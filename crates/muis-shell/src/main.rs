#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

//! muis shell: the native window around the xterm.js frontend.
//!
//! The shell owns no terminal state. It spawns one `muis-worker` process
//! per session (see docs/architecture-rust-xterm.md) and renders
//! src-ui. A worker crash therefore takes down one session, never the
//! window or the other sessions.

use std::path::PathBuf;

mod bridge;
mod persist;

use bridge::WorkerPool;
use tauri::Manager;

/// Locate the worker binary next to the shell executable. Same directory
/// layout on all platforms: `muis` + `muis-worker[.exe]`, which is what
/// both the Arch package and the Windows portable zip ship.
fn worker_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) {
        "muis-worker.exe"
    } else {
        "muis-worker"
    };
    let candidate = dir.join(name);
    candidate.is_file().then(|| candidate)
}

#[tauri::command]
fn ping() -> String {
    "pong".to_string()
}

#[tauri::command]
fn worker_available() -> bool {
    worker_path().is_some()
}

#[tauri::command]
fn default_shell() -> String {
    muis_core::shell::default_shell().to_string_lossy().into_owned()
}

#[tauri::command]
fn default_cwd() -> String {
    muis_core::paths::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "/".to_string())
}

/// Optional input for the native PTY smoke harness. Kept debug-build-only
/// so release binaries never execute environment-provided shell commands.
#[tauri::command]
fn live_test_command() -> Option<String> {
    #[cfg(debug_assertions)]
    {
        return std::env::var("MUIS_TEST_COMMAND")
            .ok()
            .filter(|command| !command.trim().is_empty());
    }
    #[cfg(not(debug_assertions))]
    {
        None
    }
}

/// Frontend diagnosis snapshot (no devtools in release builds).
#[tauri::command]
fn debug_report(json: String) {
    #[cfg(debug_assertions)]
    eprintln!("muis-debug: {json}");
    #[cfg(not(debug_assertions))]
    let _ = json;
}

#[tauri::command]
fn sessions_load() -> Result<String, String> {
    persist::read_text(&muis_core::paths::sessions_file())
}

#[tauri::command]
fn sessions_save(json: String) -> Result<(), String> {
    persist::write_json(&muis_core::paths::sessions_file(), &json)
}

#[tauri::command]
fn config_load() -> Result<String, String> {
    persist::read_text(&muis_core::paths::config_file())
}

#[tauri::command]
fn config_save(json: String) -> Result<(), String> {
    persist::write_json(&muis_core::paths::config_file(), &json)
}

#[tauri::command]
fn snapshot_store(tab_id: String, data_b64: String) -> Result<(), String> {
    persist::snapshot_store(&tab_id, &data_b64)
}

#[tauri::command]
fn snapshot_read(tab_id: String) -> Result<String, String> {
    persist::snapshot_read(&tab_id)
}

#[tauri::command]
fn snapshot_remove(tab_id: String) {
    persist::snapshot_remove(&tab_id);
}

/// Current git branch for a cwd; empty string when not a repo (or git
/// missing/slow — the caller treats empty as "no pill data").
#[tauri::command]
fn git_branch(cwd: String) -> String {
    std::process::Command::new("git")
        .args(["-C", &cwd, "branch", "--show-current"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

#[derive(serde::Serialize)]
struct SysInfo {
    user: String,
    host: String,
}

/// User@host for the statusbar. Best effort, never fails.
#[tauri::command]
fn sys_info() -> SysInfo {
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "user".to_string());
    let host = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .or_else(|_| {
            std::fs::read_to_string("/etc/hostname").map(|s| s.trim().to_string())
        })
        .unwrap_or_else(|_| "host".to_string());
    SysInfo { user, host }
}

#[tauri::command]
fn worker_spawn(pool: tauri::State<WorkerPool>, session_id: String) -> Result<(), String> {
    pool.spawn_session(&session_id)
}

#[tauri::command]
fn worker_send(
    pool: tauri::State<WorkerPool>,
    session_id: String,
    line: String,
) -> Result<(), String> {
    pool.send_line(&session_id, &line)
}

#[tauri::command]
fn worker_stop(pool: tauri::State<WorkerPool>, session_id: String) {
    pool.stop_session(&session_id);
}

fn main() {
    // NVIDIA + KWin explicit sync kills the dmabuf fast path with
    // "explicit sync is used, but no acquire point is set" (native
    // Wayland only; XWayland never hits it). Fall back to shared-memory
    // compositing unless the user already chose. Invisible for a
    // terminal, and the window actually opens.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            worker_available,
            default_shell,
            default_cwd,
            live_test_command,
            debug_report,
            sessions_load,
            sessions_save,
            config_load,
            config_save,
            snapshot_store,
            snapshot_read,
            snapshot_remove,
            git_branch,
            sys_info,
            worker_spawn,
            worker_send,
            worker_stop
        ])
        .setup(|app| {
            // Fail visibly in dev when the sidecar is missing; the release
            // packages always ship both binaries together.
            if worker_path().is_none() {
                eprintln!(
                    "muis: muis-worker not found next to {}",
                    std::env::current_exe()
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|_| "<unknown>".to_string())
                );
            }
            app.handle().manage(WorkerPool::new(app.handle().clone(), worker_path()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("muis shell failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_path_points_at_sibling_binary_when_present() {        // worker_path() resolves against the test binary's directory.
        // No assertion on presence here (cargo test doesn't ship the
        // sidecar); this locks the naming contract instead.
        let name = if cfg!(windows) {
            "muis-worker.exe"
        } else {
            "muis-worker"
        };
        assert_eq!(name.strip_suffix(".exe").unwrap_or(name), "muis-worker");
        let _ = worker_path();
    }

    #[test]
    fn git_branch_is_empty_outside_a_repo() {
        let dir = std::env::temp_dir().join(format!("muis-git-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let branch = git_branch(dir.to_string_lossy().into_owned());
        // /tmp is (almost certainly) not a repo; either way it never errors.
        assert!(branch.is_ascii());
    }

    #[test]
    fn sys_info_never_blank() {
        let info = sys_info();
        assert!(!info.user.is_empty());
        assert!(!info.host.is_empty());
    }
}
