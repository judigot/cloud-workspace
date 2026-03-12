import { useState, useRef, useEffect, useCallback, type PointerEvent as ReactPointerEvent } from "react";
import styles from "./DevBubble.module.css";

export interface IBubbleApp {
  slug: string;
  url: string;
  status: "up" | "down" | "unknown";
}

interface IDevBubbleProps {
  /** URL to load in the OpenCode iframe */
  url?: string;
  /** Current app iframe URL (shown in the URL bar) */
  appUrl?: string;
  /** Called when user navigates to a new URL via the URL bar */
  onNavigate?: (url: string) => void;
  /** List of workspace apps to show in the nav */
  apps?: IBubbleApp[];
  /** Currently active app slug (highlighted in nav) */
  activeSlug?: string | null;
  /** Called when user taps an app in the nav */
  onSelectApp?: (app: IBubbleApp) => void;
  /** Called when user taps "Home" to go back to dashboard */
  onGoHome?: () => void;
}

interface IPosition {
  x: number;
  y: number;
}

const BUBBLE_SIZE = 60;
const BUBBLE_MARGIN = 24;
/**
 * Minimum distance (px) the pointer must travel before a gesture counts as a
 * drag rather than a tap.  10 px is generous enough to absorb the natural
 * jitter of a finger on a touch screen while still feeling responsive for
 * intentional drags.
 */
const DRAG_THRESHOLD = 10;

export function DevBubble({
  url = "https://dev.judigot.com",
  appUrl = "",
  onNavigate,
  apps = [],
  activeSlug = null,
  onSelectApp,
  onGoHome,
}: IDevBubbleProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<IPosition>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [urlInput, setUrlInput] = useState(appUrl);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // ── Refs for pointer / drag state ──
  // Using refs (not state) so pointer handlers never suffer from stale closures.
  const posRef = useRef<IPosition>(position);
  const draggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const offsetRef = useRef<IPosition>({ x: 0, y: 0 });
  const startRef = useRef<IPosition>({ x: 0, y: 0 });

  // Keep the ref in sync whenever state changes (resize handler, etc.)
  useEffect(() => {
    posRef.current = position;
  }, [position]);

  // Sync URL bar when app changes externally
  useEffect(() => {
    setUrlInput(appUrl);
  }, [appUrl]);

  // Set initial position + clamp on resize
  useEffect(() => {
    const update = () => {
      setPosition({
        x: window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN,
        y: window.innerHeight - BUBBLE_SIZE - BUBBLE_MARGIN,
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ── Pointer handlers ──
  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (isOpen) return;
      // Prevent browser defaults: scroll, long-press menu, synthetic mouse events.
      e.preventDefault();
      draggingRef.current = true;
      hasDraggedRef.current = false;
      // Always read the *latest* position from the ref, never from a stale
      // closure capture of `position` state.
      offsetRef.current = {
        x: e.clientX - posRef.current.x,
        y: e.clientY - posRef.current.y,
      };
      startRef.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsDragging(true);
    },
    [isOpen],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (!hasDraggedRef.current && dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      hasDraggedRef.current = true;
      const next: IPosition = {
        x: Math.max(BUBBLE_MARGIN, Math.min(window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN, e.clientX - offsetRef.current.x)),
        y: Math.max(BUBBLE_MARGIN, Math.min(window.innerHeight - BUBBLE_SIZE - BUBBLE_MARGIN, e.clientY - offsetRef.current.y)),
      };
      posRef.current = next;
      setPosition(next);
    },
    [],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      const wasDrag = hasDraggedRef.current;
      draggingRef.current = false;
      hasDraggedRef.current = false;
      setIsDragging(false);
      if (!wasDrag) {
        setIsOpen(true);
      }
    },
    [],
  );

  const handlePointerCancel = useCallback(() => {
    draggingRef.current = false;
    hasDraggedRef.current = false;
    setIsDragging(false);
  }, []);

  const showNav = apps.length > 0 || onGoHome !== undefined;

  return (
    <div className={styles.container}>
      {/* Panel — always mounted so the iframe preserves state */}
      <div className={`${styles.panel} ${isOpen ? "" : styles.panelHidden}`}>
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.title}>OpenCode</span>
          <button
            className={styles.minimizeButton}
            onClick={() => setIsOpen(false)}
            aria-label="Minimize"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M19 13H5v-2h14v2z" />
            </svg>
          </button>
        </div>

        {/* Workspace nav */}
        {showNav && (
          <nav className={styles.nav}>
            {onGoHome !== undefined && (
              <a
                href="/"
                className={`${styles.navItem} ${activeSlug === null ? styles.navActive : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  onGoHome();
                  setIsOpen(false);
                }}
              >
                <span className={styles.navIcon}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                  </svg>
                </span>
                <span>Home</span>
              </a>
            )}
            {apps.map((app) => (
              <a
                key={app.slug}
                href={app.url}
                className={`${styles.navItem} ${app.slug === activeSlug ? styles.navActive : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  onSelectApp?.(app);
                  setIsOpen(false);
                }}
              >
                <span
                  className={`${styles.navDot} ${app.status === "up" ? styles.navDotUp : styles.navDotDown}`}
                />
                <span>{app.slug}</span>
              </a>
            ))}
          </nav>
        )}

        {/* URL bar for app navigation */}
        {onNavigate !== undefined && appUrl !== "" && (
          <form
            className={styles.urlBar}
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = urlInput.trim();
              if (trimmed !== "" && trimmed !== appUrl) {
                onNavigate(trimmed);
              }
              urlInputRef.current?.blur();
            }}
          >
            <svg className={styles.urlBarIcon} viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
            </svg>
            <input
              ref={urlInputRef}
              type="text"
              className={styles.urlBarInput}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onFocus={(e) => e.target.select()}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
            <button type="submit" className={styles.urlBarGo} aria-label="Navigate">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </svg>
            </button>
          </form>
        )}

        {/* OpenCode iframe */}
        <iframe
          src={url}
          className={styles.iframe}
          title="OpenCode"
          allow="clipboard-read; clipboard-write; microphone"
        />
      </div>

      {!isOpen && (
        <button
          className={`${styles.bubble} ${isDragging ? styles.dragging : ""}`}
          style={{
            left: `${String(position.x)}px`,
            top: `${String(position.y)}px`,
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          aria-label="Open assistant"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
          </svg>
        </button>
      )}
    </div>
  );
}
