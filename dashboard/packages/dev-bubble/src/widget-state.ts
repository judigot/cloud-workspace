export type PanelId = "assistant" | "terminal" | "apps" | "files";

export interface IBubblePanelState {
  isOpen: boolean;
  collapsedPanel: PanelId;
  activePanel: PanelId;
  selectedPanel: PanelId;
}

export const initialBubblePanelState: IBubblePanelState = {
  isOpen: false,
  collapsedPanel: "assistant",
  activePanel: "assistant",
  selectedPanel: "assistant",
};

export function openPanel(
  state: IBubblePanelState,
  panel: PanelId,
): IBubblePanelState {
  return {
    ...state,
    isOpen: true,
    activePanel: panel,
    selectedPanel: panel,
  };
}

export function closePanel(
  state: IBubblePanelState,
  panel: PanelId,
): IBubblePanelState {
  return {
    ...state,
    isOpen: false,
    collapsedPanel: panel,
    activePanel: panel,
    selectedPanel: panel,
  };
}

export function tapPanelBubble(
  state: IBubblePanelState,
  panel: PanelId,
): IBubblePanelState {
  if (!state.isOpen) {
    return openPanel(state, panel);
  }

  if (state.activePanel === panel && state.selectedPanel === panel) {
    return closePanel(state, panel);
  }

  return {
    ...state,
    activePanel: panel,
    selectedPanel: panel,
  };
}
