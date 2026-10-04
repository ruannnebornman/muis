import { describe, expect, it } from "vitest";
import { NotifyRouter, NOTIFY_DEDUPE_MS, notifyEventFromCli, type NotifyContext } from "./notify";
import type { NotifyEvent } from "./osc";

const osc9 = (body: string): NotifyEvent => ({ type: "notify", title: null, body, source: "osc9" });
const osc99 = (title: string, body: string): NotifyEvent => ({
  type: "notify",
  title,
  body,
  source: "osc99",
});

const ctx = (over: Partial<NotifyContext> = {}): NotifyContext => ({
  visible: false,
  windowFocused: false,
  ...over,
});

describe("NotifyRouter", () => {
  it("badges a tab only when it is not visible", () => {
    const r = new NotifyRouter();
    expect(r.route("t1", osc9("done"), ctx({ visible: false }), 0)?.markDone).toBe(true);
    expect(r.route("t1", osc9("done"), ctx({ visible: true }), 10_000)?.markDone).toBe(false);
  });

  it("toasts only while the window is unfocused", () => {
    const r = new NotifyRouter();
    expect(r.route("t1", osc9("a"), ctx({ windowFocused: false }), 0)?.toast).toBe(true);
    expect(r.route("t1", osc9("b"), ctx({ windowFocused: true }), 1)?.toast).toBe(false);
  });

  it("drops an identical repeat inside the window, keeps it after", () => {
    const r = new NotifyRouter();
    expect(r.route("t1", osc9("build done"), ctx(), 0)).not.toBeNull();
    expect(r.route("t1", osc9("build done"), ctx(), 100)).toBeNull();
    expect(r.route("t1", osc9("build done"), ctx(), NOTIFY_DEDUPE_MS + 1)).not.toBeNull();
  });

  it("treats different content, source, or tab as new", () => {
    const r = new NotifyRouter();
    expect(r.route("t1", osc9("a"), ctx(), 0)).not.toBeNull();
    expect(r.route("t1", osc9("b"), ctx(), 1)).not.toBeNull();
    expect(r.route("t1", osc99("", "a"), ctx(), 2)).not.toBeNull();
    expect(r.route("t2", osc9("a"), ctx(), 3)).not.toBeNull();
  });

  it("forget clears a tab's dedupe memory", () => {
    const r = new NotifyRouter();
    r.route("t1", osc9("x"), ctx(), 0);
    r.forget("t1");
    expect(r.route("t1", osc9("x"), ctx(), 1)).not.toBeNull();
  });

  it("reports the time of the last notification per tab", () => {
    const r = new NotifyRouter();
    expect(r.lastAt("t1")).toBeUndefined();
    r.route("t1", osc9("a"), ctx(), 42);
    expect(r.lastAt("t1")).toBe(42);
    expect(r.lastAt("t2")).toBeUndefined();
  });
});

describe("notifyEventFromCli", () => {
  it("maps a CLI request to a cli-source event", () => {
    expect(notifyEventFromCli({ title: "Build", body: "done", urgency: 2 })).toEqual({
      type: "notify",
      title: "Build",
      body: "done",
      source: "cli",
      urgency: 2,
    });
  });

  it("omits missing title and urgency", () => {
    expect(notifyEventFromCli({ body: "hi" })).toEqual({
      type: "notify",
      title: null,
      body: "hi",
      source: "cli",
    });
  });
});
