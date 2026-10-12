import { describe, expect, it } from "vitest";
import { expandHome, shortPath } from "./paths";

describe("shortPath", () => {
  it("collapses the home prefix to ~", () => {
    expect(shortPath("/home/user", "/home/user")).toBe("~");
    expect(shortPath("/home/user/code", "/home/user")).toBe("~/code");
  });

  it("leaves non-home paths and empty home alone", () => {
    expect(shortPath("/etc/hosts", "/home/user")).toBe("/etc/hosts");
    expect(shortPath("/home/user", "")).toBe("/home/user");
  });

  it("does not treat a prefix sibling as home", () => {
    expect(shortPath("/home/user2/x", "/home/user")).toBe("/home/user2/x");
  });
});

describe("expandHome", () => {
  it("expands ~/ to the real home", () => {
    expect(expandHome("~/code", "/home/user")).toBe("/home/user/code");
    expect(expandHome("~", "/home/user")).toBe("~");
    expect(expandHome("/abs/path", "/home/user")).toBe("/abs/path");
  });

  it("leaves ~/ untouched when home is unknown", () => {
    expect(expandHome("~/code", "")).toBe("~/code");
  });
});
