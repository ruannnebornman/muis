//! muis-worker: owns ptys for one session.
//!
//! Protocol: JSON lines on stdin (UiToWorker), JSON lines on stdout
//! (WorkerToUi). Stdin EOF means the UI is gone: kill everything and exit.
//! A crashing worker therefore only ever takes down its own session.

use muis_core::ipc::{
    b64_decode, b64_encode, decode_ui, encode_line, UiToWorker, WorkerToUi,
};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::{Arc, Mutex};

/// Bytes of recent output kept per pty for Snapshot / crash restore.
const SCROLLBACK_CAP: usize = 256 * 1024;

/// Fish startup snippet: emit OSC 133 command markers (C on start, D with
/// exit status on finish) using fish's preexec/postexec events.
const FISH_INTEGRATION: &str = r"function __muis_preexec --on-event fish_preexec; printf '\e]133;C\e\\'; end; function __muis_postexec --on-event fish_postexec; printf '\e]133;D;%d\e\\' $status; end";

/// True when the worker is running inside a Flatpak sandbox.
fn in_flatpak() -> bool {
    std::path::Path::new("/.flatpak-info").exists()
}

/// Full argv used to spawn the shell. Inside a Flatpak sandbox the shell is
/// run on the host via `flatpak-spawn --host` so the user gets their real
/// environment and tools: the runtime has no fish and a sandboxed shell
/// cannot run host binaries.
fn shell_argv(shell: &str, cwd: &str, flatpak: bool, fish_integration: &str) -> Vec<String> {
    let mut argv: Vec<String> = Vec::new();
    if flatpak {
        argv.push("flatpak-spawn".to_string());
        argv.push("--host".to_string());
        argv.push(format!("--directory={cwd}"));
        argv.push("--env=TERM=xterm-256color".to_string());
        argv.push("--env=LANG=C.UTF-8".to_string());
    }
    argv.push(shell.to_string());
    // Fish: publish OSC 133 command markers so the UI can show the last
    // command, its exit code, and duration. Non-invasive event handlers,
    // added via -C (runs before config, keeps the session interactive).
    if std::path::Path::new(shell)
        .file_name()
        .and_then(|n| n.to_str())
        == Some("fish")
    {
        argv.push("-C".to_string());
        argv.push(fish_integration.to_string());
    }
    argv
}


#[derive(Debug, Default)]
struct Scrollback {
    buf: VecDeque<u8>,
}

impl Scrollback {
    fn push(&mut self, data: &[u8]) {
        self.buf.extend(data);
        let excess = self.buf.len().saturating_sub(SCROLLBACK_CAP);
        self.buf.drain(..excess);
    }

    fn bytes(&self) -> Vec<u8> {
        self.buf.iter().copied().collect()
    }
}

/// Serializes stdout lines across the main loop and reader threads.
#[derive(Debug, Default, Clone)]
struct Emitter {
    lock: Arc<Mutex<()>>,
}

impl Emitter {
    fn emit(&self, msg: &WorkerToUi) {
        let _guard = self.lock.lock().unwrap();
        if let Ok(line) = encode_line(msg) {
            let mut out = std::io::stdout();
            let _ = out.write_all(line.as_bytes());
            let _ = out.flush();
        }
    }
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    scrollback: Arc<Mutex<Scrollback>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

fn spawn_session(
    sessions: &mut HashMap<String, Session>,
    emitter: &Emitter,
    pty_id: &str,
    shell: &str,
    cwd: &str,
    cols: u16,
    rows: u16,
) {
    if sessions.contains_key(pty_id) {
        emitter.emit(&WorkerToUi::Error {
            pty_id: pty_id.to_string(),
            message: "pty id already in use".to_string(),
        });
        return;
    }
    let id = pty_id.to_string();
    let emit_err = |message: String| {
        emitter.emit(&WorkerToUi::Error {
            pty_id: id.clone(),
            message,
        })
    };

    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(pair) => pair,
        Err(e) => {
            emit_err(format!("openpty failed: {e}"));
            return;
        }
    };
    // Start with ECHO off. The shell sets its own line discipline the
    // moment it is ready, but until then anything the worker writes to
    // the master (e.g. answers to the shell's terminal queries during
    // init) would be echoed straight back into the output stream and
    // displayed as garbage like `^[[?1;2c`.
    #[cfg(unix)]
    disable_echo(&*pair.master);

    let flatpak = in_flatpak();
    let argv = shell_argv(shell, cwd, flatpak, FISH_INTEGRATION);
    let mut cmd = CommandBuilder::new(&argv[0]);
    for arg in &argv[1..] {
        cmd.arg(arg);
    }
    if !flatpak {
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        // Long-running agents/tasks inherit a sane locale.
        cmd.env("LANG", "C.UTF-8");
    }

    let child = match pair.slave.spawn_command(cmd) {
        Ok(child) => child,
        Err(e) => {
            emit_err(format!("spawn failed: {e}"));
            return;
        }
    };

    let reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(e) => {
            emit_err(format!("pty reader failed: {e}"));
            return;
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(e) => {
            emit_err(format!("pty writer failed: {e}"));
            return;
        }
    };

    let scrollback = Arc::new(Mutex::new(Scrollback::default()));
    let child = Arc::new(Mutex::new(child));
    sessions.insert(
        id.clone(),
        Session {
            master: pair.master,
            writer,
            scrollback: Arc::clone(&scrollback),
            child: Arc::clone(&child),
        },
    );
    emitter.emit(&WorkerToUi::Spawned {
        pty_id: id.clone(),
    });

    // Drain output until EOF, then report the exit. This thread owns no
    // session-map state, so Kill racing Exited is harmless.
    let thread_emitter = emitter.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Err(_) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    scrollback.lock().unwrap().push(chunk);
                    thread_emitter.emit(&WorkerToUi::Output {
                        pty_id: id.clone(),
                        data_b64: b64_encode(chunk),
                    });
                }
            }
        }
        let code = child
            .lock()
            .unwrap()
            .wait()
            .ok()
            .and_then(|s| i32::try_from(s.exit_code()).ok());
        thread_emitter.emit(&WorkerToUi::Exited {
            pty_id: id,
            code,
        });
    });
}

/// Clear ECHO on a fresh pty (termios is shared across the pair, so the
/// master fd works). Best effort: failure just keeps the old behavior.
#[cfg(unix)]
fn disable_echo(master: &dyn MasterPty) {
    use std::os::fd::BorrowedFd;
    let Some(fd) = master.as_raw_fd() else {
        return;
    };
    // SAFETY: the fd belongs to our open pty pair and outlives this call.
    let borrowed = unsafe { BorrowedFd::borrow_raw(fd) };
    let Ok(mut termios) = nix::sys::termios::tcgetattr(&borrowed) else {
        return;
    };
    termios
        .local_flags
        .remove(nix::sys::termios::LocalFlags::ECHO);
    let _ = nix::sys::termios::tcsetattr(&borrowed, nix::sys::termios::SetArg::TCSANOW, &termios);
}

fn main() {    let emitter = Emitter::default();
    let mut sessions: HashMap<String, Session> = HashMap::new();
    let stdin = std::io::stdin();
    let mut lines = BufReader::new(stdin.lock()).lines();

    while let Some(line) = lines.next() {
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let msg = match decode_ui(&line) {
            Ok(msg) => msg,
            Err(e) => {
                emitter.emit(&WorkerToUi::Error {
                    pty_id: String::new(),
                    message: format!("bad frame: {e}"),
                });
                continue;
            }
        };
        match msg {
            UiToWorker::Spawn {
                pty_id,
                shell,
                cwd,
                cols,
                rows,
            } => spawn_session(
                &mut sessions,
                &emitter,
                &pty_id,
                &shell,
                &cwd,
                cols,
                rows,
            ),
            UiToWorker::Write { pty_id, data_b64 } => {
                let data = match b64_decode(&data_b64) {
                    Ok(data) => data,
                    Err(e) => {
                        emitter.emit(&WorkerToUi::Error {
                            pty_id,
                            message: format!("bad payload: {e}"),
                        });
                        continue;
                    }
                };
                match sessions.get_mut(&pty_id) {
                    Some(session) => {
                        if session.writer.write_all(&data).is_err()
                            || session.writer.flush().is_err()
                        {
                            emitter.emit(&WorkerToUi::Error {
                                pty_id,
                                message: "write to pty failed".to_string(),
                            });
                        }
                    }
                    None => emitter.emit(&WorkerToUi::Error {
                        pty_id,
                        message: "no such pty".to_string(),
                    }),
                }
            }
            UiToWorker::Resize {
                pty_id,
                cols,
                rows,
            } => match sessions.get(&pty_id) {
                Some(session) => {
                    if session
                        .master
                        .resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        })
                        .is_err()
                    {
                        emitter.emit(&WorkerToUi::Error {
                            pty_id,
                            message: "pty resize failed".to_string(),
                        });
                    }
                }
                None => emitter.emit(&WorkerToUi::Error {
                    pty_id,
                    message: "no such pty".to_string(),
                }),
            },
            UiToWorker::Snapshot { pty_id } => match sessions.get(&pty_id) {
                Some(session) => {
                    let data = session.scrollback.lock().unwrap().bytes();
                    emitter.emit(&WorkerToUi::SnapshotData {
                        pty_id,
                        data_b64: b64_encode(&data),
                    });
                }
                None => emitter.emit(&WorkerToUi::Error {
                    pty_id,
                    message: "no such pty".to_string(),
                }),
            },
            UiToWorker::Kill { pty_id } => {
                if let Some(session) = sessions.remove(&pty_id) {
                    let _ = session.child.lock().unwrap().kill();
                } else {
                    emitter.emit(&WorkerToUi::Error {
                        pty_id,
                        message: "no such pty".to_string(),
                    });
                }
            }
        }
    }

    // UI went away: take everything down with us, no orphans.
    for (_, session) in sessions {
        let _ = session.child.lock().unwrap().kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_argv_native_prefers_plain_command() {
        assert_eq!(shell_argv("/bin/bash", "/tmp", false, "INT"), vec!["/bin/bash"]);
    }

    #[test]
    fn shell_argv_adds_fish_integration() {
        assert_eq!(
            shell_argv("/usr/bin/fish", "/home/x", false, "INT"),
            vec!["/usr/bin/fish", "-C", "INT"]
        );
    }

    #[test]
    fn shell_argv_flatpak_wraps_with_flatpak_spawn() {
        let argv = shell_argv("/usr/bin/fish", "/home/x", true, "INT");
        assert_eq!(argv[0], "flatpak-spawn");
        assert_eq!(argv[1], "--host");
        assert_eq!(argv[2], "--directory=/home/x");
        assert_eq!(argv[3], "--env=TERM=xterm-256color");
        assert_eq!(argv[4], "--env=LANG=C.UTF-8");
        assert_eq!(&argv[5..], &["/usr/bin/fish", "-C", "INT"]);
    }
}
