#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

//! muis shell: the native window around the xterm.js frontend.
//!
//! The shell owns no terminal state. It spawns one `muis-worker` process
//! per session (see docs/archive/architecture-rust-xterm.md) and renders
//! src-ui. A worker crash therefore takes down one session, never the
//! window or the other sessions.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

mod agent;
mod bridge;
mod logging;
mod persist;

use agent::AgentPool;
use bridge::{EventSink, WorkerLaunch, WorkerPool, WORKER_EVENT};
use tauri::{Emitter, Manager};

/// Hidden argument that runs the embedded pty worker in this same binary
/// (Windows single-file build). See [`embedded_request`].
#[cfg(windows)]
const WORKER_ARG: &str = "--muis-worker";
/// Hidden argument that runs the embedded notify CLI in this same binary.
#[cfg(windows)]
const NOTIFY_ARG: &str = "--muis-notify";

/// Locate the worker binary in `dir`. Prefers the plain `muis-worker`
/// sibling that the Arch package ships; falls back to the Tauri-style
/// triple-suffixed sidecar name
/// (`muis-worker-x86_64-unknown-linux-gnu`), which is how
/// `bundle.externalBin` names it inside the AppImage.
///
/// Windows does not use this (it re-execs the shell itself); it stays for
/// the tests that lock the naming contract.
#[cfg(any(not(windows), test))]
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

/// Locate the sibling worker binary next to the shell executable, as the
/// Linux packages ship it (`muis` + `muis-worker`).
#[cfg(any(not(windows), test))]
fn worker_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    find_worker_in(exe.parent()?)
}

/// How the shell starts a session worker. Linux packages spawn the sibling
/// `muis-worker`; the Windows single-file build re-execs this same exe in
/// the hidden `--muis-worker` mode, so nothing else ships alongside it.
fn worker_launch() -> Option<WorkerLaunch> {
    #[cfg(windows)]
    {
        // Always re-exec ourselves: no sibling to lose or leave stale, and
        // the worker can never be a different version than the shell.
        let exe = std::env::current_exe().ok()?;
        Some(WorkerLaunch::SelfExe {
            exe,
            arg: WORKER_ARG.to_string(),
        })
    }
    #[cfg(not(windows))]
    {
        worker_path().map(WorkerLaunch::Exe)
    }
}

/// Windows single-file mode selector: `Some("worker")`/`Some("notify")` when
/// this is a re-exec of ourselves, `None` for a normal shell launch.
#[cfg(windows)]
fn embedded_request() -> Option<&'static str> {
    match std::env::args().nth(1).as_deref() {
        Some(WORKER_ARG) => Some("worker"),
        Some(NOTIFY_ARG) => Some("notify"),
        _ => None,
    }
}

/// Run an embedded helper in this consoleless GUI process. The notify CLI
/// gets the args after its `--muis-notify` mode flag.
#[cfg(windows)]
fn dispatch_embedded(mode: &str) -> i32 {
    match mode {
        "worker" => muis_worker::run(),
        "notify" => muis_notify::run_with(std::env::args().skip(2)),
        _ => 0,
    }
}

#[tauri::command]
fn ping() -> String {
    "pong".to_string()
}

#[tauri::command]
fn worker_available() -> bool {
    worker_launch().is_some()
}

/// Whether this window is running in `--testmode`; the frontend shows a
/// marker so a test window is never mistaken for the real one.
#[tauri::command]
fn is_test_mode() -> bool {
    test_mode()
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
    log::debug!("frontend report: {json}");
}

/// Path of the diagnostics log file, so the UI can point users at it when
/// something fails (no console in release builds).
#[tauri::command]
fn log_path() -> String {
    logging::log_file().to_string_lossy().into_owned()
}

#[tauri::command]
fn sessions_load() -> Result<String, String> {
    // Test mode starts fresh: never restore the real session.
    if test_mode() {
        return Ok(String::new());
    }
    persist::read_text(&muis_core::paths::sessions_file())
}

#[tauri::command]
fn sessions_save(json: String) -> Result<(), String> {
    // Test mode never writes: the real session file is left untouched.
    if test_mode() {
        return Ok(());
    }
    persist::write_json(&muis_core::paths::sessions_file(), &json)
}

#[tauri::command]
fn config_load() -> Result<String, String> {
    persist::read_text(&muis_core::paths::config_file())
}

#[tauri::command]
fn config_save(json: String) -> Result<(), String> {
    // Settings are loaded in test mode (so the run reflects the real
    // config), but never written, so a test can't overwrite them.
    if test_mode() {
        return Ok(());
    }
    persist::write_json(&muis_core::paths::config_file(), &json)
}

#[tauri::command]
fn snapshot_store(tab_id: String, data_b64: String) -> Result<(), String> {
    if test_mode() {
        return Ok(());
    }
    persist::snapshot_store(&tab_id, &data_b64)
}

#[tauri::command]
fn snapshot_read(tab_id: String) -> Result<String, String> {
    if test_mode() {
        return Ok(String::new());
    }
    persist::snapshot_read(&tab_id)
}

#[tauri::command]
fn snapshot_remove(tab_id: String) {
    if test_mode() {
        return;
    }
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

/// `muis --testmode`: start from a fresh session and never persist anything.
/// Real session/config files and scrollback snapshots are left untouched.
static TEST_MODE: AtomicBool = AtomicBool::new(false);

fn test_mode() -> bool {
    TEST_MODE.load(Ordering::Relaxed)
}

/// Notification socket this shell serves and injects into every pty. Test
/// mode uses a distinct socket so it never collides with a running muis (and
/// its terminals' `muis-notify` reaches the test window, not the real one).
/// `MUIS_SOCKET_NAME` overrides the base name (the live smoke test sets it so
/// it does not fight a real muis for the per-user socket).
pub(crate) fn notify_socket_name() -> String {
    let base = std::env::var("MUIS_SOCKET_NAME")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(muis_core::notify::socket_name);
    if test_mode() {
        format!("{base}-testmode")
    } else {
        base
    }
}

/// True when `flag` appears verbatim in the process arguments.
fn arg_present(args: &[String], flag: &str) -> bool {
    args.iter().any(|a| a == flag)
}

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

/// opencode only auto-loads `.js`/`.ts` files from its plugin directory.
/// A `.mjs` name is silently ignored, so the exact session-id plugin never
/// ran. Keep the installed name loadable and drop the old one.
const OPENCODE_PLUGIN_FILE: &str = "muis.js";
const OPENCODE_PLUGIN_LEGACY: &str = "muis.mjs";
const OPENCODE_PLUGIN_MARKER: &str = "muis-plugin";
const OPENCODE_PLUGIN_SRC: &str = include_str!("../opencode-plugin/muis.js");

/// Install/update the muis opencode plugin. Writes it when missing, and
/// updates it when the existing file is ours (carries the "muis-plugin"
/// marker); never touches a foreign file. Returns the path.
#[tauri::command]
fn install_opencode_plugin() -> Result<String, String> {
    let dir = opencode_plugins_dir().ok_or("no config directory")?;
    let path = dir.join(OPENCODE_PLUGIN_FILE);
    let ours = match std::fs::read_to_string(&path) {
        Ok(existing) => existing.contains(OPENCODE_PLUGIN_MARKER),
        Err(_) => true, // missing
    };
    if ours {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(&path, OPENCODE_PLUGIN_SRC).map_err(|e| e.to_string())?;
    }
    let legacy = dir.join(OPENCODE_PLUGIN_LEGACY);
    if std::fs::read_to_string(&legacy).is_ok_and(|s| s.contains(OPENCODE_PLUGIN_MARKER)) {
        let _ = std::fs::remove_file(&legacy);
    }
    Ok(path.display().to_string())
}

/// Open an http(s) URL in the user's browser (OSC 8 hyperlinks). Only
/// http/https are accepted; never a shell invocation.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("only http(s) URLs can be opened".into());
    }
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    std::process::Command::new(opener)
        .arg(trimmed)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete saved sessions (manifest + per-session snapshots).
fn reset_sessions_state() -> Result<(), String> {
    let file = muis_core::paths::sessions_file();
    let dir = muis_core::paths::sessions_dir();
    if file.exists() {
        std::fs::remove_file(&file).map_err(|e| e.to_string())?;
    }
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Wipe saved sessions and relaunch the app in place.
#[tauri::command]
fn reset_sessions_and_restart(app: tauri::AppHandle) -> Result<(), String> {
    // Never delete the real sessions from a test-mode window.
    if test_mode() {
        return Err("session reset is disabled in test mode".into());
    }
    reset_sessions_state()?;
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::process::Command::new(exe).spawn();
    }
    app.exit(0);
    Ok(())
}

/// Read a UTF-8 text file for attaching to an agent prompt. Capped so a
/// huge file can't be slurped by accident.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 512 * 1024 {
        return Err("file too large (max 512 KiB)".into());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("not a UTF-8 text file: {e}"))
}

/// Names of up to `limit` non-hidden subdirectories of `path`, sorted. Used
/// by the new-session dialog's subfolder quick picks. Best effort: a missing
/// or unreadable path yields an empty list.
#[tauri::command]
fn list_subdirs(path: String, limit: usize) -> Vec<String> {
    let mut names: Vec<String> = match std::fs::read_dir(&path) {
        Ok(entries) => entries
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .filter_map(|e| e.file_name().to_str().map(str::to_string))
            .filter(|n| !n.starts_with('.'))
            .collect(),
        Err(_) => Vec::new(),
    };
    names.sort();
    names.truncate(limit.min(50));
    names
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
/// See docs/archive/architecture-rust-xterm.md §8.
fn ensure_dmabuf_disabled() -> bool {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        true
    } else {
        false
    }
}

fn main() {
    // First thing: release builds have no console on Windows, so without a
    // file logger a start-up failure leaves nothing behind to diagnose.
    if let Some(path) = logging::init() {
        log::info!("muis shell starting; log file: {}", path.display());
    }

    // Windows single-file build: if we were re-exec'd as the embedded worker
    // or notify CLI, run that and exit before Tauri starts. This process is
    // windows-subsystem (no console), so no CLI window ever appears.
    #[cfg(windows)]
    {
        if let Some(mode) = embedded_request() {
            log::info!("embedded mode: {mode}");
            std::process::exit(dispatch_embedded(mode));
        }
    }

    ensure_dmabuf_disabled();

    let args: Vec<String> = std::env::args().collect();
    let test = arg_present(&args, "--testmode");
    TEST_MODE.store(test, Ordering::Relaxed);

    // `muis --reset-sessions`: clear saved sessions and exit (no window).
    // Ignored in test mode so it can never touch the real sessions.
    if !test && arg_present(&args, "--reset-sessions") {
        match reset_sessions_state() {
            Ok(()) => log::info!("cleared saved sessions"),
            Err(e) => {
                log::error!("could not clear sessions: {e}");
                std::process::exit(1);
            }
        }
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            worker_available,
            is_test_mode,
            default_shell,
            default_cwd,
            live_test_command,
            debug_report,
            log_path,
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
            read_text_file,
            list_subdirs,
            open_url,
            reset_sessions_and_restart,
            worker_spawn,
            worker_send,
            worker_stop,
            agent::agent_spawn,
            agent::agent_write,
            agent::agent_kill
        ])
        .setup(|app| {
            log::info!(
                "muis {} ready ({} {}); binary: {}",
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH,
                std::env::current_exe()
                    .map(|p| p.display().to_string())
                    .unwrap_or_else(|_| "<unknown>".to_string()),
            );

            // How session workers start: a sibling binary, or (Windows
            // single-file) this same exe re-exec'd in `--muis-worker` mode.
            let launch = worker_launch();
            match &launch {
                Some(WorkerLaunch::Exe(path)) => {
                    log::info!("worker binary: {}", path.display())
                }
                #[cfg(windows)]
                Some(WorkerLaunch::SelfExe { exe, arg }) => {
                    log::info!("worker mode: {} {arg}", exe.display())
                }
                None => log::error!(
                    "no muis-worker available next to {}",
                    std::env::current_exe()
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|_| "<unknown>".to_string())
                ),
            }

            let handle = app.handle().clone();
            let sink: EventSink =
                Arc::new(move |event| handle.emit(WORKER_EVENT, &event).is_ok());
            app.handle().manage(WorkerPool::new(sink, launch));
            app.handle().manage(AgentPool::new());

            // Notification endpoint for `muis-notify` clients. One per-user
            // socket; each request is forwarded to the frontend, which routes
            // it to the originating tab. Best-effort: a failure here only
            // disables the CLI path, not the window. Test mode uses its own
            // socket so it never steals notifications from a running muis.
            let socket = notify_socket_name();
            let handle = app.handle().clone();
            if let Err(e) = muis_core::notify::serve(&socket, move |req| {
                let _ = handle.emit("muis-notify", &req);
            }) {
                log::warn!("notification endpoint unavailable ({socket}): {e}");
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
    fn opencode_plugin_name_is_loadable_and_ours() {
        // opencode silently ignores `.mjs` files in its plugin dir, so the
        // installed plugin must use an extension opencode auto-loads.
        assert!(OPENCODE_PLUGIN_FILE.ends_with(".js") || OPENCODE_PLUGIN_FILE.ends_with(".ts"));
        assert_ne!(OPENCODE_PLUGIN_FILE, OPENCODE_PLUGIN_LEGACY);
        assert!(OPENCODE_PLUGIN_SRC.contains(OPENCODE_PLUGIN_MARKER));
    }

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
    fn list_subdirs_sorts_filters_and_caps() {
        let dir = std::env::temp_dir().join(format!("muis-subdirs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("beta")).unwrap();
        std::fs::create_dir_all(dir.join("alpha")).unwrap();
        std::fs::create_dir_all(dir.join(".hidden")).unwrap();
        std::fs::write(dir.join("file.txt"), b"x").unwrap();
        let path = dir.to_string_lossy().into_owned();
        // Directories only, hidden excluded, sorted.
        assert_eq!(list_subdirs(path.clone(), 10), vec!["alpha", "beta"]);
        // Limit is respected, and a missing path is empty (never errors).
        assert_eq!(list_subdirs(path, 1), vec!["alpha"]);
        assert!(list_subdirs("/no/such/path-9f3a".to_string(), 10).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
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

    #[test]
    fn testmode_flag_is_detected_exactly() {
        let args = |extra: &[&str]| -> Vec<String> {
            std::iter::once("muis".to_string())
                .chain(extra.iter().map(|s| s.to_string()))
                .collect()
        };
        assert!(!arg_present(&args(&[]), "--testmode"));
        assert!(arg_present(&args(&["--testmode"]), "--testmode"));
        assert!(arg_present(&args(&["--testmode", "--reset-sessions"]), "--testmode"));
        // Exact match only: an unrelated flag or a value is not test mode.
        assert!(!arg_present(&args(&["--test-mode"]), "--testmode"));
        assert!(!arg_present(&args(&["--testmode=1"]), "--testmode"));
    }

    #[test]
    fn notify_socket_is_base_without_test_mode() {
        assert!(!test_mode());
        assert_eq!(notify_socket_name(), muis_core::notify::socket_name());
    }
}
