/* global frappe, __ */

// Business permissions control actions, not navigation. Every Desk page remains
// reachable; only controls that change or export business data are disabled.
(function () {
	"use strict";

	const LABELS = {
		basic_read_only: "基础只读",
		personnel_view: "花名册与人事查看",
		roster_import_submit: "花名册导入提交",
		roster_import_approve: "花名册导入审批",
		dingtalk_employee_import_approve: "钉钉员工导入审批",
		employee_create: "添加员工",
		employee_create_approve: "添加员工后审批",
		employee_edit: "员工档案修改",
		personnel_change_submit: "人事异动提交",
		personnel_change_approve: "人事异动审批",
		separation_submit: "离职申请提交",
		separation_approve: "离职审批",
		separation_effective: "实际离职办理",
		personnel_export: "人事导出",
		announcement_view: "公告目录查看",
		announcement_submit: "公告提交",
		announcement_approve: "公告审批",
		announcement_sign_upload: "公告签字版上传",
		attendance_view: "考勤查看",
		attendance_import_submit: "考勤导入提交",
		attendance_exception_edit: "考勤异常修改",
		attendance_approve: "考勤审批与部门确认",
		attendance_final_lock: "考勤终稿锁定",
		attendance_export: "考勤导出",
		payroll_view: "薪酬查看",
		payroll_entry_submit: "薪资首次录入",
		payroll_change_submit: "薪资修改申请",
		contribution_submit: "社保公积金提交",
		payroll_approval: "薪酬审批",
		payroll_calculate: "薪酬试算",
		payroll_confirm: "薪酬确认与发放",
		payroll_export: "薪酬导出",
		payroll_rules: "薪酬规则配置",
		recruitment_submit: "招聘录入与提交",
		recruitment_approve: "招聘审批",
		training_submit: "培训录入与提交",
		training_approve: "培训审批",
		performance_submit: "绩效录入与提交",
		performance_approve: "绩效审批",
		permission_management: "账户与权限管理",
	};

	const FORM_POLICIES = {
		Employee: { create: "employee_create", edit: "employee_edit", approve: "employee_create_approve" },
		"Employee Onboarding": { create: "employee_create", edit: "employee_create", approve: "employee_create_approve" },
		"Employee Transfer": { create: "personnel_change_submit", edit: "personnel_change_submit", approve: "personnel_change_approve" },
		"Employee Promotion": { create: "personnel_change_submit", edit: "personnel_change_submit", approve: "personnel_change_approve" },
		"Employee Separation": { create: "separation_submit", edit: "separation_submit", approve: "separation_approve" },
		"Job Opening": { create: "recruitment_submit", edit: "recruitment_submit", approve: "recruitment_approve" },
		"Job Applicant": { create: "recruitment_submit", edit: "recruitment_submit", approve: "recruitment_approve" },
		Interview: { create: "recruitment_submit", edit: "recruitment_submit", approve: "recruitment_approve" },
		"Job Offer": { create: "recruitment_submit", edit: "recruitment_submit", approve: "recruitment_approve" },
		"Training Program": { create: "training_submit", edit: "training_submit", approve: "training_approve" },
		"Training Event": { create: "training_submit", edit: "training_submit", approve: "training_approve" },
		"Training Result": { create: "training_submit", edit: "training_submit", approve: "training_approve" },
		"Training Feedback": { create: "training_submit", edit: "training_submit", approve: "training_approve" },
		Goal: { create: "performance_submit", edit: "performance_submit", approve: "performance_approve" },
		"Appraisal Cycle": { create: "performance_submit", edit: "performance_submit", approve: "performance_approve" },
		Appraisal: { create: "performance_submit", edit: "performance_submit", approve: "performance_approve" },
	};

	const LIST_IMPORT_POLICIES = {
		Employee: "roster_import_submit",
		"Employee Onboarding": "employee_create",
		"Employee Transfer": "personnel_change_submit",
		"Employee Promotion": "personnel_change_submit",
		"Employee Separation": "separation_submit",
		"Job Applicant": "recruitment_submit",
		"Training Event": "training_submit",
		Appraisal: "performance_submit",
		"HRMS Attendance Day Check": "attendance_import_submit",
		"HRMS Attendance Exception": "attendance_import_submit",
		"HRMS Monthly Attendance Summary": "attendance_import_submit",
	};

	const PAGE_POLICIES = {
		"employee-roster-import": [[/开始|上传|预览|重新上传|确认导入|新增员工|批量修改|覆盖替换/, "roster_import_submit"]],
		"employee-roster-export": [[/导出|Export/i, "personnel_export"]],
		"employee-separation-application": [[/新建|保存|提交|申请|上传/, "separation_submit"]],
		"employee-separation-approval": [[/审批|批准|驳回|撤回/, "separation_approve"]],
		"employee-separation-effective": [[/办理|保存|确认|实际离职/, "separation_effective"]],
		"employee-separation-interview": [[/保存|提交|确认/, "separation_approve"]],
		"announcement-submit": [[/新建|保存|提交|上传|删除/, "announcement_submit"]],
		"announcement-submission-records": [[/新建|编辑|重新提交|撤回|删除/, "announcement_submit"]],
		"announcement-approval": [[/审批|批准|通过|驳回|撤回/, "announcement_approve"]],
		"announcement-signed-upload": [[/上传|保存|归档|确认/, "announcement_sign_upload"]],
		"attendance-import-center": [
			[/导出|Export/i, "attendance_export"], [/锁定|解锁|终稿|生成月度/, "attendance_final_lock"],
			[/审批|审核|批准|驳回|部门确认/, "attendance_approve"], [/异常.*(修改|更正|保存)|人工更正/, "attendance_exception_edit"],
			[/导入|上传|提交数据|重新处理/, "attendance_import_submit"],
		],
		"payroll-input-center": [
			[/导出|Export/i, "payroll_export"], [/发放|确认结算|生成结算|发送工资条/, "payroll_confirm"],
			[/试算|计算工资|生成薪资/, "payroll_calculate"], [/审批|批准|驳回/, "payroll_approval"],
			[/社保|公积金|缴费/, "contribution_submit"], [/修改申请|调薪|申请修改/, "payroll_change_submit"],
			[/首次录入|员工定薪|保存薪资/, "payroll_entry_submit"], [/规则|公式|字段映射|模板.*保存/, "payroll_rules"],
		],
		"recruitment-center": [[/审批|批准|驳回|取消/, "recruitment_approve"], [/新建|添加|录入|保存|提交|导入/, "recruitment_submit"]],
		"hrms-access-center": [[/保存权限|新建账户|账户资料|管理数据范围|验证权限|停用账号|一键全选|取消全选/, "permission_management"]],
	};

	const MUTATING_TEXT = /新建|添加|编辑|修改|保存|提交|申请|导入|上传|审批|审核|批准|驳回|撤回|取消|删除|生成|确认|锁定|解锁|New|Add|Edit|Save|Submit|Import|Upload|Approve|Reject|Cancel|Delete|Create/i;
	const APPROVAL_TEXT = /审批|审核|批准|驳回|撤回|取消|Approve|Reject|Cancel/i;
	let capabilities = new Set();
	let readyPromise = null;
	let observer = null;

	function route() {
		try { return frappe.get_route?.() || []; } catch (error) { return []; }
	}

	function controlText(control) {
		return String(control?.getAttribute?.("aria-label") || control?.title || control?.value || control?.textContent || "").replace(/\s+/g, " ").trim();
	}

	function has(key) {
		return capabilities.has("*") || capabilities.has(key);
	}

	function formPolicy(control, currentRoute, text) {
		if (currentRoute[0] !== "Form") return "";
		const doctype = currentRoute[1] || window.cur_frm?.doctype;
		const policy = FORM_POLICIES[doctype];
		if (!policy) return "";
		if (doctype === "Employee" && /人事异动/.test(text)) return "personnel_change_submit";
		if (APPROVAL_TEXT.test(text)) return policy.approve;
		if (!MUTATING_TEXT.test(text)) return "";
		if (/提交并生效|Submit and activate/i.test(text)) return policy.approve;
		const isNew = Boolean(window.cur_frm?.is_new?.());
		return isNew ? policy.create : policy.edit;
	}

	function listPolicy(currentRoute, text) {
		if (currentRoute[0] !== "List" || !/导入|Import/i.test(text)) return "";
		return LIST_IMPORT_POLICIES[currentRoute[1] || window.cur_listview?.doctype] || "";
	}

	function pagePolicy(currentRoute, text) {
		const pageName = currentRoute[0] === "Form" || currentRoute[0] === "List" ? "" : currentRoute[0];
		for (const [pattern, key] of PAGE_POLICIES[pageName] || []) {
			if (pattern.test(text)) return key;
		}
		return "";
	}

	function infer(control) {
		const explicit = control?.dataset?.hrmsCapability;
		if (explicit) return explicit;
		const text = controlText(control);
		if (!text) return "";
		const currentRoute = route();
		return formPolicy(control, currentRoute, text) || listPolicy(currentRoute, text) || pagePolicy(currentRoute, text);
	}

	function disable(control, key) {
		if (!control || !key || has(key)) return;
		const label = LABELS[key] || key;
		control.disabled = true;
		control.setAttribute("disabled", "disabled");
		control.setAttribute("aria-disabled", "true");
		control.setAttribute("data-hrms-permission-disabled", key);
		control.classList.add("disabled");
		control.title = __("没有“{0}”权限", [label]);
	}

	function apply(root = document) {
		const controls = [];
		if (root?.matches?.("button, .btn, [role='button'], input[type='submit'], [data-hrms-capability]")) controls.push(root);
		root?.querySelectorAll?.("button, .btn, [role='button'], input[type='submit'], [data-hrms-capability]").forEach((item) => controls.push(item));
		controls.forEach((control) => {
			const key = infer(control);
			if (key) disable(control, key);
		});
	}

	function deny(key) {
		const label = LABELS[key] || key;
		frappe.msgprint({ title: __("没有权限"), indicator: "orange", message: __("当前账户没有“{0}”权限，该操作已停用。", [label]) });
	}

	function requireCapability(key) {
		if (has(key)) return true;
		deny(key);
		return false;
	}

	function load(force = false) {
		if (frappe.session?.user === "Administrator") {
			capabilities = new Set(["*"]);
			return Promise.resolve(capabilities);
		}
		if (force) readyPromise = null;
		if (!readyPromise) {
			readyPromise = frappe.call("hrms.access_control.get_current_hrms_capabilities")
				.then((response) => { capabilities = new Set(response.message?.capabilities || []); return capabilities; })
				.catch(() => { capabilities = new Set(); return capabilities; });
		}
		return readyPromise;
	}

	function install() {
		load().then(() => apply(document));
		document.addEventListener("click", (event) => {
			const control = event.target?.closest?.("button, .btn, [role='button'], input[type='submit'], [data-hrms-capability]");
			const key = control && (control.dataset.hrmsPermissionDisabled || infer(control));
			if (!key || has(key)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			deny(key);
		}, true);
		observer = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
			if (node.nodeType === Node.ELEMENT_NODE) apply(node);
		})));
		observer.observe(document.body, { childList: true, subtree: true });
		$(document).on("page-change form-refresh", () => load().then(() => window.setTimeout(() => apply(document), 0)));
	}

	window.hrmsCapabilities = {
		labels: LABELS,
		ready: () => load(),
		refresh: () => load(true).then(() => { apply(document); return capabilities; }),
		has,
		require: requireCapability,
		disable,
		apply,
		guard(key, callback) { return function (...args) { if (!requireCapability(key)) return; return callback.apply(this, args); }; },
	};

	frappe.ready(install);
})();
