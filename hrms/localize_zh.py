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
	"Job Opening": "招聘职位",
	"Job Openings": "招聘职位",
	"Add Job Opening": "添加招聘职位",
	"Create Job Opening": "创建招聘职位",
	"Create your first Job Opening": "创建首个招聘职位",
	"Description of a Job Opening": "招聘职位说明",
	"Job Title": "职位名称",
	"Job Opening Template": "招聘职位模板",
	"Job Applicant": "候选人",
	"Interview": "面试",
	"Interviews": "面试",
	"Interview Type": "面试类型",
	"Interview Feedback": "面试反馈",
	"Job Offer": "录用通知",
	"Job Offer Term Template": "录用条款模板",
	"Appointment": "任命",
	"Appointment Letter": "聘书",
	"Appointment Letter Template": "聘书模板",
	"Job Requisition": "招聘申请",
	"Staffing Plan": "人员编制计划",
	"Employee Referral": "员工推荐",
	"Job Portal": "招聘门户",
	"Planning": "招聘规划",
	"Jobs": "职位",
	"Department Wise Openings": "按部门统计职位空缺",
	"Interviews (This Week)": "本周面试",
	"Publish on website": "发布到网站",
	"List View": "列表视图",
	"Default Layout": "默认布局",
	"Created On": "创建时间",
	"ID": "编号",
	"Status": "状态",
	"Setup": "设置",
	"Settings": "系统设置",
	"Add": "新增",
	"Edit": "编辑",
	"Delete": "删除",
	"Cancel": "取消",
	"Submit": "提交",
	"Close": "关闭",
	"More": "更多",
	"View": "查看",
	"Download": "下载",
	"Upload": "上传",
	"Refresh": "刷新",
	"New": "新建",
	"No data": "暂无数据",
	"Actions": "操作",
	"Print": "打印",
	"Email": "邮件",
	"Comment": "评论",
	"Attendance": "考勤",
	"Tax & Benefits": "税务与福利",
	"Shift & Attendance": "考勤排班",
	"Home": "主页",
	"Search": "搜索",
	"Save": "保存",
	"Enabled": "已启用",
	"Disabled": "已停用",
	"HRMS DingTalk Settings": "钉钉集成设置",
	"HRMS DingTalk Raw Record": "钉钉原始记录",
	"HRMS DingTalk User Map": "钉钉员工映射",
	"HRMS DingTalk Sync Log": "钉钉同步日志",
	"DingTalk": "钉钉",
	"department": "部门",
	"user": "用户",
	"attendance": "考勤",
	"approval": "审批",
	"employee_status": "员工状态",
	"内网服务器主动拉取API": "内网服务器主动拉取接口",
	"Excel导入（默认）": "表格导入（默认）",
	"连接平台+本地网关": "连接平台＋本地网关",
	"公网小网关": "公网小网关",
	"Assign": "分派",
	"Attachments": "附件",
	"Tags": "标签",
	"Share": "分享",
	"Last Edited By You": "你最近编辑",
	"Created By You": "你创建",
	"Created By": "创建人",
	"Last Edited By": "最近编辑人",
	"You": "你",
	"weeks ago": "周前",
	"week ago": "周前",
	"days ago": "天前",
	"day ago": "天前",
	"Quick Edit Fields": "快速编辑字段",
	"Department": "部门",
	"Parent Department": "上级部门",
	"All Departments": "所有部门",
	"Is Group": "是否分组",
	"Payroll Cost Center": "薪资成本中心",
	"Leave Block List": "假期封存列表",
	"Days for which Holidays are blocked for this department.": "该部门适用的假期封存日期列表。",
	"Organization Management": "组织管理",
	"Organization Level": "组织层级",
	"Organization Role": "组织角色",
	"Organization Manager": "组织负责人",
	"Proxy Manager": "代理负责人",
	"Planned Headcount": "编制人数",
	"Actual Headcount": "现有人数",
	"Vacancy Count": "空缺人数",
	"Recruitment Plan": "招聘计划",
	"Organization Source Cell": "组织图来源单元格",
	"Approvers": "审批人",
	"Approver": "审批人",
	"The first Approver in the list will be set as the default Approver.": "列表中的第一位审批人将作为默认审批人。",
	"Shift Request Approver": "班次申请审批人",
	"Leave Approver": "请假审批人",
	"Expense Approver": "费用审批人",
	"Employee Onboarding": "入职办理",
	"Employee Onboarding Template": "入职模板",
	"Employee Separation": "员工离职",
	"Employee Exits": "离职员工",
	"Employee Grievance": "员工申诉",
	"HRMS Employee Reward Punishment": "员工奖惩记录",
	"HRMS Reward Punishment Rule": "奖惩规则",
	"Grievance Type": "申诉类型",
	"Employee Skill Map": "员工技能矩阵",
	"Training Program": "培训项目",
	"Training Event": "培训活动",
	"Training Feedback": "培训反馈",
	"Training Result": "培训结果",
	"Daily Work Summary": "每日工作汇总",
	"Daily Work Summary Group": "每日工作汇总分组",
	"Daily Work Summary Replies": "每日工作汇总回复",
	"New Hires (This Month)": "本月新入职员工",
	"Trainings (This Week)": "本周培训",
	"Exits (This Month)": "本月离职员工",
	"Onboarding": "入职",
	"Grievance": "申诉",
	"Training": "培训",
	"Leave Balance": "假期余额",
	"Leave Balance Summary": "假期余额汇总",
	"Employee Leave Balance Summary": "员工假期余额汇总",
	"Holiday List": "节假日表",
	"Holiday List Assignment": "节假日表分配",
	"Leave Period": "假期期间",
	"Leave Policy": "假期政策",
	"Leave Block List": "假期封存列表",
	"Leave Type": "假期类型",
	"Compensatory Leave Request": "调休申请",
	"Application": "申请",
	"Allocation": "分配",
	"Holidays in this month": "本月节假日",
	"Employees on leave this month": "本月请假员工",
	"Employees on leave today": "今日请假员工",
	"Employees working on a holiday": "节假日出勤员工",
	"Employees Working on a Holiday": "节假日出勤员工",
	"Goal": "目标",
	"Appraisal Cycle": "考核周期",
	"Appraisal": "绩效考核",
	"Employee Performance Feedback": "员工绩效反馈",
	"Employee Promotion": "员工转正",
	"Appraisal Overview": "绩效概览",
	"KRA": "关键结果领域",
	"Employee Feedback Criteria": "员工反馈标准",
	"Payroll Entry": "薪资核算",
	"Salary Structure Assignment": "薪资结构分配",
	"Salary Slip": "工资条",
	"Salary Withholding": "薪资代扣",
	"Employee CTC Break-up": "员工薪酬成本明细",
	"Salary Register": "工资汇总表",
	"Income Tax Deductions": "所得税扣除",
	"Professional Tax Deductions": "专业税扣除",
	"Salary Component": "薪资项目",
	"Salary Structure": "薪资结构",
	"Roster": "排班表",
	"Employee Attendance Tool": "员工考勤工具",
	"Employee Checkin": "员工打卡",
	"Attendance Request": "考勤申请",
	"Shift Request": "班次申请",
	"Shift Assignment": "班次分配",
	"Shift Assignment Tool": "班次分配工具",
	"Shift Type": "班次类型",
	"Shift Location": "班次地点",
	"Shift Schedule": "班次排程",
	"Shift Schedule Assignment": "班次排程分配",
	"Overtime": "加班",
	"Overtime Type": "加班类型",
	"Overtime Slip": "加班单",
	"Employee Hours Utilization": "员工工时利用率",
	"Shift Attendance": "班次考勤",
	"Attendance Count": "考勤人数",
	"Upload Attendance": "上传考勤",
	"Activity Type": "活动类型",
	"Timesheet": "工时表",
	"Shifts": "班次",
	"Time": "时间",
	"Exemption Declaration": "免税申报",
	"Exemption Submission Proof": "免税证明提交",
	"Benefit Application": "福利申请",
	"Benefit Claim": "福利报销",
	"Income Tax Computation": "所得税计算",
	"Accrued Earnings Report": "应计收入报表",
	"Income Tax Slab": "所得税税率表",
	"Exemption Category": "免税类别",
	"Please setup Employee Naming System in Human Resource > HR Settings": "请先在人力资源＞人资设置中配置员工编号规则。",
	"Source and target shifts cannot be the same": "原班次与目标班次不能相同。",
	"Cannot break shift after end date": "不能在班次结束日期之后拆分班次。",
	"Cannot break shift before start date": "不能在班次开始日期之前拆分班次。",
	"Employee not found": "未找到员工。",
	"You can only upload JPG, PNG, PDF, TXT or Microsoft documents.": "仅支持上传 JPG、PNG、PDF、TXT 或 Microsoft 文档。",
	"Failed to download PDF: {0}": "下载 PDF 失败：{0}",
	"Add Feedback": "添加反馈",
	"Feedback": "反馈内容",
	"Feedback Rating": "反馈评分",
	"Criteria": "评价标准",
	"Weightage": "权重",
	"Rating": "评分",
	"Feedback {0} added successfully": "反馈 {0} 已添加。",
	"Team Updates": "团队动态",
	"No more updates": "没有更多动态。",
	"Select Company": "请选择公司",
	"Please select a company first": "请先选择公司。",
	"Company": "公司",
	"Month": "月份",
	"Year": "年份",
	"Branch": "分支机构",
	"Jan": "一月",
	"Feb": "二月",
	"Mar": "三月",
	"Apr": "四月",
	"May": "五月",
	"June": "六月",
	"July": "七月",
	"Aug": "八月",
	"Sep": "九月",
	"Oct": "十月",
	"Nov": "十一月",
	"Dec": "十二月",
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


def apply_hrms_zh_translations():
	"""Persist HRMS Chinese labels so DocType titles and option values render consistently."""
	for source, translated in TRANSLATIONS.items():
		_upsert_translation(source, translated)
	frappe.clear_cache()
	frappe.db.commit()
	return {"translations": len(TRANSLATIONS)}


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
	apply_hrms_zh_translations()

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
