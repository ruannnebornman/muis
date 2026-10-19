//! Config persistence.

use std::path::Path;

/// Missing file is empty (first run), anything else is an error.
pub fn read_text(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Refuses to write anything that isn't JSON, so a UI bug can never
/// corrupt the config file into garbage.
pub fn write_json(path: &Path, json: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("invalid json: {e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let pretty = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    std::fs::write(path, pretty).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static N: AtomicU64 = AtomicU64::new(0);

    fn tmp(name: &str) -> std::path::PathBuf {
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
        let back: serde_json::Value = serde_json::from_str(&read_text(&path).unwrap()).unwrap();
        assert_eq!(back["a"], 1);
        assert!(write_json(&path, "not json").is_err());
        // Failed write leaves the previous good content alone.
        let still: serde_json::Value = serde_json::from_str(&read_text(&path).unwrap()).unwrap();
        assert_eq!(still["a"], 1);
    }
}
