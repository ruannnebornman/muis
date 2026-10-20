//! Standalone `muis-notify` binary shipped by the Linux package.

fn main() {
    std::process::exit(muis_notify::run());
}
