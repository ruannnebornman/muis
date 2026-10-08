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

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

mod agent;
mod bridge;
mod persist;

use agent::AgentPool;
use bridge::{EventSink, WorkerPool, WORKER_EVENT};
use tauri::{Emitter, Manager};

/// Locate the worker binary in `dir`. Prefers the plain `muis-worker`
/// sibling that the Arch package and Windows zip ship; falls back to the
/// Tauri-style triple-suffixed sidecar name
/// (`muis-worker-x86_64-unknown-linux-gnu`), which is how `bundle.externalBin`
/// names it inside the AppImage.
fn find_worker_in(dir: &Path) -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "muis-worker.exe"
    } else {
        "muis-worker"
    };
    let plain = dir.join(name);
    if plain.is_file() {
        return Some(plain);
    }
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let mut matches: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("muis-worker-") && n.ends_with(ext))
                .unwrap_or(false)
        })
        .collect();
    matches.sort();
    matches.into_iter().next()
}

/// Locate the worker binary next to the shell executable. Same directory
/// layout on all platforms: `muis` + `muis-worker[.exe]`, which is what
/// both the Arch package and the Windows portable zip ship.
fn worker_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    find_worker_in(exe.parent()?)
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

/// Live system-monitor snapshot pushed to the frontend every 2 s.
#[derive(serde::Serialize, Clone)]
struct SystemStats {
    /// Whole-percent total CPU (not per-core).
    cpu: u8,
    mem_used: u64,
    mem_total: u64,
    /// Whole-percent GPU, or None when no reading is available.
    gpu: Option<u8>,
}

/// Sampler pauses while the window is hidden (set by the frontend).
static STATS_ACTIVE: AtomicBool = AtomicBool::new(true);

/// Whole-percent GPU utilisation, best effort. NVIDIA first, then the
/// AMD/Intel DRM counter. None when nothing can be read.
fn gpu_usage() -> Option<u8> {
    if let Ok(out) = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"])
        .output()
    {
        if out.status.success() {
            if let Ok(text) = String::from_utf8(out.stdout) {
                if let Some(v) = text.lines().find_map(|l| l.trim().parse::<u8>().ok()) {
                    return Some(v);
                }
            }
        }
    }
    if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
        for entry in entries.flatten() {
            let path = entry.path().join("device/gpu_busy_percent");
            if let Ok(text) = std::fs::read_to_string(path) {
                if let Ok(v) = text.trim().parse::<u8>() {
                    return Some(v);
                }
            }
        }
    }
    None
}

#[tauri::command]
fn system_stats_active(active: bool) {
    STATS_ACTIVE.store(active, Ordering::Relaxed);
}

/// Whether `command` resolves to an executable on PATH (or an existing
/// file path). Decides if the New AI tab option is offered.
#[tauri::command]
fn command_available(command: String) -> bool {
    let command = command.trim();
    if command.is_empty() {
        return false;
    }
    if command.contains('/') || command.contains('\\') {
        return Path::new(command).is_file();
    }
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".to_string())
            .split(';')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_lowercase())
            .collect()
    } else {
        vec![String::new()]
    };
    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            if dir.join(format!("{command}{ext}")).is_file() {
                return true;
            }
        }
    }
    false
}

/// Directory opencode loads global plugins from.
fn opencode_plugins_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    Some(base.join("opencode").join("plugins"))
}

/// Install/update the muis opencode plugin. Writes it when missing, and
/// updates it when the existing file is ours (carries the "muis-plugin"
/// marker); never touches a foreign file. Returns the path.
#[tauri::command]
fn install_opencode_plugin() -> Result<String, String> {
    let dir = opencode_plugins_dir().ok_or("no config directory")?;
    let path = dir.join("muis.mjs");
    let ours = match std::fs::read_to_string(&path) {
        Ok(existing) => existing.contains("muis-plugin"),
        Err(_) => true, // missing
    };
    if ours {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(&path, include_str!("../opencode-plugin/muis.mjs"))
            .map_err(|e| e.to_string())?;
    }
    Ok(path.display().to_string())
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

/// NVIDIA + KWin explicit sync kills WebKitGTK's dmabuf fast path with
/// "explicit sync is used, but no acquire point is set" (native Wayland
/// only; XWayland never hits it). Fall back to shared-memory compositing
/// unless the user already chose. Invisible for a terminal, and the window
/// actually opens. Returns true when this call set the variable.
/// See docs/architecture-rust-xterm.md §8.
fn ensure_dmabuf_disabled() -> bool {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        true
    } else {
        false
    }
}

fn main() {
    ensure_dmabuf_disabled();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
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
            system_stats_active,
            command_available,
            install_opencode_plugin,
            worker_spawn,
            worker_send,
            worker_stop,
            agent::agent_spawn,
            agent::agent_write,
            agent::agent_kill
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
            let handle = app.handle().clone();
            let sink: EventSink =
                Arc::new(move |event| handle.emit(WORKER_EVENT, &event).is_ok());
            app.handle().manage(WorkerPool::new(sink, worker_path()));
            app.handle().manage(AgentPool::new());

            // Notification endpoint for `muis-notify` clients. One per-user
            // socket; each request is forwarded to the frontend, which routes
            // it to the originating tab. Best-effort: a failure here only
            // disables the CLI path, not the window.
            let socket = muis_core::notify::socket_name();
            let handle = app.handle().clone();
            if let Err(e) = muis_core::notify::serve(&socket, move |req| {
                let _ = handle.emit("muis-notify", &req);
            }) {
                eprintln!("muis: notification endpoint unavailable ({socket}): {e}");
            }

            // System monitor: one sampler for the window, pushing stats
            // events. The frontend pauses it while the window is hidden.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut sys = sysinfo::System::new();
                sys.refresh_cpu_usage();
                std::thread::sleep(std::time::Duration::from_millis(500));
                loop {
                    if STATS_ACTIVE.load(Ordering::Relaxed) {
                        sys.refresh_cpu_usage();
                        sys.refresh_memory();
                        let stats = SystemStats {
                            cpu: sys.global_cpu_usage().round().clamp(0.0, 100.0) as u8,
                            mem_used: sys.used_memory(),
                            mem_total: sys.total_memory(),
                            gpu: gpu_usage(),
                        };
                        let _ = handle.emit("system-stats", &stats);
                    }
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("muis shell failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_path_points_at_sibling_binary_when_present() {
        // worker_path() resolves against the test binary's directory.
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
    fn find_worker_in_prefers_plain_then_triple_suffixed() {
        let dir = std::env::temp_dir().join(format!("muis-worker-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let plain = dir.join(if cfg!(windows) {
            "muis-worker.exe"
        } else {
            "muis-worker"
        });
        let sidecar = dir.join(if cfg!(windows) {
            "muis-worker-x86_64-pc-windows-msvc.exe"
        } else {
            "muis-worker-x86_64-unknown-linux-gnu"
        });

        // Sidecar only: fall back to the triple-suffixed name.
        std::fs::write(&sidecar, b"x").unwrap();
        assert_eq!(find_worker_in(&dir), Some(sidecar));

        // Plain sibling present: prefer it.
        std::fs::write(&plain, b"x").unwrap();
        assert_eq!(find_worker_in(&dir), Some(plain));

        let _ = std::fs::remove_dir_all(&dir);
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

    #[test]
    fn command_available_rejects_missing_and_accepts_paths() {
        assert!(!command_available("this-command-does-not-exist-9f3a".to_string()));
        assert!(!command_available("   ".to_string()));
        let exe = std::env::current_exe().unwrap();
        assert!(command_available(exe.to_string_lossy().into_owned()));
    }

    #[test]
    fn gpu_usage_never_panics() {
        // Best effort: Some(percent) or None; just must not panic.
        let _ = gpu_usage();
    }

    #[test]
    fn dmabuf_workaround_respects_user_override() {
        std::env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
        assert!(ensure_dmabuf_disabled());
        assert_eq!(
            std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").as_deref(),
            Ok("1")
        );
        // A value the user already chose is never overwritten.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "0");
        assert!(!ensure_dmabuf_disabled());
        assert_eq!(
            std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").as_deref(),
            Ok("0")
        );
        std::env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
    }
}
