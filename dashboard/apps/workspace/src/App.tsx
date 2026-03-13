import { PublicAppsLauncher, WORKSPACE_SHELL_CSS } from "@dashboard/dev-bubble/shell";

// Inject shell styles into the page
const style = document.createElement("style");
style.textContent = WORKSPACE_SHELL_CSS;
document.head.appendChild(style);

function App() {
  return <PublicAppsLauncher />;
}

export default App;
