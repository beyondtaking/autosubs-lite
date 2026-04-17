#!/usr/bin/env python3
"""
scripts/build_python.py
Package the Python engine into a standalone binary using PyInstaller.

Usage:
    python scripts/build_python.py

Output:
    dist/autosubs-engine          (macOS/Linux)
    dist/autosubs-engine.exe      (Windows)

The binary is then referenced by Tauri as a sidecar.
"""

import subprocess
import sys
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY_DIR = os.path.join(ROOT, "python")
DIST_DIR = os.path.join(ROOT, "dist-python")

def run(cmd, **kw):
    print(f"  $ {' '.join(cmd)}")
    subprocess.run(cmd, check=True, **kw)

def main():
    # Install PyInstaller if missing
    try:
        import PyInstaller
    except ImportError:
        print("Installing PyInstaller…")
        run([sys.executable, "-m", "pip", "install", "pyinstaller"])

    # Clean
    shutil.rmtree(DIST_DIR, ignore_errors=True)

    print("\nPackaging Python engine…")
    run([
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--name", "autosubs-engine",
        "--distpath", DIST_DIR,
        "--workpath", os.path.join(ROOT, "build-python"),
        "--specpath", os.path.join(ROOT, "build-python"),
        "--hidden-import", "mlx_whisper",
        "--hidden-import", "faster_whisper",
        "--hidden-import", "huggingface_hub",
        os.path.join(PY_DIR, "main.py"),
    ])

    binary = os.path.join(DIST_DIR, "autosubs-engine")
    if sys.platform == "win32":
        binary += ".exe"

    print(f"\nDone: {binary}")
    print("\nNext: place this binary in src-tauri/binaries/")
    print("  macOS/Linux: autosubs-engine-aarch64-apple-darwin  (or x86_64)")
    print("  Windows:     autosubs-engine-x86_64-pc-windows-msvc.exe")

if __name__ == "__main__":
    main()
