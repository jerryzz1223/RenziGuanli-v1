const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "hrms", "public", "js", "hrms_capability_ui.js"), "utf8");
let currentRoute = [];

function control(text, capability = "") {
	return {
		textContent: text, title: "", value: "", disabled: false,
		dataset: capability ? { hrmsCapability: capability } : {},
		classList: { add() {}, remove() {} },
		matches() { return true; },
		querySelectorAll() { return []; },
		getAttribute() { return ""; },
		setAttribute(name, value) {
			if (name === "disabled") this.disabled = true;
			if (name === "data-hrms-permission-disabled") this.dataset.hrmsPermissionDisabled = value;
		},
		removeAttribute(name) {
			if (name === "disabled") this.disabled = false;
			if (name === "data-hrms-permission-disabled") delete this.dataset.hrmsPermissionDisabled;
		},
	};
}

const documentMock = {
	body: { querySelectorAll() { return []; } },
	querySelectorAll() { return []; },
	addEventListener() {},
};
const context = {
	window: {}, document: documentMock, Node: { ELEMENT_NODE: 1 },
	MutationObserver: class { observe() {} },
	setTimeout: (callback) => callback(),
	$: () => ({ on() {} }),
	__: (message, values = []) => values.reduce((result, value, index) => result.replace(`{${index}}`, value), message),
	frappe: {
		session: { user: "restricted@example.com" },
		get_route: () => currentRoute,
		call: () => Promise.resolve({ message: { capabilities: [] } }),
		ready: (callback) => callback(),
		msgprint() {},
	},
};
context.window = context;
vm.runInNewContext(source, context, { filename: "hrms_capability_ui.js" });

(async () => {
	await context.hrmsCapabilities.ready();
	const cases = [
		[["employee-roster-import"], "开始新增员工", "roster_import_submit"],
		[["employee-roster-export"], "导出 Excel", "personnel_export"],
		[["announcement-submit"], "提交审核", "announcement_submit"],
		[["announcement-approval"], "批准", "announcement_approve"],
		[["announcement-signed-upload"], "上传签字版", "announcement_sign_upload"],
		[["attendance-import-center"], "上传考勤", "attendance_import_submit"],
		[["attendance-import-center"], "导出 Excel", "attendance_export"],
		[["attendance-import-center"], "锁定终稿", "attendance_final_lock"],
		[["attendance-import-center", "exceptions"], "应用处理", "attendance_exception_edit"],
		[["payroll-input-center"], "员工定薪", "payroll_entry_submit"],
		[["payroll-input-center"], "薪酬试算", "payroll_calculate"],
		[["payroll-input-center"], "确认结算", "payroll_confirm"],
		[["payroll-input-center", "salary-rules"], "保存本项设置", "payroll_rules"],
		[["recruitment-center"], "新建招聘申请", "recruitment_submit"],
		[["hrms-access-center"], "保存权限", "permission_management"],
		[["Form", "Employee", "EMP-1"], "保存", "employee_edit"],
		[["Form", "Employee Transfer", "NEW"], "提交", "personnel_change_submit"],
		[["Form", "Training Event", "NEW"], "提交", "training_submit"],
		[["Form", "Appraisal", "NEW"], "批准", "performance_approve"],
	];
	for (const [route, text, expected] of cases) {
		currentRoute = route;
		context.cur_frm = { doctype: route[1], is_new: () => route[2] === "NEW" };
		const button = control(text);
		context.hrmsCapabilities.apply(button);
		if (!button.disabled || button.dataset.hrmsPermissionDisabled !== expected) {
			throw new Error(`${route.join("/")} ${text} did not require ${expected}`);
		}
	}
	currentRoute = ["employee-roster-import"];
	const navigation = control("返回员工花名册");
	context.hrmsCapabilities.apply(navigation);
	if (navigation.disabled) throw new Error("Navigation button must remain usable without a business action permission.");
	if (!source.includes('typeof frappe.ready === "function"')) {
		throw new Error("Capability UI must support Frappe versions without frappe.ready().");
	}
	if (!source.includes("Promise.resolve(frappe.call")) {
		throw new Error("Capability loading must normalize Frappe's jQuery Deferred to a native Promise.");
	}
	console.log(`Business capability UI runtime verified (${cases.length} representative controls; navigation remains enabled).`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
