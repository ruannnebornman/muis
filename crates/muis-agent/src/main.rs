//! Standalone `muis-agent` binary (Linux packages).
//!
//! The Windows single-exe build does not ship this file; the shell binary
//! runs the same [`muis_agent::run`] via its hidden `--muis-agent` mode.

fn main() {
    std::process::exit(muis_agent::run());
}
