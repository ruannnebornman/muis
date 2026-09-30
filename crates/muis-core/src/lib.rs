//! muis-core: UI-agnostic terminal state.
//!
//! No Tauri, no pty, no WebView here on purpose: everything in this crate
//! is unit-testable on any platform, including CI without system WebKit.

pub mod config;
pub mod ipc;
pub mod notify;
pub mod paths;
pub mod session;
pub mod shell;
