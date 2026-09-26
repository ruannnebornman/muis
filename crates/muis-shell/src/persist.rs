//! Session + config persistence and scrollback snapshots.
//!
//! The shell owns all files: session metadata JSON, config JSON, and
//! per-tab scrollback files. Tab ids are stable across restarts (they
//! persist in the session JSON), so a restored tab replays its own
//! snapshot file before live output arrives.

use std::path::{Path, PathBuf};

/// Missing file is empty (first run), anything else is an error.
pub fn read_text(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Refuses to write anything that isn't JSON, so a UI bug can never
/// corrupt the session or config file into garbage.
pub fn write_json(path: &Path, json: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("invalid json: {e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let pretty = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    std::fs::write(path, pretty).map_err(|e| e.to_string())
}

/// Snapshot files live under the sessions dir; tab ids are sanitized so
/// a crafted id can never escape it.
pub fn snapshot_path(tab_id: &str) -> PathBuf {
    let safe: String = tab_id
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    muis_core::paths::sessions_dir().join(format!("tab-{safe}.scrollback"))
}

pub fn snapshot_store(tab_id: &str, data_b64: &str) -> Result<(), String> {
    let raw = muis_core::ipc::b64_decode(data_b64).map_err(|e| e.to_string())?;
    let path = snapshot_path(tab_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, raw).map_err(|e| e.to_string())
}

pub fn snapshot_read(tab_id: &str) -> Result<String, String> {
    match std::fs::read(snapshot_path(tab_id)) {
        Ok(raw) => Ok(muis_core::ipc::b64_encode(&raw)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn snapshot_remove(tab_id: &str) {
    let _ = std::fs::remove_file(snapshot_path(tab_id));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static N: AtomicU64 = AtomicU64::new(0);

    fn tmp(name: &str) -> PathBuf {
        let n = N.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("muis-persist-{n}-{name}"))
    }

    #[test]
    fn missing_file_reads_empty() {
        assert_eq!(read_text(&tmp("nope.json")).unwrap(), "");
    }

    #[test]
    fn json_roundtrip_and_garbage_rejected() {
        let path = tmp("s.json");
        write_json(&path, r#"{"a":1}"#).unwrap();
        let back: serde_json::Value =
            serde_json::from_str(&read_text(&path).unwrap()).unwrap();
        assert_eq!(back["a"], 1);
        assert!(write_json(&path, "not json").is_err());
        // Failed write leaves the previous good content alone.
        let still: serde_json::Value =
            serde_json::from_str(&read_text(&path).unwrap()).unwrap();
        assert_eq!(still["a"], 1);
    }

    #[test]
    fn snapshot_path_never_escapes_sessions_dir() {
        let evil = snapshot_path("../../etc/passwd");
        assert!(evil.starts_with(muis_core::paths::sessions_dir()));
        assert!(evil.to_string_lossy().contains("tab-"));
        assert!(!evil.to_string_lossy().contains("/.."));
    }
}
