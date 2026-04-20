"""
task_file.py — Task file management (.autosubs_task.json)

Written to the root folder of the video batch.
Tracks per-file status so sessions can be resumed.

Schema:
{
    "version": "1",
    "created": "2024-06-12T14:33:00",
    "updated": "2024-06-12T15:10:00",
    "root_dir": "/Videos/Series",
    "model": "base",
    "settings": { ...snapshot of processing settings... },
    "files": [
        {
            "path": "Season1/ep01.mp4",     # relative to root_dir
            "status": "done",               # pending | processing | done | error
            "srt_en": "Season1/ep01.en.srt",
            "srt_cn": "Season1/ep01.cn.srt",  # null if cn not requested
            "language": "en",
            "duration": 1472.3,
            "finished_at": "2024-06-12T14:50:22",
            "error": null
        },
        ...
    ]
}
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

TASK_FILENAME = ".autosubs_task.json"
VIDEO_EXTENSIONS    = {".mp4", ".mkv", ".mov", ".avi", ".wmv", ".flv", ".webm", ".m4v", ".ts"}
SUBTITLE_EXTENSIONS = {".srt", ".vtt", ".ass", ".ssa", ".sub", ".smi"}


# ── SCAN ─────────────────────────────────────────────────────────

def scan_subtitle_folder(root_dir: str) -> list:
    """
    Recursively scan root_dir for subtitle files.
    Excludes already-translated .cn.* files.
    Returns list of dicts sorted by relative path.
    """
    root = Path(root_dir)
    files = []
    for f in sorted(root.rglob("*")):
        if f.suffix.lower() not in SUBTITLE_EXTENSIONS or not f.is_file():
            continue
        # Skip files that are already Chinese translations (foo.zh-CN.srt / foo.cn.srt)
        stem = f.stem  # "lesson01.en" for "lesson01.en.srt"
        if stem.lower().endswith('.zh-cn') or stem.lower().endswith('.cn'):
            continue
        rel = str(f.relative_to(root))
        files.append({
            "path":        rel,
            "status":      "pending",
            "is_subtitle": True,
            "srt_cn":      None,
            "language":    None,
            "duration":    None,
            "finished_at": None,
            "error":       None,
        })
    return files


def scan_folder(root_dir: str) -> list:
    """
    Recursively scan root_dir for video files.
    Returns list of dicts sorted by relative path.
    """
    root = Path(root_dir)
    files = []
    for f in sorted(root.rglob("*")):
        if f.suffix.lower() in VIDEO_EXTENSIONS and f.is_file():
            rel = str(f.relative_to(root))
            files.append({
                "path": rel,
                "status": "pending",
                "srt_en": None,
                "srt_cn": None,
                "language": None,
                "duration": None,
                "finished_at": None,
                "error": None,
            })
    return files


# ── TASK FILE I/O ─────────────────────────────────────────────────

def task_file_path(root_dir: str) -> str:
    return os.path.join(root_dir, TASK_FILENAME)


def load_task(root_dir: str) -> Optional[dict]:
    """Load existing task file. Returns None if not found."""
    path = task_file_path(root_dir)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def create_task(root_dir: str, model: str, settings: dict) -> dict:
    """
    Create a new task file by scanning root_dir.
    Saves and returns the task dict.
    """
    files = scan_folder(root_dir)
    task = {
        "version": "1",
        "created": _now(),
        "updated": _now(),
        "root_dir": root_dir,
        "model": model,
        "settings": settings,
        "files": files,
    }
    save_task(root_dir, task)
    return task


def save_task(root_dir: str, task: dict) -> None:
    """Write task dict to disk."""
    task["updated"] = _now()
    path = task_file_path(root_dir)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(task, f, ensure_ascii=False, indent=2)


def merge_with_scan(root_dir: str, existing_task: dict) -> dict:
    """
    Merge existing task with fresh scan:
    - Keep status of already-processed files
    - Add newly discovered files as pending
    - Remove entries for files that no longer exist
    """
    root = Path(root_dir)
    scanned = {f["path"]: f for f in scan_folder(root_dir)}
    existing = {f["path"]: f for f in existing_task.get("files", [])}

    merged = []
    for path, fresh in sorted(scanned.items()):
        if path in existing:
            # keep existing progress
            merged.append(existing[path])
        else:
            merged.append(fresh)

    existing_task["files"] = merged
    existing_task["updated"] = _now()
    return existing_task


# ── STATUS HELPERS ────────────────────────────────────────────────

def update_file_status(task: dict, rel_path: str, **kwargs) -> dict:
    """Update a single file entry in the task. kwargs: status, srt_en, srt_cn, etc."""
    for f in task["files"]:
        if f["path"] == rel_path:
            f.update(kwargs)
            break
    return task


def get_pending_files(task: dict, skip_existing_srt: bool = True) -> list:
    """Return files that still need processing (pending or error)."""
    root = task["root_dir"]
    result = []
    for f in task["files"]:
        if f["status"] == "done":
            if skip_existing_srt and f.get("srt_en"):
                # double-check file actually exists on disk
                srt_path = os.path.join(root, f["srt_en"])
                if os.path.exists(srt_path):
                    continue
        if f["status"] in ("pending", "error"):
            result.append(f)
    return result


def summary(task: dict) -> dict:
    files = task.get("files", [])
    done = sum(1 for f in files if f["status"] == "done")
    error = sum(1 for f in files if f["status"] == "error")
    pending = sum(1 for f in files if f["status"] == "pending")
    return {
        "total": len(files),
        "done": done,
        "pending": pending,
        "error": error,
        "updated": task.get("updated"),
    }


def reset_progress(root_dir: str, task: dict) -> dict:
    """Reset all file statuses back to pending."""
    for f in task["files"]:
        f["status"] = "pending"
        f["srt_en"] = None
        f["srt_cn"] = None
        f["language"] = None
        f["finished_at"] = None
        f["error"] = None
    save_task(root_dir, task)
    return task


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")
