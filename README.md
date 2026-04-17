English | [中文](README.zh-CN.md)

# AutoSubs Lite

Batch subtitle generator powered by **Whisper transcription** + **LLM translation**. Processes videos in bulk or translates existing subtitle files, outputting `.en.srt` / `.cn.srt` / `.cn.vtt` alongside the source.

- 💻 Native desktop app (Tauri v2, macOS & Windows)
- 🎙️ Local Whisper transcription (mlx-whisper on Apple Silicon / faster-whisper on Windows & Intel Mac)
- 🌐 LLM translation: DeepSeek / GLM / Kimi / OpenAI / Anthropic / MiniMax
- 📝 Chinese subtitles reorganized by **Chinese semantics** — not forced into 1:1 alignment with English cues
- 🔁 Resume support: progress is saved to a task file and restored automatically

## Screenshots

![Main UI](docs/screenshots/main.png)

---

## 1. Installation

### 1.1 macOS

**Requirements**

| | Requirement |
|---|---|
| OS | macOS 12 or later (Apple Silicon recommended; Intel Mac works via faster-whisper) |
| Python | 3.10 or later |
| Disk | ≥ 2 GB (one Whisper model + venv) |
| RAM | ≥ 8 GB (16 GB recommended for `large-v3`) |

**Step 1 — Install the DMG**

Open `AutoSubs Lite_0.1.1_aarch64.dmg` and drag the app to **Applications**.

**Step 2 — Set up the Python environment (required)**

The app searches for Python in this order (bold = recommended):

1. Environment variable `AUTOSUBS_PYTHON`
2. **`~/autosubs/venv/bin/python3`**
3. `/opt/homebrew/bin/python3` / `/usr/local/bin/python3` / `/usr/bin/python3`

```bash
# Make sure you have Python 3.10+ (if not: brew install python@3.11)
python3 --version

# Create a dedicated venv at the recommended path
mkdir -p ~/autosubs
python3 -m venv ~/autosubs/venv
source ~/autosubs/venv/bin/activate

pip install --upgrade pip
pip install mlx-whisper huggingface-hub          # Apple Silicon
# pip install faster-whisper huggingface-hub     # Intel Mac
```

**Step 3 — First launch**

1. Open **AutoSubs Lite** — if the log shows `Whisper backend detected`, the environment is ready
2. Click **Preferences** → **Whisper Model** → download a model
3. Click **Translation Model** → enter your LLM provider details (see [LLM Providers](#llm-providers))

---

### 1.2 Windows

**Requirements**

| | Requirement |
|---|---|
| OS | Windows 10 / 11 (x64) |
| Python | 3.10 or later — install from [python.org](https://www.python.org/downloads/) |
| WebView2 | Pre-installed on Windows 11 / modern Edge; installer will prompt if missing |
| Disk | ≥ 2 GB |
| RAM | ≥ 8 GB |

> mlx-whisper is **Apple Silicon only**. Use `faster-whisper` on Windows.

**Step 1 — Install Python**

Download Python 3.11 from [python.org](https://www.python.org/downloads/windows/).
During setup, **check "Add Python to PATH"**.

**Step 2 — Install the app**

Download `AutoSubs.Lite_0.1.1_x64_en-US.msi` from GitHub Releases and run it.

**Step 3 — Set up the Python environment (required)**

The app searches for Python in this order:

1. Environment variable `AUTOSUBS_PYTHON`
2. **`%USERPROFILE%\autosubs\venv\Scripts\python.exe`**
3. `%LOCALAPPDATA%\Programs\Python\Python3xx\python.exe`
4. `python.exe` on the system PATH

Open **PowerShell**:

```powershell
# Create venv at the recommended path
mkdir "$env:USERPROFILE\autosubs"
python -m venv "$env:USERPROFILE\autosubs\venv"
& "$env:USERPROFILE\autosubs\venv\Scripts\Activate.ps1"

pip install --upgrade pip
pip install faster-whisper huggingface-hub
```

> If PowerShell blocks script execution, run first:
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```

**Step 4 — First launch**

Same as macOS step 3 — open the app, check the log, download a Whisper model, configure a translation provider.

---

### LLM Providers

| Provider | base_url | Recommended model |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Zhipu GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Anthropic | `https://api.anthropic.com/v1` | `claude-3-5-haiku-latest` |
| MiniMax | `https://api.minimax.chat/v1` | `abab6.5s-chat` |

> The Anthropic Messages API is detected automatically from the base_url — no extra config needed.

---

## 2. Developer Setup

### macOS

```bash
git clone <repo>
cd autosubs-lite

npm install

python3 -m venv ~/autosubs/venv
source ~/autosubs/venv/bin/activate
pip install -r requirements.txt

# Rust (once)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

npm run tauri dev        # dev mode
npm run tauri build      # production build
```

### Windows

```powershell
git clone <repo>
cd autosubs-lite

npm install

python -m venv "$env:USERPROFILE\autosubs\venv"
& "$env:USERPROFILE\autosubs\venv\Scripts\Activate.ps1"
pip install faster-whisper huggingface-hub   # replace mlx-whisper in requirements.txt

# Rust: download rustup-init.exe from https://rustup.rs, run it, reopen PowerShell

npm run tauri dev
npm run tauri build
```

Build output:

| Platform | Artifacts |
|---|---|
| macOS | `bundle/macos/*.app` · `bundle/dmg/*.dmg` |
| Windows | `bundle/msi/*.msi` · `bundle/nsis/*.exe` |

### Automated Releases (GitHub Actions)

Pushing a `v*.*.*` tag triggers `.github/workflows/release.yml`, which builds on both macOS and Windows runners and publishes a GitHub Release with both installers:

```bash
./scripts/bump_version.sh 0.2.0   # updates version in 5 files
# edit CHANGELOG.md
npm run tauri build                # verify locally
git add -A && git commit -m "chore: release v0.2.0"
git tag v0.2.0 && git push && git push --tags
```

---

## 3. Versioning

Format: `MAJOR.MINOR.PATCH`

| Change type | Which part | Example |
|---|---|---|
| New feature | MINOR +1, PATCH reset | 0.1.1 → **0.2.0** |
| Bug fix | PATCH +1 | 0.1.1 → **0.1.2** |
| Breaking change | MAJOR +1 | 0.x.x → **1.0.0** |

Use `./scripts/bump_version.sh X.Y.Z` to update all 5 version references at once.

---

## 4. Usage

### 4.1 Video → subtitles (most common)

1. **Add videos** — pick files or a folder (subfolders scanned recursively)
2. Select Whisper model and source language; optionally enable **Generate Chinese subtitles**
3. Click **Start**
4. Output: `{name}.{lang}.srt` next to each video; `{name}.cn.srt` if translation is enabled

### 4.2 Translate existing subtitles (skip Whisper)

1. Click **Add Subtitle Files** → pick a folder (scans `.srt` / `.vtt`, skips `.cn.*`)
2. **Generate Chinese subtitles must be checked** (start button is disabled otherwise)
3. Click **Start**

Output naming:

| Input | Output |
|---|---|
| `foo.en.srt` | `foo.cn.srt` |
| `foo.srt` | `foo.cn.srt` |
| `foo.en.vtt` | `foo.cn.vtt` |
| `foo.vtt` | `foo.cn.vtt` |

### 4.3 Resume interrupted runs

If a folder job is interrupted, `.autosubs_task.json` saves progress in the folder root. Re-open the same folder and click **Resume** to skip completed files.

### 4.4 Preferences quick reference

| Setting | Default | Description |
|---|---|---|
| Whisper model directory | `~/autosubs/models` | Where models are downloaded |
| Translation batch size | 80 | Sentences per LLM call |
| Skip existing SRT | On | Skip transcription if `.en.srt` already exists |
| Auto-save task file | On | Write `.autosubs_task.json` after each file |
| Re-segmentation | On | Udemy-style short cues (target 45 chars, max 70) |
| Proxy | Off | HTTP / SOCKS5 / system proxy |

---

## 5. Project Structure

```
autosubs-lite/
├── python/                     # Processing engine
│   ├── main.py                  # Entry point — stdin/stdout IPC
│   ├── transcriber.py           # Whisper wrapper
│   ├── translator.py            # LLM translation + Chinese re-segmentation
│   ├── resegmenter.py           # Whisper output → short subtitle cues
│   ├── srt_writer.py            # SRT/VTT writer + text formatting
│   ├── subtitle_reader.py       # Parse .srt / .vtt for translate-only mode
│   └── task_file.py             # Task file & folder scanning
├── src/                         # Frontend (React + TypeScript)
│   ├── App.tsx
│   ├── components/
│   ├── stores/appStore.ts
│   ├── i18n/locales.ts
│   └── styles/theme.css
├── src-tauri/                   # Rust shell
│   ├── src/lib.rs                # Python sidecar (cross-platform)
│   └── tauri.conf.json
├── .github/workflows/
│   └── release.yml              # macOS + Windows CI/CD
├── scripts/
│   └── bump_version.sh          # One-command version bump
├── CHANGELOG.md
├── requirements.txt
└── package.json
```

---

## 6. FAQ

**Q: macOS — app can't find python3**
A: Confirm `~/autosubs/venv/bin/python3` exists. Alternatively, launch from Terminal:
```bash
AUTOSUBS_PYTHON=/path/to/python3 open -a "AutoSubs Lite"
```

**Q: Windows — app can't find Python**
A: Make sure Python was installed with "Add to PATH" checked, or create the venv at the recommended path (`%USERPROFILE%\autosubs\venv`).

**Q: Log shows "missing Whisper backend"**
A: Install the correct backend in your venv:
- Apple Silicon: `pip install mlx-whisper`
- Windows / Intel Mac: `pip install faster-whisper`

**Q: Translation error — "N of M sentences not returned"**
A: The LLM response was truncated by `max_tokens`. Lower the batch size in **Preferences → Translation batch** (30–50 recommended).

**Q: Windows shows "Windows protected your PC" when installing**
A: Click **More info → Run anyway**. The installer is not code-signed (common for personal tools). The source is fully open.

**Q: Chinese subtitle count is lower than English**
A: Expected behavior since v0.1.1 — Chinese cues are split by Chinese punctuation/semantics rather than mapped 1:1 to English cues.

**Q: Proxy is configured but LLM still unreachable**
A: Use **Preferences → Proxy → Test Proxy** to verify HTTP 204. If the proxy works but the LLM doesn't, check whether the target base_url is covered by the proxy's allow-list.

---

## 7. License

MIT License — see [LICENSE](LICENSE)
