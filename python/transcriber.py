"""
transcriber.py — mlx-whisper transcription wrapper
Supports: mlx-whisper (Apple Silicon MPS), faster-whisper (CPU/CUDA fallback)
"""

import os
import sys
import json
import time
from pathlib import Path
from typing import Callable, Optional


def get_backend():
    """Detect best available backend."""
    try:
        import mlx_whisper  # noqa
        return "mlx"
    except ImportError:
        pass
    try:
        from faster_whisper import WhisperModel  # noqa
        return "faster"
    except ImportError:
        pass
    raise RuntimeError("No Whisper backend found. Run: pip install mlx-whisper")


def ensure_ffmpeg_on_path():
    """
    mlx-whisper / faster-whisper call `ffmpeg` as a subprocess. On macOS,
    when the app is launched from Finder (not Terminal), PATH does not
    include /opt/homebrew/bin, so `ffmpeg` is not found even though it's
    installed. Detect ffmpeg in common locations and prepend its directory
    to PATH so mlx-whisper's internal `subprocess.run(['ffmpeg', ...])`
    succeeds.
    """
    import shutil as _sh
    # Already reachable?
    if _sh.which("ffmpeg"):
        return _sh.which("ffmpeg")

    candidates = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/opt/local/bin/ffmpeg",   # MacPorts
        "/usr/bin/ffmpeg",
        os.path.expanduser("~/autosubs/bin/ffmpeg"),   # new (visible) location
        os.path.expanduser("~/.autosubs/bin/ffmpeg"),  # legacy (hidden) fallback
    ]
    for c in candidates:
        if os.path.exists(c) and os.access(c, os.X_OK):
            bin_dir = os.path.dirname(c)
            cur = os.environ.get("PATH", "")
            if bin_dir not in cur.split(":"):
                os.environ["PATH"] = f"{bin_dir}:{cur}"
            return c

    # Last resort: try imageio-ffmpeg if installed (bundles static ffmpeg)
    try:
        import imageio_ffmpeg  # type: ignore
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        if ff and os.path.exists(ff):
            bin_dir = os.path.dirname(ff)
            cur = os.environ.get("PATH", "")
            if bin_dir not in cur.split(":"):
                os.environ["PATH"] = f"{bin_dir}:{cur}"
            # mlx-whisper uses `ffmpeg` literal name, so symlink if needed
            link_name = os.path.join(bin_dir, "ffmpeg")
            if not os.path.exists(link_name):
                try:
                    os.symlink(ff, link_name)
                except OSError:
                    pass
            return ff
    except ImportError:
        pass

    raise RuntimeError(
        "找不到 ffmpeg。请安装：\n"
        "  brew install ffmpeg\n"
        "或 pip install imageio-ffmpeg\n"
        "安装后重启 AutoSubs Lite。"
    )


def transcribe(
    video_path: str,
    model_name: str = "base",
    language: Optional[str] = None,          # None = auto-detect
    model_dir: str = "~/autosubs/models",
    on_progress: Optional[Callable[[float, str], None]] = None,
) -> dict:
    """
    Transcribe audio from a video file.

    Returns:
        {
            "language": "en",
            "segments": [
                {"id": 1, "start": 0.0, "end": 2.5, "text": "Hello world."},
                ...
            ]
        }
    """
    model_dir = os.path.expanduser(model_dir)
    backend = get_backend()

    # Ensure ffmpeg is discoverable — mlx-whisper / faster-whisper shell out to it.
    ensure_ffmpeg_on_path()

    if on_progress:
        on_progress(0.0, f"加载模型 {model_name} ({backend})…")

    if backend == "mlx":
        return _transcribe_mlx(video_path, model_name, language, model_dir, on_progress)
    else:
        return _transcribe_faster(video_path, model_name, language, model_dir, on_progress)


def _transcribe_mlx(video_path, model_name, language, model_dir, on_progress):
    import mlx_whisper

    model_path = os.path.join(model_dir, f"mlx-{model_name}")

    # Validate local model integrity before passing to mlx-whisper. It prefers
    # weights.safetensors and falls back to weights.npz — either works.
    if os.path.exists(model_path):
        weights = _find_weights_file(model_path)
        if not weights:
            raise RuntimeError(
                f"模型 {model_name} 不完整：缺少 weights.safetensors / weights.npz "
                f"(目录: {model_path})。请在右侧「模型 & 语言」标签重新点下载。"
            )
        if os.path.getsize(weights) < _MIN_WEIGHTS_BYTES:
            raise RuntimeError(
                f"模型 {model_name} 的 {os.path.basename(weights)} 大小异常 "
                f"({os.path.getsize(weights)} bytes)。下载未完成，请删除 "
                f"{model_path} 后重新下载。"
            )
    else:
        # No local copy → fall back to HuggingFace repo id (will trigger online fetch)
        model_path = _mlx_repo_id(model_name)

    kwargs = dict(
        path_or_hf_repo=model_path,
        word_timestamps=True,
        verbose=False,
        # ── Anti-hallucination guards ──
        # condition_on_previous_text=False breaks the loop-cascade chain
        # where one bad segment's output gets fed as context to the next,
        # snowballing into phrases like "system to develop a system to
        # develop a system to develop a…" repeating across many cues.
        condition_on_previous_text=False,
        # Tighter than mlx-whisper's default 2.4 — catches word-level loops
        # (gzip compression ratio triggers temperature-fallback re-decode).
        compression_ratio_threshold=1.8,
        # Explicit defaults (keep Whisper's built-in re-decode safety net on).
        logprob_threshold=-1.0,
        no_speech_threshold=0.6,
    )
    if language:
        kwargs["language"] = language

    if on_progress:
        on_progress(0.05, "提取音频并开始识别…")

    result = mlx_whisper.transcribe(video_path, **kwargs)

    segments = []
    for i, seg in enumerate(result.get("segments", [])):
        words = []
        for w in seg.get("words", []) or []:
            # mlx-whisper word: {"word": " Hello", "start": 0.1, "end": 0.4, "probability": 0.99}
            words.append({
                "word": w.get("word", ""),
                "start": round(w.get("start", seg["start"]), 3),
                "end": round(w.get("end", seg["end"]), 3),
            })
        segments.append({
            "id": i + 1,
            "start": round(seg["start"], 3),
            "end": round(seg["end"], 3),
            "text": seg["text"].strip(),
            "words": words,
        })

    if on_progress:
        on_progress(1.0, f"转录完成，共 {len(segments)} 条字幕")

    return {
        "language": result.get("language", "unknown"),
        "segments": segments,
    }


def _transcribe_faster(video_path, model_name, language, model_dir, on_progress):
    from faster_whisper import WhisperModel

    model_path = os.path.join(model_dir, model_name)
    if not os.path.exists(model_path):
        model_path = model_name  # let faster-whisper auto-download

    model = WhisperModel(model_path, device="cpu", compute_type="int8")

    if on_progress:
        on_progress(0.05, "提取音频并开始识别…")

    lang_kwarg = {"language": language} if language else {}
    segments_gen, info = model.transcribe(
        video_path,
        beam_size=5,
        word_timestamps=True,
        # ── Anti-hallucination guards (mirror the mlx path) ──
        condition_on_previous_text=False,
        compression_ratio_threshold=1.8,
        log_prob_threshold=-1.0,          # faster-whisper naming
        no_speech_threshold=0.6,
        # VAD filters out long silences where Whisper most often hallucinates.
        # mlx-whisper has no built-in VAD; faster-whisper ships with Silero.
        vad_filter=True,
        **lang_kwarg,
    )

    segments = []
    for i, seg in enumerate(segments_gen):
        words = []
        for w in (seg.words or []):
            words.append({
                "word": w.word,
                "start": round(w.start, 3),
                "end": round(w.end, 3),
            })
        segments.append({
            "id": i + 1,
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip(),
            "words": words,
        })
        if on_progress and i % 20 == 0:
            on_progress(0.1 + 0.85 * min(i / max(len(segments), 1), 1.0), f"识别中… {i} 条")

    if on_progress:
        on_progress(1.0, f"转录完成，共 {len(segments)} 条字幕")

    return {
        "language": info.language,
        "segments": segments,
    }


_MIN_WEIGHTS_BYTES = 1_000_000  # any real Whisper weights file is > 1 MB


def _find_weights_file(model_folder: str) -> Optional[str]:
    """
    Return the absolute path to the weights file inside `model_folder`, or None.

    mlx-community repos use one of two formats:
      - weights.npz         (older, e.g. tiny/base/small/medium/large-v3)
      - weights.safetensors (newer, e.g. large-v3-turbo)
    mlx-whisper's loader tries safetensors first, then npz, so we match that.
    """
    for name in ("weights.safetensors", "weights.npz"):
        path = os.path.join(model_folder, name)
        if os.path.exists(path):
            return path
    return None


def is_model_complete(model_name: str, model_dir: str) -> bool:
    """
    Return True if the local copy of `model_name` looks complete enough to load.
    Used by list_models so we don't report half-finished downloads as installed.
    """
    model_dir = os.path.expanduser(model_dir)
    folder = os.path.join(model_dir, f"mlx-{model_name}")
    if not os.path.isdir(folder):
        return False
    weights = _find_weights_file(folder)
    if not weights:
        return False
    try:
        return os.path.getsize(weights) >= _MIN_WEIGHTS_BYTES
    except OSError:
        return False


_MODEL_APPROX_SIZE_MB = {
    "tiny":           75,
    "base":           145,
    "small":          480,
    "medium":         1500,
    "large-v3-turbo": 1600,
    "large-v3":       3100,
}


def _mlx_repo_id(model_name: str) -> str:
    """
    Return the MLX HuggingFace repo id for a given Whisper model.

    Most models use: mlx-community/whisper-{name}-mlx
    But large-v3-turbo is published as: mlx-community/whisper-large-v3-turbo
    """
    if model_name == "large-v3-turbo":
        return "mlx-community/whisper-large-v3-turbo"
    return f"mlx-community/whisper-{model_name}-mlx"


def _dir_size_bytes(path: str) -> int:
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def download_model(model_name: str, model_dir: str = "~/.autosubs/models",
                   on_progress: Optional[Callable[[float, str], None]] = None):
    """
    Download a Whisper model to the local model directory.

    Strategy:
      1. Wipe any previous (possibly partial) directory so HF doesn't try to
         resume from a corrupted .incomplete file.
      2. Run snapshot_download in a background thread.
      3. Poll dir size on the calling thread and emit progress every ~700 ms,
         since snapshot_download has no built-in callback for LFS file streams.
      4. Verify weights.npz exists and is plausibly large at the end.

    Honors HF_ENDPOINT env var (e.g. https://hf-mirror.com) and
    HTTP_PROXY/HTTPS_PROXY env vars set by main.apply_proxy().
    """
    import shutil
    import threading as _th
    import time as _time

    model_dir = os.path.expanduser(model_dir)
    os.makedirs(model_dir, exist_ok=True)
    backend = get_backend()

    if backend == "mlx":
        from huggingface_hub import snapshot_download
        from huggingface_hub.utils import HfHubHTTPError

        repo_id = _mlx_repo_id(model_name)
        local_dir = os.path.join(model_dir, f"mlx-{model_name}")

        # 1. Clean any previous attempt — partial files leave .lock / .incomplete
        #    in .cache/ that confuse subsequent runs.
        if os.path.exists(local_dir):
            if on_progress:
                on_progress(0.01, "清理旧的不完整下载…")
            shutil.rmtree(local_dir, ignore_errors=True)
        os.makedirs(local_dir, exist_ok=True)

        approx_total_mb = _MODEL_APPROX_SIZE_MB.get(model_name, 200)
        approx_total_bytes = approx_total_mb * 1024 * 1024

        if on_progress:
            on_progress(0.02, f"开始下载 {repo_id}（约 {approx_total_mb} MB）…")

        # 2. Background download thread
        result = {"err": None, "done": False}
        def _do_download():
            try:
                snapshot_download(
                    repo_id=repo_id,
                    local_dir=local_dir,
                    # Different mlx-community repos ship weights under different
                    # names — large-v3-turbo uses weights.safetensors, the older
                    # -mlx repos use weights.npz. Accept both so either layout
                    # actually fetches the LFS blob.
                    allow_patterns=["weights.safetensors", "weights.npz",
                                    "config.json", "tokenizer.json",
                                    "*.txt", "*.json"],
                )
            except Exception as e:
                result["err"] = e
            finally:
                result["done"] = True

        worker = _th.Thread(target=_do_download, daemon=True)
        worker.start()

        # 3. Heartbeat: poll directory size and emit progress
        last_size = -1
        stall_seconds = 0
        while not result["done"]:
            _time.sleep(0.7)
            try:
                cur_size = _dir_size_bytes(local_dir)
            except Exception:
                cur_size = 0
            mb = cur_size / (1024 * 1024)
            pct = min(0.95, 0.02 + 0.93 * (cur_size / approx_total_bytes)) if approx_total_bytes else 0.5
            if cur_size == last_size:
                stall_seconds += 0.7
            else:
                stall_seconds = 0
                last_size = cur_size
            stall_note = f" · 等待响应 {int(stall_seconds)}s" if stall_seconds > 3 else ""
            if on_progress:
                on_progress(pct, f"下载中 {mb:.1f} / ~{approx_total_mb} MB{stall_note}")

        worker.join()

        if result["err"] is not None:
            shutil.rmtree(local_dir, ignore_errors=True)
            err = result["err"]
            if isinstance(err, HfHubHTTPError):
                raise RuntimeError(
                    f"无法访问 HuggingFace: {err}. "
                    f"请检查代理，或设置环境变量 HF_ENDPOINT=https://hf-mirror.com 使用镜像。"
                )
            raise RuntimeError(
                f"下载失败: {err}. 提示：weights.npz 较大，请确保代理稳定或使用 HF 镜像。"
            )

        # 4. Validate
        if not is_model_complete(model_name, model_dir):
            shutil.rmtree(local_dir, ignore_errors=True)
            raise RuntimeError(
                f"下载完成但权重文件（weights.safetensors / weights.npz）缺失或过小 — "
                f"仓库 {repo_id} 可能不存在或网络中断。已清理目录，请检查代理后重试。"
            )

        if on_progress:
            wf = _find_weights_file(local_dir) or ""
            sz = os.path.getsize(wf) if wf else 0
            on_progress(1.0, f"下载完成 → {local_dir} ({sz // (1024*1024)} MB)")

    else:
        from faster_whisper import WhisperModel
        if on_progress:
            on_progress(0.05, f"下载 faster-whisper/{model_name}…")
        WhisperModel(model_name, download_root=model_dir)
        if on_progress:
            on_progress(1.0, "下载完成")
