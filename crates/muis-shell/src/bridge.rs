//! Shell ↔ worker bridge.
//!
//! The shell owns one `muis-worker` child process per session and routes
//! bytes: frontend UiToWorker JSON lines go to worker stdin, worker
//! stdout lines come back through an injected [`EventSink`] (in the app,
//! `muis-worker-event` Tauri events carrying a [`SessionEvent`]). The
//! shell never interprets terminal state; a dead worker only ever
//! affects its own session.

use muis_core::ipc::{decode_worker, WorkerToUi};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

/// Frontend event name for everything arriving from any worker.
pub const WORKER_EVENT: &str = "muis-worker-event";

#[derive(Debug, Clone, Serialize)]
pub struct SessionEvent {
    pub session_id: String,
    pub frame: WorkerToUi,
}

/// Delivers a worker event to the frontend. Returns `false` when the
/// destination is gone, which stops the pump thread. The indirection
/// keeps the pool testable without a Tauri runtime.
pub type EventSink = Arc<dyn Fn(SessionEvent) -> bool + Send + Sync + 'static>;


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
    sink: EventSink,
    workers: Mutex<HashMap<String, Arc<Running>>>,
    worker_bin: Option<PathBuf>,
}

impl WorkerPool {
    pub fn new(sink: EventSink, worker_bin: Option<PathBuf>) -> Self {
        Self {
            sink,
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
            // The worker forwards this to each pty so `muis-notify` can find
            // the shell's notification socket.
            .env("MUIS_SOCKET", muis_core::notify::socket_name())
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
        let sink = Arc::clone(&self.sink);
        let id = session_id.to_string();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                match parse_worker_line(&id, &line) {
                    Ok(event) => {
                        if !sink(event) {
                            break;
                        }
                    }
                    Err(_) => continue,
                }
            }
            let _ = sink(Self::dead_worker_event(&id));
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

    /// One worker process per session, spawn is idempotent, and stopping
    /// one session leaves the others running. Uses a fake worker script
    /// that answers every input line with a `spawned` frame, so the pool
    /// is exercised without a Tauri runtime or a real pty.
    #[cfg(unix)]
    #[test]
    fn one_worker_per_session_and_stop_is_isolated() {
        use std::os::unix::fs::PermissionsExt;
        use std::sync::mpsc::channel;
        use std::time::Duration;

        let dir = std::env::temp_dir().join(format!("muis-pool-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let worker = dir.join("fake-worker.sh");
        std::fs::write(
            &worker,
            "#!/bin/sh\nwhile IFS= read -r _line; do printf '{\"type\":\"spawned\",\"pty_id\":\"p1\"}\\n'; done\n",
        )
        .unwrap();
        let mut perms = std::fs::metadata(&worker).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&worker, perms).unwrap();

        let (tx, rx) = channel::<SessionEvent>();
        let sink: EventSink = Arc::new(move |event| tx.send(event).is_ok());
        let pool = WorkerPool::new(sink, Some(worker));

        // Two sessions, one double-spawn to prove idempotency.
        pool.spawn_session("s1").unwrap();
        pool.spawn_session("s1").unwrap();
        pool.spawn_session("s2").unwrap();

        let write = r#"{"type":"write","pty_id":"p1","data":""}"#;
        pool.send_line("s1", write).unwrap();
        pool.send_line("s2", write).unwrap();

        // Exactly one `spawned` frame per session, not two for s1.
        let mut spawned: HashMap<String, usize> = HashMap::new();
        while spawned.values().sum::<usize>() < 2 {
            let event = rx.recv_timeout(Duration::from_secs(5)).expect("worker event");
            if matches!(event.frame, WorkerToUi::Spawned { .. }) {
                *spawned.entry(event.session_id).or_insert(0) += 1;
            }
        }
        assert_eq!(spawned.get("s1"), Some(&1));
        assert_eq!(spawned.get("s2"), Some(&1));

        // Stopping s1 kills only its worker; s2 keeps answering.
        pool.stop_session("s1");
        assert!(pool.send_line("s1", write).is_err());
        pool.send_line("s2", write).unwrap();
        let mut s2_alive = false;
        while !s2_alive {
            let event = rx.recv_timeout(Duration::from_secs(5)).expect("s2 still alive");
            if event.session_id == "s2" && matches!(event.frame, WorkerToUi::Spawned { .. }) {
                s2_alive = true;
            }
        }

        pool.stop_session("s2");
        std::fs::remove_dir_all(&dir).ok();
    }
}
