// src-tauri/src/main.rs
// Tauri v2 binary entry point — delegates to lib.rs

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    autosubs_lite_lib::run()
}
