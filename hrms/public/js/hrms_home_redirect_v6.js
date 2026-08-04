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

	var HRMS_ENSURED_PAGE_SLUGS = new Set([
		"employee-detail",
		"employee-archive",
		"employee-roster-import",
		"employee-roster-export",
		"personnel-reports",
		"staff-attribute-settings",
		"hr-settings-center",
		"hrms-developer-center",
		"hrms-model-center",
		"hrms-access-center",
		"employee-property-history",
		"attendance-import-center",
		"payroll-input-center",
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
						{ label: "人事", route: "/desk/personnel", slug: "personnel" },
						{ label: "组织", route: "/desk/department", slug: "department" },
						{ label: "招聘", route: "/desk/recruitment", slug: "recruitment" },
						{ label: "考勤假期", route: "/desk/attendance-import-center", slug: "attendance-import-center" },
						{ label: "薪酬", route: "/desk/payroll-input-center", slug: "payroll-input-center" },
					],
				},
			],
		},
		{
			label: "人事",
			route: "/desk/personnel",
			icon: "P",
			keys: [
				"personnel",
				"employee",
				"employee-detail",
				"employee-archive",
				"employee-roster-import",
				"employee-roster-export",
				"personnel-reports",
				"staff-attribute-settings",
				"employee-onboarding",
				"employee-promotion",
				"employee-separation",
				"employee-transfer",
				"employee-property-history",
				"employee-skill-map",
				"employee-grievance",
				"exit-interview",
			],
			items: [
				{ type: "link", label: "主页", route: "/desk/personnel", slug: "personnel" },
				{
					type: "section",
					label: "员工管理",
					children: [
						{ label: "员工花名册", route: "/desk/employee", slug: "employee" },
						{ label: "员工档案库", route: "/desk/employee-archive", slug: "employee-archive" },
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
						{ label: "人事异动", route: "/desk/employee-transfer", slug: "employee-transfer" },
						{ label: "任职记录", route: "/desk/employee-property-history", slug: "employee-property-history" },
						{ label: "培训经历", route: "/desk/employee-skill-map", slug: "employee-skill-map" },
						{ label: "奖惩记录", route: "/desk/employee-grievance", slug: "employee-grievance" },
						{ label: "离职面谈", route: "/desk/exit-interview", slug: "exit-interview" },
					],
				},
			],
		},
		{
			label: "组织",
			route: "/desk/department",
			icon: "O",
			keys: ["department", "organizational-chart", "staffing-plan"],
			items: [
				{ type: "link", label: "组织管理", route: "/desk/department", slug: "department" },
				{ type: "link", label: "架构图", route: "/desk/organizational-chart", slug: "organizational-chart" },
				{ type: "link", label: "组织报表", route: "/desk/staffing-plan", slug: "staffing-plan" },
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
			label: "考勤假期",
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
				{ type: "link", label: "主页", route: "/desk/attendance-import-center/summary", slug: "attendance-import-center/summary" },
				{
					type: "section",
					label: "考勤统计",
					children: [
						{ label: "考勤导入中心", route: "/desk/attendance-import-center/import", slug: "attendance-import-center/import" },
						{ label: "统计首页", route: "/desk/attendance-import-center/summary", slug: "attendance-import-center/summary" },
						{ label: "每日考勤", route: "/desk/attendance-import-center/daily", slug: "attendance-import-center/daily" },
						{ label: "月考勤表", route: "/desk/attendance-import-center/monthly", slug: "attendance-import-center/monthly" },
						{ label: "考勤报表", route: "/desk/attendance-import-center/reports", slug: "attendance-import-center/reports" },
						{ label: "考勤确认", route: "/desk/attendance-import-center/exceptions", slug: "attendance-import-center/exceptions" },
					],
				},
				{
					type: "section",
					label: "明细记录",
					children: [
						{ label: "打卡记录", route: "/desk/attendance-import-center/clock-records", slug: "attendance-import-center/clock-records" },
						{ label: "补卡记录", route: "/desk/attendance-import-center/makeup-records", slug: "attendance-import-center/makeup-records" },
						{ label: "请假记录", route: "/desk/attendance-import-center/leave-records", slug: "attendance-import-center/leave-records" },
						{ label: "外出记录", route: "/desk/attendance-import-center/outing-records", slug: "attendance-import-center/outing-records" },
						{ label: "出差记录", route: "/desk/attendance-import-center/trip-records", slug: "attendance-import-center/trip-records" },
						{ label: "加班记录", route: "/desk/attendance-import-center/overtime-records", slug: "attendance-import-center/overtime-records" },
					],
				},
				{
					type: "section",
					label: "考勤管理",
					children: [
						{ label: "字段管理", route: "/desk/attendance-import-center/field-rules", slug: "attendance-import-center/field-rules" },
						{ label: "自定义规则", route: "/desk/attendance-import-center/custom-rules", slug: "attendance-import-center/custom-rules" },
						{ label: "考勤分组", route: "/desk/attendance-import-center/groups", slug: "attendance-import-center/groups" },
						{ label: "排班管理", route: "/desk/attendance-import-center/schedule", slug: "attendance-import-center/schedule" },
						{ label: "考勤规则", route: "/desk/attendance-import-center/rules", slug: "attendance-import-center/rules" },
						{ label: "打卡方式", route: "/desk/attendance-import-center/clock-settings", slug: "attendance-import-center/clock-settings" },
						{ label: "考勤设置", route: "/desk/attendance-import-center/settings", slug: "attendance-import-center/settings" },
						{ label: "钉钉打卡对接", route: "/desk/attendance-import-center/dingtalk", slug: "attendance-import-center/dingtalk" },
					],
				},
				{
					type: "section",
					label: "绩效奖惩关联",
					children: [
						{ label: "苹果树", route: "/desk/attendance-import-center/apple-rules", slug: "attendance-import-center/apple-rules" },
						{ label: "7S", route: "/desk/attendance-import-center/seven-s-rules", slug: "attendance-import-center/seven-s-rules" },
						{ label: "KPI", route: "/desk/attendance-import-center/kpi-rules", slug: "attendance-import-center/kpi-rules" },
					],
				},
				{
					type: "section",
					label: "假期管理",
					children: [
						{ label: "请假申请", route: "/desk/leave-application", slug: "leave-application" },
						{ label: "假期分配", route: "/desk/leave-allocation", slug: "leave-allocation" },
						{ label: "假期政策", route: "/desk/leave-policy", slug: "leave-policy" },
						{ label: "假期列表", route: "/desk/holiday-list", slug: "holiday-list" },
						{ label: "Frappe月度考勤表", route: "/desk/query-report/Monthly Attendance Sheet", slug: "monthly-attendance-sheet" },
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
				"employee-salary",
				"monthly-payroll",
				"payroll-disbursement",
				"data-closure",
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
				{ type: "link", label: "主页", route: "/desk/payroll-input-center", slug: "payroll-input-center" },
				{
					type: "section",
					label: "薪酬管理",
					children: [
						{ label: "月工资表", route: "/desk/payroll-input-center/monthly-payroll", slug: "monthly-payroll" },
						{ label: "工资发放", route: "/desk/payroll-input-center/payroll-disbursement", slug: "payroll-disbursement" },
						{ label: "员工薪资", route: "/desk/payroll-input-center/employee-salary", slug: "employee-salary" },
						{ label: "薪酬报表", route: "/desk/payroll-input-center/payroll-reports", slug: "payroll-reports" },
						{ label: "薪酬分析", route: "/desk/payroll-input-center/payroll-analysis", slug: "payroll-analysis" },
						{ label: "计薪规则", route: "/desk/payroll-input-center/salary-rules", slug: "salary-rules" },
						{ label: "薪资主数据", route: "/desk/payroll-input-center/salary-master", slug: "salary-master" },
						{ label: "福利扣款来源", route: "/desk/payroll-input-center/welfare-sources", slug: "welfare-sources" },
						{ label: "数据闭环导入", route: "/desk/payroll-input-center/data-closure", slug: "data-closure" },
						{ label: "变量导入", route: "/desk/payroll-input-center/variables", slug: "variables" },
						{ label: "薪资输入表", route: "/desk/payroll-input-center/inputs", slug: "inputs" },
						{ label: "薪资结算表", route: "/desk/payroll-input-center/settlements", slug: "settlements" },
					],
				},
				{
					type: "section",
					label: "薪酬设置",
					children: [
						{ label: "薪资设置", route: "/desk/payroll-input-center/salary-rules", slug: "salary-rules" },
						{ label: "年终奖计算", route: "/desk/payroll-input-center/annual-bonus", slug: "annual-bonus" },
						{ label: "发送工资条", route: "/desk/payroll-input-center/salary-slips", slug: "salary-slips" },
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

	function hide_unneeded_menu_items() {
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
		document
			.querySelectorAll(
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
		hide_empty_workspace_dropdowns();
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
		"人事": "personnel",
		"组织": "department",
		"招聘": "recruitment",
		"考勤假期": "attendance-import-center",
		"薪酬": "payroll-input-center",
		"审批": "workflow",
		"培训学习": "training-program",
		"绩效": "performance",
		"更多": "hr-settings-center",
		"HR Setup": "hrms-workbench",
		"Personnel": "personnel",
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
			var desk_route = route_parts[0] || "";
			if (HRMS_ENSURED_PAGE_SLUGS.has(desk_route)) {
				frappe
					.call("hrms.api.employee_field_template.ensure_personnel_pages")
					.always(function () {
						frappe.set_route.apply(frappe, route_parts);
					});
				return;
			}
			frappe.set_route.apply(frappe, route_parts);
			return;
		}
		window.location.href = route;
	}

	function hrms_sidebar_link_html(item, active_slug) {
		var active =
			item.slug === active_slug ||
			route_to_slug(item.route) === active_slug ||
			(item.active_slugs || []).some(function (slug) {
				return slug === active_slug || route_key_matches(active_slug, slug);
			});
		return [
			'<button type="button" class="hrms-unified-sidebar-link sidebar-item-container standard-sidebar-item',
			active ? " selected active" : "",
			'" data-hrms-route="',
			escape_html(item.route),
			'" data-hrms-slug="',
			escape_html(item.slug || route_to_slug(item.route)),
			'">',
			'<span class="hrms-unified-sidebar-link__icon">☰</span>',
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
		var signature = module.label + ":" + active_slug;
		if (sidebar.dataset.hrmsUnifiedSidebar === signature) {
			return;
		}
		sidebar.dataset.hrmsUnifiedSidebar = signature;

		var body = [
			'<div class="hrms-unified-sidebar">',
			'<button type="button" class="hrms-unified-sidebar-app" data-hrms-route="',
			escape_html(module.route),
			'">',
			'<span class="hrms-unified-sidebar-app__icon">',
			escape_html(module.icon || module.label.slice(0, 1)),
			"</span>",
			'<span class="hrms-unified-sidebar-app__text"><strong>',
			escape_html(module.label),
			'</strong><small>人资管理系统</small></span>',
			'<span class="hrms-unified-sidebar-app__chevron">⌄</span>',
			"</button>",
			'<div class="hrms-unified-sidebar-list">',
		];
		if (!module.contextual) {
			body.push(
				'<button type="button" class="hrms-unified-sidebar-link sidebar-item-container standard-sidebar-item" data-hrms-route="/desk/notifications">',
				'<span class="hrms-unified-sidebar-link__icon">♢</span><span class="sidebar-item-label">通知</span>',
				"</button>",
			);
		}

		(module.items || []).forEach(function (item) {
			if (!can_access_hrms_item(item)) {
				return;
			}
			if (item.type === "link") {
				body.push(hrms_sidebar_link_html(item, active_slug));
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
			visible_children.forEach(function (child) {
				body.push(hrms_sidebar_link_html(child, active_slug));
			});
			body.push("</div></div>");
		});

		body.push("</div></div>");
		sidebar.innerHTML = body.join("");

		sidebar.querySelectorAll("[data-hrms-route]").forEach(function (link) {
			link.addEventListener("click", function (event) {
				event.preventDefault();
				event.stopPropagation();
				navigate_hrms_sidebar(link.getAttribute("data-hrms-route"));
			});
		});

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

	function hide_empty_workspace_dropdowns() {
		document.querySelectorAll(".dropdown-menu, .frappe-menu.context-menu").forEach(function (menu) {
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

	function localize_dynamic_text() {
		function translate_known_text(value) {
			var translated = value || "";
			Object.keys(text_replacements).forEach(function (source) {
				if (source && translated.indexOf(source) !== -1) {
					translated = translated.split(source).join(text_replacements[source]);
				}
			});
			return translated;
		}

		if (document.title && text_replacements[document.title]) {
			document.title = text_replacements[document.title];
		}

		document.querySelectorAll("input, textarea").forEach(function (field) {
			var placeholder = field.getAttribute("placeholder");
			if (placeholder && (technical_field_labels[placeholder] || text_replacements[placeholder])) {
				field.setAttribute("placeholder", technical_field_labels[placeholder] || text_replacements[placeholder]);
			}
		});

		document.querySelectorAll("[title], [data-original-title], [data-label], [aria-label]").forEach(function (field) {
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
		document.querySelectorAll(".primary-action[data-label]").forEach(function (button) {
			var visible_label = button.textContent || "";
			var translated_label = translate_known_text(visible_label);
			if (translated_label !== visible_label) {
				button.textContent = translated_label;
			}
		});

		var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		var node;
		while ((node = walker.nextNode())) {
			if (node.parentElement && node.parentElement.closest("script, style, noscript")) {
				continue;
			}
			var text = node.nodeValue.trim();
			if (text_replacements[text]) {
				node.nodeValue = node.nodeValue.replace(text, text_replacements[text]);
				continue;
			}
			Object.keys(text_replacements).forEach(function (source) {
				if (source && node.nodeValue.indexOf(source) !== -1) {
					node.nodeValue = node.nodeValue.split(source).join(text_replacements[source]);
				}
			});
			node.nodeValue = node.nodeValue.replace(/来自\s+Employee\s+标准字段/g, "来自员工标准字段");
			node.nodeValue = node.nodeValue.replace(/来自\s+Salary Structure\s+标准字段/g, "来自薪资结构标准字段");
			node.nodeValue = node.nodeValue.replace(/来自\s+Salary Detail\s+标准字段/g, "来自薪资明细标准字段");
			node.nodeValue = node.nodeValue.replace(/来自\s+Employee\s+/g, "来自员工");
			node.nodeValue = node.nodeValue.replace(/来自\s+Salary Structure\s+/g, "来自薪资结构");
			node.nodeValue = node.nodeValue.replace(/来自\s+Salary Detail\s+/g, "来自薪资明细");
			node.nodeValue = node.nodeValue.replace(/标准字段/g, "标准字段");
			node.nodeValue = node.nodeValue.replace(/\bEmployee\b/g, "员工");
			node.nodeValue = node.nodeValue.replace(/\bSalary Structure\b/g, "薪资结构");
			node.nodeValue = node.nodeValue.replace(/\bSalary Detail\b/g, "薪资明细");
			node.nodeValue = node.nodeValue.replace(/\bCompany\b/g, "公司");
			node.nodeValue = node.nodeValue.replace(/\bCNY\b/g, "CNY");
			if (/^Depend/.test(node.nodeValue)) {
				node.nodeValue = node.nodeValue.replace(/Depend\.\.\.|Depen\.\.\.|Depend.*$/g, "按出勤");
			}
			if (/^Is Tax/.test(node.nodeValue)) {
				node.nodeValue = node.nodeValue.replace(/Is Tax.*$/g, "计税");
			}
			if (/^Accrua/.test(node.nodeValue)) {
				node.nodeValue = node.nodeValue.replace(/Accrua.*$/g, "计提");
			}
		}
	}

	function apply_hrms_shell_rules() {
		hide_frappe_breadcrumbs();
		fix_desk_home_links();
		apply_hrms_sidebar_shell();
		enable_sidebar_section_collapse();
	}

	function apply_hrms_ui_rules() {
		apply_hrms_shell_rules();
		hide_unneeded_menu_items();
		localize_dynamic_text();
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
				redirect_to_hrms_home();
				apply_hrms_shell_rules();
				schedule_hrms_localization(220);
				window.clearTimeout(hrms_shell_ui_followup);
				hrms_shell_ui_followup = window.setTimeout(function () {
					apply_hrms_sidebar_shell();
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

	redirect_to_hrms_home();
	apply_hrms_ui_rules();
	bind_hrms_shell_route_events();
	new MutationObserver(function (mutations) {
		bind_hrms_shell_route_events();
		if (mutations.length && mutations.every(should_ignore_hrms_shell_mutation)) {
			return;
		}
		schedule_hrms_ui_rules(120);
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
