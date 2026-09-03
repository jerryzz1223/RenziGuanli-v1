frappe.pages["hrms-workbench"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("系统主页"),
		single_column: true,
	});

	const view = new HRMSHome(page);
	view.show();
};

const CHINA_PROVINCE_MAP_LAYOUT = [
	["新疆维吾尔自治区", 12, 42], ["西藏自治区", 27, 75], ["青海省", 35, 57], ["甘肃省", 43, 48],
	["内蒙古自治区", 54, 29], ["黑龙江省", 78, 18], ["吉林省", 77, 29], ["辽宁省", 73, 37],
	["北京市", 68, 41], ["天津市", 71, 44], ["河北省", 66, 47], ["山西省", 60, 46],
	["宁夏回族自治区", 52, 52], ["陕西省", 58, 56], ["山东省", 72, 52], ["河南省", 65, 58],
	["江苏省", 76, 60], ["上海市", 80, 67], ["安徽省", 71, 64], ["浙江省", 77, 71],
	["湖北省", 64, 66], ["重庆市", 56, 68], ["四川省", 50, 68], ["贵州省", 56, 75],
	["云南省", 44, 80], ["湖南省", 64, 74], ["江西省", 70, 75], ["福建省", 76, 80],
	["广东省", 69, 84], ["广西壮族自治区", 57, 84], ["海南省", 59, 94], ["香港特别行政区", 71, 89],
	["澳门特别行政区", 69, 90], ["台湾省", 86, 82],
];

const HOME_CHART_COLORS = ["#456fca", "#6f9be8", "#91b4ee", "#79bfa4", "#e6b45e", "#d88272", "#9c82ca"];

class HRMSHome {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
	}

	show() {
		this.page.set_title(__("系统主页"));
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
		const analytics = data.analytics || {};
		const number = (value) => frappe.utils.escape_html(String(value || 0));
		const dateLabel = frappe.utils.escape_html(data.today?.date_label || "");
		this.wrapper.innerHTML = `
			<div class="hrms-home">
				<section class="hrms-home__header">
					<div>
						<p class="hrms-home__eyebrow">${dateLabel}</p>
						<h2>${frappe.utils.escape_html(__("系统主页"))}</h2>
						<p>从常用入口进入人事、组织、招聘、考勤和薪酬模块。</p>
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

	native_place_map(distribution) {
		this.nativePlaceMembers = distribution.members || {};
		const counts = new Map((distribution.items || []).map((item) => [item.label, Number(item.count) || 0]));
		const max = Math.max(...Array.from(counts.values()), 0);
		const total = Number(distribution.total) || 0;
		const visibleCount = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
		const unreported = Number(distribution.unreported) || 0;
		const other = Number(distribution.other) || 0;
		const ranked = (distribution.items || []).slice(0, 5);
		const markers = CHINA_PROVINCE_MAP_LAYOUT.map(([label, x, y]) => {
			const count = counts.get(label) || 0;
			const level = count && max ? Math.max(0.32, count / max) : 0;
			const title = `${label}：${count} 人${count ? "，悬停或点击查看员工姓名" : ""}`;
			if (!count) return `<span class="hrms-home__map-marker" style="--x:${x}%;--y:${y}%;--level:${level}" aria-hidden="true"></span>`;
			return `<button type="button" class="hrms-home__map-marker is-active" style="--x:${x}%;--y:${y}%;--level:${level}" data-native-place="${frappe.utils.escape_html(label)}" aria-controls="hrms-home-map-detail" aria-label="${frappe.utils.escape_html(title)}">${count}</button>`;
		}).join("");
		return `
			<article class="hrms-home__panel hrms-home__map-panel">
				<div class="hrms-home__panel-head"><div><h3>人员籍贯分布</h3><p>按已填写的中国省级籍贯统计在职员工；悬停或点击圆点查看姓名</p></div><span class="hrms-home__data-note">${total} 人</span></div>
				<div class="hrms-home__map-content">
					<div class="hrms-home__china-map" role="img" aria-label="中国省级籍贯人员分布图">
						<svg viewBox="0 0 1000 600" aria-hidden="true"><path d="M80 270 155 180 300 146 405 114 530 143 660 102 824 146 905 237 858 305 889 382 811 439 730 415 655 470 564 442 481 497 390 472 296 519 219 478 153 400 83 359 115 309Z"/></svg>
						${markers}
					</div>
					<div class="hrms-home__map-summary">
						<div class="hrms-home__map-legend"><span></span><small>圆点越深，人员越多</small></div>
						<div class="hrms-home__map-detail" id="hrms-home-map-detail" aria-live="polite"><p>悬停或点击地图中的有色圆点，查看该省员工姓名。</p></div>
						${this.distribution_rows(ranked, "暂无已填写的籍贯数据")}
						<p class="hrms-home__chart-footnote">已定位 ${visibleCount} 人${other ? ` · 其他地区 ${other} 人` : ""}${unreported ? ` · 待补充 ${unreported} 人` : ""}</p>
					</div>
				</div>
			</article>
		`;
	}

	distribution_chart(title, subtitle, distribution, emptyLabel) {
		const values = this.chart_items(distribution);
		const total = values.reduce((sum, item) => sum + item.count, 0);
		const segments = [];
		let position = 0;
		values.forEach((item, index) => {
			const end = total ? position + (item.count / total) * 100 : position;
			segments.push(`${HOME_CHART_COLORS[index % HOME_CHART_COLORS.length]} ${position}% ${end}%`);
			position = end;
		});
		const chartStyle = `background:${segments.length ? `conic-gradient(${segments.join(",")})` : "#edf1f5"}`;
		return `
			<article class="hrms-home__panel hrms-home__chart-panel">
				<div class="hrms-home__panel-head"><div><h3>${title}</h3><p>${subtitle}</p></div></div>
				<div class="hrms-home__donut-row">
					<div class="hrms-home__donut" style="${chartStyle}"><div><b>${total}</b><span>人</span></div></div>
					<div class="hrms-home__chart-legend">${values.length ? values.map((item, index) => `<div><i style="--chart-color:${HOME_CHART_COLORS[index % HOME_CHART_COLORS.length]}"></i><span>${frappe.utils.escape_html(item.label)}</span><b>${item.count}</b></div>`).join("") : `<p>${emptyLabel}</p>`}</div>
				</div>
			</article>
		`;
	}

	department_distribution(distribution) {
		return `
			<article class="hrms-home__panel hrms-home__department-panel">
				<div class="hrms-home__panel-head"><div><h3>部门人员分布</h3><p>在职员工人数最多的部门</p></div></div>
				${this.distribution_rows(distribution.items || [], "暂无部门归属数据", true)}
				<p class="hrms-home__chart-footnote">${distribution.unreported ? `待补充部门 ${distribution.unreported} 人` : "部门资料完整"}</p>
			</article>
		`;
	}

	chart_items(distribution) {
		const items = (distribution.items || []).map((item) => ({ label: item.label, count: Number(item.count) || 0 }));
		if (distribution.other) items.push({ label: "其他", count: Number(distribution.other) || 0 });
		if (distribution.unreported) items.push({ label: "未填写", count: Number(distribution.unreported) || 0 });
		return items.filter((item) => item.count > 0);
	}

	distribution_rows(items, emptyLabel, bars = false) {
		const max = Math.max(...items.map((item) => Number(item.count) || 0), 0);
		if (!items.length) return `<p class="hrms-home__chart-empty">${emptyLabel}</p>`;
		return `<div class="hrms-home__distribution-list ${bars ? "is-bars" : ""}">${items.map((item) => {
			const count = Number(item.count) || 0;
			const width = max ? Math.max(6, (count / max) * 100) : 0;
			return `<div class="hrms-home__distribution-row"><span>${frappe.utils.escape_html(item.label)}</span>${bars ? `<i><b style="width:${width}%"></b></i>` : ""}<strong>${count} 人</strong></div>`;
		}).join("")}</div>`;
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
		this.wrapper.querySelectorAll("[data-native-place]").forEach((marker) => {
			const reveal = () => this.show_native_place_members(marker.dataset.nativePlace || "");
			marker.addEventListener("mouseenter", reveal);
			marker.addEventListener("focus", reveal);
			marker.addEventListener("click", reveal);
		});
	}

	show_native_place_members(nativePlace) {
		const detail = this.wrapper.querySelector("#hrms-home-map-detail");
		if (!detail || !nativePlace) return;
		const names = this.nativePlaceMembers[nativePlace] || [];
		const safePlace = frappe.utils.escape_html(nativePlace);
		if (!names.length) {
			detail.innerHTML = `<strong>${safePlace}</strong><p>当前账号没有可显示的在职员工姓名。</p>`;
			return;
		}
		detail.innerHTML = `<strong>${safePlace} · ${names.length} 人</strong><div class="hrms-home__map-names">${names.map((name) => `<span>${frappe.utils.escape_html(name)}</span>`).join("")}</div>`;
	}
}
