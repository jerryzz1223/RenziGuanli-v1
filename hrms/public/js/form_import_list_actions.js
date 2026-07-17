/* global frappe, __ */

(function () {
	const IMPORTS = {
		"Employee Transfer": { key: "employee_transfer", label: "人事异动表单" },
		"Employee Promotion": { key: "qualification_review", label: "转正/晋升表单" },
		"Employee Separation": { key: "resignation_application", label: "离职表单" },
		"Job Applicant": { key: "recruitment_interview", label: "候选人面试表单" },
		"Training Event": { key: "training_registration", label: "培训登记表" },
		"Appraisal": { key: "performance_summary", label: "绩效总结表" },
		"Employee Skill Map": { key: "certificate_management", label: "证书管理表" },
		"Employee Grievance": { key: "reward_punishment", label: "奖惩提报表" },
		"HRMS Attendance Day Check": { key: "attendance_daily", label: "每日考勤表" },
		"HRMS Attendance Exception": { key: "attendance_exception", label: "出勤异常表" },
		"HRMS Apple Reward Record": { key: "apple_reward", label: "苹果树表" },
		"HRMS Monthly Attendance Summary": { key: "attendance_final", label: "月度考勤终稿" },
	};

	Object.entries(IMPORTS).forEach(([doctype, config]) => {
		const existing = frappe.listview_settings[doctype] || {};
		const previous_onload = existing.onload;
		frappe.listview_settings[doctype] = {
			...existing,
			onload(listview) {
				previous_onload?.(listview);
				listview.page.add_inner_button(__("表单导入"), () => {
					if (window.hrmsFormImport?.open) {
						window.hrmsFormImport.open(config.key, { title: `${config.label}${__("导入")}` });
						return;
					}
					frappe.msgprint(__("导入组件正在加载，请稍后重试。"));
				});
			},
		};
	});
})();
