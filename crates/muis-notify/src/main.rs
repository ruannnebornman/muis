//! `muis-notify`: send a notification to a running muis window.
//!
//! Point hook-only tools at this binary, e.g. Aider's
//! `--notifications-command "muis-notify --title Aider --body 'ready'"`,
//! a Claude Code `Notification` hook, or Codex's `notify = [...]`.
//!
//! The target socket and tab default to the `MUIS_SOCKET` and `MUIS_TAB_ID`
//! environment variables, which muis injects into every pty, so a plain
//! `muis-notify --body "done"` from a shell inside muis just works.

use std::process::ExitCode;

use muis_core::notify::{self, NotifyRequest};

const USAGE: &str = "\
usage: muis-notify --body TEXT [--title TEXT] [--tab ID] [--urgency 0|1|2] [--socket NAME]
       muis-notify --agent-session ID [--tab ID]

Sends a desktop notification to a running muis window, or reports the
agent session id for a tab (so it can resume that exact session).
Defaults for --socket and --tab come from the MUIS_SOCKET and MUIS_TAB_ID
environment variables, which muis sets inside its terminals.";

#[derive(Debug, Default, PartialEq, Eq)]
struct Cli {
    title: Option<String>,
    body: Option<String>,
    tab_id: Option<String>,
    urgency: Option<u8>,
    socket: Option<String>,
    agent_session: Option<String>,
}

fn parse_args(args: impl Iterator<Item = String>) -> Result<Cli, String> {
    let mut cli = Cli::default();
    let mut args = args;
    while let Some(arg) = args.next() {
        let mut value = || args.next().ok_or_else(|| format!("{arg} needs a value"));
        match arg.as_str() {
            "--title" => cli.title = Some(value()?),
            "--body" => cli.body = Some(value()?),
            "--tab" => cli.tab_id = Some(value()?),
            "--socket" => cli.socket = Some(value()?),
            "--agent-session" => cli.agent_session = Some(value()?),
            "--urgency" => {
                let urgency: u8 = value()?
                    .parse()
                    .map_err(|_| "--urgency must be 0, 1, or 2".to_string())?;
                if urgency > 2 {
                    return Err("--urgency must be 0, 1, or 2".to_string());
                }
                cli.urgency = Some(urgency);
            }
            other if other.starts_with('-') => {
                return Err(format!("unknown argument: {other}"));
            }
            // Codex appends its event JSON as a positional argument; ignore
            // positionals so `notify = ["muis-notify", "--body", "done"]`
            // works as written. Unknown flags still error.
            _ => {}
        }
    }
    Ok(cli)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        println!("{USAGE}");
        return ExitCode::SUCCESS;
    }

    let cli = match parse_args(args.into_iter()) {
        Ok(cli) => cli,
        Err(e) => {
            eprintln!("muis-notify: {e}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    // A body is the usual case; an agent-session report needs no body.
    if cli.body.is_none() && cli.agent_session.is_none() {
        eprintln!("muis-notify: --body or --agent-session is required\n{USAGE}");
        return ExitCode::from(2);
    }

    let socket = cli
        .socket
        .or_else(|| std::env::var("MUIS_SOCKET").ok())
        .unwrap_or_else(notify::socket_name);
    let req = NotifyRequest {
        title: cli.title,
        body: cli.body.unwrap_or_default(),
        tab_id: cli.tab_id.or_else(|| std::env::var("MUIS_TAB_ID").ok()),
        urgency: cli.urgency,
        agent_session: cli.agent_session,
    };

    match notify::send(&socket, &req) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("muis-notify: could not reach muis (socket {socket}): {e}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> std::vec::IntoIter<String> {
        list.iter().map(|s| s.to_string()).collect::<Vec<_>>().into_iter()
    }

    #[test]
    fn parses_all_flags() {
        let cli = parse_args(args(&[
            "--title", "Build", "--body", "done", "--tab", "t1", "--urgency", "2", "--socket", "s",
        ]))
        .unwrap();
        assert_eq!(
            cli,
            Cli {
                title: Some("Build".into()),
                body: Some("done".into()),
                tab_id: Some("t1".into()),
                urgency: Some(2),
                socket: Some("s".into()),
                agent_session: None,
            }
        );
    }

    #[test]
    fn parses_agent_session_without_body() {
        let cli = parse_args(args(&["--agent-session", "ses_1"])).unwrap();
        assert_eq!(cli.agent_session.as_deref(), Some("ses_1"));
        assert_eq!(cli.body, None);
    }

    #[test]
    fn rejects_missing_value_unknown_flag_and_bad_urgency() {
        assert!(parse_args(args(&["--body"])).is_err());
        assert!(parse_args(args(&["--nope"])).is_err());
        assert!(parse_args(args(&["--body", "x", "--urgency", "9"])).is_err());
    }

    #[test]
    fn body_only_is_enough() {
        assert_eq!(parse_args(args(&["--body", "hi"])).unwrap().body.as_deref(), Some("hi"));
    }

    #[test]
    fn ignores_positional_payload_but_rejects_unknown_flags() {
        // Codex passes its event JSON as a positional argument.
        let cli = parse_args(args(&[
            "--body",
            "done",
            r#"{"type":"agent-turn-complete"}"#,
        ]))
        .unwrap();
        assert_eq!(cli.body.as_deref(), Some("done"));
        assert!(parse_args(args(&["--nope"])).is_err());
    }
}
