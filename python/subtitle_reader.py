"""
subtitle_reader.py — Parse SRT and VTT subtitle files into segment lists.

Segments are dicts compatible with translator.py and srt_writer.py:
    {"id": 1, "start": 0.0, "end": 2.5, "text": "Hello world"}
"""

import re


# ── Time conversion helpers ───────────────────────────────────────

def _srt_time_to_seconds(ts: str) -> float:
    """00:01:23,456 → 83.456"""
    ts = ts.replace('.', ',')  # also accept dot separator
    h, m, rest = ts.split(':')
    s, ms = rest.split(',')
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def _vtt_time_to_seconds(ts: str) -> float:
    """00:01:23.456 or 01:23.456 → seconds"""
    ts = ts.replace(',', '.')
    parts = ts.split(':')
    if len(parts) == 3:
        h, m, s = parts
    elif len(parts) == 2:
        h, m, s = '0', parts[0], parts[1]
    else:
        return 0.0
    return int(h) * 3600 + int(m) * 60 + float(s)


# ── SRT parser ────────────────────────────────────────────────────

def parse_srt(content: str) -> list:
    """
    Parse SRT content into a list of segment dicts.
    Handles BOM, HTML tags, and multi-line cues.
    """
    content = content.lstrip('\ufeff')  # strip BOM
    segments = []
    # split on 1+ blank lines between cues
    blocks = re.split(r'\n\s*\n', content.strip())
    for block in blocks:
        lines = [ln.rstrip() for ln in block.strip().splitlines()]
        if len(lines) < 3:
            continue
        # first line: sequence number (required)
        try:
            idx = int(lines[0].strip())
        except ValueError:
            continue
        # second line: timestamps
        ts = re.match(
            r'(\d{1,2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{3})',
            lines[1]
        )
        if not ts:
            continue
        start = _srt_time_to_seconds(ts.group(1))
        end   = _srt_time_to_seconds(ts.group(2))
        # remaining lines: text (may be multi-line)
        text = '\n'.join(lines[2:]).strip()
        # strip HTML tags (e.g. <i>, <b>, <font color="...">)
        text = re.sub(r'<[^>]+>', '', text).strip()
        if text:
            segments.append({'id': idx, 'start': start, 'end': end, 'text': text})
    return segments


# ── VTT parser ────────────────────────────────────────────────────

def parse_vtt(content: str) -> list:
    """
    Parse WebVTT content into a list of segment dicts.
    Handles optional cue identifiers, NOTE and STYLE blocks.
    """
    content = content.lstrip('\ufeff')
    # drop WEBVTT header line
    content = re.sub(r'^WEBVTT[^\n]*\n', '', content, count=1)
    # drop NOTE and STYLE blocks
    content = re.sub(r'(NOTE|STYLE)\b[^\n]*\n.*?(?=\n\s*\n|\Z)', '', content,
                     flags=re.DOTALL)

    segments = []
    blocks = re.split(r'\n\s*\n', content.strip())
    auto_idx = 1
    for block in blocks:
        lines = [ln.rstrip() for ln in block.strip().splitlines()]
        if not lines:
            continue
        if lines[0].startswith(('NOTE', 'STYLE')):
            continue

        # optional cue identifier (first line has no '-->')
        start_line = 0
        cue_id = auto_idx
        if '-->' not in lines[0]:
            try:
                cue_id = int(lines[0].strip())
            except ValueError:
                pass  # string id, ignore
            start_line = 1

        if start_line >= len(lines):
            continue

        # timestamp line (may have positioning info after the time range)
        ts = re.match(
            r'(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})'
            r'\s*-->\s*'
            r'(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})',
            lines[start_line]
        )
        if not ts:
            continue

        start = _vtt_time_to_seconds(ts.group(1))
        end   = _vtt_time_to_seconds(ts.group(2))
        text  = '\n'.join(lines[start_line + 1:]).strip()
        text  = re.sub(r'<[^>]+>', '', text).strip()  # strip HTML tags
        if text:
            segments.append({'id': cue_id, 'start': start, 'end': end, 'text': text})
            auto_idx = cue_id + 1

    return segments
