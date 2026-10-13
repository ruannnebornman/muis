//! Standalone `muis-worker` binary (Linux packages).
//!
//! The Windows single-exe build does not ship this file; the shell binary
//! runs the same [`muis_worker::run`] via its hidden `--muis-worker` mode.

fn main() {
    std::process::exit(muis_worker::run());
}
