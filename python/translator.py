"""
translator.py — LLM-based subtitle translation

Supports: DeepSeek, GLM, Kimi, OpenAI-compatible, MiniMax, **Anthropic (Claude)**

Most providers expose an OpenAI-compatible /v1/chat/completions endpoint.
Anthropic uses its own Messages API (/v1/messages) with a different request
and response schema, so we auto-detect and branch accordingly.

Translation flow (Chinese-semantic re-segmentation):
  1. Merge consecutive English cues into complete sentences at sentence-end
     punctuation (. ? ! ;) — this is the unit sent to the LLM.
  2. Translate sentence groups (not raw cues) in batches.
  3. Split each Chinese translation back into display-friendly cues at Chinese
     punctuation, distributing the group's [start, end] proportionally by
     character count.
  4. Return `{id, start, end, text}` segments — `write_srt` downstream is
     unchanged.

This avoids cross-cue content leaking (where the LLM borrows from the next
fragment to make the Chinese flow naturally) and produces Chinese subtitles
aligned with Chinese semantics instead of English cue boundaries.
"""

import json
import re
import time
import os
import socket
from typing import Optional, Callable
import urllib.request
import urllib.error


SYSTEM_PROMPT = """You are a professional subtitle translator.
Translate the following sentences from {src_lang} to Simplified Chinese.

Rules:
- Each input item is ONE complete sentence — translate it as a whole, aim for natural spoken Chinese
- Keep the id exactly as-is, translate only the text
- Output ONLY valid JSON, no markdown, no explanation
- Keep translations concise and subtitle-friendly
- Output format: [{{"id": 1, "text": "译文"}}, ...]"""

USER_PROMPT = """Translate these sentences to Simplified Chinese:
{segments_json}"""


# ── Sentence grouping (English → sentence-level) ─────────────────────

# Match a sentence-ending punctuation at the end of a stripped text (allowing
# trailing closing quotes/brackets and whitespace).
_EN_SENTENCE_END = re.compile(r'[.!?;]["\')\]]*\s*$')


def _group_into_sentences(segments: list, max_cues_per_group: int = 8) -> list:
    """
    Merge consecutive cues into sentence groups by end-punctuation.

    Each group: {"gid", "text", "start", "end", "source_ids": [...]}.

    max_cues_per_group caps runs without end-punct (stuttering speakers,
    auto-captions missing periods) to keep batches bounded.
    """
    groups: list = []
    buf: list = []
    parts: list = []
    gid = 0

    def flush():
        nonlocal buf, parts, gid
        if not buf:
            return
        gid += 1
        groups.append({
            "gid":        gid,
            "text":       " ".join(parts).strip(),
            "start":      float(buf[0].get("start", 0.0)),
            "end":        float(buf[-1].get("end", buf[0].get("start", 0.0))),
            "source_ids": [s.get("id") for s in buf],
        })
        buf, parts = [], []

    for seg in segments:
        text = str(seg.get("text", "")).strip()
        if not text:
            continue
        buf.append(seg)
        parts.append(text)
        ends_sentence = bool(_EN_SENTENCE_END.search(text))
        if ends_sentence or len(buf) >= max_cues_per_group:
            flush()
    flush()
    return groups


# ── Chinese re-segmentation (Chinese-semantic → subtitle cues) ───────

# Priority 1: strong breaks — Chinese sentence-end punctuation
_CN_STRONG = "。！？"
# Priority 2: clause breaks — Chinese commas and related
_CN_WEAK = "，、；：,;"


def _split_chinese_by_semantics(text: str, start: float, end: float,
                                target_chars: int = 18,
                                max_chars: int = 30) -> list:
    """
    Split a Chinese sentence into subtitle-friendly cues.

    Breaks at Chinese punctuation; falls back to a hard cut at max_chars if
    no suitable punctuation appears. Timestamps are distributed proportionally
    by character count over [start, end], with the last cue snapped to `end`
    to avoid float drift.
    """
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [{"text": text, "start": round(start, 3), "end": round(end, 3)}]

    pieces: list = []
    cur = ""
    for ch in text:
        cur += ch
        at_target = len(cur) >= target_chars
        is_strong = ch in _CN_STRONG
        is_weak = ch in _CN_WEAK
        # Break after strong punct once we have some body;
        # break after weak punct once we hit the target;
        # force a break when we hit the hard ceiling.
        if (is_strong and len(cur) >= max(4, target_chars // 2)) \
                or (is_weak and at_target) \
                or len(cur) >= max_chars:
            pieces.append(cur)
            cur = ""
    if cur:
        if pieces and len(cur) < 4:
            # tail too short to stand alone — glue to previous piece
            pieces[-1] += cur
        else:
            pieces.append(cur)

    # Distribute [start, end] proportionally by character count
    total = sum(len(p) for p in pieces) or 1
    duration = max(end - start, 0.001)
    cues: list = []
    cur_t = start
    for p in pieces:
        share = (len(p) / total) * duration
        cues.append({
            "text":  p.strip(),
            "start": round(cur_t, 3),
            "end":   round(cur_t + share, 3),
        })
        cur_t += share
    # Snap last end to exact group end (avoid float drift from accumulated shares)
    if cues:
        cues[-1]["end"] = round(end, 3)
    return cues


_CJK_RE = re.compile(r'[\u4e00-\u9fff]')


def translate_segments(
    segments: list,
    provider_config: dict,
    src_lang: str = "en",
    batch_size: int = 80,
    proxy: Optional[str] = None,
    on_progress: Optional[Callable[[float, str], None]] = None,
) -> list:
    """
    Translate a list of source-language subtitle segments to Chinese, with
    Chinese-semantic cue re-segmentation.

    provider_config: {
        "base_url": "https://api.deepseek.com/v1",
        "api_key": "sk-...",
        "model": "deepseek-chat",
    }

    Returns: a NEW list of `{id, start, end, text}` segments whose cue
    boundaries follow Chinese punctuation — not the original English cues.
    The time span of each sentence group is preserved (Chinese cues inside
    a group cover the same [start, end] as the source English cues).
    """
    if not segments:
        return segments

    _setup_proxy(proxy)

    # 1) Group English cues into complete sentences so the LLM sees full
    #    semantic units instead of mid-sentence fragments.
    groups = _group_into_sentences(segments)
    if on_progress:
        on_progress(
            0.0,
            f"合并为 {len(groups)} 个完整句（共 {len(segments)} 条原字幕）"
        )

    # 2) Batch-translate the groups. batch_size now counts groups-per-API-call
    #    rather than cues, but the same default (80) remains reasonable — a
    #    sentence typically spans 2–3 cues, so translating 80 sentences is
    #    roughly equivalent to the old "80 cues" in output volume.
    if not groups:
        return []

    batches = [groups[i:i + batch_size]
               for i in range(0, len(groups), batch_size)]
    translated_groups: list = []

    for bi, batch in enumerate(batches):
        if on_progress:
            pct = bi / max(len(batches), 1)
            on_progress(pct,
                        f"翻译第 {bi + 1}/{len(batches)} 批（{len(batch)} 句）…")
        translated_groups.extend(
            _translate_group_batch(batch, provider_config, src_lang)
        )

    # 3) Split each Chinese translation into subtitle-friendly cues, with
    #    timestamps distributed proportionally across the group's time span.
    new_segs: list = []
    next_id = 1
    for g in translated_groups:
        pieces = _split_chinese_by_semantics(
            g.get("cn_text", ""), g["start"], g["end"]
        )
        for p in pieces:
            new_segs.append({"id": next_id, **p})
            next_id += 1

    if on_progress:
        on_progress(
            1.0,
            f"翻译完成：{len(segments)} 英文 cue → {len(new_segs)} 中文 cue"
        )

    return new_segs


def _translate_group_batch(groups: list, config: dict, src_lang: str) -> list:
    """
    Translate a batch of sentence groups.

    Each returned group is the input dict with an added `cn_text` field.
    Sanity checks (JSON parse, CJK presence, id match, truncation) mirror
    the original per-cue batch but measured over groups.
    """
    input_data = [{"id": g["gid"], "text": g["text"]} for g in groups]
    segments_json = json.dumps(input_data, ensure_ascii=False, indent=2)

    system = SYSTEM_PROMPT.format(src_lang=src_lang)
    user = USER_PROMPT.format(segments_json=segments_json)

    # Adaptive output budget. Chinese output is roughly 2–3× denser per
    # character than English in BPE tokenization, so scale the cap by input
    # characters rather than group count. Cap at 8192 since several providers
    # (DeepSeek, Anthropic non-Sonnet) enforce that ceiling.
    input_chars = sum(len(g["text"]) for g in groups)
    max_tokens = min(8192, max(2048, input_chars * 3))

    response_text = _call_api(config, system, user, max_tokens=max_tokens)
    parsed = _parse_response(response_text)

    # ── Sanity checks — fail loudly instead of silently returning source text ──
    preview = response_text[:400].replace("\n", " ")
    if not parsed:
        raise RuntimeError(
            f"翻译失败：无法解析 LLM 响应为 JSON 数组。"
            f"响应前 400 字：{preview!r}"
        )

    id_to_cn = {item["id"]: item["text"] for item in parsed}
    missing = [g["gid"] for g in groups if g["gid"] not in id_to_cn]
    if len(missing) == len(groups):
        raise RuntimeError(
            f"翻译失败：LLM 返回的 id 与输入完全不匹配。"
            f"输入 ids {[g['gid'] for g in groups[:5]]}…，"
            f"返回 ids {list(id_to_cn)[:5]}…。"
            f"响应前 400 字：{preview!r}"
        )

    # Must see at least one CJK character across all returned texts, otherwise
    # the LLM didn't actually translate (echoed source, misconfigured model,
    # or responded in the wrong language).
    translated_blob = "".join(str(t) for t in id_to_cn.values())
    if translated_blob and not _CJK_RE.search(translated_blob):
        raise RuntimeError(
            f"翻译失败：LLM 响应里没有中文字符（可能返回了原文或拒绝翻译）。"
            f"检查模型配置和 API key。响应前 400 字：{preview!r}"
        )

    # Truncation detection: when max_tokens is hit mid-response, the JSON gets
    # cut off and only the first N objects parse cleanly — the rest silently
    # fall back to the source sentence. Surface it if > 20% missing.
    if len(missing) > max(1, len(groups) * 0.2):
        raise RuntimeError(
            f"翻译不完整：{len(groups)} 句中有 {len(missing)} 句未返回"
            f"（响应可能被 max_tokens 截断）。"
            f"缺失 gids: {missing[:10]}{'…' if len(missing) > 10 else ''}。"
            f"建议：调小每批字幕条数（偏好→翻译分批，建议 30–50）。"
        )

    # Attach Chinese text; fall back to source text for missed ids (< 20%).
    out: list = []
    for g in groups:
        cn = id_to_cn.get(g["gid"], g["text"])
        out.append({**g, "cn_text": cn})
    return out


def _is_anthropic(base_url: str) -> bool:
    """Return True when the base URL points to Anthropic's Messages API."""
    return "anthropic.com" in base_url


def _call_api(config: dict, system: str, user: str,
              max_tokens: int = 4096, max_retries: int = 3) -> str:
    """
    Call an LLM chat API.

    Auto-detects Anthropic (Messages API) vs OpenAI-compatible
    (chat/completions) based on the base_url.
    """
    base_url = config["base_url"].rstrip("/")
    api_key = config["api_key"]
    model = config["model"]

    if _is_anthropic(base_url):
        url = f"{base_url}/messages"
        payload = json.dumps({
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [
                {"role": "user", "content": user},
            ],
            "temperature": 0.3,
        }).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        }
    else:
        url = f"{base_url}/chat/completions"
        payload = json.dumps({
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.3,
            "max_tokens": max_tokens,
        }).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }

    is_anth = _is_anthropic(base_url)

    # Read timeout: LLMs for batched subtitle translation (up to 4096 output
    # tokens + possible network overhead via proxy) can take 60–120s easily
    # for Anthropic Claude / OpenAI GPT-4 class models. 180s leaves headroom
    # for slow proxies without hanging forever.
    READ_TIMEOUT = 180

    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=READ_TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if is_anth:
                    # Anthropic response: {"content": [{"type":"text","text":"..."}], ...}
                    content = data["content"][0]["text"]
                else:
                    content = data["choices"][0]["message"]["content"]
                if not (content or "").strip():
                    raise RuntimeError("API 返回空响应（可能触发了频率限制或内容过滤）")
                return content
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            if attempt < max_retries - 1:
                time.sleep(min(30, 3 ** attempt))
                continue
            raise RuntimeError(f"API error {e.code}: {body}")
        except socket.timeout as e:
            if attempt < max_retries - 1:
                time.sleep(min(30, 3 ** attempt))
                continue
            raise RuntimeError(
                f"API {base_url} 超时（{READ_TIMEOUT}s 无响应）。"
                f"建议：1) 确认代理可达；2) 调小每批字幕条数（偏好→翻译分批）；"
                f"3) 换更快的模型（如 claude-haiku 或 deepseek-chat）"
            ) from e
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(min(30, 3 ** attempt))
                continue
            raise

    raise RuntimeError("API call failed after retries")


def _parse_response(text: str) -> list:
    """Extract JSON array from LLM response, tolerating markdown fences."""
    # strip markdown code fences
    text = re.sub(r'^```(?:json)?\s*', '', text.strip(), flags=re.MULTILINE)
    text = re.sub(r'\s*```$', '', text.strip(), flags=re.MULTILINE)
    text = text.strip()

    # find first [ ... ]
    match = re.search(r'\[.*\]', text, re.DOTALL)
    if match:
        text = match.group(0)

    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass

    # fallback: try to extract individual {"id":..,"text":..} objects
    items = re.findall(r'\{\s*"id"\s*:\s*(\d+)\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}', text)
    return [{"id": int(i), "text": t} for i, t in items]


def test_connection(config: dict, proxy: Optional[str] = None) -> dict:
    """
    Quick connection test — sends a minimal API request.
    Returns {"ok": True, "model": "...", "latency_ms": 123}
            {"ok": False, "error": "..."}
    """
    _setup_proxy(proxy)

    start = time.time()
    try:
        _call_api(config, "You are a test assistant.", "Reply with: OK")
        latency = int((time.time() - start) * 1000)
        return {"ok": True, "model": config["model"], "latency_ms": latency}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _setup_proxy(proxy_url):
    """
    Install a urllib opener that matches the requested proxy mode.

    proxy_url can be:
      - None / falsy → remove any custom opener (urllib reads no proxy)
      - "system"     → install default opener that auto-reads HTTP_PROXY env vars
      - "http://..."/"socks5://..." → install opener that always uses that URL
    """
    if not proxy_url:
        # Default opener with empty ProxyHandler → bypass env-var proxies entirely
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        urllib.request.install_opener(opener)
        return
    if proxy_url == "system":
        # Default opener (no explicit ProxyHandler) → urllib reads env vars per-request
        urllib.request.install_opener(urllib.request.build_opener())
        return
    proxy_handler = urllib.request.ProxyHandler({
        "http": proxy_url,
        "https": proxy_url,
    })
    opener = urllib.request.build_opener(proxy_handler)
    urllib.request.install_opener(opener)
