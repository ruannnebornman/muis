use std::path::PathBuf;

/// Platform config/state locations. Linux follows XDG; Windows uses
/// %APPDATA% so the same filenames work in the portable install.
pub fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

pub fn config_dir() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("muis");
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
            if !xdg.is_empty() {
                return PathBuf::from(xdg).join("muis");
            }
        }
    }
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config")
        .join("muis")
}

pub fn state_dir() -> PathBuf {
    #[cfg(windows)]
    {
        return config_dir();
    }
    #[cfg(not(windows))]
    {
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
}

/// Per-session worker snapshots + manifests live here.
pub fn sessions_dir() -> PathBuf {
    state_dir().join("sessions")
}

pub fn config_file() -> PathBuf {
    config_dir().join("muis.json")
}

pub fn sessions_file() -> PathBuf {
    state_dir().join("sessions.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dirs_end_in_muis_and_nest() {
        assert!(config_dir().ends_with("muis"));
        assert_eq!(sessions_dir(), state_dir().join("sessions"));
        assert_eq!(config_file(), config_dir().join("muis.json"));
        assert_eq!(sessions_file(), state_dir().join("sessions.json"));
    }
}
