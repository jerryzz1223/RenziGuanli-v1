const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms/api/payroll_input.py"), "utf8");
const sourceType = JSON.parse(fs.readFileSync(path.join(root, "hrms/hr/doctype/hrms_payroll_variable_source_type/hrms_payroll_variable_source_type.json"), "utf8"));
const targetArea = sourceType.fields.find((field) => field.fieldname === "target_area");

if (targetArea.options.includes("考勤继承")) {
	throw new Error("考勤继承是系统展示状态，不能作为可维护来源的数据库选项。");
}

const catalog = api.slice(api.indexOf("def list_payroll_variable_source_types"), api.indexOf("def _attendance_scope_filters"));
for (const marker of [
	"system_sources",
	"editable_defaults",
	'item["source_code"] != "attendance_final"',
	'"attendance_final", "salary_change", "attendance_bonus"',
	"return system_sources + rows",
]) {
	if (!catalog.includes(marker)) throw new Error(`Missing source catalog safeguard: ${marker}`);
}

console.log("Payroll variable source catalog contract passed.");
