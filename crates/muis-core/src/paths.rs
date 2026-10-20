use std::path::PathBuf;

/// Linux config/state locations, following XDG.
pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

pub fn config_dir() -> PathBuf {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        if !xdg.is_empty() {
            return PathBuf::from(xdg).join("muis");
        }
    }
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config")
        .join("muis")
}

pub fn state_dir() -> PathBuf {
    if let Ok(xdg) = std::env::var("XDG_STATE_HOME") {
        if !xdg.is_empty() {
            return PathBuf::from(xdg).join("muis");
        }
    }
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("share")
        .join("muis")
}

/// Diagnostic log files live here.
pub fn log_dir() -> PathBuf {
    state_dir().join("logs")
}

pub fn config_file() -> PathBuf {
    config_dir().join("muis.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dirs_end_in_muis_and_nest() {
        assert!(config_dir().ends_with("muis"));
        assert!(log_dir().ends_with("logs"));
        assert_eq!(config_file(), config_dir().join("muis.json"));
    }
}
