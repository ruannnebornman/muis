//! ACP (Agent Client Protocol) bridge.
//!
//! One shared agent process serves every AI pane. The shell spawns the
//! agent in ACP mode (`<command> acp`) on first use, streams its stdout to
//! the frontend as an `agent-msg` event, and forwards frontend writes to
//! the child's stdin. Sessions are multiplexed over the one process and
//! routed by the frontend from the session id in each message, so all
//! protocol logic stays in `src-ui/src/acp.ts` (testable without Tauri).

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter};

/// Event carrying one line of agent stdout (or stderr) to the frontend.
pub const AGENT_MSG: &str = "agent-msg";
/// Event emitted when the shared agent process exits.
pub const AGENT_EXIT: &str = "agent-exit";

struct AgentProc {
    child: Arc<Mutex<Child>>,
    stdin: ChildStdin,
}

/// The single shared agent process, lazily spawned.
#[derive(Clone, Default)]
pub struct AgentPool {
    proc: Arc<Mutex<Option<AgentProc>>>,
}

impl AgentPool {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Clone, serde::Serialize)]
struct AgentMsg {
    line: String,
}

/// Build `(program, args)` for an ACP launch: the configured command plus
/// `acp`, and `--pure` when requested.
fn acp_argv(command: &str, pure: bool) -> Result<(String, Vec<String>), String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("empty agent command".into());
    }
    let mut parts = command.split_whitespace();
    let program = parts.next().ok_or("empty agent command")?.to_string();
    let mut args: Vec<String> = parts.map(|s| s.to_string()).collect();
    args.push("acp".to_string());
    if pure {
        args.push("--pure".to_string());
    }
    Ok((program, args))
}

/// Spawn the shared agent in ACP mode for `cwd`. Idempotent: if a process is
/// already running, it is reused. `command` is the agent binary (e.g.
/// `opencode`); `acp` is appended to select its ACP entrypoint, and `--pure`
/// is appended when `pure` is set.
#[tauri::command]
pub fn agent_spawn(
    app: AppHandle,
    pool: tauri::State<AgentPool>,
    cwd: String,
    command: String,
    pure: Option<bool>,
) -> Result<(), String> {
    let mut slot = pool.proc.lock().unwrap();
    if slot.is_some() {
        return Ok(()); // shared process already running
    }
    let (program, args) = acp_argv(&command, pure.unwrap_or(false))?;

    // Run the agent at a lower priority so a burst of agent startups does
    // not starve the rest of the machine. Unix only; skipped elsewhere.
    let mut cmd = if cfg!(unix) {
        let mut c = Command::new("nice");
        c.arg("-n").arg("10").arg(&program).args(&args);
        c
    } else {
        let mut c = Command::new(&program);
        c.args(&args);
        c
    };
    let mut child = cmd
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn {program}: {e}"))?;

    let stdout = child.stdout.take().ok_or("agent has no stdout")?;
    let stderr = child.stderr.take();
    let stdin = child.stdin.take().ok_or("agent has no stdin")?;
    let child = Arc::new(Mutex::new(child));

    let handle = app.clone();
    let reader_child = child.clone();
    let pool_slot = pool.proc.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let _ = handle.emit(AGENT_MSG, AgentMsg { line });
                }
                Err(_) => break,
            }
        }
        // Reap the child so a naturally-exited agent does not linger as a
        // zombie. `agent_kill` may have already waited; that is harmless.
        if let Ok(mut c) = reader_child.lock() {
            let _ = c.wait();
        }
        // Clear the slot (only if it still holds our process, not a newer
        // one) *before* signalling exit, so a recovery respawn finds it
        // empty and actually spawns.
        {
            let mut slot = pool_slot.lock().unwrap();
            let ours = slot
                .as_ref()
                .map(|p| Arc::ptr_eq(&p.child, &reader_child))
                .unwrap_or(false);
            if ours {
                *slot = None;
            }
        }
        let _ = handle.emit(AGENT_EXIT, ());
    });

    // Surface agent stderr as messages too; ACP uses stdout for the
    // protocol, so stderr is diagnostics and safe to forward.
    if let Some(err) = stderr {
        let handle = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(err);
            for line in reader.lines().map_while(Result::ok) {
                let _ = handle.emit(AGENT_MSG, AgentMsg { line: format!("[stderr] {line}") });
            }
        });
    }

    *slot = Some(AgentProc { child, stdin });
    Ok(())
}

/// Write one JSON-RPC line to the shared agent's stdin.
#[tauri::command]
pub fn agent_write(pool: tauri::State<AgentPool>, line: String) -> Result<(), String> {
    let mut slot = pool.proc.lock().unwrap();
    let proc = slot.as_mut().ok_or("no agent running")?;
    proc.stdin
        .write_all(line.as_bytes())
        .and_then(|_| proc.stdin.write_all(b"\n"))
        .and_then(|_| proc.stdin.flush())
        .map_err(|e| e.to_string())
}

/// Stop the shared agent process and forget it. Idle panes call this; the
/// next AI pane spawns a fresh process.
#[tauri::command]
pub fn agent_kill(pool: tauri::State<AgentPool>) {
    if let Some(proc) = pool.proc.lock().unwrap().take() {
        if let Ok(mut child) = proc.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_command_is_rejected() {
        assert!(acp_argv("", false).is_err());
        assert!(acp_argv("   ", false).is_err());
    }

    #[test]
    fn acp_argv_appends_acp() {
        assert_eq!(
            acp_argv("opencode", false).unwrap(),
            ("opencode".to_string(), vec!["acp".to_string()])
        );
    }

    #[test]
    fn acp_argv_appends_pure_when_requested() {
        assert_eq!(acp_argv("opencode", true).unwrap().1, vec!["acp", "--pure"]);
    }

    #[test]
    fn acp_argv_keeps_extra_args_before_acp() {
        let (program, args) = acp_argv("opencode run --agent build", false).unwrap();
        assert_eq!(program, "opencode");
        assert_eq!(args, vec!["run", "--agent", "build", "acp"]);
    }
}
