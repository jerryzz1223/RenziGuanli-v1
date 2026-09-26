const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "hrms/public/js/hrms_home_redirect_v6.js"), "utf8");
const css = fs.readFileSync(path.join(root, "hrms/public/css/hrms_top_nav.css"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms/hooks.py"), "utf8");

function includes(source, marker, message) {
	if (!source.includes(marker)) throw new Error(`${message}: ${marker}`);
}

for (const marker of [
	"function remove_native_list_chrome()",
	'route[0] === "List"',
	'page.querySelectorAll(NATIVE_LIST_CHROME_SELECTOR)',
	'window.hrmsRemoveNativeListChrome = remove_native_list_chrome',
	'run_hrms_shell_step("removing native list controls", remove_native_list_chrome)',
]) {
	includes(shell, marker, "Shared shell must remove Frappe list chrome on every HRMS native list");
}

for (const marker of [
	'".page-head .view-switcher"',
	'".page-head .page-icon-group"',
	'".page-head .menu-btn-group"',
	'".filter-section .filter-selector"',
	'".filter-section .sort-selector"',
]) {
	includes(shell, marker, "Native list control selector is missing");
}

for (const marker of [
	"function render_parent_return_action(module, route, slug, page)",
	'button.textContent = "← " + __("返回上级")',
	"navigate_hrms_sidebar(target.route",
	"parent_return_target(module, route, slug)",
]) {
	includes(shell, marker, "Every HRMS child page must expose a parent return action");
}

includes(css, "body.hrms-native-list-chrome-clean", "CSS must prevent native controls flashing before removal");
includes(css, ".hrms-parent-return-action", "Parent return action must have stable styling");
includes(hooks, "hrms_home_redirect_v6.js?v=20260926-native-list-chrome-v1", "Shared shell cache key must change");
includes(hooks, "hrms_top_nav.css?v=20260926-native-list-chrome-v1", "Shared shell CSS cache key must change");

console.log("PASS: HRMS native lists remove duplicate Frappe chrome and child pages provide a parent return action.");
