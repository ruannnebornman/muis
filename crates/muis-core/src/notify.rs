//! Local notification endpoint for `muis-notify` clients.
//!
//! A running muis shell listens on a per-user local socket; the
//! `muis-notify` binary (and anything that can run it) sends one JSON
//! request per connection. This is how hook-only tools — OpenCode, Aider,
//! Claude `Notification` hooks, Codex `notify` — reach the terminal, the
//! same shape as `wezterm cli` or `cmux notify`.
//!
//! The socket is an abstract-namespace socket on Linux and a named pipe on
//! Windows (via `interprocess`), so there is no stale file to clean up.

use std::io::{self, BufRead, BufReader, Write};

use interprocess::local_socket::{prelude::*, GenericNamespaced, ListenerOptions, Name, Stream};
use serde::{Deserialize, Serialize};

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
    /// Agent session id reported by an agent hook/plugin (opencode, …),
    /// so the tab can resume that exact session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_session: Option<String>,
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
    F: Fn(NotifyRequest) + Send + 'static,
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
            if let Ok(req) = serde_json::from_str::<NotifyRequest>(line.trim()) {
                on_request(req);
            }
        }
    });
    Ok(())
}

/// Send one request to a running muis.
pub fn send(socket: &str, req: &NotifyRequest) -> io::Result<()> {
    let mut conn = Stream::connect(socket_address(socket)?)?;
    let mut line = serde_json::to_string(req)?;
    line.push('\n');
    conn.write_all(line.as_bytes())?;
    conn.flush()
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
            agent_session: Some("ses_1".into()),
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
                agent_session: None
            }
        );
    }

    #[test]
    fn socket_name_is_per_user() {
        assert!(socket_name().starts_with("muis-notify-"));
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
            agent_session: None,
        };
        send(&socket, &req).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), req);
    }
}
