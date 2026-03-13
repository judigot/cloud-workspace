"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var shell_1 = require("@dashboard/dev-bubble/shell");
// Inject shell styles into the page
var style = document.createElement("style");
style.textContent = shell_1.WORKSPACE_SHELL_CSS;
document.head.appendChild(style);
function App() {
    return <shell_1.PublicAppsLauncher />;
}
exports.default = App;
