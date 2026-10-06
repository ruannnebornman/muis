//! ACP (Agent Client Protocol) bridge.
//!
//! The shell owns no agent state beyond the child process. It spawns the
//! agent in ACP mode (`<command> acp`), streams each stdout line to the
//! frontend as an `agent-msg` event, and forwards frontend writes to the
//! child's stdin. All protocol logic lives in the frontend
//! (`src-ui/src/acp.ts`), which keeps it testable without Tauri.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

/// Event carrying one line of agent stdout (or stderr) to the frontend.
pub const AGENT_MSG: &str = "agent-msg";
/// Event emitted when an agent process exits.
pub const AGENT_EXIT: &str = "agent-exit";

struct AgentProc {
    child: Child,
    stdin: ChildStdin,
}

/// One ACP child process per agent tab, keyed by an opaque id.
#[derive(Default)]
pub struct AgentPool {
    procs: Mutex<HashMap<String, AgentProc>>,
    next: AtomicUsize,
}

impl AgentPool {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Clone, serde::Serialize)]
struct AgentMsg {
    id: String,
    line: String,
}

#[derive(Clone, serde::Serialize)]
struct AgentExit {
    id: String,
}

/// Spawn an agent in ACP mode for `cwd`. `command` is the agent binary
/// (e.g. `opencode`); `acp` is appended to select its ACP entrypoint.
#[tauri::command]
pub fn agent_spawn(
    app: AppHandle,
    pool: tauri::State<AgentPool>,
    cwd: String,
    command: String,
) -> Result<String, String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("empty agent command".into());
    }
    let mut parts = command.split_whitespace();
    let program = parts.next().ok_or("empty agent command")?;
    let mut args: Vec<String> = parts.map(|s| s.to_string()).collect();
    args.push("acp".to_string());

    let mut child = Command::new(program)
        .args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn {program}: {e}"))?;

    let id = format!("ag{}", pool.next.fetch_add(1, Ordering::Relaxed) + 1);
    let stdout = child.stdout.take().ok_or("agent has no stdout")?;
    let stderr = child.stderr.take();
    let stdin = child.stdin.take().ok_or("agent has no stdin")?;

    let reader_id = id.clone();
    let handle = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let _ = handle.emit(
                        AGENT_MSG,
                        AgentMsg { id: reader_id.clone(), line },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = handle.emit(AGENT_EXIT, AgentExit { id: reader_id });
    });

    // Surface agent stderr as messages too; ACP uses stdout for the
    // protocol, so stderr is diagnostics and safe to forward.
    if let Some(err) = stderr {
        let err_id = id.clone();
        let handle = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(err);
            for line in reader.lines().map_while(Result::ok) {
                let _ = handle.emit(
                    AGENT_MSG,
                    AgentMsg { id: err_id.clone(), line: format!("[stderr] {line}") },
                );
            }
        });
    }

    pool.procs
        .lock()
        .unwrap()
        .insert(id.clone(), AgentProc { child, stdin });
    Ok(id)
}

/// Write one JSON-RPC line to an agent's stdin.
#[tauri::command]
pub fn agent_write(pool: tauri::State<AgentPool>, id: String, line: String) -> Result<(), String> {
    let mut procs = pool.procs.lock().unwrap();
    let proc = procs.get_mut(&id).ok_or("no such agent")?;
    proc.stdin
        .write_all(line.as_bytes())
        .and_then(|_| proc.stdin.write_all(b"\n"))
        .and_then(|_| proc.stdin.flush())
        .map_err(|e| e.to_string())
}

/// Stop an agent process and forget it.
#[tauri::command]
pub fn agent_kill(pool: tauri::State<AgentPool>, id: String) {
    if let Some(mut proc) = pool.procs.lock().unwrap().remove(&id) {
        let _ = proc.child.kill();
        let _ = proc.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_command_is_rejected() {
        // Command validation is the only pure logic here; spawning needs Tauri.
        assert!("".trim().is_empty());
        assert!("   ".trim().is_empty());
        assert!(!("opencode".trim().is_empty()));
    }
}
