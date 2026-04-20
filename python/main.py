"""
main.py — AutoSubs Lite processing engine

Communicates with the Tauri frontend via newline-delimited JSON on stdout.
Receives commands from Tauri via stdin (one JSON object per line).

stdout events → frontend:
    {"type": "progress",       "file": "ep01.mp4", "stage": "transcribe|translate|write", "pct": 0.0-1.0, "msg": "..."}
    {"type": "file_done",      "file": "ep01.mp4", "language": "en", "srt_en": "...", "srt_cn": null}
    {"type": "file_error",     "file": "ep01.mp4", "error": "..."}
    {"type": "queue_done",     "total": 7, "done": 6, "errors": 1, "stopped": false}
    {"type": "folder_scanned", "task": {...}, "resumed": true, "summary": {...}}
    {"type": "test_result",    "ok": true, "latency_ms": 234}
    {"type": "test_result",    "ok": false, "error": "..."}
    {"type": "download_progress", "model": "base", "pct": 0.5, "msg": "..."}
    {"type": "download_done",  "model": "base", "path": "..."}
    {"type": "download_error", "model": "base", "error": "..."}
    {"type": "log",            "level": "info|warn|error", "msg": "..."}

stdin commands → engine:
    {"cmd": "start",          "config": {...}}
    {"cmd": "stop"}
    {"cmd": "test_llm",       "provider": {...}, "proxy": null}
    {"cmd": "scan_folder",    "root_dir": "..."}
    {"cmd": "download_model", "model": "base", "model_dir": "~/autosubs/models"}
    {"cmd": "ping"}
"""

import sys
import json
import os
import threading
import time
from datetime import datetime

# Make sure relative imports work even when launched with absolute path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from transcriber import transcribe
from translator  import translate_segments, test_connection
from srt_writer  import write_srt, write_vtt, get_srt_path, get_cn_subtitle_path
from task_file   import (
    load_task, create_task, save_task, merge_with_scan,
    update_file_status, get_pending_files, summary as task_summary,
    scan_folder, scan_subtitle_folder,
    SUBTITLE_EXTENSIONS,
)

_SUBTITLE_EXTS = SUBTITLE_EXTENSIONS


def _is_subtitle_file(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in _SUBTITLE_EXTS

_stop_flag = threading.Event()
_worker: threading.Thread | None = None


# ── Emit helpers ──────────────────────────────────────────────────

def emit(obj: dict):
    """Write a JSON event line to stdout (Tauri reads this)."""
    print(json.dumps(obj, ensure_ascii=False), flush=True)

def emit_progress(file: str, stage: str, pct: float, msg: str):
    emit({"type": "progress", "file": file, "stage": stage,
          "pct": round(pct, 3), "msg": msg})

def emit_log(level: str, msg: str):
    emit({"type": "log", "level": level, "msg": msg})


# ── Proxy: configure environment so urllib/requests/httpx all pick it up ──

def apply_proxy(proxy):
    """
    proxy can be:
      - None / falsy → clear any proxy env vars
      - "system"     → leave existing env vars (system proxy already inherited)
      - "http://host:port" / "socks5://host:port" → export to env
    """
    if not proxy:
        for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
                  "http_proxy", "https_proxy", "all_proxy"):
            os.environ.pop(k, None)
        return
    if proxy == "system":
        return
    os.environ["HTTP_PROXY"]  = proxy
    os.environ["HTTPS_PROXY"] = proxy
    os.environ["ALL_PROXY"]   = proxy
    os.environ["http_proxy"]  = proxy
    os.environ["https_proxy"] = proxy
    os.environ["all_proxy"]   = proxy


# ── Dependency self-check ────────────────────────────────────────

def check_dependencies():
    """Verify a Whisper backend is importable. Emit a clear error if not."""
    try:
        import mlx_whisper  # noqa: F401
        return "mlx-whisper"
    except ImportError:
        pass
    try:
        from faster_whisper import WhisperModel  # noqa: F401
        return "faster-whisper"
    except ImportError:
        pass
    emit_log(
        "error",
        "缺少 Whisper 后端：请安装 mlx-whisper 或 faster-whisper "
        "(pip install mlx-whisper)。"
    )
    return None


# ── Process a single video file ───────────────────────────────────

def process_file(abs_path: str, rel_path: str, config: dict) -> dict:
    """
    Transcribe + optionally translate one video file.
    Returns {"srt_en": "...", "srt_cn": "...|None", "language": "en"}.
    Raises on error.
    """
    fname      = os.path.basename(abs_path)
    model_name = config.get("model", "base")
    language   = config.get("language") or None
    model_dir  = config.get("model_dir", "~/autosubs/models")
    generate_cn = config.get("generate_cn", False)
    llm        = config.get("llm_provider")
    batch_size = config.get("batch_size", 80)
    proxy      = config.get("proxy")
    fmt        = config.get("fmt", {})

    # ── Stage 1: Transcribe ──
    def on_transcribe(pct, msg):
        emit_progress(rel_path, "transcribe", pct * 0.70, msg)

    result   = transcribe(abs_path, model_name=model_name, language=language,
                          model_dir=model_dir, on_progress=on_transcribe)
    segments = result["segments"]
    detected = result.get("language", "und")

    if not segments:
        raise ValueError("Transcription returned no segments — check audio content")

    # ── Stage 1.5: Optionally re-segment using word-level timestamps ──
    # This runs ONCE so English + Chinese SRTs share identical cue boundaries.
    if fmt.get("resegment_enabled"):
        from resegmenter import resegment, DEFAULT_CONFIG as RSEG_DEFAULT
        rseg_cfg = {
            "enabled":      True,
            "target_chars": fmt.get("resegment_target_chars", RSEG_DEFAULT["target_chars"]),
            "max_chars":    fmt.get("resegment_max_chars",    RSEG_DEFAULT["max_chars"]),
            "min_duration": fmt.get("resegment_min_duration", RSEG_DEFAULT["min_duration"]),
            "max_duration": fmt.get("resegment_max_duration", RSEG_DEFAULT["max_duration"]),
            "max_cps":      fmt.get("resegment_max_cps",      RSEG_DEFAULT["max_cps"]),
        }
        before = len(segments)
        # Detect missing word-level timestamps before calling — some models
        # (notably large-v3-turbo on mlx-whisper) return empty words[] even
        # with word_timestamps=True. The resegmenter will synthesize from
        # text/duration, but we warn the user so they understand cue
        # boundaries are estimated rather than aligned to actual speech.
        missing_words = sum(1 for s in segments if not (s.get("words") or []))
        if missing_words:
            emit_log("warn",
                     f"{fname}: {missing_words}/{before} 段缺少词级时间戳"
                     f"（模型 {model_name} 不支持），将按文本均分估算切分点")
        segments = resegment(segments, rseg_cfg)
        emit_log("info",
                 f"{fname}: 重分段 {before} → {len(segments)} 条"
                 f"（目标 {rseg_cfg['target_chars']} 字符，≤ {rseg_cfg['max_chars']}）")

    # ── Stage 2: Write original-language SRT ──
    emit_progress(rel_path, "write", 0.72, f"Writing {detected} subtitles…")
    srt_en_abs = get_srt_path(abs_path, detected)
    write_srt(segments, srt_en_abs, fmt)

    srt_cn_abs = None

    # ── Stage 3: Translate → Chinese (optional) ──
    if generate_cn and llm and detected != "zh":
        emit_progress(rel_path, "translate", 0.75, "Starting translation…")

        def on_translate(pct, msg):
            emit_progress(rel_path, "translate", 0.75 + pct * 0.22, msg)

        cn_segs   = translate_segments(segments, provider_config=llm,
                                        src_lang=detected, batch_size=batch_size,
                                        proxy=proxy, on_progress=on_translate)
        emit_progress(rel_path, "write", 0.97, "Writing Chinese subtitles…")
        srt_cn_abs = get_srt_path(abs_path, "zh-CN")
        write_srt(cn_segs, srt_cn_abs, fmt)

    elif generate_cn and detected == "zh":
        emit_log("info", f"Source is already Chinese for {fname} — skipping translation")

    emit_progress(rel_path, "write", 1.0, "Done")
    return {
        "language": detected,
        "srt_en":   srt_en_abs,
        "srt_cn":   srt_cn_abs,
    }


# ── Process a single subtitle file (translate-only mode) ─────────

def process_subtitle_file(abs_path: str, rel_path: str, config: dict) -> dict:
    """
    Translate an existing subtitle file to Chinese.
    Reads → parses → translates → writes .zh-CN.srt / .zh-CN.vtt.
    Returns {"srt_en": original_path, "srt_cn": cn_path, "language": "en"}.
    Raises on error.
    """
    fname       = os.path.basename(abs_path)
    generate_cn = config.get("generate_cn", False)
    llm         = config.get("llm_provider")
    batch_size  = config.get("batch_size", 80)
    proxy       = config.get("proxy")
    fmt         = config.get("fmt", {})

    if not generate_cn:
        raise ValueError("字幕文件模式需要开启「生成中文字幕」选项")
    if not llm:
        raise ValueError("字幕翻译需要配置翻译模型（偏好设置 → 翻译模型）")

    # ── Stage 1: Read and parse subtitle file ──
    emit_progress(rel_path, "read", 0.05, "Reading subtitle file…")
    ext = os.path.splitext(abs_path)[1].lower()

    with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    from subtitle_reader import parse_srt, parse_vtt
    segments = parse_vtt(content) if ext == ".vtt" else parse_srt(content)

    if not segments:
        raise ValueError(f"无法解析字幕文件 {fname}（内容为空或格式不受支持）")

    emit_log("info", f"{fname}: 读取到 {len(segments)} 条字幕")

    # ── Stage 2: Translate → Chinese ──
    emit_progress(rel_path, "translate", 0.10, f"Translating {len(segments)} segments…")

    def on_translate(pct, msg):
        emit_progress(rel_path, "translate", 0.10 + pct * 0.85, msg)

    cn_segs = translate_segments(
        segments, provider_config=llm,
        src_lang="en", batch_size=batch_size,
        proxy=proxy, on_progress=on_translate,
    )

    # ── Stage 3: Write output ──
    emit_progress(rel_path, "write", 0.97, "Writing Chinese subtitle…")
    cn_path = get_cn_subtitle_path(abs_path)
    if ext == ".vtt":
        write_vtt(cn_segs, cn_path)
    else:
        write_srt(cn_segs, cn_path, fmt)

    emit_progress(rel_path, "write", 1.0, "Done")
    return {
        "language": "en",
        "srt_en":   abs_path,  # original subtitle (source)
        "srt_cn":   cn_path,
    }


# ── Process queue ─────────────────────────────────────────────────

def run_queue(config: dict):
    _stop_flag.clear()

    apply_proxy(config.get("proxy"))

    root_dir  = config.get("root_dir")
    auto_save = config.get("auto_save_task", True)
    skip_srt  = config.get("skip_existing_srt", True)

    # ── Build pending list ──────────────────────────────────────────
    # Each item: {path, _abs, _rel, status, is_subtitle, _task_item}
    pending = []

    # Video files via task file (rootDir folder-scan mode)
    if root_dir:
        task = load_task(root_dir)
        if task:
            task = merge_with_scan(root_dir, task)
        else:
            snap = {k: v for k, v in config.items() if k != "llm_provider"}
            task = create_task(root_dir, config.get("model", "base"), snap)
        for item in get_pending_files(task, skip_existing_srt=skip_srt):
            pending.append({
                **item,
                "_abs":       os.path.join(root_dir, item["path"]),
                "_rel":       item["path"],
                "is_subtitle": False,
                "_task_item": True,
            })
    else:
        task = None

    # Explicit file list — subtitle files (always absolute paths) and
    # individual video files added without a rootDir scan.
    for f in config.get("files", []):
        if isinstance(f, dict):
            p      = f["path"]
            is_sub = f.get("is_subtitle", False)
        else:
            p      = f
            is_sub = _is_subtitle_file(p)
        pending.append({
            "path":        p,
            "_abs":        p,
            "_rel":        p,
            "status":      "pending",
            "is_subtitle": is_sub,
            "_task_item":  False,
        })

    total = len(pending)
    done  = 0
    errs  = 0

    for item in pending:
        if _stop_flag.is_set():
            break

        abs_path   = item["_abs"]
        rel_path   = item["_rel"]
        is_subtitle = item.get("is_subtitle", False) or _is_subtitle_file(abs_path)

        if not os.path.exists(abs_path):
            emit({"type": "file_error", "file": rel_path, "error": "File not found"})
            errs += 1
            continue

        # Mark as processing in task file (only for rootDir task items)
        if task and item.get("_task_item"):
            update_file_status(task, rel_path, status="processing")
            if auto_save: save_task(root_dir, task)

        try:
            if is_subtitle:
                result = process_subtitle_file(abs_path, rel_path, config)
            else:
                result = process_file(abs_path, rel_path, config)

            # Make paths relative for task file display; keep absolute for subtitle files
            srt_en = result.get("srt_en")
            srt_cn = result.get("srt_cn")
            if item.get("_task_item") and root_dir:
                srt_en = os.path.relpath(srt_en, root_dir) if srt_en else None
                srt_cn = os.path.relpath(srt_cn, root_dir) if srt_cn else None

            emit({"type": "file_done", "file": rel_path,
                  "language": result["language"],
                  "srt_en": srt_en, "srt_cn": srt_cn})

            if task and item.get("_task_item"):
                update_file_status(task, rel_path, status="done",
                                   language=result["language"],
                                   srt_en=srt_en, srt_cn=srt_cn,
                                   finished_at=_now(), error=None)
                if auto_save: save_task(root_dir, task)
            done += 1

        except Exception as e:
            msg = str(e)
            emit({"type": "file_error", "file": rel_path, "error": msg})
            if task and item.get("_task_item"):
                update_file_status(task, rel_path, status="error", error=msg)
                if auto_save: save_task(root_dir, task)
            errs += 1

    emit({"type": "queue_done", "total": total, "done": done,
          "errors": errs, "stopped": _stop_flag.is_set()})


# ── Download model ────────────────────────────────────────────────

def run_download(model: str, model_dir: str, proxy=None):
    apply_proxy(proxy)
    def on_progress(pct, msg):
        emit({"type": "download_progress", "model": model,
              "pct": round(pct, 3), "msg": msg})
    try:
        from transcriber import download_model
        download_model(model, model_dir=model_dir, on_progress=on_progress)
        local_path = os.path.join(os.path.expanduser(model_dir), f"mlx-{model}")
        emit({"type": "download_done", "model": model, "path": local_path})
    except Exception as e:
        emit({"type": "download_error", "model": model, "error": str(e)})


# ── Scan subtitle folder ──────────────────────────────────────────

def run_subtitle_scan(root_dir: str):
    files = scan_subtitle_folder(root_dir)
    emit({"type": "subtitle_folder_scanned", "files": files, "root_dir": root_dir})


# ── Scan video folder ─────────────────────────────────────────────

def run_scan(root_dir: str):
    task = load_task(root_dir)
    if task:
        task = merge_with_scan(root_dir, task)
        save_task(root_dir, task)
        emit({"type": "folder_scanned", "task": task,
              "resumed": True, "summary": task_summary(task)})
    else:
        files = scan_folder(root_dir)
        emit({"type": "folder_scanned", "files": files, "resumed": False})


# ── Main command loop ─────────────────────────────────────────────

def main():
    global _worker
    emit_log("info", f"AutoSubs Lite Python engine started (python {sys.version.split()[0]})")
    backend = check_dependencies()
    if backend:
        emit_log("info", f"Whisper backend detected: {backend}")

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue

        try:
            cmd = json.loads(raw)
        except json.JSONDecodeError as e:
            emit_log("warn", f"Invalid JSON from Tauri: {e}")
            continue

        action = cmd.get("cmd", "")

        # ── ping (health check) ──
        if action == "ping":
            emit({"type": "pong"})

        # ── start queue ──
        elif action == "start":
            if _worker and _worker.is_alive():
                emit_log("warn", "Queue already running")
                continue
            _stop_flag.clear()
            _worker = threading.Thread(
                target=run_queue, args=(cmd["config"],), daemon=True)
            _worker.start()

        # ── stop queue ──
        elif action == "stop":
            _stop_flag.set()
            emit_log("info", "Stop signal sent")

        # ── test LLM connection ──
        elif action == "test_llm":
            provider    = cmd.get("provider", {})
            provider_id = cmd.get("provider_id")
            proxy       = cmd.get("proxy")
            apply_proxy(proxy)
            def _do_test(_prov=provider, _pid=provider_id, _proxy=proxy):
                # Echo provider_id back so the UI can match result → card
                result = test_connection(_prov, proxy=_proxy)
                emit({"type": "test_result", "provider_id": _pid, **result})
            threading.Thread(target=_do_test, daemon=True).start()

        # ── test proxy connectivity (no LLM key required) ──
        elif action == "test_proxy":
            proxy = cmd.get("proxy")
            apply_proxy(proxy)
            def _run_proxy_test():
                import urllib.request, time as _t
                # Reset urllib opener so env-var-based proxy is used
                try:
                    from translator import _setup_proxy
                    _setup_proxy(proxy)
                except Exception:
                    pass
                start = _t.time()
                target_url = "https://www.google.com/generate_204"
                try:
                    req = urllib.request.Request(target_url, method="GET",
                                                 headers={"User-Agent": "AutoSubsLite/0.1"})
                    with urllib.request.urlopen(req, timeout=8) as resp:
                        latency = int((_t.time() - start) * 1000)
                        emit({"type": "proxy_test_result", "ok": True,
                              "status": resp.status, "latency_ms": latency,
                              "url": target_url})
                except Exception as e:
                    emit({"type": "proxy_test_result", "ok": False,
                          "error": str(e), "url": target_url})
            threading.Thread(target=_run_proxy_test, daemon=True).start()

        # ── scan folder for subtitle files ──
        elif action == "scan_subtitle_folder":
            root = cmd.get("root_dir", "")
            if not root or not os.path.isdir(root):
                emit_log("error", f"scan_subtitle_folder: invalid path '{root}'")
                continue
            threading.Thread(target=run_subtitle_scan, args=(root,), daemon=True).start()

        # ── scan folder for videos ──
        elif action == "scan_folder":
            root = cmd.get("root_dir", "")
            if not root or not os.path.isdir(root):
                emit_log("error", f"scan_folder: invalid path '{root}'")
                continue
            threading.Thread(target=run_scan, args=(root,), daemon=True).start()

        # ── download Whisper model ──
        elif action == "download_model":
            model     = cmd.get("model", "base")
            model_dir = cmd.get("model_dir", "~/autosubs/models")
            proxy     = cmd.get("proxy")
            threading.Thread(
                target=run_download, args=(model, model_dir, proxy), daemon=True).start()

        # ── list locally installed Whisper models ──
        elif action == "list_models":
            from transcriber import is_model_complete
            model_dir = os.path.expanduser(cmd.get("model_dir", "~/autosubs/models"))
            local = []
            if os.path.isdir(model_dir):
                for entry in os.listdir(model_dir):
                    full = os.path.join(model_dir, entry)
                    if not os.path.isdir(full):
                        continue
                    # mlx-whisper layout: mlx-{name}/  with weights.npz / config.json
                    if entry.startswith("mlx-"):
                        name = entry[len("mlx-"):]
                    else:
                        name = entry
                    # Only report a model as installed if its weights file is present
                    # and plausibly large — partial downloads must NOT show as ✓.
                    if is_model_complete(name, model_dir):
                        local.append(name)
            emit({"type": "models_listed", "models": local, "dir": model_dir})

        else:
            emit_log("warn", f"Unknown command: {action}")


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


if __name__ == "__main__":
    main()
