frappe.pages["recruitment-center"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("招聘中心"), single_column: true });
	const view = new RecruitmentCenter(page);
	wrapper.recruitment_center = view;
	view.show();
};

class RecruitmentCenter {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
	}

	show() {
		this.page.set_primary_action(__("新建招聘申请"), () => frappe.new_doc("Job Requisition"));
		this.page.set_secondary_action(__("新增候选人"), () => frappe.new_doc("Job Applicant"));
		this.render_loading();
		this.refresh();
	}

	refresh() {
		frappe
			.call("hrms.hr.page.recruitment_center.recruitment_center.get_recruitment_data")
			.then((response) => this.render(response.message || {}))
			.catch(() => this.render_error());
	}

	render_loading() {
		this.wrapper.innerHTML = '<section class="recruitment-center recruitment-center--state">正在加载招聘待办…</section>';
	}

	render_error() {
		this.wrapper.innerHTML = `<section class="recruitment-center recruitment-center--state"><p>招聘数据暂时无法读取，请确认权限后重试。</p><button class="btn btn-default" data-action="refresh">重新加载</button></section>`;
		this.bind_events();
	}

	render(data) {
		const summary = data.summary || {};
		const value = (key) => frappe.utils.escape_html(String(summary[key] || 0));
		this.wrapper.innerHTML = `
			<div class="recruitment-center">
				<section class="recruitment-center__header">
					<div><p class="recruitment-center__eyebrow">招聘全流程</p><h2>从岗位需求到新员工报到</h2><p>所有业务记录仍保存在标准招聘单据中；这里集中展示需要处理的节点。</p></div>
					<button class="btn btn-default" data-action="refresh">刷新</button>
				</section>
				<section class="recruitment-center__flow" aria-label="招聘流程">
					${this.flow_step("1", "需求确认", "招聘申请 / 职位")}${this.flow_step("2", "收集初筛", "候选人 / 简历")}${this.flow_step("3", "面试评估", "面试 / 反馈")}${this.flow_step("4", "录用确认", "Offer")}${this.flow_step("5", "入职跟进", "员工入职")}
				</section>
				<section class="recruitment-center__metrics">
					${this.metric("待确认需求", value("pending_requisitions"), ["List", "Job Requisition"], "Pending")}
					${this.metric("开放职位", value("open_openings"), ["List", "Job Opening"], "Open")}
					${this.metric("进行中候选人", value("active_applicants"), ["List", "Job Applicant"])}
					${this.metric("7 日内面试", value("upcoming_interviews"), ["List", "Interview"])}
					${this.metric("待答复 Offer", value("offers_awaiting_response"), ["List", "Job Offer"], "Awaiting Response")}
					${this.metric("待办理入职", value("onboarding_in_progress"), ["List", "Employee Onboarding"])}
				</section>
				<section class="recruitment-center__grid">
					<article class="recruitment-center__panel recruitment-center__panel--pipeline"><div class="recruitment-center__panel-head"><div><h3>候选人漏斗</h3><p>从初筛到录用，点击阶段查看名单。</p></div><button class="btn btn-default btn-sm" data-route='["List","Job Applicant"]'>候选人库</button></div>${this.pipeline(data.pipeline || [])}</article>
					<article class="recruitment-center__panel"><div class="recruitment-center__panel-head"><div><h3>近期面试</h3><p>未来 7 天待处理面试</p></div><button class="btn btn-default btn-sm" data-route='["List","Interview"]'>全部面试</button></div>${this.interviews(data.interviews || [])}</article>
					<article class="recruitment-center__panel"><div class="recruitment-center__panel-head"><div><h3>待答复录用通知</h3><p>确认后可继续创建员工与入职流程。</p></div><button class="btn btn-default btn-sm" data-route='["List","Job Offer"]'>全部 Offer</button></div>${this.offers(data.offers || [])}</article>
					<article class="recruitment-center__panel"><div class="recruitment-center__panel-head"><div><h3>入职跟进</h3><p>已接受 Offer 后的报到准备与任务。</p></div><button class="btn btn-default btn-sm" data-route='["List","Employee Onboarding"]'>入职单</button></div>${this.onboarding(data.onboarding || [])}</article>
				</section>
			</div>`;
		this.bind_events();
	}

	flow_step(number, title, caption) {
		return `<div class="recruitment-center__flow-step"><b>${number}</b><div><strong>${title}</strong><small>${caption}</small></div></div>`;
	}

	metric(label, value, route, status) {
		const filter = status ? ` data-status="${frappe.utils.escape_html(status)}"` : "";
		return `<button class="recruitment-center__metric" data-route='${JSON.stringify(route)}'${filter}><span>${label}</span><strong>${value}</strong></button>`;
	}

	pipeline(rows) {
		if (!rows.length) return this.empty("暂无候选人数据。");
		return `<div class="recruitment-center__pipeline">${rows.map((row) => `<button data-route='["List","Job Applicant"]' data-status="${frappe.utils.escape_html(row.status || "")}"><span>${frappe.utils.escape_html(row.label || "")}</span><strong>${frappe.utils.escape_html(String(row.total || 0))}</strong></button>`).join("")}</div>`;
	}

	interviews(rows) {
		if (!rows.length) return this.empty("未来 7 天没有待处理面试。");
		return `<div class="recruitment-center__list">${rows.map((row) => this.list_row(row.name, row.applicant_name, `${row.interview_type || ""} · ${row.scheduled_on || ""} ${row.from_time || ""}`, row.status)).join("")}</div>`;
	}

	offers(rows) {
		if (!rows.length) return this.empty("没有等待候选人答复的 Offer。");
		return `<div class="recruitment-center__list">${rows.map((row) => this.list_row(row.name, row.applicant_name, `${row.designation || ""} · 发出日期 ${row.offer_date || ""}`, "待答复")).join("")}</div>`;
	}

	onboarding(rows) {
		if (!rows.length) return this.empty("没有待跟进的入职单。");
		return `<div class="recruitment-center__list">${rows.map((row) => this.list_row(row.name, row.employee_name, `${row.designation || ""} · 预计入职 ${row.date_of_joining || ""}`, row.boarding_status)).join("")}</div>`;
	}

	list_row(name, title, caption, status) {
		const safe = (value) => frappe.utils.escape_html(String(value || "—"));
		return `<button class="recruitment-center__list-row" data-document="${safe(name)}"><div><strong>${safe(title)}</strong><small>${safe(caption)}</small></div><span>${safe(status)}</span></button>`;
	}

	empty(message) {
		return `<div class="recruitment-center__empty">${frappe.utils.escape_html(message)}</div>`;
	}

	bind_events() {
		this.wrapper.querySelectorAll("[data-action='refresh']").forEach((button) => button.addEventListener("click", () => this.refresh()));
		this.wrapper.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => {
			const route = JSON.parse(button.dataset.route || "[]");
			if (route[0] === "List" && button.dataset.status) frappe.route_options = { status: button.dataset.status };
			if (route.length) frappe.set_route(...route);
		}));
		this.wrapper.querySelectorAll("[data-document]").forEach((button) => button.addEventListener("click", () => {
			const panel = button.closest(".recruitment-center__panel");
			const heading = panel?.querySelector("h3")?.textContent || "";
			const doctype = heading.includes("面试") ? "Interview" : heading.includes("Offer") ? "Job Offer" : "Employee Onboarding";
			frappe.set_route("Form", doctype, button.dataset.document);
		}));
	}
}
