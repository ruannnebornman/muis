/**
 * Unit test for the opencode TUI route tracker. The plugin runs inside the
 * TUI, so we drive the exported tracker directly instead of starting a TUI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentInvocation,
  createRouteTracker,
} from "../../crates/muis-shell/opencode-plugin/muis-tui.mjs";

function tracker() {
  const reported = [];
  const cleared = [];
  const track = createRouteTracker(
    (id) => reported.push(id),
    () => cleared.push(true),
  );
  return { track, reported, cleared };
}

const sessionRoute = (id) => ({ name: "session", params: { sessionID: id } });

test("reports session route changes exactly once", () => {
  const { track, reported } = tracker();
  track(sessionRoute("ses_first"));
  track(sessionRoute("ses_first"));
  track(sessionRoute("ses_second"));
  assert.deepEqual(reported, ["ses_first", "ses_second"]);
});

test("does not clear on the initial home route", () => {
  const { track, cleared } = tracker();
  track({ name: "home" });
  assert.deepEqual(cleared, []);
});

test("clears after leaving a session", () => {
  const { track, reported, cleared } = tracker();
  track(sessionRoute("ses_first"));
  track({ name: "home" });
  assert.deepEqual(reported, ["ses_first"]);
  assert.deepEqual(cleared, [true]);
});

test("ignores malformed route ids", () => {
  const { track, reported } = tracker();
  track({ name: "session", params: { sessionID: "nope" } });
  track({ name: "session", params: {} });
  track({ name: "plugin", params: { sessionID: "ses_plugin" } });
  assert.deepEqual(reported, []);
});

test("picks the agent CLI for sidecar and Windows single-exe builds", () => {
  assert.deepEqual(agentInvocation({}), { command: "muis-agent", args: [] });
  assert.deepEqual(agentInvocation({ MUIS_BIN: "/opt/muis/muis" }), {
    command: "/opt/muis/muis",
    args: ["--muis-agent"],
  });
  assert.deepEqual(agentInvocation({ MUIS_AGENT_BIN: "/opt/muis/muis-agent", MUIS_BIN: "/opt/muis/muis" }), {
    command: "/opt/muis/muis-agent",
    args: [],
  });
});
