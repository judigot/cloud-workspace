import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ChangeEvent,
  type FC,
  type ReactNode,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

export interface IApp {
  slug: string;
  url: string;
  status: "up" | "down" | "unknown";
  iconUrl: string | null;
  fallbackLabel: string;
  fallbackHue: number;
}

export interface IConfig {
  domain: string;
  opencodeDomain: string;
  apps: IApp[];
}

export interface IUploadAsset {
  name: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  serverPath: string;
  url: string;
}

type WorkspaceMode = "assistant" | "terminal" | "apps" | "files";

export interface WorkspaceShellProps {
  opencodeUrl: string;
  header?: ReactNode;
  className?: string;
  mode?: WorkspaceMode;
  terminalWsPath?: string;
}

type TerminalShortcut = {
  label: string;
  value: string;
  kind?: "ctrl";
};

const CUSTOM_TERMINAL_KEYS: TerminalShortcut[] = [
  { label: "Esc", value: "\u001b" },
  { label: "Tab", value: "\t" },
  { label: "Ctrl", value: "", kind: "ctrl" },
  { label: "/", value: "/" },
];

// Feature toggle: keep custom terminal UX code, but ship defaults for stability.
const useDefault = true;

export function useApps() {
  const [config, setConfig] = useState<IConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchApps = useCallback(async () => {
    try {
      const res = await fetch("/api/apps");
      if (!res.ok) return;
      const data = (await res.json()) as IConfig;
      setConfig(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchApps();
    const id = setInterval(() => void fetchApps(), 10_000);
    return () => clearInterval(id);
  }, [fetchApps]);

  return { config, loading };
}

function formatSize(size: number) {
  if (size < 1024) return `${String(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(asset: IUploadAsset) {
  return asset.mimeType.startsWith("image/");
}

function toAbsoluteUrl(url: string) {
  return new URL(url, window.location.origin).toString();
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

const AppTileIcon: FC<{ app: IApp }> = ({ app }) => {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(app.iconUrl) && !failed;

  if (showImage) {
    return (
      <div className="ws-app-icon ws-app-icon-image-wrap">
        <img
          className="ws-app-icon-image"
          src={app.iconUrl ?? undefined}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <div
      className="ws-app-icon ws-app-icon-fallback"
      aria-hidden="true"
      style={{
        background: `linear-gradient(135deg, hsl(${app.fallbackHue} 72% 58%), hsl(${(app.fallbackHue + 28) % 360} 70% 42%))`,
      }}
    >
      {app.fallbackLabel}
    </div>
  );
};

export function useUploads() {
  const [assets, setAssets] = useState<IUploadAsset[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUploads = useCallback(async () => {
    try {
      const res = await fetch("/api/uploads");
      if (!res.ok) return;
      const data = (await res.json()) as { assets: IUploadAsset[] };
      setAssets(data.assets || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUploads();
  }, [fetchUploads]);

  return { assets, setAssets, loading, refreshUploads: fetchUploads };
}

const TerminalSurface: FC<{ terminalWsPath: string; active: boolean }> = ({
  terminalWsPath,
  active,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [cwdLabel, setCwdLabel] = useState("~");
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const ctrlArmedRef = useRef(false);
  const keys = CUSTOM_TERMINAL_KEYS;

  useEffect(() => {
    ctrlArmedRef.current = ctrlArmed;
  }, [ctrlArmed]);

  const encodeCtrl = useCallback((input: string): string => {
    if (!input) return input;
    const char = input[0];
    const code = char.charCodeAt(0);
    if (code >= 97 && code <= 122) {
      return String.fromCharCode(code - 96);
    }
    if (code >= 65 && code <= 90) {
      return String.fromCharCode(code - 64);
    }
    return input;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isMobile = window.matchMedia("(max-width: 768px)").matches;

    const term = useDefault
      ? new Terminal()
      : new Terminal({
          cursorBlink: true,
          cursorStyle: "block",
          convertEol: true,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: isMobile ? 12 : 14,
          lineHeight: isMobile ? 1.2 : 1.3,
          letterSpacing: 0,
          scrollback: 10_000,
          theme: {
            background: "#0b0d12",
            foreground: "#e8ecf4",
            cursor: "#7dd3fc",
            cursorAccent: "#0b0d12",
            black: "#1e2430",
            brightBlack: "#4b5563",
          },
        });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitRef.current = fitAddon;
    term.open(container);
    fitAddon.fit();
    term.focus();
    termRef.current = term;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}${terminalWsPath}`);
    wsRef.current = ws;

    const sendResize = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }),
      );
    };

    ws.addEventListener("open", () => {
      sendResize();
      term.focus();
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as
          | { type: "output"; data: string }
          | { type: "exit"; code: number }
          | { type: "cwd"; path: string }
          | { type: "pong" };
        if (parsed.type === "output") {
          term.write(parsed.data);
          return;
        }
        if (parsed.type === "cwd") {
          setCwdLabel(parsed.path || "~");
          return;
        }
        if (parsed.type === "exit") {
          term.writeln(`\r\n\x1b[31mTerminal exited (${String(parsed.code)})\x1b[0m`);
          return;
        }
      } catch {
        term.write(event.data);
      }
    });

    ws.addEventListener("close", () => {
      // Keep UI quiet; reconnect state is reflected by socket availability.
    });

    const dataDisposable = term.onData((data) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const armed = ctrlArmedRef.current;
      const payload = armed ? encodeCtrl(data) : data;
      ws.send(JSON.stringify({ type: "input", data: payload }));
      if (armed) {
        ctrlArmedRef.current = false;
        setCtrlArmed(false);
      }
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      sendResize();
    });
    observer.observe(container);

    const viewport = window.visualViewport;
    const onViewportResize = () => {
      fitAddon.fit();
      sendResize();
    };
    viewport?.addEventListener("resize", onViewportResize);

    // If any fonts finish loading later, re-fit once to keep cursor alignment correct.
    // (Best practice from xterm docs when fonts can change metrics.)
    void document.fonts?.ready.then(() => {
      fitAddon.fit();
      sendResize();
    });

    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", onViewportResize);
      resizeDisposable.dispose();
      dataDisposable.dispose();
      try {
        ws.close();
      } catch {
        // no-op
      }
      term.dispose();
      wsRef.current = null;
      termRef.current = null;
      fitRef.current = null;
    };
  }, [terminalWsPath, encodeCtrl]);

  useEffect(() => {
    if (!active) return;
    fitRef.current?.fit();
    termRef.current?.focus();
    const ws = wsRef.current;
    const term = termRef.current;
    if (ws && term && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }),
      );
    }
  }, [active]);

  const sendShortcut = useCallback((shortcut: TerminalShortcut) => {
    const ws = wsRef.current;
    const term = termRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (shortcut.kind === "ctrl") {
      ctrlArmedRef.current = true;
      setCtrlArmed(true);
      term?.focus();
      return;
    }
    const armed = ctrlArmedRef.current;
    const payload = armed ? encodeCtrl(shortcut.value) : shortcut.value;
    ws.send(JSON.stringify({ type: "input", data: payload }));
    if (armed) {
      ctrlArmedRef.current = false;
      setCtrlArmed(false);
    }
    term?.focus();
  }, [encodeCtrl]);

  return (
    <div className={`ws-terminal-root${useDefault ? " ws-terminal-default" : " ws-terminal-custom"}`}>
      <div className="ws-terminal-keys" aria-label="Terminal shortcuts">
        {keys.map((shortcut) => (
          <button
            key={shortcut.label}
            type="button"
            className={`ws-terminal-key${
              shortcut.kind === "ctrl"
                  ? " ws-terminal-key-meta"
                  : ""
            }${shortcut.kind === "ctrl" && ctrlArmed ? " ws-terminal-key-active" : ""}`}
            onClick={() => sendShortcut(shortcut)}
          >
            {shortcut.label}
          </button>
        ))}
      </div>
      <div className="ws-terminal-title" aria-live="polite">
        {cwdLabel}
      </div>
      <div className="ws-terminal-stage" ref={containerRef} />
    </div>
  );
};

export const WorkspaceShell: FC<WorkspaceShellProps> = ({
  opencodeUrl,
  header,
  className,
  mode = "assistant",
  terminalWsPath = "/api/terminal/ws",
}) => {
  const { config } = useApps();
  const { assets, setAssets } = useUploads();
  const currentSlug =
    window.location.pathname.split("/").filter(Boolean)[0] ?? "";
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    setUploading(true);

    try {
      const res = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });
      const payload = await res.json().catch(() => ({})) as {
        error?: string;
        assets?: IUploadAsset[];
      };
      if (!res.ok) {
        throw new Error(payload.error || "Upload failed.");
      }

      const nextAssets = [...(payload.assets || []), ...assets].sort(
        (a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt),
      );
      setAssets(nextAssets);
    } catch {
      // ignore upload errors in compact shell for now
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }, [assets, setAssets]);

  return (
    <div className={`ws-shell${className ? ` ${className}` : ""}`}>
      {header}

      <div className="ws-content">

        {/* Assistant panel */}
        <div
          className={`ws-pane ws-pane-assistant${mode === "assistant" ? " ws-pane-active" : " ws-pane-hidden"}`}
        >
          <iframe
            className="ws-iframe"
            src={opencodeUrl}
            title="OpenCode"
            allow="clipboard-read; clipboard-write; microphone"
          />
        </div>

        {/* Terminal panel */}
        <div
          className={`ws-pane ws-pane-terminal${mode === "terminal" ? " ws-pane-active" : " ws-pane-hidden"}`}
        >
          <TerminalSurface terminalWsPath={terminalWsPath} active={mode === "terminal"} />
        </div>

        {/* Apps panel */}
        <div
          className={`ws-pane ws-pane-apps${mode === "apps" ? " ws-pane-active" : " ws-pane-hidden"}`}
        >
          <div className="ws-apps-panel">
            <div className="ws-apps-grid">
              {config?.apps.map((app) => (
                <a
                  key={app.slug}
                  href={app.url}
                  className={`ws-app-card${app.slug === currentSlug ? " ws-app-card-active" : ""}`}
                >
                  <AppTileIcon app={app} />
                  <div className="ws-app-name">{app.slug}</div>
                  <div className={`ws-app-dot ws-app-dot-${app.status}`} />
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Files panel */}
        <div
          className={`ws-pane ws-pane-files${mode === "files" ? " ws-pane-active" : " ws-pane-hidden"}`}
        >
          <div className="ws-files-mini">
            <input
              ref={uploadInputRef}
              className="ws-upload-input"
              type="file"
              accept="image/*,.pdf,.txt,.md,.json"
              multiple
              onChange={handleUpload}
            />
            <div className="ws-files-header">
              <span>Files</span>
              <button className="ws-files-upload-btn" onClick={() => uploadInputRef.current?.click()}>
                {uploading ? "Uploading..." : "Upload"}
              </button>
            </div>
            <div className="ws-files-list">
              {assets.length === 0 ? (
                <div className="ws-files-empty">No files yet</div>
              ) : (
                assets.map((asset) => (
                  <div key={asset.name} className="ws-file-mini-item">
                    {isImage(asset) ? (
                      <img src={asset.url} alt={asset.name} className="ws-file-mini-thumb" />
                    ) : (
                      <div className="ws-file-mini-icon">{asset.name.split(".").pop()}</div>
                    )}
                    <span className="ws-file-mini-name">{asset.name}</span>
                    <button className="ws-file-mini-copy" onClick={() => navigator.clipboard.writeText(asset.name)}>Copy</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const WORKSPACE_SHELL_CSS = `
  .ws-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0f1115;
    font-family: system-ui, -apple-system, sans-serif;
    color: #f5f7ff;
  }
  .ws-shell-fullpage {
    height: 100vh;
    height: 100dvh;
  }

  .ws-iframe {
    height: 100%;
    width: 100%;
    border: none;
    background: #0f0f1a;
  }

  .ws-content {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .ws-files-panel {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: 12px;
    border-radius: 0;
    background: linear-gradient(180deg, #171f30 0%, #101722 100%);
    border-top: 1px solid rgba(255,255,255,0.08);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
    z-index: 5;
  }
  .ws-files-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .ws-files-panel-body {
    display: grid;
    gap: 8px;
    overflow-y: auto;
    min-height: 0;
    padding-right: 2px;
    align-content: start;
  }
  .ws-upload-heading {
    min-width: 0;
  }
  .ws-upload-label {
    display: block;
    color: rgba(255,255,255,0.68);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .ws-upload-copy {
    margin: 2px 0 0;
    color: #8f9bb8;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ws-upload-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .ws-upload-input {
    display: none;
  }
  .ws-upload-button,
  .ws-upload-chip {
    border: 1px solid rgba(255,255,255,0.12);
    background: linear-gradient(135deg, rgba(102,126,234,0.18), rgba(118,75,162,0.14));
    color: #f5f7ff;
    border-radius: 999px;
    min-height: 32px;
    padding: 0 12px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }
  .ws-upload-message {
    margin-bottom: 8px;
    color: #bcc8ec;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ws-upload-empty {
    color: #8891a8;
    font-size: 11px;
    padding: 6px 0;
  }
  .ws-upload-card {
    min-width: 0;
    max-width: none;
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) auto;
    grid-template-areas:
      "preview meta actions";
    column-gap: 12px;
    row-gap: 6px;
    align-items: center;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(255,255,255,0.035);
    border: 1px solid rgba(255,255,255,0.07);
    flex-shrink: 0;
  }
  .ws-upload-preview,
  .ws-upload-file {
    grid-area: preview;
    width: 64px;
    height: 64px;
    border-radius: 10px;
    background: rgba(255,255,255,0.06);
  }
  .ws-upload-preview {
    object-fit: cover;
    display: block;
  }
  .ws-upload-file {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #eef2ff;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.04em;
  }
  .ws-upload-meta {
    grid-area: meta;
    display: grid;
    gap: 3px;
    min-width: 0;
    align-content: start;
  }
  .ws-upload-meta strong,
  .ws-upload-meta span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ws-upload-meta strong {
    font-size: 11px;
    color: #f5f7ff;
  }
  .ws-upload-submeta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }
  .ws-upload-meta span {
    font-size: 10px;
    color: #98a4bf;
  }
  .ws-upload-card-actions {
    grid-area: actions;
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .ws-upload-chip {
    min-height: 26px;
    padding: 0 9px;
    font-size: 10px;
    flex: 0 0 auto;
  }
  .ws-pane {
    position: absolute;
    inset: 0;
    min-height: 0;
  }
  .ws-pane-active {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
  }
  .ws-pane-hidden {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
  }

  /* Apps panel */
  .ws-pane-apps {
    background: #0f1115;
  }
  .ws-apps-panel {
    height: 100%;
    padding: 12px;
    overflow-y: auto;
  }
  .ws-apps-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }
  .ws-app-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px 12px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    text-decoration: none;
    transition: background 0.15s, border-color 0.15s;
  }
  .ws-app-card:active {
    background: rgba(255,255,255,0.08);
  }
  .ws-app-card-active {
    border-color: rgba(59, 130, 246, 0.5);
    background: rgba(59, 130, 246, 0.1);
  }
  .ws-app-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 700;
    color: white;
    margin-bottom: 8px;
  }
  .ws-app-icon-image-wrap {
    background: rgba(255,255,255,0.08);
    overflow: hidden;
    padding: 8px;
  }
  .ws-app-icon-fallback {
    color: white;
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.04em;
  }
  .ws-app-icon-image {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    border-radius: 8px;
  }
  .ws-app-name {
    font-size: 12px;
    font-weight: 600;
    color: #e2e8f0;
    text-align: center;
    word-break: break-all;
  }
  .ws-app-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: 6px;
  }
  .ws-app-dot-up {
    background: #22c55e;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
  }
  .ws-app-dot-down, .ws-app-dot-unknown {
    background: #64748b;
  }

  /* Files panel (mini) */
  .ws-pane-files {
    background: #0f1115;
  }
  .ws-files-mini {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 12px;
  }
  .ws-files-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    margin-bottom: 10px;
  }
  .ws-files-header span {
    font-size: 14px;
    font-weight: 700;
    color: #e2e8f0;
  }
  .ws-files-upload-btn {
    border: 1px solid rgba(255,255,255,0.12);
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(217, 119, 6, 0.2));
    color: #fbbf24;
    border-radius: 999px;
    min-height: 32px;
    padding: 0 12px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }
  .ws-files-list {
    flex: 1;
    overflow-y: auto;
  }
  .ws-files-empty {
    color: #64748b;
    font-size: 12px;
    text-align: center;
    padding: 20px;
  }
  .ws-file-mini-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 10px;
    background: rgba(255,255,255,0.03);
    margin-bottom: 6px;
  }
  .ws-file-mini-thumb {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    object-fit: cover;
  }
  .ws-file-mini-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: rgba(255,255,255,0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: #94a3b8;
  }
  .ws-file-mini-name {
    flex: 1;
    font-size: 11px;
    color: #e2e8f0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ws-file-mini-copy {
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
    color: #94a3b8;
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
  }

  .ws-terminal-root {
    height: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, #101722 0%, #0a0f17 22%, #07090d 100%);
  }
  .ws-terminal-default {
    background: #0b0d12;
  }
  .ws-terminal-stage {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 0;
    overflow: hidden;
  }
  .ws-terminal-stage .xterm {
    height: 100%;
  }
  .ws-terminal-keys {
    display: flex;
    align-items: center;
    gap: 7px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 9px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    background: linear-gradient(180deg, rgba(20,28,40,0.96), rgba(13,19,28,0.94));
    backdrop-filter: blur(10px);
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    flex-shrink: 0;
  }
  .ws-terminal-keys::-webkit-scrollbar { display: none; }
  .ws-terminal-title {
    flex-shrink: 0;
    text-align: center;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: rgba(220, 232, 248, 0.9);
    padding: 7px 10px 6px;
    background: linear-gradient(180deg, rgba(17, 25, 37, 0.95), rgba(12, 17, 25, 0.92));
    border-bottom: 1px solid rgba(255,255,255,0.08);
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.35);
  }
  .ws-terminal-key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    border: 1px solid rgba(255,255,255,0.18);
    background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.05));
    color: #e6edf8;
    border-radius: 11px;
    padding: 0 10px;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.01em;
    line-height: 1;
    white-space: nowrap;
    height: 34px;
    min-width: 58px;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22);
    transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
  }
  .ws-terminal-key:active {
    background: linear-gradient(180deg, rgba(125, 211, 252, 0.24), rgba(125, 211, 252, 0.12));
    border-color: rgba(125, 211, 252, 0.46);
    transform: translateY(1px);
  }
  .ws-terminal-key-meta {
    border-color: rgba(129, 140, 248, 0.36);
    color: #dbe4ff;
    min-width: 78px;
  }
  .ws-terminal-key-active {
    border-color: rgba(125, 211, 252, 0.7);
    background: linear-gradient(180deg, rgba(125, 211, 252, 0.36), rgba(125, 211, 252, 0.18));
    color: #f0fbff;
  }

  @media (max-width: 480px) {
    .ws-files-panel {
      padding: 10px;
    }
    .ws-files-panel-head {
      align-items: flex-start;
      flex-direction: column;
    }
    .ws-upload-actions {
      width: 100%;
    }
    .ws-upload-button {
      min-width: 0;
      width: 100%;
    }
    .ws-upload-copy {
      display: none;
    }
    .ws-upload-card {
      grid-template-columns: 48px minmax(0, 1fr);
      grid-template-areas:
        "preview meta"
        "actions actions";
      row-gap: 8px;
      padding: 10px;
    }
    .ws-upload-preview,
    .ws-upload-file {
      width: 48px;
      height: 48px;
    }
    .ws-upload-card-actions {
      justify-content: stretch;
    }
    .ws-upload-chip {
      flex: 1;
    }
    .ws-terminal-key {
      font-size: 10.5px;
      height: 32px;
      min-width: 54px;
      padding: 0 9px;
    }
    .ws-terminal-key-meta {
      min-width: 72px;
    }
  }

  /* xterm.js defaults (kept raw for stability) */
  .xterm {
    cursor: text;
    position: relative;
    user-select: none;
    -ms-user-select: none;
    -webkit-user-select: none;
  }
  .xterm.focus,
  .xterm:focus {
    outline: none;
  }
  .xterm .xterm-helpers {
    position: absolute;
    top: 0;
    z-index: 5;
  }
  .xterm .xterm-helper-textarea {
    padding: 0;
    border: 0;
    margin: 0;
    position: absolute;
    opacity: 0;
    left: -9999em;
    top: 0;
    width: 0;
    height: 0;
    z-index: -5;
    white-space: nowrap;
    overflow: hidden;
    resize: none;
  }
  .xterm .composition-view {
    background: #000;
    color: #fff;
    display: none;
    position: absolute;
    white-space: nowrap;
    z-index: 1;
  }
  .xterm .composition-view.active {
    display: block;
  }
  .xterm .xterm-viewport {
    background-color: #000;
    overflow-y: scroll;
    cursor: default;
    position: absolute;
    right: 0;
    left: 0;
    top: 0;
    bottom: 0;
  }
  .xterm .xterm-screen {
    position: relative;
  }
  .xterm .xterm-screen canvas {
    position: absolute;
    left: 0;
    top: 0;
  }
  .xterm-char-measure-element {
    display: inline-block;
    visibility: hidden;
    position: absolute;
    top: 0;
    left: -9999em;
    line-height: normal;
  }
  .xterm .xterm-accessibility:not(.debug),
  .xterm .xterm-message {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    right: 0;
    z-index: 10;
    color: transparent;
    pointer-events: none;
  }
  .xterm .xterm-accessibility-tree:not(.debug) *::selection {
    color: transparent;
  }
  .xterm .xterm-accessibility-tree {
    font-family: monospace;
    user-select: text;
    white-space: pre;
  }
  .xterm .xterm-accessibility-tree > div {
    transform-origin: left;
    width: fit-content;
  }
  .xterm .live-region {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
  .xterm.enable-mouse-events {
    cursor: default;
  }
  .xterm.xterm-cursor-pointer,
  .xterm .xterm-cursor-pointer {
    cursor: pointer;
  }
  .xterm.column-select.focus {
    cursor: crosshair;
  }
`;
