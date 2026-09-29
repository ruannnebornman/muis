import { describe, expect, it } from "vitest";
import { NotifyRouter, NOTIFY_DEDUPE_MS } from "./notify";
import type { NotifyEvent } from "./osc";

const osc9 = (body: string): NotifyEvent => ({ type: "notify", title: null, body, source: "osc9" });
const osc99 = (title: string, body: string): NotifyEvent => ({
  type: "notify",
  title,
  body,
  source: "osc99",
});

describe("NotifyRouter", () => {
  it("badges a tab only when it is not visible", () => {
    const r = new NotifyRouter();
    expect(r.route("t1", osc9("done"), false, 0)).toEqual({ markDone: true });
    expect(r.route("t1", osc9("done"), true, 10_000)).toEqual({ markDone: false });
  });

  it("drops an identical repeat inside the window, keeps it after", () => {
    const r = new NotifyRouter();
    expect(r.route("t1", osc9("build done"), false, 0)).toEqual({ markDone: true });
    expect(r.route("t1", osc9("build done"), false, 100)).toBeNull();
    expect(r.route("t1", osc9("build done"), false, NOTIFY_DEDUPE_MS + 1)).toEqual({
      markDone: true,
    });
  });

  it("treats different content, source, or tab as new", () => {
    const r = new NotifyRouter();
    expect(r.route("t1", osc9("a"), false, 0)).toEqual({ markDone: true });
    expect(r.route("t1", osc9("b"), false, 1)).toEqual({ markDone: true });
    expect(r.route("t1", osc99("", "a"), false, 2)).toEqual({ markDone: true });
    expect(r.route("t2", osc9("a"), false, 3)).toEqual({ markDone: true });
  });

  it("forget clears a tab's dedupe memory", () => {
    const r = new NotifyRouter();
    r.route("t1", osc9("x"), false, 0);
    r.forget("t1");
    expect(r.route("t1", osc9("x"), false, 1)).toEqual({ markDone: true });
  });
});
