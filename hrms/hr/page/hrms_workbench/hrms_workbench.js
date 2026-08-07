frappe.pages["hrms-workbench"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("人资工作台"),
		single_column: true,
	});

	const view = new HRMSWorkbench(page);
	view.show();
};

class HRMSWorkbench {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.entries = [
			{ label: "人事", title: "员工花名册", description: "员工档案、花名册、入转调离和人事报表", route: ["personnel"], indicator: "blue" },
			{ label: "组织", title: "组织管理", description: "公司、分支机构、部门、岗位、职级和组织架构", route: ["department"], indicator: "green" },
			{ label: "招聘", title: "招聘职位", description: "职位、候选人、面试、录用和入职衔接", route: ["recruitment"], indicator: "orange" },
			{ label: "考勤假期", title: "考勤导入中心", description: "每日考勤核对、考勤异常处理、月度考勤终稿", route: ["attendance-import-center"], indicator: "purple" },
			{ label: "薪酬", title: "薪酬管理中心", description: "规则中心、薪资主数据、福利扣款来源中心、变量导入、全勤奖、住房补贴、学历补贴、宿舍扣款、社保个人、薪资输入表和薪资结算表", route: ["payroll-input-center", "salary-rules"], indicator: "blue" },
			{ label: "审批", title: "审批表单", description: "流程、待办、费用、出差和审批动作", route: ["workflow"], indicator: "green" },
			{ label: "培训学习", title: "培训计划", description: "培训项目、培训结果、培训反馈和员工技能", route: ["training-program"], indicator: "orange" },
			{ label: "绩效", title: "绩效概览", description: "考核周期、考核模板、目标和绩效结果", route: ["performance"], indicator: "purple" },
			{ label: "钉钉集成", title: "基础数据同步", description: "连接平台、本地网关、员工部门同步、考勤审批原始数据和 dingtalk-integration", route: ["hr-settings-center", "dingtalk-integration"], indicator: "green" },
			{ label: "更多", title: "设置中心", description: "字段管理中心、员工属性设置、导入映射设置和基础资料设置", route: ["hr-settings-center"], indicator: "blue" },
		];
		this.attendance_cards = [
			{ label: "考勤导入中心", description: "导入 1.1每日统计、1.2请假单、1.3苹果树", route: ["attendance-import-center"], indicator: "blue" },
			{ label: "每日考勤核对", description: "按员工、日期、班次核对出勤、请假、加班和缺卡", route: ["attendance-import-center", "daily"], indicator: "green" },
			{ label: "考勤异常处理", description: "处理忘打卡、迟到、早退、旷工、未申请加班", route: ["attendance-import-center", "exceptions"], indicator: "orange" },
			{ label: "月度考勤终稿", description: "生成标准工时、实际出勤、1.5倍/2倍/3倍加班和调整后工时", route: ["attendance-import-center", "monthly"], indicator: "purple" },
		];
	}

	show() {
		this.page.set_title(__("人资工作台"));
		this.render();
	}

	render() {
		this.wrapper.innerHTML = `
			<div class="hrms-workbench hrms-workbench-shell">
				<section class="hrms-module-hero">
					<div>
						<h2>${frappe.utils.escape_html(__("工作台"))}</h2>
						<p>${frappe.utils.escape_html(__("统一进入人事、组织、招聘、考勤假期、薪酬、审批、培训学习和绩效。"))}</p>
					</div>
					<button class="btn btn-primary" data-route="${frappe.utils.escape_html(JSON.stringify(["attendance-import-center"]))}">
						${frappe.utils.escape_html(__("进入考勤导入中心"))}
					</button>
				</section>
				<div class="hrms-module-card-grid">
					${this.entries.map((entry) => this.render_entry(entry)).join("")}
				</div>
				<section class="hrms-module-table-card">
					<div class="hrms-module-table-head">
						<h3>${frappe.utils.escape_html(__("考勤假期"))}</h3>
					</div>
					<div class="hrms-module-card-grid hrms-attendance-entry-grid">
						${this.attendance_cards.map((entry) => this.render_entry(entry)).join("")}
					</div>
				</section>
			</div>
		`;
		this.bind_events();
	}

	render_entry(entry) {
		return `
			<button type="button" class="hrms-module-card" data-route="${frappe.utils.escape_html(JSON.stringify(entry.route))}">
				<span class="indicator ${frappe.utils.escape_html(entry.indicator)}"></span>
				<strong>${frappe.utils.escape_html(__(entry.label))}</strong>
				<span>${frappe.utils.escape_html(__(entry.title || ""))}</span>
				<small>${frappe.utils.escape_html(__(entry.description || ""))}</small>
			</button>
		`;
	}

	bind_events() {
		this.wrapper.querySelectorAll("[data-route]").forEach((button) => {
			button.addEventListener("click", () => {
				const route = JSON.parse(button.dataset.route || "[]");
				if (!route.length) return;
				frappe.set_route(...route);
			});
		});
	}
}
