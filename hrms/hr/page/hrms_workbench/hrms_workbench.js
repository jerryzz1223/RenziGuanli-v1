frappe.pages["hrms-workbench"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("人资主页"),
		single_column: true,
	});

	const view = new HRMSHome(page);
	view.show();
};

class HRMSHome {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
	}

	show() {
		this.page.set_title(__("人资主页"));
		this.render_loading();
		this.refresh();
	}

	refresh() {
		frappe
			.call("hrms.hr.page.hrms_workbench.hrms_workbench.get_data")
			.then((response) => this.render(response.message || {}))
			.catch(() => this.render_error());
	}

	render_loading() {
		this.wrapper.innerHTML = '<section class="hrms-home hrms-home-state">正在加载首页数据…</section>';
	}

	render_error() {
		this.wrapper.innerHTML = `
			<section class="hrms-home hrms-home-state">
				<p>首页数据暂时无法读取，请稍后重试。</p>
				<button type="button" class="btn btn-default" data-home-refresh>重新加载</button>
			</section>
		`;
		this.wrapper.querySelector("[data-home-refresh]")?.addEventListener("click", () => this.refresh());
	}

	render(data) {
		const overview = data.right_rail?.overview || {};
		const reminders = data.right_rail?.reminders || {};
		const attendance = data.cards?.attendance || {};
		const personnel = data.cards?.personnel || {};
		const recruitment = data.cards?.recruitment || {};
		const leave = data.cards?.leave || {};
		const number = (value) => frappe.utils.escape_html(String(value || 0));
		const dateLabel = frappe.utils.escape_html(data.today?.date_label || "");
		this.wrapper.innerHTML = `
			<div class="hrms-home">
				<section class="hrms-home__header">
					<div>
						<p class="hrms-home__eyebrow">${dateLabel}</p>
						<h2>${frappe.utils.escape_html(__("人资主页"))}</h2>
						<p>从常用入口快速开始，人员与考勤数据在下方汇总。</p>
					</div>
					<button type="button" class="btn btn-default" data-home-refresh>刷新数据</button>
				</section>
				<section class="hrms-home__metrics" aria-label="本月概览">
					${this.metric("在职人员", number(overview.active), `员工总数 ${number(overview.total)}`, "people")}
					${this.metric("本月入职", number(personnel.new_hires), `待办理入职 ${number(personnel.onboarding)}`, "user-plus")}
					${this.metric("今日考勤", number(attendance.checkins), `异常 ${number(attendance.exceptions)}`, "calendar")}
					${this.metric("待处理事项", number((leave.open || 0) + (recruitment.open_jobs || 0)), `请假 ${number(leave.open)} · 招聘 ${number(recruitment.open_jobs)}`, "inbox")}
				</section>
				<section class="hrms-home__panel hrms-home__shortcuts">
					<div class="hrms-home__panel-head"><div><h3>常用入口</h3><p>直接进入实际业务页面。</p></div></div>
					<div class="hrms-home__shortcut-list">
						${this.shortcut("员工花名册", "查看和维护员工档案", ["employee"], "people", "blue")}
						${this.shortcut("新增员工", "创建员工档案", ["Form", "Employee", "new-employee"], "user-plus", "green")}
						${this.shortcut("组织部门", "查看组织与部门", ["department"], "building", "purple")}
						${this.shortcut("招聘进度", "职位、候选人与面试", ["recruitment"], "briefcase", "orange")}
						${this.shortcut("每日考勤", "核对今日出勤", ["attendance-import-center", "daily"], "calendar", "teal")}
						${this.shortcut("考勤异常", "处理迟到、缺勤等异常", ["attendance-import-center", "exceptions"], "alert", "red")}
						${this.shortcut("请假管理", "查看请假申请", ["List", "Leave Application"], "file", "yellow")}
						${this.shortcut("薪酬中心", "进入薪酬业务页面", ["payroll-input-center"], "wallet", "indigo")}
					</div>
				</section>
				<section class="hrms-home__grid">
					<article class="hrms-home__panel">
						<div class="hrms-home__panel-head"><div><h3>人事概况</h3><p>员工状态与入转离待办</p></div><button type="button" class="btn btn-default btn-sm" data-route='["employee"]'>查看花名册</button></div>
						<div class="hrms-home__stat-grid">
							${this.stat("在职", number(overview.active))}
							${this.stat("试用期", number(overview.probation))}
							${this.stat("待入职", number(personnel.onboarding))}
							${this.stat("本月入职", number(personnel.new_hires))}
							${this.stat("待离职", number(personnel.separation))}
							${this.stat("已离职", number(overview.left))}
						</div>
					</article>
					<article class="hrms-home__panel">
						<div class="hrms-home__panel-head"><div><h3>今日动态</h3><p>招聘、考勤和人事提醒</p></div><button type="button" class="btn btn-default btn-sm" data-route='["attendance-import-center", "daily"]'>进入核对</button></div>
						<div class="hrms-home__status-list">
							${this.status_row("今日考勤", number(attendance.checkins), "已核对记录")}
							${this.status_row("考勤异常", number(attendance.exceptions), `缺勤 ${number(attendance.absent)} · 迟到 ${number(attendance.late)} · 早退 ${number(attendance.early)}`)}
							${this.status_row("开放招聘职位", number(recruitment.open_jobs), `今日面试 ${number(recruitment.interviews)}`)}
							${this.status_row("请假待处理", number(leave.open), `已批准 ${number(leave.approved)}`)}
							${this.status_row("生日提醒", number(reminders.birthdays), `入职周年 ${number(reminders.work_anniversaries)}`)}
						</div>
					</article>
				</section>
				</div>
		`;
		this.bind_events();
	}

	metric(label, value, caption, icon) {
		return `<article class="hrms-home__metric"><span class="hrms-home__metric-icon">${this.icon(icon)}</span><div><span>${label}</span><strong>${value}</strong><small>${caption}</small></div></article>`;
	}

	shortcut(label, caption, route, icon, tone) {
		return `<button type="button" class="hrms-home__shortcut is-${tone}" data-route='${JSON.stringify(route)}'><span class="hrms-home__shortcut-icon">${this.icon(icon)}</span><strong>${label}</strong><small>${caption}</small></button>`;
	}

	stat(label, value) {
		return `<div class="hrms-home__stat"><strong>${value}</strong><span>${label}</span></div>`;
	}

	status_row(label, value, caption) {
		return `<div class="hrms-home__status-row"><div><strong>${label}</strong><small>${caption}</small></div><b>${value}</b></div>`;
	}

	icon(name) {
		const paths = {
			people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
			"user-plus": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
			building: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h.01M11 7h.01M15 7h.01M7 11h.01M11 11h.01M15 11h.01M7 15h.01M11 15h.01M15 15h.01"/>',
			briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/>',
			calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 15l2 2 5-5"/>',
			alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/>',
			file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
			wallet: '<path d="M20 7V6a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v8a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V7"/><path d="M16 14h.01"/>',
			inbox: '<path d="M4 4h16v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M4 14h4l2 3h4l2-3h4"/>',
		};
		return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
	}

	bind_events() {
		this.wrapper.querySelectorAll("[data-home-refresh]").forEach((button) => button.addEventListener("click", () => this.refresh()));
		this.wrapper.querySelectorAll("[data-route]").forEach((button) => {
			button.addEventListener("click", () => {
				const route = JSON.parse(button.dataset.route || "[]");
				if (!route.length) return;
				frappe.set_route(...route);
			});
		});
	}
}
