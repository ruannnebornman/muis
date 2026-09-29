import { describe, expect, it } from "vitest";
import { expandHome, shortPath } from "./paths";

describe("shortPath", () => {
  it("collapses the home prefix to ~", () => {
    expect(shortPath("/home/kaazrot", "/home/kaazrot")).toBe("~");
    expect(shortPath("/home/kaazrot/code", "/home/kaazrot")).toBe("~/code");
  });

  it("leaves non-home paths and empty home alone", () => {
    expect(shortPath("/etc/hosts", "/home/kaazrot")).toBe("/etc/hosts");
    expect(shortPath("/home/kaazrot", "")).toBe("/home/kaazrot");
  });

  it("does not treat a prefix sibling as home", () => {
    expect(shortPath("/home/kaazrot2/x", "/home/kaazrot")).toBe("/home/kaazrot2/x");
  });
});

describe("expandHome", () => {
  it("expands ~/ to the real home", () => {
    expect(expandHome("~/code", "/home/kaazrot")).toBe("/home/kaazrot/code");
    expect(expandHome("~", "/home/kaazrot")).toBe("~");
    expect(expandHome("/abs/path", "/home/kaazrot")).toBe("/abs/path");
  });

  it("leaves ~/ untouched when home is unknown", () => {
    expect(expandHome("~/code", "")).toBe("~/code");
  });
});
