import { describe, expect, it } from "vitest";
import { SidePanelRegistry } from "./panels";

describe("SidePanelRegistry", () => {
  it("toggles registered panels, ignores unknown ids", () => {
    const r = new SidePanelRegistry();
    expect(r.toggle("snor")).toBe(null);
    r.register({ id: "snor", title: "Snor" });
    expect(r.toggle("snor")).toBe("snor");
    expect(r.visible()).toBe("snor");
    expect(r.toggle("snor")).toBe(null);
  });

  it("shows one panel at a time and drops closed ones", () => {
    const r = new SidePanelRegistry();
    r.register({ id: "a", title: "A" });
    r.register({ id: "b", title: "B" });
    expect(r.list().map((p) => p.id)).toEqual(["a", "b"]);
    r.toggle("a");
    expect(r.toggle("b")).toBe("b");
    r.unregister("b");
    expect(r.visible()).toBe(null);
    r.toggle("a");
    r.close();
    expect(r.visible()).toBe(null);
  });
});
