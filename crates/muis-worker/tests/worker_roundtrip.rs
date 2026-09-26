//! End-to-end through the real binary: spawn the worker as a child
//! process, drive it over stdio, and assert shell output, snapshots,
//! and exit codes come back. This is the closest thing to opening the
//! terminal without needing a display.

use muis_core::ipc::{
    b64_decode, b64_encode, decode_worker, encode_line, UiToWorker, WorkerToUi,
};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(20);

struct Driver {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
}

impl Driver {
    fn spawn() -> Self {
        let exe = env!("CARGO_BIN_EXE_muis-worker");
        let mut child = Command::new(exe)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("worker binary runs");
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            stdin,
            lines: rx,
        }
    }

    fn send(&mut self, msg: &UiToWorker) {
        let line = encode_line(msg).unwrap();
        self.stdin.write_all(line.as_bytes()).unwrap();
        self.stdin.flush().unwrap();
    }

    fn next(&self) -> WorkerToUi {
        let line = self.lines.recv_timeout(TIMEOUT).expect("worker answers");
        decode_worker(&line).unwrap()
    }

    /// Bounded receive for idle-shell drains (None = quiet, not failure).
    fn next_timeout(&self, dur: Duration) -> Option<WorkerToUi> {
        self.lines
            .recv_timeout(dur)
            .ok()
            .and_then(|line| decode_worker(&line).ok())
    }

    /// Collect Output payloads until `needle` appears in the stream.
    fn output_until(&self, pty_id: &str, needle: &[u8]) -> Vec<u8> {
        let mut acc = Vec::new();
        loop {
            match self.next() {
                WorkerToUi::Output { pty_id: id, data_b64 } if id == pty_id => {
                    let raw = b64_decode(&data_b64).unwrap();
                    acc.extend_from_slice(&raw);
                    if acc
                        .windows(needle.len())
                        .any(|w| w == needle)
                    {
                        return acc;
                    }
                }
                WorkerToUi::Error { message, .. } => panic!("worker error: {message}"),
                _ => continue,
            }
        }
    }

    fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for Driver {
    fn drop(&mut self) {
        self.kill();
    }
}

fn spawn_msg(pty_id: &str, shell: &str) -> UiToWorker {
    UiToWorker::Spawn {
        pty_id: pty_id.into(),
        shell: shell.into(),
        cwd: std::env::temp_dir().to_string_lossy().into_owned(),
        cols: 80,
        rows: 24,
    }
}

#[test]
fn shell_echo_roundtrip_and_snapshot() {
    let mut d = Driver::spawn();
    d.send(&spawn_msg("t1", "/bin/sh"));
    assert_eq!(
        d.next(),
        WorkerToUi::Spawned {
            pty_id: "t1".into()
        }
    );

    d.send(&UiToWorker::Write {
        pty_id: "t1".into(),
        data_b64: b64_encode(b"echo hello-muis\n"),
    });
    d.output_until("t1", b"hello-muis");

    d.send(&UiToWorker::Snapshot {
        pty_id: "t1".into(),
    });
    // Snapshot arrives alongside/after output; skip stale outputs.
    let snap = loop {
        match d.next() {
            WorkerToUi::SnapshotData { data_b64, .. } => break b64_decode(&data_b64).unwrap(),
            WorkerToUi::Output { .. } => continue,
            other => panic!("unexpected frame: {other:?}"),
        }
    };
    assert!(snap.windows(b"hello-muis".len()).any(|w| w == b"hello-muis"));

    d.send(&UiToWorker::Kill {
        pty_id: "t1".into(),
    });
    let exited = loop {
        match d.next() {
            WorkerToUi::Exited { code, .. } => break code,
            WorkerToUi::Output { .. } => continue,
            other => panic!("unexpected frame: {other:?}"),
        }
    };
    // Killed by the worker: some exit/signal code, but we got the event.
    assert!(exited.is_some());
}

#[test]
fn shell_exit_code_propagates() {
    let mut d = Driver::spawn();
    d.send(&spawn_msg("t2", "/bin/sh"));
    assert_eq!(
        d.next(),
        WorkerToUi::Spawned {
            pty_id: "t2".into()
        }
    );
    d.send(&UiToWorker::Write {
        pty_id: "t2".into(),
        data_b64: b64_encode(b"exit 42\n"),
    });
    let code = loop {
        match d.next() {
            WorkerToUi::Exited { code, .. } => break code,
            WorkerToUi::Output { .. } => continue,
            other => panic!("unexpected frame: {other:?}"),
        }
    };
    assert_eq!(code, Some(42));
}

#[test]
fn unknown_pty_and_bad_shell_report_errors() {
    let mut d = Driver::spawn();
    d.send(&UiToWorker::Write {
        pty_id: "ghost".into(),
        data_b64: b64_encode(b"x"),
    });
    assert!(matches!(d.next(), WorkerToUi::Error { .. }));

    d.send(&spawn_msg("t3", "/nonexistent-shell-muis"));
    assert!(matches!(d.next(), WorkerToUi::Error { .. }));

    d.send(&UiToWorker::Spawn {
        pty_id: "t3".into(),
        shell: "/bin/sh".into(),
        cwd: std::env::temp_dir().to_string_lossy().into_owned(),
        cols: 80,
        rows: 24,
    });
    assert_eq!(
        d.next(),
        WorkerToUi::Spawned {
            pty_id: "t3".into()
        }
    );
    // Duplicate id is rejected, original keeps running.
    d.send(&spawn_msg("t3", "/bin/sh"));
    assert!(matches!(d.next(), WorkerToUi::Error { .. }));
    d.send(&UiToWorker::Kill {
        pty_id: "t3".into(),
    });
    // Drain until Exited (outputs may interleave).
    let mut seen_exit = false;
    for _ in 0..50 {
        if matches!(d.next(), WorkerToUi::Exited { .. }) {
            seen_exit = true;
            break;
        }
    }
    assert!(seen_exit);
}

#[test]
fn spawned_shell_runs_with_echo_off() {
    // Guards the startup contract: terminal query replies written before
    // the shell sets its own line discipline must not echo visibly.
    let mut d = Driver::spawn();
    d.send(&spawn_msg("t4", "/bin/sh"));
    assert_eq!(
        d.next(),
        WorkerToUi::Spawned {
            pty_id: "t4".into()
        }
    );
    d.send(&UiToWorker::Write {
        pty_id: "t4".into(),
        data_b64: b64_encode(b"stty -a\n"),
    });
    // stty -a prints "speed ... baud" plus the flags incl. -echo.
    // Flags come after the baud line, so drain briefly for more output.
    let mut out = d.output_until("t4", b"baud");
    for _ in 0..10 {
        match d.next_timeout(Duration::from_millis(300)) {
            Some(WorkerToUi::Output { pty_id, data_b64 }) if pty_id == "t4" => {
                out.extend_from_slice(&b64_decode(&data_b64).unwrap());
                if out.windows(b"-echo".len()).any(|w| w == b"-echo") {
                    break;
                }
            }
            _ => continue,
        }
    }
    assert!(
        out.windows(b"-echo".len()).any(|w| w == b"-echo"),
        "expected -echo in stty output, got: {:?}",
        String::from_utf8_lossy(&out)
    );
}
