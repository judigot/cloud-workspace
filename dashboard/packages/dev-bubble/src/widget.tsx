/**
 * DevBubble standalone widget (React).
 * Injected into app pages via nginx sub_filter.
 * Compiled to a self-contained IIFE bundle that includes React+ReactDOM.
 *
 * Behavior modeled after Facebook Messenger chat heads on Android:
 *   - Bubble is ALWAYS visible -- it never disappears
 *   - Draggable with edge-snapping after release
 *   - On tap: bubble docks to top of whichever edge it's on (left or right)
 *   - Home button slides out to the opposite side of the bubble
 *   - Chat panel slides down below the bubble row
 *   - On minimize (tap bubble again): everything reverses simultaneously
 *   - No header bar inside the panel -- the bubble row IS the header
 *
 * Config via script tag data attributes:
 *   <script src="/dev-bubble.js"
 *     data-opencode-url="https://dev.judigot.com"
 *     data-dashboard-url="https://judigot.com">
 *   </script>
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  type FC,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceShell, WORKSPACE_SHELL_CSS } from "./WorkspaceShell";
import {
  initialBubblePanelState,
  openPanel as openPanelState,
  closePanel as closePanelState,
  tapPanelBubble as tapPanelBubbleState,
  type PanelId,
} from "./widget-state";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BUBBLE_SIZE = 54;
const BUBBLE_MARGIN = 12;
/** Gap between home button and bubble, and bubble to chat — all equal to BUBBLE_MARGIN. */
const BUTTON_GAP = BUBBLE_MARGIN;
/** Minimum px before a gesture counts as drag. */
const DRAG_THRESHOLD = 10;
/** Duration for bubble reposition animations (ms). */
const ANIM_DURATION = 350;
/** Delay before home button starts sliding out. */
const HOME_REVEAL_DELAY = 50;
/** Duration for home button slide animation. */
const HOME_SLIDE_DURATION = 250;

// ---------------------------------------------------------------------------
// Config from script tag
// ---------------------------------------------------------------------------
const scriptTag = document.currentScript as HTMLScriptElement | null;
const OPENCODE_URL =
  scriptTag?.getAttribute("data-opencode-url") ??
  "https://dev.judigot.com";
const DASHBOARD_URL =
  scriptTag?.getAttribute("data-dashboard-url") ?? "/";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const WIDGET_CSS = `
  #__dev-bubble-root,
  #__dev-bubble-root * {
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
  }
  #__dev-bubble-root {
    font-family: system-ui, -apple-system, sans-serif;
    position: fixed;
    z-index: 99999;
  }

  /* ── Bubble ── always visible */
  .db-btn {
    position: fixed;
    width: ${BUBBLE_SIZE}px;
    height: ${BUBBLE_SIZE}px;
    border-radius: 50%;
    background: radial-gradient(circle at center, #2a2a2a 0%, #1a1a1a 58%, #090909 100%);
    border: none;
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    z-index: 100000;
    touch-action: none;
    user-select: none;
    padding: 0;
    outline: none;
    transition: none;
    animation: db-btn-enter ${ANIM_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1);
  }
  .db-btn-terminal {
    background: radial-gradient(circle at center, #2fae9f 0%, #177b73 58%, #0a3f44 100%);
  }
  .db-btn-apps {
    background: radial-gradient(circle at center, #6ea3ff 0%, #3172f2 58%, #17398d 100%);
  }
  .db-btn-files {
    background: radial-gradient(circle at center, #f2c55d 0%, #f2a617 58%, #9a5906 100%);
  }
  @keyframes db-btn-enter {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .db-btn:focus, .db-btn:focus-visible { outline: none; }
  .db-btn:active { cursor: grabbing; }
  .db-btn-animating {
    transition: left ${ANIM_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                top ${ANIM_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                transform ${ANIM_DURATION}ms ease;
  }
  .db-btn.db-active {
    transform: scale(1.08) !important;
    cursor: pointer;
  }
  @media (hover: hover) {
    .db-btn:hover {
      transform: scale(1);
    }
  }

  /* ── Side buttons (home + terminal) ── */
  .db-side-btn {
    position: fixed;
    width: ${BUBBLE_SIZE}px;
    height: ${BUBBLE_SIZE}px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    z-index: 99999;
    padding: 0;
    outline: none;
    /* Hidden state: transform is set via inline style (direction depends on dock side) */
    opacity: 0;
    pointer-events: none;
    transition: left ${ANIM_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                top ${ANIM_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                transform ${HOME_SLIDE_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                opacity ${HOME_SLIDE_DURATION}ms ease;
  }
  .db-side-btn:focus, .db-side-btn:focus-visible { outline: none; }
  .db-home {
    background: radial-gradient(circle at center, #717a7e 0%, #4e565a 58%, #262c2f 100%);
  }
  .db-terminal {
    background: radial-gradient(circle at center, #2fae9f 0%, #177b73 58%, #0a3f44 100%);
  }
  .db-assistant {
    background: radial-gradient(circle at center, #2a2a2a 0%, #1a1a1a 58%, #090909 100%);
  }
  .db-apps {
    background: radial-gradient(circle at center, #6ea3ff 0%, #3172f2 58%, #17398d 100%);
  }
  .db-files {
    background: radial-gradient(circle at center, #f2c55d 0%, #f2a617 58%, #9a5906 100%);
  }
  .db-side-btn-visible {
    transform: translateX(0) scale(1) !important;
    opacity: 1;
    pointer-events: auto;
  }
  .db-side-btn.db-active {
    transform: translateX(0) scale(1.08) !important;
  }
  @media (hover: hover) {
    .db-side-btn:hover {
      transform: translateX(0) scale(1);
    }
  }

  /* ── Chat panel ── anchored below the bubble row */
  .db-panel {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    background: #0f1115;
    z-index: 99998;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: top ${ANIM_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                opacity ${ANIM_DURATION}ms ease;
    will-change: top, opacity;
  }
  .db-panel-closed {
    opacity: 0;
    pointer-events: none;
  }
  .db-panel-open {
    opacity: 1;
    pointer-events: auto;
  }
  .db-panel-hidden {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
  }

  .db-panel .ws-shell {
    flex: 1;
    min-height: 0;
  }
`;

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------
const IconChat: FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
  </svg>
);

const IconHome: FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
  </svg>
);

const IconTerminal: FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
    <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v10h14V7H5zm2.2 2.3 3 2.7-3 2.7 1.4 1.5 4.7-4.2-4.7-4.2-1.4 1.5zM12 15h5v-2h-5v2z" />
  </svg>
);

const IconApps: FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26">
    <path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z" />
  </svg>
);

const IconFiles: FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26">
    <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" />
  </svg>
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type DockSide = "left" | "right";
function clamp(x: number, y: number) {
  return {
    x: Math.max(BUBBLE_MARGIN, Math.min(window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN, x)),
    y: Math.max(BUBBLE_MARGIN, Math.min(window.innerHeight - BUBBLE_SIZE - BUBBLE_MARGIN, y)),
  };
}

function snapX(fromX: number) {
  const mid = window.innerWidth / 2;
  return fromX + BUBBLE_SIZE / 2 < mid
    ? BUBBLE_MARGIN
    : window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN;
}

/** Which side of the screen is this X position on? */
function sideForX(x: number): DockSide {
  return x + BUBBLE_SIZE / 2 < window.innerWidth / 2 ? "left" : "right";
}

/** Docked X for a given side. */
function dockedX(side: DockSide) {
  return side === "left"
    ? BUBBLE_MARGIN
    : window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN;
}

// ---------------------------------------------------------------------------
// Widget component
// ---------------------------------------------------------------------------
const DevBubbleWidget: FC = () => {
  // ── Bubble position ──
  const [pos, setPos] = useState(() => clamp(window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN, BUBBLE_MARGIN));
  const posRef = useRef(pos);
  useEffect(() => { posRef.current = pos; }, [pos]);

  // ── Animation flag ──
  const [animating, setAnimating] = useState(false);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Panel state ──
  const [panelState, setPanelState] = useState(initialBubblePanelState);
  const { isOpen, collapsedPanel, activePanel, selectedPanel } = panelState;
  const [hasOpened, setHasOpened] = useState(false);

  // Invariants (simplified):
  // 1) Single source of truth: activePanel decides which bubble is active-sized.
  // 2) Minimize only on second tap of currently selected+active bubble.
  // 3) Bubble used to minimize becomes collapsedPanel (the draggable identity).

  // ── Which side the bubble docked to ──
  const [dockSide, setDockSide] = useState<DockSide>("right");

  // ── Side button visibility ──
  const [homeVisible, setHomeVisible] = useState(false);
  const homeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Saved position before opening ──
  const savedPos = useRef<{ x: number; y: number } | null>(null);

  // ── Drag refs ──
  const dragging = useRef(false);
  const hasDragged = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const pointerStart = useRef({ x: 0, y: 0 });

  // Animate bubble to a position.
  const animateTo = useCallback((target: { x: number; y: number }, onDone?: () => void) => {
    if (animTimer.current) clearTimeout(animTimer.current);
    setAnimating(true);
    posRef.current = target;
    setPos(target);
    animTimer.current = setTimeout(() => {
      setAnimating(false);
      animTimer.current = null;
      onDone?.();
    }, ANIM_DURATION + 20);
  }, []);

  // ── Open ── dock to whichever side the bubble is currently on.
  const openPanel = useCallback((panel: PanelId = "assistant") => {
    savedPos.current = { ...posRef.current };
    if (!hasOpened) setHasOpened(true);
    const side = sideForX(posRef.current.x);
    setDockSide(side);
    const target = clamp(dockedX(side), BUBBLE_MARGIN);
    setPanelState((prev) => openPanelState(prev, panel));
    animateTo(target);
    if (homeTimer.current) clearTimeout(homeTimer.current);
    homeTimer.current = setTimeout(() => {
      setHomeVisible(true);
      homeTimer.current = null;
    }, HOME_REVEAL_DELAY);
  }, [hasOpened, animateTo]);

  // ── Close ── everything moves at once.
  const closePanel = useCallback((panel: PanelId) => {
    setHomeVisible(false);
    setPanelState((prev) => closePanelState(prev, panel));
    if (homeTimer.current) {
      clearTimeout(homeTimer.current);
      homeTimer.current = null;
    }
    if (savedPos.current) {
      const snapped = clamp(snapX(savedPos.current.x), savedPos.current.y);
      animateTo(snapped);
      savedPos.current = null;
    }
  }, [animateTo]);

  const tapPanelBubble = useCallback((panel: PanelId) => {
    if (!isOpen) {
      openPanel(panel);
      return;
    }
    if (activePanel === panel && selectedPanel === panel) {
      closePanel(panel);
      return;
    }
    setPanelState((prev) => tapPanelBubbleState(prev, panel));
  }, [isOpen, activePanel, selectedPanel, openPanel, closePanel]);

  // ── Edge-snap after drag ──
  const snapToEdge = useCallback((fromX: number, fromY: number) => {
    animateTo(clamp(snapX(fromX), fromY));
  }, [animateTo]);

  // ── Pointer handlers ──
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (isOpen) return;
      e.preventDefault();
      if (animTimer.current) {
        clearTimeout(animTimer.current);
        animTimer.current = null;
        setAnimating(false);
      }
      dragging.current = true;
      hasDragged.current = false;
      offset.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
      pointerStart.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [isOpen],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dragging.current) return;
      e.preventDefault();
      const dx = e.clientX - pointerStart.current.x;
      const dy = e.clientY - pointerStart.current.y;
      if (!hasDragged.current && dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      hasDragged.current = true;
      const next = clamp(e.clientX - offset.current.x, e.clientY - offset.current.y);
      posRef.current = next;
      setPos(next);
    },
    [],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (isOpen) {
        e.preventDefault();
        tapPanelBubble(collapsedPanel);
        return;
      }
      if (!dragging.current) return;
      e.preventDefault();
      const wasDrag = hasDragged.current;
      dragging.current = false;
      hasDragged.current = false;
      if (wasDrag) {
        snapToEdge(posRef.current.x, posRef.current.y);
      } else {
        openPanel(collapsedPanel);
      }
    },
    [isOpen, collapsedPanel, tapPanelBubble, snapToEdge, openPanel],
  );

  const onPointerCancel = useCallback(() => {
    if (dragging.current) {
      dragging.current = false;
      hasDragged.current = false;
      snapToEdge(posRef.current.x, posRef.current.y);
    }
  }, [snapToEdge]);

  // ── Resize ──
  useEffect(() => {
    const handler = () => {
      if (isOpen) {
        const target = clamp(dockedX(dockSide), BUBBLE_MARGIN);
        posRef.current = target;
        setPos(target);
      } else {
        setPos((p) => {
          const snapped = clamp(snapX(p.x), p.y);
          posRef.current = snapped;
          return snapped;
        });
      }
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [isOpen, dockSide]);

  // ── Layout calculations ──
  const lane = BUBBLE_SIZE + BUTTON_GAP;
  const sideDir = dockSide === "right" ? -1 : 1;

  const sidePanels: PanelId[] = ["assistant", "terminal", "apps", "files"].filter(
    (panel) => panel !== collapsedPanel,
  );
  const sidePanelOffsets = Object.fromEntries(
    sidePanels.map((panel, index) => [panel, index + 1]),
  ) as Record<PanelId, number>;

  // Side buttons layout while open: main bubble at docked edge, then remaining panels, then home.
  const homeLeft = pos.x + sideDir * lane * (sidePanels.length + 1);
  const rowY = pos.y;

  const homeHiddenTx = dockSide === "right" ? lane * (sidePanels.length + 1) : -lane * (sidePanels.length + 1);

  // Panel anchored below the bubble row.
  const panelTop = pos.y + BUBBLE_SIZE + BUBBLE_MARGIN;
  const panelTopClosed = window.innerHeight + 10;

  // ── Classes ──
  const isTerminalActive = isOpen && activePanel === "terminal";
  const isFilesActive = isOpen && activePanel === "files";
  const isAppsActive = isOpen && activePanel === "apps";
  const isMainActive = activePanel === collapsedPanel;

  let bubbleClass = "db-btn";
  if (collapsedPanel === "terminal") bubbleClass += " db-btn-terminal";
  else if (collapsedPanel === "apps") bubbleClass += " db-btn-apps";
  else if (collapsedPanel === "files") bubbleClass += " db-btn-files";
  if (animating) bubbleClass += " db-btn-animating";
  if (isMainActive) bubbleClass += " db-active";

  let panelClass = "db-panel";
  if (isOpen) panelClass += " db-panel-open";
  else if (hasOpened) panelClass += " db-panel-closed";
  else panelClass += " db-panel-hidden";

  let homeClass = "db-side-btn db-home";
  if (homeVisible) homeClass += " db-side-btn-visible";

  const panelMeta: Record<PanelId, { className: string; label: string; icon: React.ReactNode; active: boolean }> = {
    assistant: {
      className: "db-assistant",
      label: "Assistant",
      icon: <IconChat />,
      active: isOpen && activePanel === "assistant",
    },
    terminal: {
      className: "db-terminal",
      label: "Terminal",
      icon: <IconTerminal />,
      active: isTerminalActive,
    },
    apps: {
      className: "db-apps",
      label: "Apps",
      icon: <IconApps />,
      active: isAppsActive,
    },
    files: {
      className: "db-files",
      label: "Files",
      icon: <IconFiles />,
      active: isFilesActive,
    },
  };

  return (
    <>
      {/* Chat panel — always mounted, no header bar */}
      <div
        className={panelClass}
        style={{ top: isOpen ? panelTop : panelTopClosed }}
      >
        <WorkspaceShell
          opencodeUrl={OPENCODE_URL}
          mode={activePanel}
          terminalWsPath="/api/terminal/ws"
        />
      </div>

      {/* Home button — positioned on opposite side of bubble */}
      <button
        className={homeClass}
        aria-label="Home"
        title="Back to dashboard"
        style={{
          left: homeLeft,
          top: rowY,
          transform: `translateX(${homeHiddenTx}px) scale(0.8)`,
        }}
        onClick={() => { window.location.href = DASHBOARD_URL; }}
      >
        <IconHome />
      </button>

      {sidePanels.map((panel) => {
        const offset = sidePanelOffsets[panel];
        const meta = panelMeta[panel];
        let sideClass = `db-side-btn ${meta.className}`;
        if (homeVisible) sideClass += " db-side-btn-visible";
        if (meta.active) sideClass += " db-active";

        return (
          <button
            key={panel}
            className={sideClass}
            aria-label={meta.label}
            title={meta.label}
            style={{
              left: pos.x + sideDir * lane * offset,
              top: rowY,
              transform: `translateX(${dockSide === "right" ? lane * offset : -lane * offset}px) scale(0.8)`,
            }}
            onClick={() => tapPanelBubble(panel)}
          >
            {meta.icon}
          </button>
        );
      })}

      {/* Main bubble — stays docked to the side when minimized */}
      <button
        className={bubbleClass}
        aria-label={isOpen ? "Minimize" : `Open ${collapsedPanel}`}
        style={{ left: pos.x, top: rowY }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {collapsedPanel === "terminal" ? <IconTerminal /> : collapsedPanel === "apps" ? <IconApps /> : collapsedPanel === "files" ? <IconFiles /> : <IconChat />}
      </button>
    </>
  );
};

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------
(function mount() {
  if (document.getElementById("__dev-bubble-root")) return;

  const style = document.createElement("style");
  style.textContent = WORKSPACE_SHELL_CSS + WIDGET_CSS;
  document.head.appendChild(style);

  const container = document.createElement("div");
  container.id = "__dev-bubble-root";
  document.body.appendChild(container);

  createRoot(container).render(<DevBubbleWidget />);
})();
