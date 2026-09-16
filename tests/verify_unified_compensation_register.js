const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const page = fs.readFileSync("hrms/hr/page/payroll_input_center/payroll_input_center.js", "utf8");
const sidebar = fs.readFileSync("hrms/public/js/hrms_home_redirect_v6.js", "utf8");

assert.match(sidebar, /type: "section", label: "薪资与社保公积金"/);
assert.equal((sidebar.match(/type: "section", label: "社保公积金"/g) || []).length, 0);
for (const label of ["社保公积金输入", "薪资与社保查看", "申请修改", "审批", "修改记录"]) {
	assert.match(sidebar, new RegExp(`label: "${label}"`));
}

for (const legacyRoute of ["contribution-view", "contribution-changes", "contribution-approvals", "contribution-history"]) {
	assert.match(page, new RegExp(`tab === "${legacyRoute}"`));
}
assert.match(page, /async load_compensation_register\(\)/);
assert.match(page, /点击员工行内的修改按钮，再选择本次要修改的内容/);
assert.match(page, /hrms-compensation-register-table/);
assert.match(page, /data-table-page-size="15"/);
const register = page.slice(page.indexOf("async load_compensation_register()"), page.indexOf("async load_salary_register()"));
assert.match(register, /\["姓名", "工号", "部门", "工作性质"/);
assert.doesNotMatch(register, /姓名 \/ 工号/);
assert.match(register, /<\/button><\/td><td>\$\{esc\(row\.employee_code \|\| row\.employee\)\}<\/td>/);
for (const label of ["社保个人承担", "社保公司承担", "公积金个人承担", "公积金公司承担"]) {
	assert.match(register, new RegExp(`"${label}"`));
}
assert.doesNotMatch(register, /社保：个人 \/ 公司|公积金：个人 \/ 公司/);
assert.match(register, /contribution_amount_cell\(social, "personal_amount"\)/);
assert.match(register, /contribution_amount_cell\(social, "company_amount"\)/);
assert.match(register, /contribution_amount_cell\(fund, "personal_amount"\)/);
assert.match(register, /contribution_amount_cell\(fund, "company_amount"\)/);
assert.match(register, /data-sort-value="\$\{sortValue\}"/);
assert.match(page, /dataset\.sortValue \?\? leftCell\?\.innerText\.trim\(\)/);
assert.match(register, /colspan="14">暂无档案/);
assert.doesNotMatch(page, /姓名 \/ 工号|员工 \/ 工号|工号\/姓名/);
assert.match(page, /最后修改人/);
assert.match(page, /latest_actions/);
assert.match(page, /查看首次提交、历次修改及审批记录/);
assert.match(page, /open_compensation_request_picker\(row, contributions = \{\}\)/);
assert.match(page, /data-compensation-request/);
assert.match(page, /pending_employees = new Set\(result\.pending_employees \|\| \[\]\)/);
assert.match(page, /data-open-standing-approval>待审批/);
assert.match(page, /disabled aria-disabled="true" title="等待有审批权限的账户处理">待审批/);
assert.match(page, /frappe\.set_route\("payroll-input-center", "salary-approvals"\)/);
assert.match(page, /title: `\$\{row\.employee_name \|\| row\.employee\} · 修改申请`/);
assert.match(page, /fieldname: "request_item"/);
assert.match(page, /fieldname: "previous_amount", fieldtype: "Currency", label: "修改前底薪", read_only: 1/);
assert.match(page, /fieldname: "requested_amount", fieldtype: "Currency", label: "修改后底薪", reqd: 1/);
assert.match(page, /fieldname: "previous_personal_amount"[\s\S]*label: "修改前个人承担"/);
assert.match(page, /fieldname: "requested_personal_amount"[\s\S]*label: "修改后个人承担"/);
assert.match(page, /primary_action_label: "提交申请，等待审批"/);
assert.doesNotMatch(page, /primary_action_label: "下一步"/);
assert.doesNotMatch(page, /btn-group-vertical btn-group-xs/);
assert.match(page, /\.filter\(\(item\) => !previous \|\| item\.includes\("is-changed"\)\)/);
for (const marker of ["导出工资社保汇总", "data-export-compensation", "data-compensation-export-field", "export_compensation_register", "每位员工只占一行"]) {
	assert.match(page, new RegExp(marker));
}
assert.match(page, /fieldname: "employee", fieldtype: "Data", label: __\("个人工号（可选）"\)/);
assert.match(page, /生成 Excel 报表失败/);

const pageCss = fs.readFileSync("hrms/hr/page/payroll_input_center/payroll_input_center.css", "utf8");
assert.match(pageCss, /\.hrms-compensation-register-table-wrap[\s\S]*max-height: calc\(100vh - 250px\)[\s\S]*overflow: auto/);
assert.match(pageCss, /\.hrms-compensation-register-table thead th[\s\S]*position: sticky[\s\S]*top: 0/);

const Payroll = vm.runInNewContext(`${page}\nPayrollInputCenter`, { frappe: { pages: { "payroll-input-center": {} } } });
const view = Object.create(Payroll.prototype);
const row = (amount, label) => ({ label, cells: [{ dataset: { sortValue: String(amount) }, innerText: `${label}\n2026-09-01 起` }] });
const tableRows = [row(1280, "1,280.00"), row(520, "520.00"), row(0, "尚未建档")];
const tbody = {
	rows: tableRows,
	appendChild(item) {
		this.rows.splice(this.rows.indexOf(item), 1);
		this.rows.push(item);
	},
};
const table = { tBodies: [tbody], dataset: {}, querySelectorAll: () => [] };
view.sort_table_rows(table, 0, "asc");
assert.deepEqual(tableRows.map((item) => item.label), ["尚未建档", "520.00", "1,280.00"]);
view.sort_table_rows(table, 0, "desc");
assert.deepEqual(tableRows.map((item) => item.label), ["1,280.00", "520.00", "尚未建档"]);

console.log("Unified compensation navigation, register, per-item request and one-row export contract passed.");
