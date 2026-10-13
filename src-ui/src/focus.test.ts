import { describe, it, expect } from "vitest";
import { shouldFocusTerminal } from "./focus";

describe("shouldFocusTerminal", () => {
  it("focuses on a plain selection", () => {
    expect(shouldFocusTerminal({ dragging: false, searchFocused: false })).toBe(true);
  });

  it("does not focus while reordering", () => {
    expect(shouldFocusTerminal({ dragging: true, searchFocused: false })).toBe(false);
  });

  it("does not steal focus from the search box", () => {
    expect(shouldFocusTerminal({ dragging: false, searchFocused: true })).toBe(false);
  });
});
