use serde::{Deserialize, Serialize};
use std::path::Path;

/// View options. Persisted; the settings dialog edits exactly this struct.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppConfig {
    pub show_sessions: bool,
    pub tabs_on_top: bool,
    /// Terminal font size in points. None means system fixed font + 2.
    pub font_size: Option<u32>,
    /// Accent theme name. None keeps the default Breeze/Muis chrome.
    #[serde(default)]
    pub theme: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            show_sessions: true,
            tabs_on_top: false,
            font_size: None,
            theme: None,
        }
    }
}

impl AppConfig {
    /// Missing file is not an error: first run starts with defaults.
    /// A corrupt file IS an error so we never silently lose settings.
    pub fn load(path: &Path) -> std::io::Result<Self> {
        match std::fs::read_to_string(path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e),
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
        }
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let text = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(path, text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static N: AtomicU64 = AtomicU64::new(0);

    fn tmp() -> std::path::PathBuf {
        let n = N.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("muis-cfg-test-{}-{n}", std::process::id()))
    }

    #[test]
    fn missing_file_gives_defaults() {
        let cfg = AppConfig::load(&tmp().join("nope.json")).unwrap();
        assert_eq!(cfg, AppConfig::default());
    }

    #[test]
    fn save_load_roundtrip() {
        let path = tmp().join("muis.json");
        let cfg = AppConfig {
            show_sessions: false,
            tabs_on_top: true,
            font_size: Some(13),
            theme: Some("nord".to_string()),
        };
        cfg.save(&path).unwrap();
        assert_eq!(AppConfig::load(&path).unwrap(), cfg);
    }

    #[test]
    fn corrupt_file_is_an_error_not_defaults() {
        let path = tmp().join("muis.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{not json").unwrap();
        let err = AppConfig::load(&path).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn old_config_without_theme_still_loads() {
        let path = tmp().join("old.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            r#"{"show_sessions":true,"tabs_on_top":false,"font_size":11}"#,
        )
        .unwrap();
        let cfg = AppConfig::load(&path).unwrap();
        assert_eq!(cfg.theme, None);
        assert_eq!(cfg.font_size, Some(11));
    }
}
