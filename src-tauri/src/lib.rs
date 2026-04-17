// src-tauri/src/lib.rs
// Tauri v2 library entry point

use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::io::{BufRead, BufReader, Write};
use tauri::{AppHandle, Emitter, Manager, State};
use serde::Serialize;
use serde_json::Value;

pub struct PythonProcess {
    pub stdin: Option<std::process::ChildStdin>,
}

pub type PythonState = Arc<Mutex<PythonProcess>>;

#[tauri::command]
async fn pick_files(app: AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let files = app
        .dialog()
        .file()
        .add_filter("Video", &["mp4","mkv","mov","avi","wmv","flv","webm","m4v","ts"])
        .blocking_pick_files();
    match files {
        Some(paths) => Ok(paths.into_iter()
            .filter_map(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().to_string())
            .collect()),
        None => Ok(vec![]),
    }
}

#[tauri::command]
async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
async fn pick_directory(app: AppHandle) -> Result<Option<String>, String> {
    pick_folder(app).await
}

#[tauri::command]
async fn send_to_python(cmd: Value, state: State<'_, PythonState>) -> Result<(), String> {
    let mut proc = state.lock().map_err(|e| e.to_string())?;
    if let Some(stdin) = proc.stdin.as_mut() {
        let line = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
        writeln!(stdin, "{}", line).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut result = vec![];
    for entry in entries.flatten() {
        let meta = entry.metadata().ok();
        result.push(FileEntry {
            name:   entry.file_name().to_string_lossy().to_string(),
            path:   entry.path().to_string_lossy().to_string(),
            is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            size:   meta.as_ref().map(|m| m.len()).unwrap_or(0),
        });
    }
    Ok(result)
}

/// Platform-specific venv layout constants.
#[cfg(windows)]
const VENV_BIN: &str = "Scripts";
#[cfg(windows)]
const PY_EXE:  &str = "python.exe";
#[cfg(not(windows))]
const VENV_BIN: &str = "bin";
#[cfg(not(windows))]
const PY_EXE:  &str = "python3";

/// Search for a usable Python binary, in priority order:
/// 1. `AUTOSUBS_PYTHON` environment variable (explicit override)
/// 2. `.venv/{bin|Scripts}/{python3|python.exe}` sibling of the resource dir (dev)
/// 3. `~/autosubs/venv/…`  — recommended user install location
/// 4. `~/.autosubs/venv/…` — legacy location (macOS/Linux compat only)
/// 5. OS-specific fallbacks (Homebrew on macOS; LOCALAPPDATA installs on Windows)
fn find_python(resource_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    use std::path::PathBuf;

    // 1. Explicit override
    if let Ok(p) = std::env::var("AUTOSUBS_PYTHON") {
        let pb = PathBuf::from(p);
        if pb.exists() { return Some(pb); }
    }

    // 2. Dev-mode sibling venv
    if let Some(parent) = resource_dir.parent() {
        let venv_py = parent.join(".venv").join(VENV_BIN).join(PY_EXE);
        if venv_py.exists() { return Some(venv_py); }
    }

    // 3 & 4. User venv under home dir
    #[cfg(windows)]
    let home_key = "USERPROFILE";
    #[cfg(not(windows))]
    let home_key = "HOME";

    if let Ok(home) = std::env::var(home_key) {
        let user_venv = PathBuf::from(&home)
            .join("autosubs").join("venv").join(VENV_BIN).join(PY_EXE);
        if user_venv.exists() { return Some(user_venv); }

        #[cfg(not(windows))]
        {
            let legacy = PathBuf::from(&home)
                .join(".autosubs").join("venv").join(VENV_BIN).join(PY_EXE);
            if legacy.exists() { return Some(legacy); }
        }
    }

    // 5. OS-specific system fallbacks
    #[cfg(windows)]
    {
        // LOCALAPPDATA\Programs\Python\Python31x\python.exe — prefer newest
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let py_root = PathBuf::from(&local).join("Programs").join("Python");
            if let Ok(entries) = std::fs::read_dir(&py_root) {
                let mut dirs: Vec<_> = entries.flatten()
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .collect();
                dirs.sort_by(|a, b| b.file_name().cmp(&a.file_name())); // newest first
                for entry in dirs {
                    let py = entry.path().join("python.exe");
                    if py.exists() { return Some(py); }
                }
            }
        }
        // Last resort: rely on PATH (works if user ticked "Add to PATH" during install)
        return Some(PathBuf::from("python.exe"));
    }

    #[cfg(not(windows))]
    {
        for cand in &[
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
            "/usr/bin/python3",
        ] {
            let pb = PathBuf::from(cand);
            if pb.exists() { return Some(pb); }
        }
        None
    }
}

pub fn start_python_sidecar(app: &AppHandle, state: PythonState) {
    use std::process::Command;

    let res_dir = app.path().resource_dir().expect("resource dir");
    let script = res_dir.join("python").join("main.py");

    if !script.exists() {
        let app_clone = app.clone();
        let path = script.to_string_lossy().to_string();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(800));
            let _ = app_clone.emit("python:log", serde_json::json!({
                "type": "log",
                "level": "error",
                "msg": format!("Python script not found: {}", path),
            }));
        });
        return;
    }

    let python_bin = match find_python(&res_dir) {
        Some(p) => p,
        None => {
            let app_clone = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(800));
                let _ = app_clone.emit("python:log", serde_json::json!({
                    "type": "log",
                    "level": "error",
                    "msg": "找不到 python3。请安装 Python 3.10+ 或在偏好设置里指定 AUTOSUBS_PYTHON 环境变量",
                }));
            });
            return;
        }
    };

    // Build a PATH that includes common tool locations.
    // macOS apps launched via Finder inherit only a minimal PATH, hiding Homebrew
    // tools (ffmpeg, ffprobe, …). Prepend the standard Homebrew prefixes so
    // subprocess calls from Python work out of the box.
    // On Windows the user's full PATH is already inherited; no augmentation needed.
    let existing_path = std::env::var("PATH").unwrap_or_default();
    #[cfg(not(windows))]
    let merged_path = {
        let extra = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin"];
        let mut parts: Vec<String> = extra.iter().map(|s| s.to_string()).collect();
        if !existing_path.is_empty() { parts.push(existing_path); }
        parts.join(":")
    };
    #[cfg(windows)]
    let merged_path = existing_path;

    let mut cmd = Command::new(&python_bin);
    cmd.arg(&script)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .env("PATH", &merged_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let app_clone = app.clone();
            let py = python_bin.to_string_lossy().to_string();
            let err = e.to_string();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(800));
                let _ = app_clone.emit("python:log", serde_json::json!({
                    "type": "log",
                    "level": "error",
                    "msg": format!("无法启动 Python sidecar ({}): {}", py, err),
                }));
            });
            return;
        }
    };

    let stdin  = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take().expect("stderr");

    { state.lock().unwrap().stdin = Some(stdin); }

    // stdout reader: parse JSON events and forward to frontend
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if let Ok(val) = serde_json::from_str::<Value>(&line) {
                let evt = val.get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let _ = app_clone.emit(&format!("python:{}", evt), val);
            }
        }
        let _ = app_clone.emit("python:exited", serde_json::json!({}));
    });

    // stderr reader: surface uncaught Python exceptions to the frontend log
    let app_err = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let _ = app_err.emit("python:log", serde_json::json!({
                "type": "log",
                "level": "error",
                "msg": format!("[python] {}", line),
            }));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let python_state: PythonState = Arc::new(Mutex::new(PythonProcess { stdin: None }));
    let python_state_clone = python_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(python_state)
        .setup(move |app| {
            start_python_sidecar(&app.handle(), python_state_clone);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_files,
            pick_folder,
            pick_directory,
            send_to_python,
            list_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
