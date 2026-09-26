use std::path::PathBuf;

/// Default shell probe, per platform.
///
/// Linux: `$SHELL` when it points at something executable, else
/// fish → bash → sh. Fish stays the Veldmuis default; the fallbacks
/// keep fresh installs and containers working.
/// Windows: pwsh → powershell → cmd from PATH, else %SystemRoot% fallback.
pub fn default_shell() -> PathBuf {
    #[cfg(windows)]
    {
        for candidate in ["pwsh.exe", "powershell.exe", "cmd.exe"] {
            if let Some(found) = find_on_path(candidate) {
                return found;
            }
        }
        let system32 = std::env::var("SystemRoot")
            .map(|r| PathBuf::from(r).join("System32"))
            .unwrap_or_else(|_| PathBuf::from(r"C:\Windows\System32"));
        system32.join("cmd.exe")
    }
    #[cfg(not(windows))]
    {
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
}

#[cfg(not(windows))]
fn is_executable(p: &PathBuf) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn find_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let full = dir.join(name);
        if full.is_file() {
            return Some(full);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shell_is_nonempty() {
        assert!(!default_shell().as_os_str().is_empty());
    }

    #[cfg(not(windows))]
    #[test]
    fn default_shell_exists() {
        // Must be spawnable: the worker execs this on every new tab.
        assert!(default_shell().exists());
    }
}
