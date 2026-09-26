use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

/// UI → worker frames, one JSON object per line on worker stdin.
/// The TypeScript side in src-ui mirrors these tags exactly; the shared
/// fixture at tests/fixtures/ipc-frames.jsonl locks both sides together.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UiToWorker {
    Spawn {
        pty_id: String,
        shell: String,
        cwd: String,
        cols: u16,
        rows: u16,
    },
    /// Terminal input bytes, base64 (stdin pastes are not always UTF-8).
    Write { pty_id: String, data_b64: String },
    Resize { pty_id: String, cols: u16, rows: u16 },
    Snapshot { pty_id: String },
    Kill { pty_id: String },
}

/// Worker → UI frames, one JSON object per line on worker stdout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerToUi {
    Spawned { pty_id: String },
    /// Pty output bytes, base64.
    Output { pty_id: String, data_b64: String },
    Exited {
        pty_id: String,
        code: Option<i32>,
    },
    SnapshotData { pty_id: String, data_b64: String },
    Error { pty_id: String, message: String },
}

pub fn encode_line<T: Serialize>(msg: &T) -> serde_json::Result<String> {
    serde_json::to_string(msg).map(|mut s| {
        s.push('\n');
        s
    })
}

pub fn decode_ui(line: &str) -> serde_json::Result<UiToWorker> {
    serde_json::from_str(line.trim())
}

pub fn decode_worker(line: &str) -> serde_json::Result<WorkerToUi> {
    serde_json::from_str(line.trim())
}

pub fn b64_encode(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

pub fn b64_decode(s: &str) -> Result<Vec<u8>, base64::DecodeError> {
    STANDARD.decode(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn all_variants_roundtrip() {
        let ui = vec![
            UiToWorker::Spawn {
                pty_id: "p1".into(),
                shell: "/usr/bin/fish".into(),
                cwd: "/tmp".into(),
                cols: 80,
                rows: 24,
            },
            UiToWorker::Write {
                pty_id: "p1".into(),
                data_b64: b64_encode(b"ls\n"),
            },
            UiToWorker::Resize {
                pty_id: "p1".into(),
                cols: 120,
                rows: 32,
            },
            UiToWorker::Snapshot { pty_id: "p1".into() },
            UiToWorker::Kill { pty_id: "p1".into() },
        ];
        for m in ui {
            let line = encode_line(&m).unwrap();
            assert!(line.ends_with('\n'));
            assert_eq!(decode_ui(&line).unwrap(), m);
        }
        let worker = vec![
            WorkerToUi::Spawned { pty_id: "p1".into() },
            WorkerToUi::Output {
                pty_id: "p1".into(),
                data_b64: b64_encode(b"hi"),
            },
            WorkerToUi::Exited {
                pty_id: "p1".into(),
                code: Some(0),
            },
            WorkerToUi::SnapshotData {
                pty_id: "p1".into(),
                data_b64: b64_encode(b"hi"),
            },
            WorkerToUi::Error {
                pty_id: "p1".into(),
                message: "no such pty".into(),
            },
        ];
        for m in worker {
            let line = encode_line(&m).unwrap();
            assert_eq!(decode_worker(&line).unwrap(), m);
        }
    }

    #[test]
    fn binary_payload_survives_base64() {
        let raw = vec![0x1b, 0x5b, 0x33, 0x32, 0xff, 0x00, 0xfe];
        assert_eq!(b64_decode(&b64_encode(&raw)).unwrap(), raw);
    }

    /// Shared contract with src-ui: every line decodes on its declared
    /// side and re-encodes byte-identically (modulo trailing newline).
    #[test]
    fn shared_fixture_matches_both_sides() {
        let path = format!(
            "{}/../../tests/fixtures/ipc-frames.jsonl",
            env!("CARGO_MANIFEST_DIR")
        );
        let text = std::fs::read_to_string(&path).unwrap();
        let mut ui_tags = HashSet::new();
        let mut worker_tags = HashSet::new();
        let mut lines = 0;
        for line in text.lines() {
            if line.trim().is_empty() {
                continue;
            }
            lines += 1;
            let v: serde_json::Value = serde_json::from_str(line).unwrap();
            let dir = v["dir"].as_str().unwrap();
            let frame = &v["frame"];
            let tag = frame["type"].as_str().unwrap().to_string();
            match dir {
                "ui" => {
                    let m: UiToWorker = serde_json::from_value(frame.clone()).unwrap();
                    // Value equality ignores key order; the wire only
                    // promises tags and fields, not serialization order.
                    assert_eq!(serde_json::to_value(&m).unwrap(), *frame);
                    ui_tags.insert(tag);
                }
                "worker" => {
                    let m: WorkerToUi = serde_json::from_value(frame.clone()).unwrap();
                    assert_eq!(serde_json::to_value(&m).unwrap(), *frame);
                    worker_tags.insert(tag);
                }
                d => panic!("bad dir in fixture: {d}"),
            }
        }
        assert!(lines >= 10, "fixture shrank unexpectedly");
        for t in ["spawn", "write", "resize", "snapshot", "kill"] {
            assert!(ui_tags.contains(t), "fixture missing ui frame {t}");
        }
        for t in ["spawned", "output", "exited", "snapshot_data", "error"] {
            assert!(worker_tags.contains(t), "fixture missing worker frame {t}");
        }
    }
}
