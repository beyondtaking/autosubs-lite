"""
srt_writer.py — SRT file generation + text formatting pipeline

Text processing order:
  1. Remove filler words (optional)
  2. Text case conversion
  3. Remove punctuation (optional)
  4. Censor sensitive words
  5. Line breaking (NLP / word / char)
  6. Enforce max lines & max chars
"""

import re
import os
from typing import Optional

# ── Subtitle output path helpers ──────────────────────────────────

# Language tag suffixes that may appear before the file extension
# e.g.  "lesson01.en.srt" → strip ".en" → "lesson01.cn.srt"
_LANG_TAG_RE = re.compile(
    r'\.(en|zh|ja|ko|fr|de|es|it|ru|pt|ar|nl|pl|sv|da|fi|cs|hu|tr|vi|th|id|ms|uk|hr|bg|ro|sk|no|ca|he|hi)$',
    re.IGNORECASE
)


# ── SRT TIMESTAMP ────────────────────────────────────────────────
def _seconds_to_srt_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


# ── TEXT FORMATTING ───────────────────────────────────────────────

FILLER_WORDS = re.compile(
    r'\b(uh+|um+|you know|like|i mean|sort of|kind of|basically|literally|actually|right\?)\b',
    re.IGNORECASE
)

def apply_text_formatting(text: str, config: dict) -> str:
    """
    Apply formatting rules to a single subtitle text string.

    config keys:
        remove_fillers      bool   default False
        text_case           str    "original"|"sentence"|"upper"|"lower"|"title"
        remove_punctuation  bool   default False
        keep_ellipsis       bool   default True
        censor_enabled      bool   default False
        censor_words        list   []
        censor_char         str    "****"
        censor_case_insensitive bool default True
    """

    # 1. Remove filler words
    if config.get("remove_fillers", False):
        text = FILLER_WORDS.sub("", text)
        text = re.sub(r'\s{2,}', ' ', text).strip()
        # strip leading comma/space that filler removal might leave
        text = re.sub(r'^[,\s]+', '', text)

    # 2. Text case
    case = config.get("text_case", "original")
    if case == "upper":
        text = text.upper()
    elif case == "lower":
        text = text.lower()
    elif case == "sentence":
        text = text[:1].upper() + text[1:].lower() if text else text
    elif case == "title":
        text = text.title()
    # "original" → no change

    # 3. Remove punctuation
    if config.get("remove_punctuation", False):
        if config.get("keep_ellipsis", True):
            # protect ellipsis before stripping
            text = text.replace("...", "\x00ELLIPSIS\x00")
            text = re.sub(r'[^\w\s\x00]', '', text)
            text = text.replace("\x00ELLIPSIS\x00", "…")
        else:
            text = re.sub(r'[^\w\s]', '', text)
        text = re.sub(r'\s{2,}', ' ', text).strip()

    # 4. Censor
    if config.get("censor_enabled", False):
        words = config.get("censor_words", [])
        char = config.get("censor_char", "****")
        flags = re.IGNORECASE if config.get("censor_case_insensitive", True) else 0
        for w in words:
            if not w:
                continue
            if char == "首尾保留" and len(w) > 2:
                replacement = w[0] + "*" * (len(w) - 2) + w[-1]
            else:
                replacement = char
            text = re.sub(r'\b' + re.escape(w) + r'\b', replacement, text, flags=flags)

    return text.strip()


# ── LINE BREAKING ─────────────────────────────────────────────────

def break_lines(text: str, max_chars: int = 42, max_lines: int = 2,
                method: str = "nlp") -> str:
    """
    Break text into multiple subtitle lines.

    method: "nlp" | "word" | "char"
    max_lines: 0 or negative → unlimited (no truncation, no ellipsis)
    """
    if len(text) <= max_chars:
        return text

    if method == "char":
        lines = [text[i:i + max_chars] for i in range(0, len(text), max_chars)]
    elif method == "nlp":
        lines = _nlp_break(text, max_chars)
    else:  # word
        lines = _word_break(text, max_chars)

    # max_lines <= 0 → unlimited, return all lines with no truncation
    if max_lines is None or max_lines <= 0:
        return "\n".join(lines)

    total_lines = len(lines)
    lines = lines[:max_lines]
    # Only append ellipsis when we actually dropped one or more lines of content
    if total_lines > max_lines and lines:
        lines[-1] = lines[-1].rstrip() + "…"

    return "\n".join(lines)


def _word_break(text: str, max_chars: int) -> list:
    words = text.split()
    lines, current = [], ""
    for word in words:
        candidate = (current + " " + word).strip()
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _nlp_break(text: str, max_chars: int) -> list:
    """
    Prefer breaking at natural clause boundaries:
    commas, conjunctions (and/but/or/so/because/when/if/that/which/who)
    before falling back to word-wrap.
    """
    # clause boundary pattern
    boundary = re.compile(
        r'(?<=[^,])(,\s*|\s+(?:and|but|or|so|because|when|if|that|which|who|then|although|while|though)\s+)',
        re.IGNORECASE
    )

    if len(text) <= max_chars:
        return [text]

    # try to find a boundary near the midpoint
    mid = len(text) // 2
    best_pos = None
    best_dist = len(text)

    for m in boundary.finditer(text):
        pos = m.start()
        dist = abs(pos - mid)
        if dist < best_dist and pos > 4 and pos < len(text) - 4:
            best_dist = dist
            best_pos = m.end()

    if best_pos:
        left = text[:best_pos].rstrip(", ")
        right = text[best_pos:].lstrip()
        # recurse each half if still too long
        return _nlp_break(left, max_chars) + _nlp_break(right, max_chars)
    else:
        return _word_break(text, max_chars)


# ── SRT WRITER ────────────────────────────────────────────────────

def segments_to_srt(segments: list, fmt_config: dict) -> str:
    """Convert segment list to SRT string with formatting applied."""
    lines = []
    idx = 1
    for seg in segments:
        text = seg.get("text", "").strip()
        if not text:
            continue

        text = apply_text_formatting(text, fmt_config)
        if not text:
            continue

        text = break_lines(
            text,
            max_chars=fmt_config.get("max_chars_per_line", 34),
            max_lines=fmt_config.get("max_lines", 1),
            method=fmt_config.get("line_break_method", "nlp"),
        )

        start = _seconds_to_srt_time(seg["start"])
        end = _seconds_to_srt_time(seg["end"])

        lines.append(str(idx))
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")
        idx += 1

    return "\n".join(lines)


def write_srt(segments: list, output_path: str, fmt_config: dict) -> None:
    """Write segments to an SRT file."""
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    content = segments_to_srt(segments, fmt_config)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)


def get_srt_path(video_path: str, lang: str = "en") -> str:
    """
    Derive SRT path from video path.
    /path/to/video.mp4 → /path/to/video.en.srt
    """
    base = os.path.splitext(video_path)[0]
    return f"{base}.{lang}.srt"


def get_cn_subtitle_path(subtitle_path: str) -> str:
    """
    Compute the Chinese-translation output path for a subtitle file,
    preserving the original format extension.

    Examples:
        lesson01.en.srt  →  lesson01.cn.srt
        lesson01.srt     →  lesson01.cn.srt
        lesson01.en.vtt  →  lesson01.cn.vtt
        lesson01.vtt     →  lesson01.cn.vtt
    """
    dirname  = os.path.dirname(subtitle_path)
    basename = os.path.basename(subtitle_path)
    name, ext = os.path.splitext(basename)       # ext: ".srt" | ".vtt" | …
    # strip language tag if present (e.g. ".en" from "lesson01.en")
    name = _LANG_TAG_RE.sub('', name)
    return os.path.join(dirname, f"{name}.cn{ext}")


# ── VTT WRITER ────────────────────────────────────────────────────

def _seconds_to_vtt_time(seconds: float) -> str:
    h  = int(seconds // 3600)
    m  = int((seconds % 3600) // 60)
    s  = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def write_vtt(segments: list, output_path: str) -> None:
    """Write segments to a WebVTT file."""
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    lines = ["WEBVTT", ""]
    i = 1
    for seg in segments:
        text = seg.get("text", "").strip()
        if not text:
            continue
        start = _seconds_to_vtt_time(seg["start"])
        end   = _seconds_to_vtt_time(seg["end"])
        lines.append(str(i))
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")
        i += 1
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
