const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const recordsPy = fs.readFileSync(
	path.join(root, "hrms/hr/page/employee_separation_records/employee_separation_records.py"),
	"utf8",
);
const recordsJs = fs.readFileSync(
	path.join(root, "hrms/hr/page/employee_separation_records/employee_separation_records.js"),
	"utf8",
);

for (const marker of [
	'"separation_reason_type"',
	'"separation_reason"',
	'"custom_separation_reason"',
	'"separation_reason_detail"',
	'"separation_reason_display"',
	'"approver_reason_type"',
	'"approver_reason_display"',
	'"approver_reason_detail"',
	'def _separation_reason_display(separation):',
	'def _approver_reason_display(separation):',
	'reason_type == "自定义"',
]) {
	if (!recordsPy.includes(marker)) {
		throw new Error(`离职记录接口缺少原因字段或转换逻辑：${marker}`);
	}
}

for (const marker of [
	'__("员工自述离职原因")',
	'__("审批确认离职原因")',
	'row.separation_reason_display || __("未填写")',
	'row.approver_reason_display || __("未确认")',
	'row.separation_reason_type || __("未填写")',
	'row.separation_reason_detail || __("未填写")',
	'row.approver_reason_type || __("未确认")',
	'row.approver_reason_detail || __("未记录")',
	'this.detail_item(__("员工自述详细原因"), reason_detail)',
	'this.detail_item(__("审批确认详细原因"), approver_reason_detail)',
	'frappe.route_options = { hrms_from: "employee-separation-records" }',
]) {
	if (!recordsJs.includes(marker)) {
		throw new Error(`离职记录页面缺少原因展示：${marker}`);
	}
}

console.log("Employee separation record reason checks passed.");
