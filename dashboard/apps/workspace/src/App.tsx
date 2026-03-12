import { WorkspaceShell, WORKSPACE_SHELL_CSS } from "@dashboard/dev-bubble/shell";

// Inject shell styles into the page
const style = document.createElement("style");
style.textContent = WORKSPACE_SHELL_CSS;
document.head.appendChild(style);

// Extract base domain (e.g. "judigot.com" from "www.judigot.com")
const getBaseDomain = (hostname: string): string => {
  const parts = hostname.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : hostname;
};

const OPENCODE_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:4097"
    : `https://dev.${getBaseDomain(window.location.hostname)}/`;

function App() {
  return (
    <WorkspaceShell
      opencodeUrl={OPENCODE_URL}
      className="ws-shell-fullpage"
    />
  );
}

export default App;
