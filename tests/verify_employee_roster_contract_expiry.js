const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const list = fs.readFileSync(path.join(root, "hrms/public/js/erpnext/employee_list.js"), "utf8");
const css = fs.readFileSync(path.join(root, "hrms/public/css/hrms_top_nav.css"), "utf8");
const api = fs.readFileSync(path.join(root, "hrms/api/employee_field_template.py"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms/hooks.py"), "utf8");

function mustInclude(source, marker, message) {
	assert(source.includes(marker), message || `Missing marker: ${marker}`);
}

function extractFunction(source, name) {
	const start = source.indexOf(`function ${name}`);
	assert(start >= 0, `Missing function: ${name}`);
	const bodyStart = source.indexOf("{", start);
	let depth = 0;
	for (let index = bodyStart; index < source.length; index += 1) {
		if (source[index] === "{") depth += 1;
		if (source[index] === "}") depth -= 1;
		if (depth === 0) return source.slice(start, index + 1);
	}
	throw new Error(`Unclosed function: ${name}`);
}

mustInclude(list, '{ fieldname: "contract_end_date", label: "合同到期日" }', "花名册首页必须显示合同到期日列。");
mustInclude(list, '"contract_end_date",', "花名册请求必须包含合同到期日。");
mustInclude(list, 'cell.classList.add("hrms-roster-contract-expiry-warning")', "两个月内到期的合同必须应用红色提醒。");
mustInclude(css, ".hrms-roster-contract-expiry-warning", "花名册缺少合同到期红色样式。");
mustInclude(api, '"contract_end_date",', "花名册接口必须取回合同到期日。");
mustInclude(hooks, "hrms_top_nav.css?v=20260915-contract-expiry-probation-buckets-v1", "花名册样式必须更新静态资源版本。");

const context = {};
vm.createContext(context);
vm.runInContext(
	`${extractFunction(list, "get_roster_date_only")}\n${extractFunction(list, "is_roster_contract_expiry_warning")}`,
	context,
);

const today = "2026-09-15";
assert.strictEqual(context.is_roster_contract_expiry_warning("2026-11-15", today), true, "两个月边界当天应该提醒。");
assert.strictEqual(context.is_roster_contract_expiry_warning("2026-11-16", today), false, "超过两个月不应提前标红。");
assert.strictEqual(context.is_roster_contract_expiry_warning("2026-09-14", today), true, "已到期合同应继续保持红色。");
assert.strictEqual(context.is_roster_contract_expiry_warning("", today), false, "空日期不应标红。");
assert.strictEqual(context.is_roster_contract_expiry_warning("2026-02-30", today), false, "无效日期不应标红。");
assert.strictEqual(
	context.is_roster_contract_expiry_warning("2026-03-31", "2026-01-31"),
	true,
	"两个月应按日历月计算。",
);

console.log("employee roster contract expiry warning verified");
