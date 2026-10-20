//! Diagnostics logging to a file.
//!
//! Every diagnostic goes to a log file under [`muis_core::paths::log_dir`],
//! and panics are routed there too so a start-up failure still leaves a
//! trace on disk.

use std::fs::OpenOptions;
use std::path::PathBuf;

use log::LevelFilter;
use simplelog::{CombinedLogger, Config, ConfigBuilder, SharedLogger, WriteLogger};

/// Path of the log file (`<log_dir>/muis.log`).
pub fn log_file() -> PathBuf {
    muis_core::paths::log_dir().join("muis.log")
}

/// Install the file logger and a panic hook. Best effort: if the file cannot
/// be opened the app still runs, it just has no diagnostics. Returns the log
/// file path when logging is active.
pub fn init() -> Option<PathBuf> {
    let path = log_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()?;

    let level = requested_level();
    let mut loggers: Vec<Box<dyn SharedLogger>> = vec![WriteLogger::new(level, config(), file)];

    // In dev also mirror to stderr so a terminal run stays readable.
    #[cfg(debug_assertions)]
    {
        use simplelog::{ColorChoice, TermLogger, TerminalMode};
        loggers.push(TermLogger::new(
            level,
            config(),
            TerminalMode::Stderr,
            ColorChoice::Auto,
        ));
    }

    if CombinedLogger::init(loggers).is_err() {
        return None;
    }
    install_panic_hook();
    Some(path)
}

/// `MUIS_LOG=off|error|warn|info|debug|trace` overrides the default, which is
/// `debug` in dev builds and `info` in release.
fn requested_level() -> LevelFilter {
    match std::env::var("MUIS_LOG").ok().as_deref() {
        Some("off") => LevelFilter::Off,
        Some("error") => LevelFilter::Error,
        Some("warn") => LevelFilter::Warn,
        Some("info") => LevelFilter::Info,
        Some("debug") => LevelFilter::Debug,
        Some("trace") => LevelFilter::Trace,
        _ if cfg!(debug_assertions) => LevelFilter::Debug,
        _ => LevelFilter::Info,
    }
}

fn config() -> Config {
    let mut builder = ConfigBuilder::new();
    // Best effort: some platforms cannot resolve the local offset; fall back
    // to UTC timestamps rather than dropping logging.
    let _ = builder.set_time_offset_to_local();
    builder.build()
}

/// Log panics before the default hook prints/aborts. Without this a panic in
/// a release build would vanish along with the console-less window.
fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {info}");
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_file_sits_under_the_log_dir() {
        assert_eq!(log_file(), muis_core::paths::log_dir().join("muis.log"));
    }

    #[test]
    fn level_env_override_is_parsed() {
        // Only the mapping that does not depend on build profile.
        std::env::set_var("MUIS_LOG", "off");
        assert_eq!(requested_level(), LevelFilter::Off);
        std::env::set_var("MUIS_LOG", "trace");
        assert_eq!(requested_level(), LevelFilter::Trace);
        std::env::remove_var("MUIS_LOG");
    }
}
