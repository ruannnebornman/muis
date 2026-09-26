//! Shell ↔ worker bridge.
//!
//! The shell owns one `muis-worker` child process per session and routes
//! bytes: frontend UiToWorker JSON lines go to worker stdin, worker
//! stdout lines come back as `muis-worker-event` Tauri events carrying a
//! [`SessionEvent`]. The shell never interprets terminal state; a dead
//! worker only ever affects its own session.

use muis_core::ipc::{decode_worker, WorkerToUi};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Frontend event name for everything arriving from any worker.
pub const WORKER_EVENT: &str = "muis-worker-event";

#[derive(Debug, Clone, Serialize)]
pub struct SessionEvent {
    pub session_id: String,
    pub frame: WorkerToUi,
}

/// Pure parse step: worker stdout line -> frontend event payload.
/// Unit-tested without a Tauri runtime.
pub fn parse_worker_line(session_id: &str, line: &str) -> Result<SessionEvent, String> {
    decode_worker(line)
        .map(|frame| SessionEvent {
            session_id: session_id.to_string(),
            frame,
        })
        .map_err(|e| e.to_string())
}

struct Running {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
}

pub struct WorkerPool {
    app: AppHandle,
    workers: Mutex<HashMap<String, Arc<Running>>>,
    worker_bin: Option<std::path::PathBuf>,
}

impl WorkerPool {
    pub fn new(app: AppHandle, worker_bin: Option<std::path::PathBuf>) -> Self {
        Self {
            app,
            workers: Mutex::new(HashMap::new()),
            worker_bin,
        }
    }

    fn dead_worker_event(session_id: &str) -> SessionEvent {
        SessionEvent {
            session_id: session_id.to_string(),
            frame: WorkerToUi::Error {
                pty_id: String::new(),
                message: "worker process ended".to_string(),
            },
        }
    }

    /// Start the worker for a session. Idempotent: already running is Ok.
    pub fn spawn_session(&self, session_id: &str) -> Result<(), String> {
        if self.workers.lock().unwrap().contains_key(session_id) {
            return Ok(());
        }
        let bin = self.worker_bin.clone().ok_or_else(|| {
            "muis-worker not found next to the muis binary".to_string()
        })?;
        let mut child = Command::new(bin)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("failed to start muis-worker: {e}"))?;
        let stdin = child.stdin.take().ok_or("worker stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("worker stdout unavailable")?;
        let running = Arc::new(Running {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
        });
        self.workers
            .lock()
            .unwrap()
            .insert(session_id.to_string(), Arc::clone(&running));

        // Pump worker stdout -> frontend events until EOF, then report the
        // death so the UI can offer reconnect. EOF without Exited frames
        // means the worker crashed (see the per-session-process design).
        let app = self.app.clone();
        let id = session_id.to_string();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                match parse_worker_line(&id, &line) {
                    Ok(event) => {
                        if app.emit(WORKER_EVENT, &event).is_err() {
                            break;
                        }
                    }
                    Err(_) => continue,
                }
            }
            let _ = app.emit(WORKER_EVENT, Self::dead_worker_event(&id));
        });
        Ok(())
    }

    /// Forward one UiToWorker JSON line to the session's worker.
    pub fn send_line(&self, session_id: &str, line: &str) -> Result<(), String> {
        let workers = self.workers.lock().unwrap();
        let running = workers
            .get(session_id)
            .ok_or_else(|| format!("no worker for session {session_id}"))?;
        let mut stdin = running.stdin.lock().unwrap();
        stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("worker write failed: {e}"))?;
        if !line.ends_with('\n') {
            stdin
                .write_all(b"\n")
                .map_err(|e| format!("worker write failed: {e}"))?;
        }
        stdin
            .flush()
            .map_err(|e| format!("worker write failed: {e}"))?;
        Ok(())
    }

    /// Kill the session's worker and forget it. Next spawn starts fresh.
    pub fn stop_session(&self, session_id: &str) {
        if let Some(running) = self.workers.lock().unwrap().remove(session_id) {
            if let Ok(mut child) = running.child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_worker_line_tags_session() {
        let e = parse_worker_line("s1", r#"{"type":"exited","pty_id":"t2","code":42}"#).unwrap();
        assert_eq!(e.session_id, "s1");
        assert_eq!(
            e.frame,
            WorkerToUi::Exited {
                pty_id: "t2".into(),
                code: Some(42),
            }
        );
    }

    #[test]
    fn parse_worker_line_rejects_garbage() {
        assert!(parse_worker_line("s1", "not json").is_err());
        assert!(parse_worker_line("s1", r#"{"type":"nope"}"#).is_err());
    }

    #[test]
    fn session_event_serializes_for_the_frontend() {
        let e = SessionEvent {
            session_id: "s1".into(),
            frame: WorkerToUi::Spawned {
                pty_id: "t1".into(),
            },
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["session_id"], "s1");
        assert_eq!(v["frame"]["type"], "spawned");
    }
}
