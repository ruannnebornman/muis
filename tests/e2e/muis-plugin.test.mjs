/**
 * Unit test for the opencode plugin's notification payload. The plugin runs
 * inside opencode, so we drive it with a fake shell and assert what it asks
 * `muis-notify` to send.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MuisPlugin } from "../../crates/muis-shell/opencode-plugin/muis.js";

/** Fake Bun-style tagged shell that records each command as a string. */
function fakeShell() {
  const calls = [];
  const $ = (strings, ...values) => {
    const text = strings
      .map((s, i) => {
        const v = values[i];
        if (v === undefined) return s;
        return s + (Array.isArray(v) ? v.join(" ") : String(v));
      })
      .join("");
    calls.push(text);
    return Promise.resolve();
  };
  return { calls, $ };
}

test("session.idle toast names the project and the work", async () => {
  const { calls, $ } = fakeShell();
  const hooks = await MuisPlugin({ $ });
  await hooks.event({
    event: {
      type: "session.updated",
      properties: { info: { id: "ses_abc", title: "Fix the clock", directory: "/home/x/Projects/muis" } },
    },
  });
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_abc" } } });
  const joined = calls.join("\n");
  assert.match(joined, /--title muis/);
  assert.match(joined, /--body Fix the clock has finished/);
  assert.doesNotMatch(joined, /turn finished/);
});

test("session.idle without known info still avoids the placeholder", async () => {
  const { calls, $ } = fakeShell();
  const hooks = await MuisPlugin({ $ });
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_unknown" } } });
  const joined = calls.join("\n");
  assert.match(joined, /--title opencode/);
  assert.match(joined, /--body opencode has finished/);
  assert.doesNotMatch(joined, /turn finished/);
});

test("chat.message reports the exact session for resume tracking", async () => {
  const { calls, $ } = fakeShell();
  const hooks = await MuisPlugin({ $ });
  await hooks["chat.message"]({ sessionID: "ses_exact1", agent: "build" });
  const joined = calls.join("\n");
  assert.match(joined, /muis-agent session ses_exact1/);
  assert.doesNotMatch(joined, /--title/);
});

test("session.created reports a new top-level session but not a subagent", async () => {
  const { calls, $ } = fakeShell();
  const hooks = await MuisPlugin({ $ });
  await hooks.event({
    event: {
      type: "session.created",
      properties: { info: { id: "ses_root", title: "", directory: "/p", parentID: "" } },
    },
  });
  assert.match(calls.join("\n"), /muis-agent session ses_root/);

  calls.length = 0;
  await hooks.event({
    event: {
      type: "session.created",
      properties: { info: { id: "ses_child", title: "", directory: "/p", parentID: "ses_root" } },
    },
  });
  assert.doesNotMatch(calls.join("\n"), /muis-agent/);
});

test("agent reports dedupe repeated session ids", async () => {
  const { calls, $ } = fakeShell();
  const hooks = await MuisPlugin({ $ });
  await hooks["chat.message"]({ sessionID: "ses_same" });
  await hooks["chat.message"]({ sessionID: "ses_same" });
  const agentCalls = calls.filter((c) => c.includes("muis-agent"));
  assert.equal(agentCalls.length, 1);
});

test("session.idle notifies without overriding the TUI route", async () => {
  const { calls, $ } = fakeShell();
  const hooks = await MuisPlugin({ $ });
  await hooks.event({
    event: {
      type: "session.updated",
      properties: { info: { id: "ses_idle", title: "Fix it", directory: "/p" } },
    },
  });
  calls.length = 0;
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_idle" } } });
  const joined = calls.join("\n");
  assert.doesNotMatch(joined, /muis-agent/);
  assert.match(joined, /muis-notify .*--title p/);
});

test("invalid session ids are never reported", async () => {
  const { calls, $ } = fakeShell();
  const hooks = await MuisPlugin({ $ });
  await hooks["chat.message"]({ sessionID: "not-a-session" });
  assert.doesNotMatch(calls.join("\n"), /muis-agent/);
});
