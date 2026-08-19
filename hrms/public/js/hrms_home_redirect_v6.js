(function () {
	var text_replacements = {
		"Begin typing for results.": "输入以搜索结果。",
		"Core": "系统管理",
		"Frappe Framework": "人资管理系统",
		"User": "账户",
		"Role": "角色",
		"User Permission": "用户数据范围",
		"Permission Manager": "角色权限配置",
		"User Activity Log": "用户操作日志",
		"Activity Log": "操作日志",
		"Access Log": "访问日志",
		"System User": "系统用户",
		"Employee Self Service": "员工自助",
		"System Manager": "系统管理员",
		"HR Manager": "人资管理员",
		"HR User": "人事专员",
		"Expense Approver": "费用审批人",
		"Leave Approver": "请假审批人",
		"Interviewer": "面试官",
		"Guest": "访客",
		"DocType": "单据类型",
		"Page": "页面",
		"Pages": "页面",
		"Workspace": "工作区",
		"Custom Field": "自定义字段",
		"Property Setter": "属性覆盖",
		"Client Script": "客户端脚本",
		"Workflow": "工作流",
		"Account": "会计科目",
		"Activity Type": "活动类型",
		"Additional Salary": "附加薪资",
		"Appointment": "预约",
		"Appraisal": "绩效考核",
		"Appraisal Cycle": "考核周期",
		"Appraisal Template": "考核模板",
		"Expense Claim": "费用报销",
		"Employee Advance": "员工预支",
		"Interview Feedback": "面试反馈",
		"Interview Type": "面试类型",
		"Leave Application": "请假申请",
		"Only If Creator": "仅限创建者",
		"Meaning of Different Permission Types:": "不同权限类型的含义：",
		"HRMS Employee Field Template": "员工字段模板",
		"HRMS Form Approval Matrix": "人资表单审批矩阵",
		"HRMS Attendance Custom Rule": "考勤自定义规则",
		"HRMS Payroll Rule": "薪资计算规则",
		"HRMS Payroll Field Mapping": "薪资字段映射",
		"HRMS DingTalk Settings": "钉钉连接设置",
		"Personnel": "人事",
		"Employee": "员工",
		"人资设置": "工作台",
		"Employment Type": "工作性质",
		"Full-time": "全职",
		"Intern": "实习生",
		"Contract": "外包",
		"Retainer": "退休返聘",
		"Active": "在职",
		"Left": "已离职",
		"Inactive": "待离职",
		"Suspended": "停职",
		"Training Program": "培训计划",
		"Masters & Reports": "主数据 & 报表",
		"Masters": "主数据",
		"Reports": "报表",
		"Report": "报表",
		"Shifts": "班次",
		"Shift Type": "班次类型",
		"Shift Location": "班次地点",
		"Shift Assignment": "班次分配",
		"Shift Schedule": "班次计划",
		"Shift Request": "班次申请",
		"Attendance": "考勤",
		"Attendance Request": "考勤申请",
		"Employee Checkin": "员工打卡",
		"Employee Attendance Tool": "员工考勤工具",
		"Organizational Chart": "组织架构",
		"Employee Grade": "员工等级",
		"Grade": "员工等级",
		"Company": "公司",
		"Branch": "分支机构（分公司）",
		"Department": "部门",
		"Designation": "职位",
		"Overtime": "加班",
		"Overtime Type": "加班类型",
		"Overtime Slip": "加班单",
		"Create User Automatically": "自动创建用户",
		"Creates a User account for this employee using the Preferred, Company, or Personal email.":
			"使用首选邮箱、公司邮箱或个人邮箱为该员工自动创建用户账号。",
		"Preferred Contact Email": "首选联系邮箱",
		"Company Email": "公司邮箱",
		"Personal Email": "个人邮箱",
		"User ID": "用户账号",
		"Holiday List": "假期列表",
		"Default Shift": "默认班次",
		"Expense Approver": "费用审批人",
		"Leave Approver": "请假审批人",
		"Shift Request Approver": "班次申请审批人",
		"Marital Status": "婚姻状况",
		"Blood Group": "血型",
		"Health Details": "健康信息",
		"Health Insurance Provider": "医保供应商",
		"Health Insurance No": "医保编号",
		"Payroll Cost Center": "薪资成本中心",
		"Employee Advance Account": "员工预支账户",
		"Auto User Creation Error": "自动创建用户错误",
		"Company or Personal Email is mandatory when 'Create User Automatically' is enabled":
			"启用“自动创建用户”时必须填写公司邮箱或个人邮箱",
		"Company or Personal Email is mandatory when 'Create User Automatically' is enabled\n":
			"启用“自动创建用户”时必须填写公司邮箱或个人邮箱",
		"Salary Structure": "薪资结构",
		"Salary Structure Assignment": "薪资结构分配",
		"Salary Slip": "工资单",
		"Salary Withholding": "薪资暂扣",
		"Earnings & Deductions": "收入与扣款",
		"Earnings": "收入项",
		"Deductions": "扣款项",
		"Employer Contributions": "雇主缴纳项",
		"Flexible Benefits": "弹性福利",
		"Enter yearly benefit amounts": "录入年度福利金额",
		"Condition and Formula Help": "条件与公式帮助",
		"Payroll Frequency": "薪资周期",
		"Salary Slip Based on Timesheet": "按工时表生成工资单",
		"Leave Encashment Amount Per Day (CNY)": "每日未休假折现金额（CNY）",
		"Max Benefits (CNY)": "最高福利金额（CNY）",
		"Company Letterhead": "公司信头",
		"Payroll Payable Account": "应付薪资账户",
		"Payment Account": "付款账户",
		"Mode of Payment": "付款方式",
		"IBAN": "国际银行账号",
		"Earning Component": "收入构成",
		"Benefit Amount": "福利金额",
		"Is Tax Applicable": "是否计税",
		"Accrual Component": "计提构成",
		"Depends On Payment Days": "按出勤天数计算",
		"Salary Component": "薪资构成",
		"Abbr": "简称",
		"Bimonthly": "半月",
		"Biweekly": "双周",
		"Weekly": "每周",
		"Daily": "每天",
		"Monthly": "每月",
		"Yes": "是",
		"No": "否",
		"Single": "未婚",
		"Married": "已婚",
		"Divorced": "离异",
		"Widowed": "丧偶",
		"Rented": "租赁",
		"Owned": "自有",
		"Job Applicant": "候选人",
		"Offer Date": "录用日期",
		"Confirmation Date": "转正日期",
		"Contract End Date": "合同结束日期",
		"Notice (days)": "通知期（天）",
		"Date Of Retirement": "退休日期",
		"Resignation Letter Date": "辞职信日期",
		"Relieving Date": "离职日期",
		"Reason for Leaving": "离职原因",
		"Feedback": "反馈",
		"Here you can maintain family details like name and occupation of parent, spouse and children":
			"可维护父母、配偶、子女等家庭成员的姓名和职业信息",
		"Here you can maintain height, weight, allergies, medical concerns etc":
			"可维护身高、体重、过敏史、健康状况等信息",
	};

	// Native list filters sometimes expose database field names instead of
	// labels. Keep these exact-only so a short key such as "allow" is never
	// replaced inside an unrelated sentence.
	var technical_field_labels = {
		allow: "允许对象",
		for_value: "允许值",
		route_name: "路由标识",
	};
	var text_replacement_keys = Object.keys(text_replacements).sort(function (left, right) {
		return right.length - left.length;
	});
	var text_replacement_pattern = new RegExp(
		text_replacement_keys
			.map(function (value) {
				return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			})
			.join("|"),
		"g",
	);

	var sidebar_section_labels = new Set([
		"快捷入口",
		"常用报表",
		"员工管理",
		"员工关系",
		"数据面板",
		"报表",
		"设置",
		"组织管理",
		"候选人",
		"统计分析",
		"考勤统计",
		"考勤管理",
		"假期管理",
		"薪酬管理",
		"审批",
		"培训设置",
		"考核管理",
		"员工档案设置",
	]);

	var HRMS_SIDEBAR_MODULES = [
		{
			label: "账户与权限",
			route: "/desk/hrms-access-center",
			icon: "权",
			contextual: true,
			keys: [
				"hrms-access-center",
				"user",
				"role",
				"user-permission",
				"permission-manager",
				"activity-log",
				"user-activity-log",
				"access-log",
			],
			items: [
				{ type: "link", label: "账户与权限总览", route: "/desk/hrms-access-center", slug: "hrms-access-center" },
				{
					type: "section",
					label: "账户管理",
					children: [
						{ label: "全部账户", route: "/desk/user", slug: "user" },
						{ label: "用户数据范围", route: "/desk/user-permission", slug: "user-permission" },
						{ label: "测试实际权限", route: "/desk/hrms-access-center", slug: "hrms-access-center" },
					],
				},
				{
					type: "section",
					label: "角色与业务权限",
					children: [
						{ label: "角色资料", route: "/desk/role", slug: "role" },
						{ label: "角色权限配置", route: "/desk/permission-manager", slug: "permission-manager" },
					],
				},
				{
					type: "section",
					label: "安全审计",
					children: [
						{ label: "用户操作日志", route: "/desk/activity-log", slug: "activity-log" },
						{ label: "访问日志", route: "/desk/access-log", slug: "access-log" },
					],
				},
			],
		},
		{
			label: "开发与配置",
			route: "/desk/hrms-developer-center",
			icon: "开",
			contextual: true,
			keys: [
				"hrms-developer-center",
				"hrms-model-center",
				"doctype",
				"page",
				"workspace",
				"custom-field",
				"property-setter",
				"client-script",
				"hrms-employee-field-template",
				"hrms-form-approval-matrix",
				"hrms-attendance-custom-rule",
				"hrms-payroll-rule",
				"hrms-payroll-field-mapping",
				"hrms-dingtalk-settings",
				"hrms-data-operations",
			],
			items: [
				{ type: "link", label: "开发与配置总览", route: "/desk/hrms-developer-center", slug: "hrms-developer-center" },
				{
					type: "section",
					label: "业务配置",
					children: [
						{ label: "员工字段与导入导出", route: "/desk/hr-settings-center", slug: "hr-settings-center" },
						{ label: "人资表单审批矩阵", route: "/desk/hrms-form-approval-matrix", slug: "hrms-form-approval-matrix" },
						{ label: "考勤自定义规则", route: "/desk/hrms-attendance-custom-rule", slug: "hrms-attendance-custom-rule" },
						{ label: "薪资计算规则", route: "/desk/hrms-payroll-rule", slug: "hrms-payroll-rule" },
						{ label: "薪资字段映射", route: "/desk/hrms-payroll-field-mapping", slug: "hrms-payroll-field-mapping" },
						{ label: "钉钉连接设置", route: "/desk/hrms-dingtalk-settings", slug: "hrms-dingtalk-settings" },
					],
				},
				{
					type: "section",
					label: "结构与页面（高级）",
					children: [
						{ label: "基础模型管理", route: "/desk/hrms-model-center", slug: "hrms-model-center" },
						{ label: "全部底层模型（谨慎）", route: "/desk/doctype", slug: "doctype" },
						{ label: "自定义字段", route: "/desk/custom-field", slug: "custom-field" },
						{ label: "属性覆盖", route: "/desk/property-setter", slug: "property-setter" },
						{ label: "页面", route: "/desk/page", slug: "page" },
						{ label: "工作区", route: "/desk/workspace", slug: "workspace" },
						{ label: "客户端脚本", route: "/desk/client-script", slug: "client-script" },
					],
				},
				{
					type: "section",
					label: "运行与发布",
					children: [
						{ label: "数据处理中心", route: "/desk/hrms-data-operations", slug: "hrms-data-operations" },
						{ label: "账户与权限", route: "/desk/hrms-access-center", slug: "hrms-access-center" },
					],
				},
			],
		},
		{
			label: "工作台",
			route: "/desk/hrms-workbench",
			icon: "H",
			keys: ["hrms-workbench", "hr-setup"],
			items: [
				{ type: "link", label: "主页", route: "/desk/hrms-workbench", slug: "hrms-workbench" },
				{
					type: "section",
					label: "快捷入口",
					children: [
						{ label: "人事", route: "/desk/employee", slug: "employee" },
						{ label: "部门", route: "/desk/department", slug: "department" },
						{ label: "招聘", route: "/desk/recruitment", slug: "recruitment" },
						{ label: "考勤假期", route: "/desk/attendance-import-center", slug: "attendance-import-center" },
						{ label: "薪酬", route: "/desk/payroll-input-center", slug: "payroll-input-center" },
					],
				},
			],
		},
		{
			label: "人事",
			route: "/desk/employee",
			icon: "P",
			keys: [
				"personnel",
				"employee",
				"employee-detail",
				"employee-roster-import",
				"employee-roster-export",
				"personnel-reports",
				"staff-attribute-settings",
				"employee-onboarding",
				"employee-promotion",
				"employee-separation",
				"employee-separation-records",
				"employee-transfer",
				"employee-property-history",
				"employee-skill-map",
				"hrms-employee-reward-punishment",
				"exit-interview",
				"cross-department-support",
			],
			items: [
				{ type: "link", label: "主页", route: "/desk/employee", slug: "employee" },
				{
					type: "section",
					label: "员工管理",
					children: [
						{ label: "员工花名册", route: "/desk/employee", slug: "employee" },
						{ label: "人事报表", route: "/desk/personnel-reports", slug: "personnel-reports" },
					],
				},
				{
					type: "section",
					label: "员工关系",
					children: [
						{ label: "入职管理", route: "/desk/employee-onboarding", slug: "employee-onboarding" },
						{ label: "转正管理", route: "/desk/employee-promotion", slug: "employee-promotion" },
						{ label: "离职管理", route: "/desk/employee-separation", slug: "employee-separation" },
						{ label: "离职记录", route: "/desk/employee-separation-records", slug: "employee-separation-records" },
						{ label: "异动记录", route: "/desk/employee-property-history", slug: "employee-property-history" },
						{ label: "培训经历", route: "/desk/employee-skill-map", slug: "employee-skill-map" },
						{ label: "奖惩记录", route: "/desk/hrms-employee-reward-punishment", slug: "hrms-employee-reward-punishment" },
						{ label: "离职面谈", route: "/desk/exit-interview", slug: "exit-interview" },
					],
				},
				{
					type: "section",
					label: "跨部门协作",
					children: [
						{ label: "跨部门支援", route: "/desk/cross-department-support", slug: "cross-department-support" },
					],
				},
			],
		},
		{
			label: "部门",
			route: "/desk/department",
			icon: "O",
			keys: ["department", "organizational-chart"],
			items: [
				{ type: "link", label: "部门管理", route: "/desk/department", slug: "department" },
				{ type: "link", label: "架构图", route: "/desk/organizational-chart", slug: "organizational-chart" },
				{ type: "link", label: "部门报表", route: "/desk/organizational-chart/report", slug: "organization-report" },
			],
		},
		{
			label: "招聘",
			route: "/desk/recruitment",
			icon: "R",
			keys: ["recruitment", "job-opening", "job-applicant", "interview", "job-offer", "employee-referral"],
			items: [
				{ type: "link", label: "主页", route: "/desk/recruitment", slug: "recruitment" },
				{
					type: "section",
					label: "招聘管理",
					children: [
						{ label: "招聘职位", route: "/desk/job-opening", slug: "job-opening" },
						{ label: "候选人", route: "/desk/job-applicant", slug: "job-applicant" },
						{ label: "面试", route: "/desk/interview", slug: "interview" },
						{ label: "录用通知", route: "/desk/job-offer", slug: "job-offer" },
						{ label: "内推", route: "/desk/employee-referral", slug: "employee-referral" },
					],
				},
			],
		},
		{
			label: "考勤",
			route: "/desk/attendance-import-center",
			icon: "A",
			keys: [
				"attendance-import-center",
				"shift-&-attendance",
				"attendance",
				"attendance-request",
				"employee-checkin",
				"employee-attendance-tool",
				"shift-type",
				"shift-location",
				"shift-schedule",
				"leave-application",
				"leave-allocation",
				"leave-policy",
				"holiday-list",
				"monthly-attendance-sheet",
			],
			items: [
				{ type: "link", label: "主页", route: "/desk/attendance-import-center/monthly-final", slug: "attendance-import-center/monthly-final" },
				{
					type: "section",
					label: "考勤处理",
					children: [
						{ label: "日考勤", route: "/desk/attendance-import-center/daily-attendance", slug: "attendance-import-center/daily-attendance" },
						{ label: "月度终稿", route: "/desk/attendance-import-center/monthly-final", slug: "attendance-import-center/monthly-final" },
						{ label: "异常处理", route: "/desk/attendance-import-center/exceptions", slug: "attendance-import-center/exceptions" },
						{ label: "加工结果", route: "/desk/attendance-import-center/processing-results", slug: "attendance-import-center/processing-results" },
					],
				},
				{
					type: "section",
					label: "数据台账",
					children: [
						{ label: "导入批次", route: "/desk/attendance-import-center/import-batches", slug: "attendance-import-center/import-batches" },
						{ label: "人工调整记录", route: "/desk/attendance-import-center/manual-adjustments", slug: "attendance-import-center/manual-adjustments" },
					],
				},
				{
					type: "section",
					label: "规则设置",
					children: [
						{ label: "字段映射", route: "/desk/attendance-import-center/field-mapping", slug: "attendance-import-center/field-mapping" },
						{ label: "部门映射", route: "/desk/attendance-import-center/department-mapping", slug: "attendance-import-center/department-mapping" },
						{ label: "处理规则", route: "/desk/attendance-import-center/processing-rules", slug: "attendance-import-center/processing-rules" },
					],
				},
			],
		},
		{
			label: "薪酬",
			route: "/desk/payroll-input-center",
			icon: "S",
			keys: [
				"payroll-input-center",
				"salary-architecture",
				"employee-salary",
				"monthly-payroll",
				"payroll-disbursement",
				"payroll-reports",
				"payroll-analysis",
				"annual-bonus",
				"salary-slips",
				"payroll",
				"salary-slip",
				"salary-structure",
				"salary-structure-assignment",
				"payroll-entry",
				"additional-salary",
				"salary-component",
				"payroll-settings",
			],
			items: [
				{ type: "link", label: "薪酬首页", route: "/desk/payroll-input-center", slug: "payroll-input-center" },
				{
					type: "section",
					label: "本月薪资",
					children: [
						{ label: "人员范围", route: "/desk/payroll-input-center/employee-salary", slug: "employee-salary" },
						{ label: "员工定薪", route: "/desk/payroll-input-center/salary-assignments", slug: "salary-assignments" },
						{ label: "月度增减项", route: "/desk/payroll-input-center/variables", slug: "variables" },
						{ label: "薪资试算", route: "/desk/payroll-input-center/monthly-workbench", slug: "monthly-workbench" },
						{ label: "确认与发放", route: "/desk/payroll-input-center/payroll-reports", slug: "payroll-reports" },
					],
				},
				{
					type: "section",
					label: "设置",
					children: [
						{ label: "核算规则", route: "/desk/payroll-input-center/salary-rules", slug: "salary-rules" },
						{ label: "考勤计薪设置", route: "/desk/payroll-input-center/attendance-pay-rules", slug: "attendance-pay-rules" },
					],
				},
				{
					type: "section",
					label: "其他",
					children: [
						{ label: "薪资架构", route: "/desk/salary-architecture", slug: "salary-architecture" },
						{ label: "年终奖", route: "/desk/payroll-input-center/annual-bonus", slug: "annual-bonus" },
					],
				},
			],
		},
		{
			label: "审批",
			route: "/desk/workflow",
			icon: "W",
			keys: ["workflow", "workflow-action", "expense-claim", "travel-request"],
			items: [
				{ type: "link", label: "主页", route: "/desk/workflow", slug: "workflow" },
				{
					type: "section",
					label: "审批",
					children: [
						{ label: "工作流", route: "/desk/workflow", slug: "workflow" },
						{ label: "待办审批", route: "/desk/workflow-action", slug: "workflow-action" },
						{ label: "费用报销", route: "/desk/expense-claim", slug: "expense-claim" },
						{ label: "出差申请", route: "/desk/travel-request", slug: "travel-request" },
					],
				},
			],
		},
		{
			label: "培训学习",
			route: "/desk/training-program",
			icon: "T",
			keys: ["training-program", "training-event", "training-result", "training-feedback", "employee-skill-map"],
			items: [
				{ type: "link", label: "主页", route: "/desk/training-program", slug: "training-program" },
				{
					type: "section",
					label: "培训学习",
					children: [
						{ label: "培训计划", route: "/desk/training-program", slug: "training-program" },
						{ label: "培训活动", route: "/desk/training-event", slug: "training-event" },
						{ label: "培训结果", route: "/desk/training-result", slug: "training-result" },
						{ label: "培训反馈", route: "/desk/training-feedback", slug: "training-feedback" },
						{ label: "员工技能", route: "/desk/employee-skill-map", slug: "employee-skill-map" },
					],
				},
			],
		},
		{
			label: "绩效",
			route: "/desk/performance",
			icon: "K",
			keys: ["performance", "appraisal", "appraisal-cycle", "appraisal-template", "appraisal-goal", "goal"],
			items: [
				{ type: "link", label: "主页", route: "/desk/performance", slug: "performance" },
				{
					type: "section",
					label: "绩效",
					children: [
						{ label: "目标", route: "/desk/goal", slug: "goal" },
						{ label: "考核周期", route: "/desk/appraisal-cycle", slug: "appraisal-cycle" },
						{ label: "绩效考核", route: "/desk/appraisal", slug: "appraisal" },
						{ label: "考核模板", route: "/desk/appraisal-template", slug: "appraisal-template" },
					],
				},
			],
		},
	];

	function redirect_to_hrms_home() {
		var path = window.location.pathname.replace(/\/+$/, "");
		var hash = window.location.hash || "";
		if (
			(path === "/desk" && (!hash || hash === "#")) ||
			path === "/apps"
		) {
			window.location.replace("/desk/hrms-workbench");
		}
	}

	function query_hrms_scope(root, selector) {
		var scope = root && root.nodeType === 1 ? root : document;
		var matches = Array.from(scope.querySelectorAll(selector));
		if (scope.nodeType === 1 && scope.matches(selector)) {
			matches.unshift(scope);
		}
		return matches;
	}

	function hide_unneeded_menu_items(root) {
		var hidden_labels = new Set([
			"桌面",
			"Desktop",
			"网站",
			"Website",
			"编辑侧边栏",
			"Edit Sidebar",
			"刷新",
			"Refresh",
			"Reload",
			"帮助",
			"Help",
			"Delete Demo Data",
			"ERPNext设置",
			"授权控制",
		]);
		query_hrms_scope(
			root,
			[
				".dropdown-menu a",
				".dropdown-menu button",
				".dropdown-menu .dropdown-item",
				".dropdown-menu .dropdown-menu-item",
				".frappe-menu.context-menu a",
				".frappe-menu.context-menu button",
				".frappe-menu.context-menu .dropdown-menu-item",
				".frappe-menu.context-menu .menu-item-title",
			].join(", "),
		)
			.forEach(function (item) {
				var text = (item.innerText || item.textContent || "").trim();
				if (hidden_labels.has(text)) {
					var row = item.closest(".dropdown-menu-item, .dropdown-item, li, a, button") || item;
					row.style.display = "none";
				}
			});
		hide_empty_workspace_dropdowns(root);
	}

	function is_desk_home_url(href) {
		if (!href) {
			return false;
		}
		var normalized = href.replace(window.location.origin, "").replace(/\/+$/, "");
		return normalized === "/desk" || normalized === "/app" || normalized === "/apps" || normalized === "#";
	}

	function fix_desk_home_links() {
		document.querySelectorAll("a[href], button[data-route]").forEach(function (item) {
			var href = item.getAttribute("href") || item.getAttribute("data-route") || "";
			if (!is_desk_home_url(href)) {
				return;
			}
			item.setAttribute("href", "/desk/hrms-workbench");
			if (item.dataset.hrmsHomeBound === "1") {
				return;
			}
			item.dataset.hrmsHomeBound = "1";
			item.addEventListener("click", function (event) {
				event.preventDefault();
				event.stopPropagation();
				window.location.href = "/desk/hrms-workbench";
			});
		});
	}

	function escape_html(value) {
		return String(value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function normalize_slug(value) {
		return String(value || "")
			.trim()
			.toLowerCase()
			.replace(/^\/desk\/?/, "")
			.replace(/^\/app\/?/, "")
			.replace(/\/$/, "")
			.replace(/\s+/g, "-");
	}

	var WORKSPACE_ROUTE_SLUGS = {
		"工作台": "hrms-workbench",
		"人事": "employee",
		"组织": "department",
		"招聘": "recruitment",
		"考勤假期": "attendance-import-center",
		"薪酬": "payroll-input-center",
		"审批": "workflow",
		"培训学习": "training-program",
		"绩效": "performance",
		"更多": "hr-settings-center",
		"HR Setup": "hrms-workbench",
		"Personnel": "employee",
	};

	function workspace_route_slug(label) {
		return WORKSPACE_ROUTE_SLUGS[label] || normalize_slug(label);
	}

	function current_route_slug() {
		if (window.frappe && frappe.get_route) {
			var route = frappe.get_route();
			if (route && route.length) {
				if (route[0] === "Workspaces") {
					return workspace_route_slug(route[1] || route[0]);
				}
				if (route[0] === "List" || route[0] === "Form") {
					return normalize_slug(route[1] || route[0]);
				}
				if (route[0] === "query-report") {
					return normalize_slug(route[1] || route[0]);
				}
				if ((route[0] === "attendance-import-center" || route[0] === "payroll-input-center") && route[1]) {
					return normalize_slug(route[0] + "/" + route[1]);
				}
				return normalize_slug(route[0]);
			}
		}
		var query_route = new URLSearchParams(window.location.search).get("route");
		var path = query_route || window.location.pathname.replace(/^\/desk\/?/, "").replace(/\/$/, "");
		var parts = path.split("/").filter(Boolean);
		if (!parts.length) {
			return "hrms-workbench";
		}
		if (parts[0].toLowerCase() === "form" || parts[0].toLowerCase() === "list") {
			return normalize_slug(parts[1] || parts[0]);
		}
		if (parts[0].toLowerCase() === "query-report") {
			return normalize_slug(parts[1] || parts[0]);
		}
		if ((parts[0].toLowerCase() === "attendance-import-center" || parts[0].toLowerCase() === "payroll-input-center") && parts[1]) {
			return normalize_slug(parts[0] + "/" + parts[1]);
		}
		return normalize_slug(parts[0]);
	}

	var hrms_expected_route_slug = "";

	function route_to_slug(route) {
		var normalized = normalize_slug(route);
		if (normalized.indexOf("query-report/") === 0) {
			return normalize_slug(normalized.split("/")[1]);
		}
		if (normalized.indexOf("attendance-import-center/") === 0 || normalized.indexOf("payroll-input-center/") === 0) {
			return normalized;
		}
		return normalize_slug(normalized.split("/")[0]);
	}

	function stable_route_slug() {
		var current_slug = current_route_slug();
		if (!hrms_expected_route_slug) {
			return current_slug;
		}
		if (current_slug === hrms_expected_route_slug) {
			hrms_expected_route_slug = "";
			return current_slug;
		}
		// Standard Frappe lists can be opened outside our custom navigation.  In
		// that case, discard the old custom-page slug so an unrelated sidebar item
		// (for example 数据处理中心) is not kept highlighted.
		hrms_expected_route_slug = "";
		return current_slug;
	}

	function route_key_matches(slug, key) {
		return slug === key || slug.indexOf(key + "/") === 0;
	}

	function active_sidebar_module(route_slug) {
		var slug = route_slug || stable_route_slug();
		return HRMS_SIDEBAR_MODULES.find(function (module) {
			return (module.keys || []).some(function (key) {
				return route_key_matches(slug, key);
			});
		});
	}

	function route_to_parts(route) {
		var desk_route = String(route || "").replace(/^\/desk\/?/, "").replace(/^\/app\/?/, "").replace(/\/$/, "");
		return desk_route.split("/").filter(Boolean);
	}

	function announce_hrms_route_change(route) {
		hrms_expected_route_slug = route_to_slug(route);
		window.dispatchEvent(
			new CustomEvent("hrms:route-change", {
				detail: { route: route, slug: hrms_expected_route_slug },
			}),
		);
		schedule_hrms_ui_rules(0);
	}

	function navigate_hrms_sidebar(route) {
		if (window.frappe && frappe.set_route && route.indexOf("/desk/") === 0) {
			announce_hrms_route_change(route);
			var route_parts = route_to_parts(route);
			frappe.set_route.apply(frappe, route_parts);
			return;
		}
		window.location.href = route;
	}

	// Sidebar order is a personal display preference.  It intentionally stays in
	// localStorage (rather than changing Workspace records) so one HR user's
	// preferred order never changes the navigation seen by another user.
	function sidebar_preference_user() {
		var user =
			(window.frappe && frappe.session && frappe.session.user) ||
			(window.frappe && frappe.boot && frappe.boot.user && frappe.boot.user.name) ||
			"guest";
		return String(user).toLowerCase();
	}

	function sidebar_order_key(module, group) {
		return "hrms-sidebar-order:" + sidebar_preference_user() + ":" + module.label + ":" + group;
	}

	function sidebar_item_key(item) {
		return String((item && (item.slug || item.route || item.label)) || "");
	}

	function get_sidebar_order(module, group) {
		try {
			var value = JSON.parse(window.localStorage.getItem(sidebar_order_key(module, group)) || "[]");
			return Array.isArray(value) ? value : [];
		} catch (error) {
			return [];
		}
	}

	function save_sidebar_order(module, group, order) {
		try {
			window.localStorage.setItem(sidebar_order_key(module, group), JSON.stringify(order));
		} catch (error) {
			// Browsers can block localStorage in private mode. The menu remains
			// usable; only persistence is skipped in that case.
		}
	}

	function order_sidebar_items(items, module, group) {
		var saved_order = get_sidebar_order(module, group);
		if (!saved_order.length) {
			return items.slice();
		}
		var rank = new Map(saved_order.map(function (key, index) {
			return [key, index];
		}));
		return items
			.slice()
			.sort(function (left, right) {
				var left_rank = rank.has(sidebar_item_key(left)) ? rank.get(sidebar_item_key(left)) : Number.MAX_SAFE_INTEGER;
				var right_rank = rank.has(sidebar_item_key(right)) ? rank.get(sidebar_item_key(right)) : Number.MAX_SAFE_INTEGER;
				return left_rank - right_rank;
			});
	}

	function sidebar_order_signature(module) {
		var groups = ["root"];
		(module.items || []).forEach(function (item) {
			if (item.type === "section") groups.push(item.label);
		});
		return groups.map(function (group) {
			return group + ":" + JSON.stringify(get_sidebar_order(module, group));
		}).join("|");
	}

	function hrms_sidebar_link_html(item, active_slug, group) {
		var active =
			item.slug === active_slug ||
			route_to_slug(item.route) === active_slug ||
			(item.active_slugs || []).some(function (slug) {
				return slug === active_slug || route_key_matches(active_slug, slug);
			});
		return [
			'<button type="button" class="hrms-unified-sidebar-link sidebar-item-container standard-sidebar-item',
			active ? " selected active" : "",
			'" data-hrms-sidebar-item="',
			escape_html(sidebar_item_key(item)),
			'" data-hrms-sidebar-group="',
			escape_html(group || "root"),
			'" data-hrms-route="',
			escape_html(item.route),
			'" data-hrms-slug="',
			escape_html(item.slug || route_to_slug(item.route)),
			'">',
			'<span class="hrms-unified-sidebar-link__icon hrms-unified-sidebar-link__drag-handle" ',
			'role="button" tabindex="0" aria-label="长按拖动排序" title="长按拖动排序">☰</span>',
			'<span class="sidebar-item-label">',
			escape_html(item.label),
			"</span>",
			"</button>",
		].join("");
	}

	function can_access_hrms_item(item) {
		var required_roles = (item && item.roles) || [];
		if (!required_roles.length) {
			return true;
		}
		var user_roles = (window.frappe && (frappe.user_roles || (frappe.boot && frappe.boot.user && frappe.boot.user.roles))) || [];
		return required_roles.some(function (role) {
			return user_roles.indexOf(role) !== -1;
		});
	}

	function render_hrms_sidebar_items(sidebar, module, active_slug) {
		var signature = module.label + ":" + active_slug + ":" + sidebar_order_signature(module);
		if (sidebar.dataset.hrmsUnifiedSidebar === signature) {
			return;
		}
		sidebar.dataset.hrmsUnifiedSidebar = signature;
		var sidebar_collapsed = window.localStorage.getItem("hrms-unified-sidebar:collapsed") === "1";
		document.body.classList.toggle("hrms-unified-sidebar-collapsed", sidebar_collapsed);

		var body = [
			'<div class="hrms-unified-sidebar">',
			'<button type="button" class="hrms-unified-sidebar-collapse" data-hrms-unified-sidebar-collapse aria-expanded="',
			sidebar_collapsed ? "false" : "true",
			'" title="',
			escape_html(sidebar_collapsed ? "展开菜单" : "收起菜单"),
			'"><span aria-hidden="true">',
			sidebar_collapsed ? "›" : "‹",
			"</span></button>",
			'<button type="button" class="hrms-unified-sidebar-app" data-hrms-route="',
			escape_html(module.route),
			'">',
			'<span class="hrms-unified-sidebar-app__icon">',
			escape_html(module.icon || module.label.slice(0, 1)),
			"</span>",
			'<span class="hrms-unified-sidebar-app__text"><strong>',
			escape_html(module.label),
			'</strong><small>人资管理系统</small></span>',
			"</button>",
			'<div class="hrms-unified-sidebar-list">',
		];

		order_sidebar_items(module.items || [], module, "root").forEach(function (item) {
			if (!can_access_hrms_item(item)) {
				return;
			}
			if (item.type === "link") {
				body.push(hrms_sidebar_link_html(item, active_slug, "root"));
				return;
			}
			var visible_children = (item.children || []).filter(can_access_hrms_item);
			if (!visible_children.length) {
				return;
			}

			var section_key = module.label + ":" + item.label;
			var section_collapsed = window.localStorage.getItem("hrms-sidebar-section:" + section_key) === "closed";
			body.push(
				'<div class="hrms-unified-sidebar-section sidebar-item-container section-item',
				section_collapsed ? " is-collapsed" : "",
				'" data-hrms-sidebar-section="',
				escape_html(item.label),
				'">',
				'<button type="button" class="hrms-unified-sidebar-section__button standard-sidebar-item item-anchor section-break">',
				'<span class="sidebar-item-label">',
				escape_html(item.label),
				"</span>",
				'<span class="hrms-unified-sidebar-section__chevron">⌄</span>',
				"</button>",
				'<div class="hrms-unified-sidebar-section__children sidebar-child-item nested-container',
				section_collapsed ? " hrms-sidebar-child-hidden" : "",
				'">',
			);
			order_sidebar_items(visible_children, module, item.label).forEach(function (child) {
				body.push(hrms_sidebar_link_html(child, active_slug, item.label));
			});
			body.push("</div></div>");
		});

		body.push("</div></div>");
		sidebar.innerHTML = body.join("");

		sidebar.querySelectorAll("[data-hrms-route]").forEach(function (link) {
			link.addEventListener("click", function (event) {
				if (event.target.closest(".hrms-unified-sidebar-link__drag-handle")) {
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				navigate_hrms_sidebar(link.getAttribute("data-hrms-route"));
			});
		});

		var collapse_button = sidebar.querySelector("[data-hrms-unified-sidebar-collapse]");
		if (collapse_button) {
			collapse_button.addEventListener("click", function (event) {
				event.preventDefault();
				event.stopPropagation();
				var collapsed = !document.body.classList.contains("hrms-unified-sidebar-collapsed");
				document.body.classList.toggle("hrms-unified-sidebar-collapsed", collapsed);
				window.localStorage.setItem("hrms-unified-sidebar:collapsed", collapsed ? "1" : "0");
				collapse_button.setAttribute("aria-expanded", collapsed ? "false" : "true");
				collapse_button.setAttribute("title", collapsed ? "展开菜单" : "收起菜单");
				collapse_button.querySelector("span").textContent = collapsed ? "›" : "‹";
			});
		}

		sidebar.querySelectorAll("[data-hrms-sidebar-section]").forEach(function (section) {
			var trigger = section.querySelector(".hrms-unified-sidebar-section__button");
			var children = section.querySelector(".hrms-unified-sidebar-section__children");
			if (!trigger || !children) {
				return;
			}
			trigger.addEventListener("click", function (event) {
				event.preventDefault();
				event.stopPropagation();
				var collapsed = !section.classList.contains("is-collapsed");
				section.classList.toggle("is-collapsed", collapsed);
				children.classList.toggle("hrms-sidebar-child-hidden", collapsed);
				window.localStorage.setItem("hrms-sidebar-section:" + module.label + ":" + section.dataset.hrmsSidebarSection, collapsed ? "closed" : "open");
			});
		});

		enable_sidebar_item_sorting(sidebar, module, active_slug);
	}

	function enable_sidebar_item_sorting(sidebar, module, active_slug) {
		var drag_state = null;
		var long_press_timer = 0;

		function clear_drag_state() {
			window.clearTimeout(long_press_timer);
			long_press_timer = 0;
			if (!drag_state) return;
			if (drag_state.item) drag_state.item.classList.remove("hrms-sidebar-item-dragging");
			document.body.classList.remove("hrms-sidebar-reordering");
			drag_state = null;
		}

		function finish_drag(event) {
			if (!drag_state) return;
			var state = drag_state;
			clear_drag_state();
			if (!state.started) return;
			var order = Array.from(state.container.querySelectorAll(":scope > [data-hrms-sidebar-item]")).map(function (item) {
				return item.dataset.hrmsSidebarItem;
			});
			save_sidebar_order(module, state.group, order);
			render_hrms_sidebar_items(sidebar, module, active_slug);
			if (event) {
				event.preventDefault();
			}
		}

		function move_dragged_item(event) {
			if (!drag_state || !drag_state.started) return;
			var target = document.elementFromPoint(event.clientX, event.clientY);
			var target_item = target && target.closest("[data-hrms-sidebar-item]");
			if (!target_item || target_item === drag_state.item || target_item.parentElement !== drag_state.container) return;
			var bounds = target_item.getBoundingClientRect();
			if (event.clientY < bounds.top + bounds.height / 2) {
				drag_state.container.insertBefore(drag_state.item, target_item);
			} else {
				drag_state.container.insertBefore(drag_state.item, target_item.nextSibling);
			}
			event.preventDefault();
		}

		sidebar.querySelectorAll(".hrms-unified-sidebar-link__drag-handle").forEach(function (handle) {
			handle.addEventListener("pointerdown", function (event) {
			if (event.button != null && event.button !== 0) return;
			var item = handle.closest("[data-hrms-sidebar-item]");
			if (!item) return;
			var group = item.dataset.hrmsSidebarGroup || "root";
			var container =
				group === "root"
					? item.parentElement
					: item.closest(".hrms-unified-sidebar-section__children");
			if (!container) return;
			event.preventDefault();
			event.stopPropagation();
			drag_state = { item: item, container: container, group: group, started: false };
			try {
				handle.setPointerCapture(event.pointerId);
			} catch (error) {
				// Pointer capture is not available in a few older embedded browsers.
			}
			long_press_timer = window.setTimeout(function () {
				if (!drag_state) return;
				drag_state.started = true;
				drag_state.item.classList.add("hrms-sidebar-item-dragging");
				document.body.classList.add("hrms-sidebar-reordering");
			}, 180);
		});

		handle.addEventListener("pointermove", move_dragged_item);
		handle.addEventListener("pointerup", finish_drag);
		handle.addEventListener("pointercancel", clear_drag_state);
		handle.addEventListener("keydown", function (event) {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				frappe.show_alert({ message: __("长按并拖动“三横线”即可调整此分组内的顺序。"), indicator: "blue" });
			}
		});
	});
}

	function apply_hrms_sidebar_shell() {
		var active_slug = stable_route_slug();
		var module = active_sidebar_module(active_slug);
		if (!module) {
			document.body.classList.remove("hrms-module-shell");
			return;
		}
		document.body.classList.add("hrms-module-shell");

		var sidebar =
			document.querySelector(".body-sidebar-container") ||
			document.querySelector(".layout-side-section") ||
			document.querySelector(".desk-sidebar") ||
			document.querySelector(".standard-sidebar");
		if (!sidebar) {
			return;
		}
		render_hrms_sidebar_items(sidebar, module, active_slug);
	}

	function hide_frappe_breadcrumbs() {
		document.body.classList.add("hrms-hide-breadcrumbs");
	}

	function get_sidebar_label(item) {
		if (item && item.classList && item.classList.contains("section-item")) {
			var direct_header = Array.from(item.children || []).find(function (child) {
				return (
					child.classList.contains("standard-sidebar-item") ||
					(child.classList.contains("item-anchor") && child.classList.contains("section-break"))
				);
			});
			if (direct_header) {
				return (direct_header.innerText || direct_header.textContent || "").trim();
			}
		}
		var label =
			item.querySelector(".sidebar-item-label, .link-content, .item-label, .ellipsis") ||
			item.querySelector("span") ||
			item;
		return (label.innerText || label.textContent || "").trim();
	}

	function is_sidebar_section(item) {
		if (!item || !item.classList) {
			return false;
		}
		var label = get_sidebar_label(item);
		return (
			item.classList.contains("section-item") ||
			sidebar_section_labels.has(label) ||
			item.classList.contains("sidebar-section") ||
			item.classList.contains("section-title") ||
			item.getAttribute("data-type") === "Section Break"
		);
	}

	function get_sidebar_items() {
		return Array.from(
			document.querySelectorAll(
				[
					".body-sidebar .sidebar-item-container.section-item",
					".body-sidebar .sidebar-item-container",
					".layout-side-section .sidebar-item",
					".desk-sidebar .sidebar-item",
					".standard-sidebar .sidebar-item",
					".standard-sidebar-section .sidebar-item",
				].join(", "),
			),
		);
	}

	function get_sidebar_section_header(section) {
		if (!section || !section.classList) {
			return section;
		}
		if (section.classList.contains("section-item")) {
			return (
				Array.from(section.children || []).find(function (child) {
					return (
						child.classList.contains("standard-sidebar-item") ||
						(child.classList.contains("item-anchor") && child.classList.contains("section-break"))
					);
				}) || section
			);
		}
		return section;
	}

	function get_sidebar_section_children(section) {
		var nested_children = Array.from(section.querySelectorAll(":scope > .sidebar-child-item.nested-container"));
		if (nested_children.length) {
			return nested_children;
		}
		var items = get_sidebar_items();
		var start = items.indexOf(section);
		var children = [];
		if (start === -1) {
			return children;
		}
		for (var i = start + 1; i < items.length; i++) {
			if (is_sidebar_section(items[i])) {
				break;
			}
			children.push(items[i]);
		}
		return children;
	}

	function toggle_sidebar_section(section) {
		var collapsed = !section.classList.contains("is-collapsed");
		section.classList.toggle("is-collapsed", collapsed);
		get_sidebar_section_children(section).forEach(function (child) {
			child.classList.toggle("hrms-sidebar-child-hidden", collapsed);
			child.setAttribute("aria-hidden", collapsed ? "true" : "false");
		});
	}

	function enable_sidebar_section_collapse() {
		get_sidebar_items().forEach(function (item) {
			if (!is_sidebar_section(item)) {
				return;
			}
			var header = get_sidebar_section_header(item);
			item.classList.add("hrms-sidebar-section-toggle");
			header.classList.add("hrms-sidebar-section-toggle-header");
			header.setAttribute("role", "button");
			header.setAttribute("tabindex", "0");
			if (item.dataset.hrmsSectionBound === "1") {
				return;
			}
			item.dataset.hrmsSectionBound = "1";
			header.addEventListener("click", function (event) {
				event.preventDefault();
				event.stopPropagation();
				toggle_sidebar_section(item);
			});
			header.addEventListener("keydown", function (event) {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					toggle_sidebar_section(item);
				}
			});
		});
	}

	function hide_empty_workspace_dropdowns(root) {
		query_hrms_scope(root, ".dropdown-menu, .frappe-menu.context-menu").forEach(function (menu) {
			var visible_items = Array.from(menu.querySelectorAll(".dropdown-menu-item, .dropdown-item, li, a, button")).filter(function (item) {
				return item.style.display !== "none" && (item.innerText || item.textContent || "").trim();
			});
			var text = (menu.innerText || menu.textContent || "").trim();
			if (
				!visible_items.length ||
				["桌面", "Desktop", "网站", "Website", "编辑侧边栏", "Edit Sidebar", "Delete Demo Data"].some(function (
					label,
				) {
					return text.indexOf(label) !== -1;
				})
			) {
				menu.classList.add("hrms-hidden-workspace-dropdown");
			}
		});
	}

	function localize_dynamic_text(root) {
		var scope = root && root.nodeType === 1 ? root : document.body;
		if (!scope) {
			return;
		}

		function translate_known_text(value) {
			return String(value || "").replace(text_replacement_pattern, function (source) {
				return text_replacements[source];
			});
		}

		if (document.title && text_replacements[document.title]) {
			document.title = text_replacements[document.title];
		}

		query_hrms_scope(scope, "input, textarea").forEach(function (field) {
			var placeholder = field.getAttribute("placeholder");
			if (placeholder && (technical_field_labels[placeholder] || text_replacements[placeholder])) {
				field.setAttribute("placeholder", technical_field_labels[placeholder] || text_replacements[placeholder]);
			}
		});

		query_hrms_scope(scope, "[title], [data-original-title], [data-label], [aria-label]").forEach(function (field) {
			["title", "data-original-title", "data-label", "aria-label"].forEach(function (attribute) {
				var value = field.getAttribute(attribute);
				var translated = translate_known_text(value);
				if (value && translated !== value) {
					field.setAttribute(attribute, translated);
				}
			});
		});

		// List views keep a second copy of the primary action label as visible
		// button text. Keep it aligned with the translated data-label; changing
		// textContent does not replace the button itself or its click handler.
		query_hrms_scope(scope, ".primary-action[data-label]").forEach(function (button) {
			var visible_label = button.textContent || "";
			var translated_label = translate_known_text(visible_label);
			if (translated_label !== visible_label) {
				button.textContent = translated_label;
			}
		});

		var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
		var node;
		while ((node = walker.nextNode())) {
			if (node.parentElement && node.parentElement.closest("script, style, noscript")) {
				continue;
			}
			var original_value = node.nodeValue;
			var text = node.nodeValue.trim();
			if (text_replacements[text]) {
				var exact_value = original_value.replace(text, text_replacements[text]);
				if (exact_value !== original_value) {
					node.nodeValue = exact_value;
				}
				continue;
			}
			var localized_value = translate_known_text(original_value);
			localized_value = localized_value.replace(/来自\s+Employee\s+标准字段/g, "来自员工标准字段");
			localized_value = localized_value.replace(/来自\s+Salary Structure\s+标准字段/g, "来自薪资结构标准字段");
			localized_value = localized_value.replace(/来自\s+Salary Detail\s+标准字段/g, "来自薪资明细标准字段");
			localized_value = localized_value.replace(/来自\s+Employee\s+/g, "来自员工");
			localized_value = localized_value.replace(/来自\s+Salary Structure\s+/g, "来自薪资结构");
			localized_value = localized_value.replace(/来自\s+Salary Detail\s+/g, "来自薪资明细");
			localized_value = localized_value.replace(/\bEmployee\b/g, "员工");
			localized_value = localized_value.replace(/\bSalary Structure\b/g, "薪资结构");
			localized_value = localized_value.replace(/\bSalary Detail\b/g, "薪资明细");
			localized_value = localized_value.replace(/\bCompany\b/g, "公司");
			if (/^Depend/.test(localized_value)) {
				localized_value = localized_value.replace(/Depend\.\.\.|Depen\.\.\.|Depend.*$/g, "按出勤");
			}
			if (/^Is Tax/.test(localized_value)) {
				localized_value = localized_value.replace(/Is Tax.*$/g, "计税");
			}
			if (/^Accrua/.test(localized_value)) {
				localized_value = localized_value.replace(/Accrua.*$/g, "计提");
			}
			// The observer watches characterData. Writing the same value feeds the
			// localization pass back into itself and keeps the main thread busy.
			if (localized_value !== original_value) {
				node.nodeValue = localized_value;
			}
		}
	}

	function apply_hrms_shell_rules() {
		hide_frappe_breadcrumbs();
		fix_desk_home_links();
		apply_hrms_sidebar_shell();
		enable_sidebar_section_collapse();
		hide_personnel_social_metadata();
	}

	// The sidebar is the primary navigation.  Optional improvements such as
	// localization must never stop it from rendering when one of them fails
	// during Desk startup.
	function run_hrms_shell_step(label, callback) {
		try {
			return callback();
		} catch (error) {
			console.error("[HRMS shell] " + label + " failed.", error);
			return undefined;
		}
	}

	function hide_personnel_social_metadata() {
		var module = active_sidebar_module(stable_route_slug());
		var is_personnel_module = module && module.label === "人事";
		document.body.classList.toggle("hrms-personnel-social-controls-hidden", Boolean(is_personnel_module));
	}

	function apply_hrms_ui_rules() {
		run_hrms_shell_step("rendering navigation", apply_hrms_shell_rules);
		run_hrms_shell_step("filtering utility menus", hide_unneeded_menu_items);
		run_hrms_shell_step("localizing page text", localize_dynamic_text);
	}

	var hrms_shell_localization_timer = 0;

	function schedule_hrms_localization(delay) {
		window.clearTimeout(hrms_shell_localization_timer);
		hrms_shell_localization_timer = window.setTimeout(function () {
			hide_unneeded_menu_items();
			localize_dynamic_text();
		}, delay == null ? 180 : delay);
	}

	var hrms_shell_window_events_bound = false;
	var hrms_shell_router_bound = false;
	var hrms_shell_ui_scheduled = false;
	var hrms_shell_ui_timer = 0;
	var hrms_shell_ui_followup = 0;

	function schedule_hrms_ui_rules(delay) {
		window.clearTimeout(hrms_shell_ui_timer);
		hrms_shell_ui_timer = window.setTimeout(function () {
			if (hrms_shell_ui_scheduled) {
				return;
			}
			hrms_shell_ui_scheduled = true;
		window.requestAnimationFrame(function () {
				hrms_shell_ui_scheduled = false;
				run_hrms_shell_step("redirecting the Desk home", redirect_to_hrms_home);
				run_hrms_shell_step("rendering navigation", apply_hrms_shell_rules);
				schedule_hrms_localization(220);
				window.clearTimeout(hrms_shell_ui_followup);
				hrms_shell_ui_followup = window.setTimeout(function () {
					run_hrms_shell_step("refreshing navigation", apply_hrms_sidebar_shell);
				}, 120);
			});
		}, delay == null ? 80 : delay);
	}

	function bind_hrms_shell_route_events() {
		if (!hrms_shell_window_events_bound) {
			window.addEventListener("hashchange", function () {
				schedule_hrms_ui_rules(0);
			});
			window.addEventListener("popstate", function () {
				schedule_hrms_ui_rules(0);
			});
			window.addEventListener("hrms:route-change", function (event) {
				if (event.detail && event.detail.slug) {
					hrms_expected_route_slug = event.detail.slug;
				} else if (event.detail && event.detail.route) {
					hrms_expected_route_slug = route_to_slug(event.detail.route);
				}
				schedule_hrms_ui_rules(0);
			});
			hrms_shell_window_events_bound = true;
		}

		if (!hrms_shell_router_bound && window.frappe && frappe.router && frappe.router.on) {
			frappe.router.on("change", function () {
				schedule_hrms_ui_rules(0);
			});
			hrms_shell_router_bound = true;
		}
	}

	function is_hrms_shell_node(node) {
		if (!node || node.nodeType !== 1) {
			return false;
		}
		return Boolean(
			node.matches(".hrms-unified-sidebar, #hrms-top-module-nav") ||
				node.closest(".hrms-unified-sidebar, #hrms-top-module-nav"),
		);
	}

	function should_ignore_hrms_shell_mutation(mutation) {
		if (is_hrms_shell_node(mutation.target)) {
			return true;
		}
		var changed_nodes = Array.from(mutation.addedNodes || []).concat(Array.from(mutation.removedNodes || []));
		return changed_nodes.length > 0 && changed_nodes.every(is_hrms_shell_node);
	}

	var hrms_dynamic_localization_timer = 0;
	var hrms_dynamic_localization_idle = 0;
	var hrms_dynamic_localization_nodes = new Set();

	function compact_localization_roots(nodes) {
		var node_set = new Set(nodes);
		return nodes.filter(function (node) {
			var parent = node.parentElement;
			while (parent) {
				if (node_set.has(parent)) return false;
				parent = parent.parentElement;
			}
			return true;
		});
	}

	function flush_hrms_dynamic_localization() {
		hrms_dynamic_localization_idle = 0;
		var pending_nodes = compact_localization_roots(Array.from(hrms_dynamic_localization_nodes));
		hrms_dynamic_localization_nodes.clear();
		pending_nodes.forEach(function (node) {
			if (!node.isConnected) {
				return;
			}
			hide_unneeded_menu_items(node);
			localize_dynamic_text(node);
		});
	}

	function schedule_hrms_dynamic_localization(nodes) {
		nodes.forEach(function (node) {
			var element = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
			if (!element || element.nodeType !== 1 || is_hrms_shell_node(element)) {
				return;
			}
			hrms_dynamic_localization_nodes.add(element);
		});
		if (!hrms_dynamic_localization_nodes.size) {
			return;
		}
		window.clearTimeout(hrms_dynamic_localization_timer);
		hrms_dynamic_localization_timer = window.setTimeout(function () {
			if (window.requestIdleCallback) {
				if (hrms_dynamic_localization_idle) window.cancelIdleCallback(hrms_dynamic_localization_idle);
				hrms_dynamic_localization_idle = window.requestIdleCallback(flush_hrms_dynamic_localization, { timeout: 250 });
				return;
			}
			flush_hrms_dynamic_localization();
		}, 40);
	}

	function mutation_needs_hrms_shell_refresh(mutation) {
		var nodes = Array.from(mutation.addedNodes || []);
		return nodes.some(function (node) {
			var element = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
			return Boolean(
				element &&
					element.nodeType === 1 &&
					(element.matches(".desk-sidebar, .navbar, .page-head") ||
						element.querySelector(".desk-sidebar, .navbar, .page-head")),
			);
		});
	}

	run_hrms_shell_step("redirecting the Desk home", redirect_to_hrms_home);
	apply_hrms_ui_rules();
	run_hrms_shell_step("binding route events", bind_hrms_shell_route_events);
	new MutationObserver(function (mutations) {
		run_hrms_shell_step("binding route events", bind_hrms_shell_route_events);
		if (mutations.length && mutations.every(should_ignore_hrms_shell_mutation)) {
			return;
		}
		if (mutations.some(mutation_needs_hrms_shell_refresh)) {
			schedule_hrms_ui_rules(120);
			return;
		}
		var changed_nodes = [];
		mutations.forEach(function (mutation) {
			if (mutation.type === "attributes" || mutation.type === "characterData") {
				changed_nodes.push(mutation.target);
			}
			changed_nodes.push.apply(changed_nodes, Array.from(mutation.addedNodes || []));
		});
		schedule_hrms_dynamic_localization(changed_nodes);
	}).observe(document.documentElement, {
		childList: true,
		subtree: true,
		// Frappe often creates a list-view button first and fills its label later by
		// replacing the text node. Observe that update as well so custom DocType
		// names do not fall back to English after the page has already rendered.
		characterData: true,
		attributes: true,
		attributeFilter: ["data-label", "title", "data-original-title", "aria-label"],
	});
})();
