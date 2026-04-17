"""
resegmenter.py — Re-segment Whisper output into subtitle-friendly cues.

Given Whisper segments with word-level timestamps, produce a new sequence
of cues that follow professional subtitle conventions (Udemy / Netflix-style):

  * Each cue stays ≤ max_chars characters (no truncation — if a cue would
    exceed, we split it into the next cue instead).
  * Each cue spans min_duration…max_duration seconds, with reading speed
    capped at max_cps (characters per second).
  * Breaks prefer:
      1. Sentence-end punctuation (. ? ! ;)
      2. Mid-sentence punctuation (, :)
      3. Conjunctions (and / but / or / so / because / that / which / when …)
      4. Word boundaries (last resort)
  * Each cue gets its own [start, end] from the actual word timestamps.
  * No ellipsis is ever inserted — the text is preserved verbatim, we only
    redraw where cue boundaries fall.

The result replaces the original Whisper segments before translation and
SRT writing, so downstream code sees uniform, one-line-friendly cues.
"""

import re
from typing import List, Dict, Optional


# ── Break-priority tokens ─────────────────────────────────────────

_SENTENCE_END = re.compile(r'[.!?;]["\')\]]*$')
_CLAUSE_MID   = re.compile(r'[,:—–-]["\')\]]*$')

# English conjunctions that make good cue boundaries when they appear
# *at the start of the next word* (i.e. current word is the last of a clause).
_CONJUNCTIONS = {
    "and", "but", "or", "so", "because", "that", "which", "who",
    "when", "while", "if", "then", "although", "though", "until",
    "before", "after", "since", "unless", "whereas",
}


def _strip_word(raw: str) -> str:
    """mlx-whisper words come with leading space; normalize."""
    return (raw or "").strip()


def _is_sentence_end(word_text: str) -> bool:
    return bool(_SENTENCE_END.search(word_text))


def _is_clause_mid(word_text: str) -> bool:
    return bool(_CLAUSE_MID.search(word_text))


def _next_is_conjunction(words: list, i: int) -> bool:
    """True if the word *after* index i is a conjunction."""
    if i + 1 >= len(words):
        return False
    nxt = _strip_word(words[i + 1].get("word", "")).lower()
    nxt = re.sub(r'^[^\w]+', '', nxt)  # strip any leading punctuation
    return nxt in _CONJUNCTIONS


def _synthesize_words(seg: dict) -> list:
    """
    Fallback when a segment lacks word-level timestamps (common with
    large-v3-turbo on mlx-whisper — alignment heads may be incomplete).

    Splits the segment's text into tokens and distributes the
    [seg.start, seg.end] window proportionally to each token's character
    length. Timing is approximate but sufficient for cue-boundary decisions
    (sentence-end punctuation usually falls near actual speech pauses).
    """
    text = (seg.get("text") or "").strip()
    if not text:
        return []
    tokens = text.split()
    if not tokens:
        return []
    seg_start = float(seg.get("start", 0.0))
    seg_end   = float(seg.get("end",   seg_start))
    duration  = max(seg_end - seg_start, 0.001)
    total_chars = sum(len(t) for t in tokens) or 1

    out = []
    cur = seg_start
    for tok in tokens:
        share = (len(tok) / total_chars) * duration
        out.append({
            "word":  " " + tok,
            "start": round(cur, 3),
            "end":   round(cur + share, 3),
        })
        cur += share
    # Snap last word's end to the exact segment end (avoid float drift).
    out[-1]["end"] = round(seg_end, 3)
    return out


# ── Public API ────────────────────────────────────────────────────

DEFAULT_CONFIG = {
    "enabled": True,
    "target_chars": 45,    # preferred cue length — try to break at/after this
    "max_chars": 70,       # hard ceiling — must break at or before this
    "min_duration": 0.8,   # seconds — cue shorter than this gets its end extended
    "max_duration": 6.0,   # seconds — cue longer than this forces a break
    "max_cps": 17.0,       # reading speed cap (chars per second)
}


def resegment(segments: list, config: Optional[dict] = None) -> list:
    """
    Re-segment a list of Whisper segments (each with .words) into
    subtitle-friendly cues.

    If segments have no word timestamps (or resegment disabled), returns
    the original segments unchanged.
    """
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    if not cfg.get("enabled", True):
        return segments

    # Flatten all words across all segments, tagging with original-segment
    # boundaries so sentence ends at segment boundaries are respected.
    # If a segment lacks word-level timestamps (some models return empty
    # words even with word_timestamps=True — notably large-v3-turbo on
    # mlx-whisper), synthesize approximate words by splitting the segment's
    # text proportionally over its time window.
    flat = []
    synthesized_count = 0
    for seg in segments:
        ws = seg.get("words") or []
        if not ws:
            ws = _synthesize_words(seg)
            if ws:
                synthesized_count += 1
        if not ws:
            # Truly empty (no text either) — skip silently.
            continue
        last_idx = len(ws) - 1
        for i, w in enumerate(ws):
            flat.append({
                "word":  w.get("word", ""),
                "start": w.get("start", seg["start"]),
                "end":   w.get("end",   seg["end"]),
                "seg_end": i == last_idx,   # True if this word ends a Whisper segment
            })

    if not flat:
        return segments

    cues = _group_words(flat, cfg)
    # Drop adjacent cues whose text is (case/punct-insensitively) identical —
    # a defense against Whisper hallucination loops that slipped past the
    # decoder's own safety nets. Runs before _enforce_timing so the merged
    # cue gets a sensible end time.
    cues = _dedup_adjacent(cues)
    # Enforce min-duration & CPS constraints by adjusting end times where
    # possible (bounded by the next cue's start so we never overlap).
    cues = _enforce_timing(cues, cfg)

    # Renumber ids from 1
    for i, c in enumerate(cues):
        c["id"] = i + 1
    return cues


# ── Grouping algorithm ────────────────────────────────────────────

def _group_words(words: list, cfg: dict) -> list:
    """
    Greedy accumulation with look-ahead break scoring.

    Invariant: each emitted cue's combined text length is ≤ max_chars.
    Preference: break at (1) sentence end, (2) clause mid-punct or pre-conjunction,
    (3) any word boundary once we've reached target_chars.
    """
    target = cfg["target_chars"]
    hard   = cfg["max_chars"]
    max_dur = cfg["max_duration"]

    cues: List[Dict] = []
    cur_words: list = []
    cur_text = ""

    def cue_duration() -> float:
        if not cur_words:
            return 0.0
        return cur_words[-1]["end"] - cur_words[0]["start"]

    def flush():
        nonlocal cur_words, cur_text
        if not cur_words:
            return
        text = " ".join(_strip_word(w["word"]) for w in cur_words).strip()
        text = re.sub(r'\s+', ' ', text)
        # Glue punctuation back to the previous word (no space before ,.?!:;)
        text = re.sub(r'\s+([,.?!:;])', r'\1', text)
        cues.append({
            "text":  text,
            "start": round(cur_words[0]["start"], 3),
            "end":   round(cur_words[-1]["end"],   3),
        })
        cur_words = []
        cur_text  = ""

    for i, w in enumerate(words):
        word_txt = _strip_word(w["word"])
        if not word_txt:
            continue
        candidate = (cur_text + " " + word_txt).strip() if cur_text else word_txt

        # ── Hard ceiling: if adding this word would exceed max_chars, flush first ──
        if len(candidate) > hard and cur_words:
            flush()
            candidate = word_txt

        cur_words.append(w)
        cur_text = candidate

        # ── Decide whether to break *after* this word ──
        reached_target = len(cur_text) >= target
        is_end         = _is_sentence_end(word_txt) or w.get("seg_end")
        is_mid         = _is_clause_mid(word_txt)
        next_is_conj   = _next_is_conjunction(words, i)

        should_break = False
        if is_end and len(cur_text) >= target * 0.6:
            # sentence boundary — break as long as we have reasonable body
            should_break = True
        elif reached_target and (is_mid or next_is_conj):
            should_break = True
        elif cue_duration() >= max_dur and cur_words:
            # duration overrun — force a break
            should_break = True
        elif len(cur_text) >= hard * 0.95 and (is_mid or next_is_conj):
            # near the hard cap with a natural seam — take it
            should_break = True

        if should_break:
            flush()

    flush()
    return cues


# ── Timing enforcement ────────────────────────────────────────────

def _enforce_timing(cues: list, cfg: dict) -> list:
    """
    Ensure each cue has:
      - duration ≥ min_duration (extend end if possible without overlap)
      - chars/sec ≤ max_cps     (extend end if possible without overlap)
    End times are only extended up to the next cue's start minus a 20ms gap,
    so we never produce overlapping cues.
    """
    min_dur = cfg["min_duration"]
    max_cps = cfg["max_cps"]
    GAP = 0.02

    for i, c in enumerate(cues):
        dur = c["end"] - c["start"]
        text_len = len(c["text"])
        needed = max(min_dur, text_len / max_cps if max_cps > 0 else 0)
        if dur >= needed:
            continue

        # Ceiling: next cue's start (or +∞ if last)
        ceiling = cues[i + 1]["start"] - GAP if i + 1 < len(cues) else c["end"] + needed
        # Collapse guard: when Whisper alignment pins multiple words to the
        # same timestamp, the next cue's start can be ≤ this cue's start,
        # making "ceiling - start" negative and the normal extension a no-op.
        # In that case give the cue a minimum visible duration anyway; it may
        # overlap the next cue slightly, which SRT players handle gracefully.
        if ceiling <= c["start"]:
            c["end"] = round(c["start"] + min_dur, 3)
            continue
        new_end = min(c["start"] + needed, ceiling)
        if new_end > c["end"]:
            c["end"] = round(new_end, 3)

    return cues


# ── Adjacent-cue deduplication (hallucination defense) ────────────

def _normalize_for_dedup(text: str) -> str:
    """Lowercase + strip non-word chars for near-identical comparison."""
    return re.sub(r'[^\w]', '', text.lower())


def _dedup_adjacent(cues: list) -> list:
    """
    Drop cue[i] when its text is (case/punct-insensitively) identical to
    cue[i-1]. The previous cue's end is extended to the dropped cue's end
    so the duration span is preserved.

    This guards against Whisper decoder loops that emit the same phrase
    back-to-back across several cues — e.g. "system to develop a system to
    develop a system to develop a…" repeating verbatim. The decoder-level
    guards (condition_on_previous_text=False + tighter compression_ratio)
    catch most cases; this is the last line of defense.
    """
    if len(cues) < 2:
        return cues
    out = [cues[0]]
    for c in cues[1:]:
        prev = out[-1]
        if _normalize_for_dedup(c["text"]) == _normalize_for_dedup(prev["text"]):
            # Absorb into the previous cue: extend its end, drop this one.
            prev["end"] = max(prev["end"], c["end"])
            continue
        out.append(c)
    return out
