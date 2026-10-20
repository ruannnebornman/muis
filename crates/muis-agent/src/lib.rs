//! `muis-agent`: report the session an agent TUI currently has open.
//!
//! This is deliberately separate from `muis-notify`: an agent-session report
//! is state, not a notification, and the shell routes it to the tab's
//! resumable metadata instead of the toast/badge path.
//!
//! Wire format: one [`muis_core::notify::AgentSessionRequest`] per
//! connection, carrying `kind: "agent-session"`, the session id (or no
//! session for a clear), an optional directory, and the originating tab.
//!
//! ```text
//! usage: muis-agent session <ses_ID> [--dir DIR] [--tab ID] [--socket NAME]
//!        muis-agent clear [--tab ID] [--socket NAME]
//! ```

use muis_core::notify::{self, AgentSessionRequest};

const USAGE: &str = "\
usage: muis-agent session <ses_ID> [--dir DIR] [--tab ID] [--socket NAME]
       muis-agent clear [--tab ID] [--socket NAME]

Reports the agent session currently open in a muis tab, so the tab can
resume exactly that session after a restart. Defaults for --socket and
--tab come from the MUIS_SOCKET and MUIS_TAB_ID environment variables.";

#[derive(Debug, Default, PartialEq, Eq)]
struct Cli {
    session: Option<Option<String>>,
    directory: Option<String>,
    tab_id: Option<String>,
    socket: Option<String>,
}

fn parse_args(args: impl Iterator<Item = String>) -> Result<Cli, String> {
    let mut cli = Cli::default();
    let mut args = args;
    let mut command: Option<String> = None;
    let mut positional: Option<String> = None;
    while let Some(arg) = args.next() {
        let mut value = || args.next().ok_or_else(|| format!("{arg} needs a value"));
        match arg.as_str() {
            "--dir" => cli.directory = Some(value()?),
            "--tab" => cli.tab_id = Some(value()?),
            "--socket" => cli.socket = Some(value()?),
            other if other.starts_with('-') => {
                return Err(format!("unknown argument: {other}"));
            }
            other => {
                if command.is_none() {
                    command = Some(other.to_string());
                } else if positional.is_none() {
                    positional = Some(other.to_string());
                } else {
                    return Err(format!("unexpected argument: {other}"));
                }
            }
        }
    }
    match command.as_deref() {
        Some("session") => {
            let id = positional.ok_or("session needs a session id")?;
            if !notify::valid_session_id(&id) {
                return Err(format!("invalid session id: {id}"));
            }
            cli.session = Some(Some(id));
        }
        Some("clear") => {
            if positional.is_some() {
                return Err("clear takes no session id".to_string());
            }
            cli.session = Some(None);
        }
        Some(other) => return Err(format!("unknown command: {other}")),
        None => return Err("missing command".to_string()),
    }
    Ok(cli)
}

/// Standalone entrypoint: parse `std::env::args()` without the program name.
pub fn run() -> i32 {
    run_with(std::env::args().skip(1))
}

/// Run with an explicit argument list (without the program name). The
/// standalone binary passes `args().skip(1)`; the Windows shell passes the
/// arguments after its `--muis-agent` mode flag.
pub fn run_with(args: impl IntoIterator<Item = String>) -> i32 {
    let args: Vec<String> = args.into_iter().collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        println!("{USAGE}");
        return 0;
    }
    let cli = match parse_args(args.into_iter()) {
        Ok(cli) => cli,
        Err(e) => {
            eprintln!("muis-agent: {e}\n{USAGE}");
            return 2;
        }
    };

    let socket = cli
        .socket
        .or_else(|| std::env::var("MUIS_SOCKET").ok())
        .unwrap_or_else(notify::socket_name);
    let req = AgentSessionRequest::new(
        cli.session.unwrap_or(None),
        cli.directory,
        cli.tab_id.or_else(|| std::env::var("MUIS_TAB_ID").ok()),
    );

    match notify::send_agent(&socket, &req) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("muis-agent: could not reach muis (socket {socket}): {e}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> std::vec::IntoIter<String> {
        list.iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
            .into_iter()
    }

    #[test]
    fn parses_session_with_optional_fields() {
        let cli = parse_args(args(&[
            "session",
            "ses_abc123",
            "--dir",
            "/tmp",
            "--tab",
            "t1",
            "--socket",
            "s",
        ]))
        .unwrap();
        assert_eq!(
            cli,
            Cli {
                session: Some(Some("ses_abc123".into())),
                directory: Some("/tmp".into()),
                tab_id: Some("t1".into()),
                socket: Some("s".into()),
            }
        );
    }

    #[test]
    fn parses_clear() {
        assert_eq!(parse_args(args(&["clear"])).unwrap().session, Some(None));
        assert!(parse_args(args(&["clear", "ses_x"])).is_err());
    }

    #[test]
    fn rejects_bad_ids_and_unknown_flags() {
        assert!(parse_args(args(&["session", "abc"])).is_err());
        assert!(parse_args(args(&["session", "ses_"])).is_err());
        assert!(parse_args(args(&["session", "ses_a;rm"])).is_err());
        assert!(parse_args(args(&["--nope"])).is_err());
        assert!(parse_args(args(&[])).is_err());
        assert!(parse_args(args(&["wat"])).is_err());
    }
}
