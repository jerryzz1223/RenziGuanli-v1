import json

import frappe


TRANSLATIONS = {
	"Frappe HR": "人资管理系统",
	"Login to Frappe HR": "登录人资管理系统",
	"Install Frappe HR": "安装人资管理系统",
	"Sign In": "登录",
	"Welcome! Please sign in to continue.": "欢迎！请登录后继续。",
	"Forgot password?": "忘记密码？",
	"Expense Claims": "费用报销",
	"Expense Claim": "费用报销",
	"Expense Claim Type": "费用报销类型",
	"Add Expense Claim Type": "添加费用报销类型",
	"Expense Claims Dashboard": "费用报销数据面板",
	"Expense Claims (This Month)": "费用报销（本月）",
	"Approved Claims (This Month)": "已批准报销（本月）",
	"Rejected Claims (This Month)": "已拒绝报销（本月）",
	"Claims by Type": "按类型统计报销",
	"Employee Advance Status": "员工预支状态",
	"Employee Advance": "员工预支",
	"Employee Advance Summary": "员工预支汇总",
	"Department wise Expense Claims": "按部门统计费用报销",
	"Leaves": "请假",
	"Leave Application": "请假申请",
	"Leave Encashment": "假期折现",
	"Leave Control Panel": "请假控制面板",
	"Leave Policy Assignment": "假期政策分配",
	"Leave Allocation": "假期分配",
	"Consolidate Leave Types": "合并假期类型",
	"consolidate_leave_types": "合并假期类型",
	"from_date": "开始日期",
	"to_date": "结束日期",
	"company": "公司",
	"department": "部门",
	"employee": "员工",
	"employee_status": "员工状态",
	"Begin typing for results.": "输入以搜索结果。",
	"Tenure": "员工生命周期",
	"Employee Lifecycle": "员工生命周期",
	"Payroll": "薪资",
	"HR Setup": "人资设置",
	"Human Resource": "人力资源",
	"Performance": "绩效",
	"Appraisal Template": "考核模板",
	"Recruitment": "招聘",
	"Attendance": "考勤",
	"Tax & Benefits": "税务与福利",
	"Shift & Attendance": "考勤排班",
	"Home": "主页",
	"Dashboard": "数据面板",
	"Accounting Entries": "会计分录",
	"Payment Entry": "收付款凭证",
	"Journal Entry": "日记账凭证",
	"Additional Salary": "附加薪资",
	"Unpaid Expense Claim": "未付费用报销",
	"Vehicle Expenses": "车辆费用",
	"Vehicle": "车辆",
	"Driver": "司机",
	"Vehicle Service Item": "车辆服务项目",
	"Vehicle Log": "车辆日志",
	"Travel Request": "差旅申请",
	"Purpose of Travel": "差旅目的",
	"Accounts Receivable": "应收账款",
	"Accounts Payable": "应付账款",
	"General Ledger": "会计总账",
	"Employee Leave Balance": "员工假期余额",
	"Employee Birthday": "员工生日",
	"Employee Information": "员工信息",
	"Monthly Attendance Sheet": "月度考勤表",
	"Employees working on a Holiday": "节假日出勤员工",
	"Daily Work Summary Report": "每日工作汇总报表",
	"Employee Analytics": "员工分析",
	"Recruitment Analytics": "招聘分析",
	"Employee Hours Utilization Based On Timesheet": "基于工时表的员工工时利用率",
	"Project Profitability": "项目盈利能力",
	"Calls": "通讯费",
	"Food": "餐饮",
	"Medical": "医疗",
	"Others": "其他",
	"Claims": "报销",
	"Advances": "预支",
	"Reports": "报表",
	"Accounting Reports": "会计报表",
	"Travel": "差旅",
	"Fleet Management": "车队管理",
	"Masters & Reports": "基础资料与报表",
	"Expenses": "费用",
	"This Month": "本月",
	"Approved Claims": "已批准报销",
	"Rejected Claims": "已拒绝报销",
	"Department wise": "按部门",
}


EXPENSE_CLAIM_TYPE_LABELS = {
	"Calls": "通讯费",
	"Food": "餐饮",
	"Medical": "医疗",
	"Others": "其他",
	"Travel": "差旅",
}


HRMS_DESKTOP_LABELS = {
	"Frappe HR": "人资管理系统",
	"Leaves": "请假",
	"Tenure": "员工生命周期",
	"Payroll": "薪资",
	"HR Setup": "人资设置",
	"Performance": "绩效",
	"Recruitment": "招聘",
	"Tax & Benefits": "税务与福利",
	"Shift & Attendance": "考勤排班",
}


HRMS_HOME_ROUTE = "/desk/hr-setup"


def _set_value_if_exists(doctype, name, values):
	if frappe.db.exists(doctype, name):
		meta = frappe.get_meta(doctype)
		valid_values = {field: value for field, value in values.items() if meta.has_field(field)}
		if valid_values:
			frappe.db.set_value(doctype, name, valid_values, update_modified=False)


def _upsert_translation(source_text, translated_text):
	existing = frappe.db.exists("Translation", {"language": "zh", "source_text": source_text, "context": ""})
	values = {
		"language": "zh",
		"source_text": source_text,
		"translated_text": translated_text,
		"context": "",
	}
	if existing:
		frappe.db.set_value("Translation", existing, "translated_text", translated_text, update_modified=False)
	else:
		frappe.get_doc({"doctype": "Translation", **values}).insert(ignore_permissions=True)


def _localize_workspace_content(workspace_name):
	if not frappe.db.exists("Workspace", workspace_name):
		return
	doc = frappe.get_doc("Workspace", workspace_name)
	changed = False

	if doc.label in TRANSLATIONS:
		doc.label = TRANSLATIONS[doc.label]
		changed = True
	if getattr(doc, "title", None) in TRANSLATIONS:
		doc.title = TRANSLATIONS[doc.title]
		changed = True

	if doc.content:
		content = doc.content
		for source, translated in TRANSLATIONS.items():
			content = content.replace(f">{source}<", f">{translated}<")
		try:
			items = json.loads(content)
		except Exception:
			items = None
		if items:
			for item in items:
				data = item.get("data") or {}
				for key in ("text",):
					if data.get(key) in TRANSLATIONS:
						data[key] = TRANSLATIONS[data[key]]
			content = json.dumps(items, ensure_ascii=False)
		if content != doc.content:
			doc.content = content
			changed = True

	if changed:
		doc.save(ignore_permissions=True)


def _localize_child_table_labels(doctype, parent=None):
	filters = {}
	if parent:
		filters["parent"] = parent
	for row in frappe.get_all(doctype, filters=filters, fields=["name", "label"], limit_page_length=500):
		if row.label in TRANSLATIONS:
			frappe.db.set_value(doctype, row.name, "label", TRANSLATIONS[row.label], update_modified=False)


def _localize_expense_claim_types():
	for source, translated in EXPENSE_CLAIM_TYPE_LABELS.items():
		if frappe.db.exists("Expense Claim Type", source):
			if not frappe.db.exists("Expense Claim Type", translated):
				frappe.rename_doc("Expense Claim Type", source, translated, force=True)
			else:
				frappe.delete_doc("Expense Claim Type", source, ignore_permissions=True, force=True)
		if frappe.db.exists("Expense Claim Type", translated):
			_set_value_if_exists("Expense Claim Type", translated, {"expense_type": translated})


def apply_expense_claim_translations():
	for source, translated in TRANSLATIONS.items():
		_upsert_translation(source, translated)

	number_cards = {
		"Expense Claims (This Month)": "费用报销（本月）",
		"Approved Claims (This Month)": "已批准报销（本月）",
		"Rejected Claims (This Month)": "已拒绝报销（本月）",
	}
	for name, translated in number_cards.items():
		_set_value_if_exists("Number Card", name, {"label": translated, "title": translated})

	charts = {
		"Expense Claims": "费用报销",
		"Claims by Type": "按类型统计报销",
		"Employee Advance Status": "员工预支状态",
		"Department wise Expense Claims": "按部门统计费用报销",
	}
	for name, translated in charts.items():
		_set_value_if_exists("Dashboard Chart", name, {"chart_name": translated})

	workspaces = {
		"Expenses": "费用",
		"Travel": "差旅",
		"Leaves": "请假",
		"Payroll": "薪资",
		"HR Setup": "人资设置",
		"Performance": "绩效",
		"Recruitment": "招聘",
		"Shift & Attendance": "考勤排班",
		"Tax & Benefits": "税务与福利",
		"Tenure": "员工生命周期",
	}
	for name, translated in workspaces.items():
		_set_value_if_exists("Workspace", name, {"label": translated, "title": translated})
		_localize_workspace_content(name)

	for doctype in ("Workspace Link", "Workspace Sidebar Item"):
		_localize_child_table_labels(doctype)

	for doctype in ("Dashboard", "Dashboard Chart", "Number Card", "Report"):
		for name, translated in TRANSLATIONS.items():
			values = {}
			if doctype == "Dashboard":
				values = {"dashboard_name": translated}
			elif doctype == "Dashboard Chart":
				values = {"chart_name": translated}
			elif doctype == "Number Card":
				values = {"label": translated}
			elif doctype == "Report":
				values = {"report_name": translated}
			_set_value_if_exists(doctype, name, values)

	_localize_expense_claim_types()

	frappe.clear_cache()
	frappe.db.commit()
	return {
		"translations": len(TRANSLATIONS),
		"number_cards": len(number_cards),
		"charts": len(charts),
		"workspaces": len(workspaces),
	}


def apply_hrms_desktop_customizations():
	for source, translated in {**TRANSLATIONS, **HRMS_DESKTOP_LABELS}.items():
		_upsert_translation(source, translated)

	updated = 0
	for icon in frappe.get_all("Desktop Icon", fields=["name", "app"]):
		hidden = 0 if icon.app == "hrms" else 1
		frappe.db.set_value("Desktop Icon", icon.name, "hidden", hidden, update_modified=False)
		updated += 1

	for name, label in HRMS_DESKTOP_LABELS.items():
		_set_value_if_exists("Desktop Icon", name, {"label": label, "hidden": 0})

	_set_value_if_exists("Desktop Icon", "Expenses", {"hidden": 1})

	_set_value_if_exists(
		"Desktop Icon",
		"Frappe HR",
		{
			"label": "人资管理系统",
			"logo_url": "/assets/hrms/images/frappe-hr-logo.svg",
			"link": HRMS_HOME_ROUTE,
			"hidden": 0,
		},
	)

	_set_value_if_exists(
		"Workspace",
		"Expenses",
		{
			"public": 0,
			"is_hidden": 1,
			"app": "",
		},
	)

	for user in ("Administrator", "Guest"):
		if frappe.db.exists("User", user) and frappe.get_meta("User").has_field("default_app"):
			frappe.db.set_value("User", user, "default_app", "hrms", update_modified=False)

	if frappe.get_meta("System Settings").has_field("default_app"):
		frappe.db.set_single_value("System Settings", "default_app", "hrms", update_modified=False)

	frappe.clear_cache()
	frappe.db.commit()
	return {"desktop_icons": updated, "visible_app": "hrms"}
