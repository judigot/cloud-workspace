import { describe, expect, it } from "vitest";
import {
  closePanel,
  initialBubblePanelState,
  openPanel,
  tapPanelBubble,
  type IBubblePanelState,
} from "./widget-state";

function expectClosedIdentity(state: IBubblePanelState) {
  expect(state.isOpen).toBe(false);
  expect(state.activePanel).toBe(state.selectedPanel);
  expect(state.selectedPanel).toBe(state.collapsedPanel);
}

describe("widget bubble invariants", () => {
  it("opens selected panel on first tap when closed", () => {
    const next = tapPanelBubble(initialBubblePanelState, "terminal");
    expect(next.isOpen).toBe(true);
    expect(next.activePanel).toBe("terminal");
    expect(next.selectedPanel).toBe("terminal");
    expect(next.collapsedPanel).toBe("assistant");
  });

  it("minimizes only on second tap of currently selected+active bubble", () => {
    const opened = openPanel(initialBubblePanelState, "assistant");
    const switched = tapPanelBubble(opened, "terminal");
    expect(switched.isOpen).toBe(true);
    expect(switched.activePanel).toBe("terminal");

    const minimized = tapPanelBubble(switched, "terminal");
    expectClosedIdentity(minimized);
    expect(minimized.collapsedPanel).toBe("terminal");
  });

  it("switches panel on first tap without minimizing", () => {
    const opened = openPanel(initialBubblePanelState, "assistant");
    const switched = tapPanelBubble(opened, "terminal");
    expect(switched.isOpen).toBe(true);
    expect(switched.activePanel).toBe("terminal");
    expect(switched.selectedPanel).toBe("terminal");
    expect(switched.collapsedPanel).toBe("assistant");
  });

  it("closePanel enforces closed identity invariant", () => {
    const opened = openPanel(initialBubblePanelState, "assistant");
    const closed = closePanel(opened, "assistant");
    expectClosedIdentity(closed);
  });

  it("closePanel preserves the triggering panel as collapsed identity", () => {
    const opened = openPanel(initialBubblePanelState, "assistant");
    const closed = closePanel(opened, "apps");
    expectClosedIdentity(closed);
    expect(closed.collapsedPanel).toBe("apps");
  });
});
