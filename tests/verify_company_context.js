const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const topNavPath = path.join(root, "hrms", "public", "js", "hrms_top_nav.js");
const orgChartPath = path.join(root, "hrms", "hr", "page", "organizational_chart", "organizational_chart.js");
const hooksPath = path.join(root, "hrms", "hooks.py");

function read(file) {
	if (!fs.existsSync(file)) throw new Error(`Missing file: ${path.relative(root, file)}`);
	return fs.readFileSync(file, "utf8");
}

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

const topNav = read(topNavPath);
const orgChart = read(orgChartPath);
const hooks = read(hooksPath);

for (const marker of [
	'const PREFERRED_COMPANY = "永新"',
	"const SINGLE_COMPANY_OPERATION_MODE = true",
	"SINGLE_COMPANY_OPERATION_MODE ? (primary ? [primary] : []) : companies",
	'return companies[0]?.name || ""',
	"hrms_company_context",
	"localStorage",
	"get_user_default?.(\"company\")",
	'frappe.db.get_list("Company"',
	"hrms:company-context-changed",
	"window.hrmsCompanyContext",
	"getCurrentCompany",
	"setCurrentCompany",
	"renderCompanyContext",
	"hrms-top-company-context",
	"Company",
]) {
	mustInclude(topNav, marker, `Global company context is missing: ${marker}`);
}

if (!topNav.includes("!SINGLE_COMPANY_OPERATION_MODE && companies.length && canManageCompanyIdentity()")) {
	throw new Error("Company management entry must stay hidden while Yongxin single-company mode is active.");
}

mustInclude(hooks, "hrms_top_nav.js?v=20260811a", "Top-nav cache key must change with the single-company contract.");

for (const marker of [
	"hrmsCompanyContext",
	"getCurrentCompany",
	"hrms:company-context-changed",
	"set_company(detail.company, { publish: false })",
]) {
	mustInclude(orgChart, marker, `Organization chart must consume global company context: ${marker}`);
}

mustInclude(hooks, "hrms_top_nav.js", "Desk must include the global company context script.");

for (const [source, label] of [
	[topNav, "top navigation"],
	[orgChart, "organization chart"],
]) {
	if (source.includes("TEST-HRMS")) {
		throw new Error(`${label} must not use TEST-HRMS as a company-context default.`);
	}
}

console.log("Global company context defaults, persistence, selector, and organization synchronization are wired.");
