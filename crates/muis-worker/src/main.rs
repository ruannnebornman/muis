//! Standalone `muis-worker` binary shipped by the Linux package.

fn main() {
    std::process::exit(muis_worker::run());
}
