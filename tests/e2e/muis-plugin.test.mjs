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
