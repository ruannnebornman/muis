use std::path::PathBuf;

/// Default shell probe: `$SHELL` when it points at something executable,
/// else fish → bash → sh. Fish stays the Veldmuis default; the fallbacks
/// keep fresh installs and containers working.
pub fn default_shell() -> PathBuf {
    if let Ok(sh) = std::env::var("SHELL") {
        let p = PathBuf::from(&sh);
        if !sh.is_empty() && is_executable(&p) {
            return p;
        }
    }
    for candidate in ["/usr/bin/fish", "/bin/bash", "/bin/sh"] {
        let p = PathBuf::from(candidate);
        if is_executable(&p) {
            return p;
        }
    }
    PathBuf::from("/bin/sh")
}

fn is_executable(p: &PathBuf) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shell_is_nonempty() {
        assert!(!default_shell().as_os_str().is_empty());
    }

    #[test]
    fn default_shell_exists() {
        // Must be spawnable: the worker execs this on every new tab.
        assert!(default_shell().exists());
    }
}
