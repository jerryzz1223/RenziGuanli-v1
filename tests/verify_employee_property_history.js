const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pagePath = path.join(
	root,
	"hrms",
	"hr",
	"page",
	"employee_property_history",
	"employee_property_history.js",
);

function read(file) {
	if (!fs.existsSync(file)) {
		throw new Error(`Missing file: ${path.relative(root, file)}`);
	}
	return fs.readFileSync(file, "utf8");
}

function assertIncludes(source, marker, message) {
	if (!source.includes(marker)) {
		throw new Error(message || `Missing marker: ${marker}`);
	}
}

const source = read(pagePath);
const apiPath = path.join(root, "hrms", "api", "employee_field_template.py");
const apiSource = read(apiPath);

for (const marker of [
	'frappe.pages["employee-property-history"]',
	"办理人事异动",
	"办理转正",
	"打开人事异动列表",
	"get_employee_property_history",
	"任职记录来自人事异动和转正/晋升单据中的 Employee Property History 变更明细",
	"查看来源单据",
	"暂无任职记录。请通过人事异动或转正单据生成任职变化。",
	"正在读取任职记录...",
	"@media (max-width: 768px)",
]) {
	assertIncludes(source, marker, `Employee property history page missing marker: ${marker}`);
}

assertIncludes(
	source,
	"row.source_doctype && row.source_name",
	"Source document button should only render when both source_doctype and source_name are present.",
);

assertIncludes(
	source,
	"来源单据缺失",
	"Page should show a non-clickable fallback when a history row lacks source document metadata.",
);

assertIncludes(
	source,
	'status.textContent = __("暂无记录")',
	"Empty pagination state should show a clear no-records label instead of 0-0 counters.",
);

assertIncludes(
	apiSource,
	"def get_employee_property_history(employee: str | None = None, department: str | None = None, company: str | None = None, search: str | None = None, limit_start: int = 0, limit_page_length: int = 50):",
	"Whitelisted property-history API parameters must be typed for Frappe RPC validation.",
);

console.log("employee property history contract passed");
