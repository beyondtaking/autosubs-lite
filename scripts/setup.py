#!/usr/bin/env python3
"""
scripts/setup.py — First-time setup script

Checks and installs all dependencies:
  - Python 3.10+
  - mlx-whisper (Apple Silicon) or faster-whisper (CPU/CUDA)
  - Node.js + npm
  - Rust + Cargo
  - Tauri CLI

Usage:
    python scripts/setup.py
"""

import subprocess
import sys
import platform
import shutil

IS_MAC   = platform.system() == "Darwin"
IS_WIN   = platform.system() == "Windows"
IS_ARM   = platform.machine() in ("arm64", "aarch64")

OK   = "\033[92m✓\033[0m"
FAIL = "\033[91m✕\033[0m"
INFO = "\033[96m→\033[0m"
WARN = "\033[93m⚠\033[0m"

def check(label, cmd, version_flag="--version"):
    try:
        out = subprocess.check_output([cmd, version_flag],
                                       stderr=subprocess.STDOUT,
                                       text=True).strip().split("\n")[0]
        print(f"{OK} {label}: {out}")
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        print(f"{FAIL} {label}: NOT FOUND")
        return False

def pip_install(pkg):
    subprocess.run([sys.executable, "-m", "pip", "install", pkg], check=True)

def main():
    print("\n─── AutoSubs Lite Setup ───\n")

    # Python version
    v = sys.version_info
    if v < (3, 10):
        print(f"{FAIL} Python 3.10+ required (you have {v.major}.{v.minor})")
        sys.exit(1)
    print(f"{OK} Python {v.major}.{v.minor}.{v.micro}")

    # Platform
    plat = f"{platform.system()} {platform.machine()}"
    print(f"{INFO} Platform: {plat}")
    if IS_MAC and IS_ARM:
        print(f"{INFO} Apple Silicon detected → will use mlx-whisper")
    elif IS_MAC:
        print(f"{WARN} Intel Mac detected → will use faster-whisper (slower)")
    elif IS_WIN:
        print(f"{INFO} Windows detected → will use faster-whisper")

    print()

    # Node
    node_ok = check("Node.js", "node")
    npm_ok  = check("npm", "npm")

    # Rust
    rust_ok = check("Rust", "rustc")
    cargo_ok = check("Cargo", "cargo")

    # Tauri CLI
    tauri_ok = check("Tauri CLI", "cargo-tauri")

    print()

    # Python packages
    print("─── Python Packages ───\n")
    try:
        import mlx_whisper
        print(f"{OK} mlx-whisper")
    except ImportError:
        if IS_MAC and IS_ARM:
            print(f"{INFO} Installing mlx-whisper…")
            pip_install("mlx-whisper")
        else:
            print(f"{INFO} Installing faster-whisper…")
            pip_install("faster-whisper")

    try:
        import huggingface_hub
        print(f"{OK} huggingface-hub")
    except ImportError:
        print(f"{INFO} Installing huggingface-hub…")
        pip_install("huggingface-hub")

    print()

    # Install suggestions
    missing = []
    if not node_ok or not npm_ok:
        missing.append("Node.js: https://nodejs.org")
    if not rust_ok or not cargo_ok:
        missing.append("Rust: https://rustup.rs")
    if not tauri_ok:
        missing.append("Tauri CLI: cargo install tauri-cli --version '^2.0'")

    if missing:
        print("─── Action Required ───\n")
        for m in missing:
            print(f"  {WARN} Install {m}")
        print()
    else:
        print("─── All Good ───\n")
        print("Run the app:")
        print("  npm install && cargo tauri dev")
        print()

if __name__ == "__main__":
    main()
