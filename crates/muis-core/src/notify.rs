//! Local client endpoint for `muis-notify` and `muis-agent`.
//!
//! A running muis shell listens on a per-user local socket; each client
//! sends one JSON request per connection. This is how hook-only tools —
//! OpenCode, Aider, Claude `Notification` hooks, Codex `notify` — reach the
//! terminal, the same shape as `wezterm cli` or `cmux notify`.
//!
//! Notifications and agent-session reports share the transport but not the
//! payload: a `kind` discriminator keeps `muis-agent` out of the
//! notification path. Requests without `kind` are notifications, so old
//! `muis-notify` clients keep working unchanged.
//!
//! The socket is an abstract-namespace socket on Linux and a named pipe on
//! Windows (via `interprocess`), so there is no stale file to clean up.

use std::io::{self, BufRead, BufReader, Write};

use interprocess::local_socket::{prelude::*, GenericNamespaced, ListenerOptions, Name, Stream};
use serde::{Deserialize, Serialize};

pub const AGENT_KIND: &str = "agent-session";

/// One notification request from a client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotifyRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub body: String,
    /// Originating tab, injected into ptys as `MUIS_TAB_ID`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<String>,
    /// 0 low, 1 normal, 2 critical.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub urgency: Option<u8>,
}

/// The terminal's currently open agent session. `session: None` means the
/// agent is no longer showing a session (for example OpenCode's home screen)
/// and the tab must stop treating itself as resumable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentSessionRequest {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
    /// Originating tab, injected into ptys as `MUIS_TAB_ID`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<String>,
}

impl AgentSessionRequest {
    pub fn new(session: Option<String>, directory: Option<String>, tab_id: Option<String>) -> Self {
        Self {
            kind: AGENT_KIND.to_string(),
            session,
            directory,
            tab_id,
        }
    }
}

/// Every request a local client may send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientRequest {
    Notify(NotifyRequest),
    AgentSession(AgentSessionRequest),
}

/// True for the only session ids muis will ever write to a shell.
pub fn valid_session_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("ses_") else {
        return false;
    };
    !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// Per-user socket name. Abstract namespace on Linux, named pipe on Windows.
pub fn socket_name() -> String {
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "default".to_string());
    format!("muis-notify-{user}")
}

fn socket_address(socket: &str) -> io::Result<Name<'_>> {
    socket.to_ns_name::<GenericNamespaced>()
}

/// Bind the socket and serve requests on a background thread, calling
/// `on_request` for each decoded request. The bind is synchronous, so a
/// client can connect as soon as this returns.
pub fn serve<F>(socket: &str, on_request: F) -> io::Result<()>
where
    F: Fn(ClientRequest) + Send + 'static,
{
    let listener = ListenerOptions::new()
        .name(socket_address(socket)?)
        .try_overwrite(true)
        .create_sync()?;
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(conn) = conn else { continue };
            let mut reader = BufReader::new(conn);
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() {
                continue;
            }
            if let Some(req) = decode_client(line.trim()) {
                on_request(req);
            }
        }
    });
    Ok(())
}

/// Decode one wire line. Agent reports are recognized by `kind`; everything
/// else is a notification (including old clients that never sent `kind`).
pub fn decode_client(line: &str) -> Option<ClientRequest> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let is_agent = value
        .get("kind")
        .and_then(|v| v.as_str())
        .is_some_and(|k| k == AGENT_KIND);
    if is_agent {
        serde_json::from_value(value)
            .ok()
            .map(ClientRequest::AgentSession)
    } else {
        serde_json::from_value(value)
            .ok()
            .map(ClientRequest::Notify)
    }
}

fn send_value(socket: &str, value: &serde_json::Value) -> io::Result<()> {
    let mut conn = Stream::connect(socket_address(socket)?)?;
    let mut line = serde_json::to_string(value)?;
    line.push('\n');
    conn.write_all(line.as_bytes())?;
    conn.flush()
}

/// Send one notification request to a running muis.
pub fn send(socket: &str, req: &NotifyRequest) -> io::Result<()> {
    send_value(socket, &serde_json::to_value(req)?)
}

/// Send one agent-session report to a running muis.
pub fn send_agent(socket: &str, req: &AgentSessionRequest) -> io::Result<()> {
    send_value(socket, &serde_json::to_value(req)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn request_json_roundtrips_and_optional_fields_may_be_omitted() {
        let req = NotifyRequest {
            title: Some("T".into()),
            body: "b".into(),
            tab_id: Some("t1".into()),
            urgency: Some(2),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert_eq!(serde_json::from_str::<NotifyRequest>(&json).unwrap(), req);

        let min: NotifyRequest = serde_json::from_str(r#"{"body":"hi"}"#).unwrap();
        assert_eq!(
            min,
            NotifyRequest {
                title: None,
                body: "hi".into(),
                tab_id: None,
                urgency: None,
            }
        );
    }

    #[test]
    fn socket_name_is_per_user() {
        assert!(socket_name().starts_with("muis-notify-"));
    }

    #[test]
    fn agent_request_roundtrips_with_and_without_a_session() {
        let req = AgentSessionRequest::new(
            Some("ses_abc123".into()),
            Some("/tmp".into()),
            Some("t1".into()),
        );
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("agent-session"));
        assert_eq!(decode_client(&json), Some(ClientRequest::AgentSession(req)));

        let clear = AgentSessionRequest::new(None, None, Some("t1".into()));
        assert_eq!(
            decode_client(&serde_json::to_string(&clear).unwrap()),
            Some(ClientRequest::AgentSession(clear))
        );
    }

    #[test]
    fn legacy_notify_and_agent_do_not_cross_decode() {
        let notify = NotifyRequest {
            title: None,
            body: "hello".into(),
            tab_id: Some("t1".into()),
            urgency: None,
        };
        assert_eq!(
            decode_client(&serde_json::to_string(&notify).unwrap()),
            Some(ClientRequest::Notify(notify))
        );
        assert!(decode_client("not json").is_none());
    }

    #[test]
    fn session_ids_are_strictly_ses_alphanumeric() {
        assert!(valid_session_id("ses_abc123"));
        assert!(!valid_session_id("ses_"));
        assert!(!valid_session_id("abc123"));
        assert!(!valid_session_id("ses_ab-c"));
        assert!(!valid_session_id("ses_ab c"));
        assert!(!valid_session_id("ses_ab\nrm -rf /"));
    }

    #[test]
    fn serve_and_send_roundtrip() {
        let socket = format!("muis-notify-test-{}", std::process::id());
        let (tx, rx) = mpsc::channel();
        serve(&socket, move |req| {
            let _ = tx.send(req);
        })
        .unwrap();

        let req = NotifyRequest {
            title: None,
            body: "hello".into(),
            tab_id: Some("tab-1".into()),
            urgency: None,
        };
        send(&socket, &req).unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            ClientRequest::Notify(req)
        );

        let agent = AgentSessionRequest::new(Some("ses_x1".into()), None, Some("tab-1".into()));
        send_agent(&socket, &agent).unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            ClientRequest::AgentSession(agent)
        );
    }
}
