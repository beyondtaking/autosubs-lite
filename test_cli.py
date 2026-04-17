#!/usr/bin/env python3
"""
test_cli.py — Test the Python processing pipeline without Tauri.

Usage:
    # Basic transcription only
    python test_cli.py video.mp4

    # With Chinese translation (requires API key in env or --api-key)
    python test_cli.py video.mp4 --cn --provider deepseek --api-key sk-...

    # Folder batch mode
    python test_cli.py /path/to/folder --cn

    # Test LLM connection only
    python test_cli.py --test-llm --provider deepseek --api-key sk-...
"""

import sys
import os
import argparse
import json
import time

sys.path.insert(0, os.path.dirname(__file__))

from python.transcriber import transcribe, get_backend
from python.translator import translate_segments, test_connection
from python.srt_writer import write_srt, get_srt_path
from python.task_file import scan_folder, load_task, create_task, save_task, update_file_status, get_pending_files

# ── ANSI colors ────────────────────────────────────────────────────
GREEN  = '\033[92m'
YELLOW = '\033[93m'
RED    = '\033[91m'
CYAN   = '\033[96m'
GRAY   = '\033[90m'
RESET  = '\033[0m'
BOLD   = '\033[1m'

def ok(msg):    print(f"{GREEN}✓{RESET} {msg}")
def warn(msg):  print(f"{YELLOW}⚠{RESET} {msg}")
def err(msg):   print(f"{RED}✕{RESET} {msg}")
def info(msg):  print(f"{CYAN}→{RESET} {msg}")
def dim(msg):   print(f"{GRAY}{msg}{RESET}")


def parse_args():
    p = argparse.ArgumentParser(description='AutoSubs Lite — CLI test')
    p.add_argument('input', nargs='?', help='Video file or folder path')
    p.add_argument('--model',    default='base',  help='Whisper model (default: base)')
    p.add_argument('--model-dir',default='~/autosubs/models', help='Model storage dir')
    p.add_argument('--language', default=None,    help='Source language (default: auto)')
    p.add_argument('--cn',       action='store_true', help='Also generate Chinese subtitles')
    p.add_argument('--provider', default='deepseek',
                   choices=['deepseek','glm','kimi','openai','minimax'],
                   help='LLM provider for Chinese translation')
    p.add_argument('--api-key',  default=None,    help='LLM API key (or set env AUTOSUBS_API_KEY)')
    p.add_argument('--base-url', default=None,    help='LLM base URL override')
    p.add_argument('--batch-size', type=int, default=80, help='Translation batch size')
    p.add_argument('--test-llm', action='store_true', help='Only test LLM connection')
    p.add_argument('--fmt-max-chars', type=int, default=34)
    p.add_argument('--fmt-max-lines', type=int, default=1)
    return p.parse_args()


PROVIDER_URLS = {
    'deepseek': ('https://api.deepseek.com/v1',             'deepseek-chat'),
    'glm':      ('https://open.bigmodel.cn/api/paas/v4',    'glm-4-flash'),
    'kimi':     ('https://api.moonshot.cn/v1',               'moonshot-v1-8k'),
    'openai':   ('https://api.openai.com/v1',                'gpt-4o-mini'),
    'minimax':  ('https://api.minimax.chat/v1',              'abab6.5s-chat'),
}


def build_llm_config(args):
    api_key = args.api_key or os.environ.get('AUTOSUBS_API_KEY', '')
    default_url, default_model = PROVIDER_URLS.get(args.provider, ('', ''))
    return {
        'base_url': args.base_url or default_url,
        'api_key':  api_key,
        'model':    default_model,
    }


def build_fmt_config(args):
    return {
        'max_chars_per_line': args.fmt_max_chars,
        'max_lines': args.fmt_max_lines,
        'line_break_method': 'nlp',
        'text_case': 'original',
        'remove_punctuation': False,
        'keep_ellipsis': True,
        'remove_fillers': False,
        'censor_enabled': False,
        'censor_words': [],
        'censor_char': '****',
        'censor_case_insensitive': True,
    }


def process_file(video_path: str, args, fmt_config: dict, llm_config: dict = None):
    fname = os.path.basename(video_path)
    print(f"\n{BOLD}── {fname} ──{RESET}")

    # ── Transcribe ──
    t0 = time.time()
    info(f"Transcribing with model={args.model} lang={args.language or 'auto'}…")

    def on_progress(pct, msg):
        bar = '█' * int(pct * 20) + '░' * (20 - int(pct * 20))
        print(f"\r  [{bar}] {msg[:60]:<60}", end='', flush=True)

    result = transcribe(
        video_path,
        model_name=args.model,
        language=args.language,
        model_dir=args.model_dir,
        on_progress=on_progress,
    )
    print()  # newline after progress

    segments = result['segments']
    detected = result['language']
    elapsed  = time.time() - t0
    ok(f"Transcribed {len(segments)} segments  lang={detected}  ({elapsed:.1f}s)")

    # ── Write original SRT ──
    srt_en = get_srt_path(video_path, detected)
    write_srt(segments, srt_en, fmt_config)
    ok(f"Wrote: {srt_en}")

    # ── Translate to Chinese ──
    if args.cn and llm_config and detected != 'zh':
        if not llm_config['api_key']:
            warn("No API key — skipping Chinese translation. Use --api-key or set AUTOSUBS_API_KEY")
            return

        t1 = time.time()
        info(f"Translating {len(segments)} segments via {args.provider} (batch={args.batch_size})…")

        def on_trans(pct, msg):
            bar = '█' * int(pct * 20) + '░' * (20 - int(pct * 20))
            print(f"\r  [{bar}] {msg[:60]:<60}", end='', flush=True)

        cn_segments = translate_segments(
            segments,
            provider_config=llm_config,
            src_lang=detected,
            batch_size=args.batch_size,
            on_progress=on_trans,
        )
        print()
        elapsed2 = time.time() - t1
        ok(f"Translated {len(cn_segments)} segments ({elapsed2:.1f}s)")

        srt_cn = get_srt_path(video_path, 'cn')
        write_srt(cn_segments, srt_cn, fmt_config)
        ok(f"Wrote: {srt_cn}")

    elif args.cn and detected == 'zh':
        dim("  Source is already Chinese — skipping translation")


def process_folder(folder_path: str, args, fmt_config: dict, llm_config: dict = None):
    print(f"\n{BOLD}Scanning folder: {folder_path}{RESET}")

    task = load_task(folder_path)
    if task:
        from python.task_file import summary
        s = summary(task)
        info(f"Resuming task: {s['done']}/{s['total']} done, {s['pending']} pending")
    else:
        task = create_task(folder_path, args.model, {})

    pending = get_pending_files(task, skip_existing_srt=True)
    print(f"  {len(pending)} files to process\n")

    for i, f in enumerate(pending):
        abs_path = os.path.join(folder_path, f['path'])
        print(f"[{i+1}/{len(pending)}]", end=' ')

        update_file_status(task, f['path'], status='processing')
        save_task(folder_path, task)

        try:
            process_file(abs_path, args, fmt_config, llm_config)
            srt_en = get_srt_path(abs_path, 'unknown')  # will be overwritten with real lang
            update_file_status(task, f['path'], status='done',
                               srt_en=os.path.relpath(srt_en, folder_path))
        except Exception as e:
            err(f"Failed: {e}")
            update_file_status(task, f['path'], status='error', error=str(e))

        save_task(folder_path, task)

    from python.task_file import summary
    s = summary(task)
    print(f"\n{BOLD}Done:{RESET} {s['done']}/{s['total']} succeeded, {s['error']} errors")


def main():
    args = parse_args()

    print(f"\n{BOLD}AutoSubs Lite — CLI Test{RESET}")
    print(f"  Backend : {get_backend()}")
    print(f"  Model   : {args.model}")

    fmt_config = build_fmt_config(args)
    llm_config = build_llm_config(args) if args.cn or args.test_llm else None

    # ── Test LLM connection only ──
    if args.test_llm:
        if not llm_config['api_key']:
            err("No API key. Use --api-key or set AUTOSUBS_API_KEY")
            sys.exit(1)
        info(f"Testing connection to {args.provider} ({llm_config['base_url']})…")
        result = test_connection(llm_config)
        if result['ok']:
            ok(f"Connected! model={result['model']}  latency={result['latency_ms']}ms")
        else:
            err(f"Failed: {result['error']}")
            sys.exit(1)
        return

    if not args.input:
        err("No input provided. Pass a video file or folder path.")
        sys.exit(1)

    path = os.path.abspath(args.input)
    if not os.path.exists(path):
        err(f"Path not found: {path}")
        sys.exit(1)

    if os.path.isdir(path):
        process_folder(path, args, fmt_config, llm_config)
    else:
        process_file(path, args, fmt_config, llm_config)


if __name__ == '__main__':
    main()
