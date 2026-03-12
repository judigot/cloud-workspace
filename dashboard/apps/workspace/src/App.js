"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var shell_1 = require("@dashboard/dev-bubble/shell");
// Inject shell styles into the page
var style = document.createElement("style");
style.textContent = shell_1.WORKSPACE_SHELL_CSS;
document.head.appendChild(style);
// Extract base domain (e.g. "judigot.com" from "www.judigot.com")
var getBaseDomain = function (hostname) {
    var parts = hostname.split(".");
    return parts.length > 2 ? parts.slice(-2).join(".") : hostname;
};
var OPENCODE_URL = window.location.hostname === "localhost"
    ? "http://localhost:4097"
    : "https://dev.".concat(getBaseDomain(window.location.hostname), "/");
function App() {
    return (<shell_1.WorkspaceShell opencodeUrl={OPENCODE_URL} className="ws-shell-fullpage"/>);
}
exports.default = App;
