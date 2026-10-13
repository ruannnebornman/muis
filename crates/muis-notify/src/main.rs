//! Standalone `muis-notify` binary (Linux packages).
//!
//! The Windows single-exe build does not ship this file; the shell binary
//! runs the same [`muis_notify::run`] via its hidden `--muis-notify` mode.

fn main() {
    std::process::exit(muis_notify::run());
}
