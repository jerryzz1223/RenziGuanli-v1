const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const navigation = fs.readFileSync(path.join(root, "hrms", "public", "js", "hrms_home_redirect_v6.js"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms", "hooks.py"), "utf8");

for (const marker of [
	"function find_sidebar_item(module, route_slug)",
	"[item_slug, route_to_slug(item.route)]",
	"var match_score = -1;",
	"route_slug === slug ? 10000 : 0",
	'Object.assign({ current: true }, item)',
	"function separation_breadcrumb_parent(route)",
	"function current_breadcrumb_label(route, parent, label_override)",
	"function apply_contextual_breadcrumbs(label_override)",
	'{ label: "主页", route: "/desk/hrms-workbench", slug: "hrms-workbench" }',
	'if (module.label !== "主页")',
	'"employee-detail": { label: "员工花名册", route: "/desk/employee", slug: "employee" }',
	'{ label: "离职记录", route: "/desk/employee-separation-records", slug: "employee-separation-records" }',
	'form?.doc?.docstatus === 1 && form?.doc?.boarding_status === "Completed"',
	'document.body.classList.remove("hrms-hide-breadcrumbs")',
	"window.hrmsApplyContextualBreadcrumbs = apply_contextual_breadcrumbs;",
	"function schedule_contextual_breadcrumbs()",
	"[180, 700]",
	"schedule_contextual_breadcrumbs();",
	"apply_contextual_breadcrumbs();",
]) {
	assert.ok(navigation.includes(marker), `全局层级导航缺少契约: ${marker}`);
}

assert.ok(
	hooks.includes("/assets/hrms/js/hrms_home_redirect_v6.js?v=20260912-context-breadcrumbs-v4"),
	"导航脚本变更后必须刷新静态资源版本。",
);

console.log("Contextual breadcrumbs follow home, module, feature, and record hierarchy.");
