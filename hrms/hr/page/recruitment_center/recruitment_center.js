frappe.pages["recruitment-center"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("招聘中心"), single_column: true });
	const view = new RecruitmentCenter(page);
	wrapper.recruitment_center = view;
	view.show();
};

frappe.pages["recruitment-center"].on_page_show = function (wrapper) {
	wrapper.recruitment_center?.refresh();
};

class RecruitmentCenter {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.mode = "register";
		this.start = 0;
		this.request_id = 0;
		this.register_view = "list";
		window.addEventListener("hrms:company-context-changed", () => {
			if (this.mode !== "register") return;
			Promise.resolve(this.company_control?.set_value(this.current_company())).then(() => {
				this.start = 0;
				this.refresh();
			});
		});
	}

	show() {
		this.render_register_shell();
		this.refresh();
	}

	refresh() {
		if (this.mode === "register") return this.refresh_register();
		const request_id = ++this.request_id;
		return Promise.resolve(frappe.call("hrms.hr.page.recruitment_center.recruitment_center.get_recruitment_data"))
			.then((response) => { if (request_id === this.request_id) this.render(response.message || {}); })
			.catch(() => { if (request_id === this.request_id) this.render_error(); });
	}

	current_company() {
		return window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	}

	register_columns() {
		return [
			["registration_month", "月份"], ["sequence", "序号"], ["candidate_name", "姓名"],
			["native_place", "籍贯"], ["source", "信息渠道"], ["phone", "联系电话"],
			["gender", "性别"], ["education", "学历"], ["marital_status", "婚姻状况"], ["age", "年龄"],
			["interview_date", "面试时间"], ["interview_position", "面试岗位"], ["referrer", "介绍人"],
			["interviewer", "面试官"], ["hired", "录用与否"], ["assigned_department", "分配部门"],
			["assigned_position", "分配岗位"], ["rejection_reason", "未录用原因或其他"],
			["expected_start_date", "预计人员上班时间"], ["arrival_status", "是否报到"], ["no_show_reason", "未报到原因"],
		];
	}

	render_register_shell() {
		this.mode = "register";
		this.page.clear_primary_action();
		this.page.clear_secondary_action?.();
		this.wrapper.innerHTML = `<section class="recruitment-center interview-register">
			<header class="interview-register__hero"><h1>面试人员登记</h1><div class="interview-register__actions"><button class="btn btn-primary" data-register-new disabled>新增面试登记</button><button class="btn btn-default" data-refresh>刷新数据</button></div></header>
			<nav class="interview-register__navigation" aria-label="招聘业务"><button class="is-active" aria-current="page">面试人员登记</button><button data-overview>招聘总览 <span aria-hidden="true">↗</span></button><button data-sources>信息渠道 <span aria-hidden="true">↗</span></button></nav>
			<section class="interview-register__panel">
			<div class="interview-register__panel-heading"><h2>查找面试登记</h2></div>
			<div class="interview-register__filters">
				<div data-company></div>
				<label>面试月份<input class="form-control" type="month" data-month></label>
				<label>查找人员<input class="form-control" type="search" data-search placeholder="姓名、联系电话或面试岗位"></label>
				<label>录用与否<select class="form-control" data-hired><option value="">全部</option>是</option><option>否</option></select></label>
				<label>是否报到<select class="form-control" data-arrival><option value="">全部</option><option>待报到</option><option>已报到</option><option>未报到</option></select></label>
				<div class="interview-register__filter-actions"><button class="btn btn-primary" data-query>查询</button><button class="btn btn-default" data-clear>重置</button></div>
			</div>
			</section>
			<section class="interview-register__panel interview-register__list-panel">
			<div class="interview-register__panel-heading"><h2>人员登记清单</h2><div class="interview-register__view-switch" role="group" aria-label="清单显示方式"><button data-view="list">日常清单</button><button data-view="template">模板全字段</button></div></div>
			<div data-register-results aria-live="polite"></div>
			<div class="interview-register__footer"><span data-page-info></span><div><button class="btn btn-default btn-sm" data-prev>上一页</button> <button class="btn btn-default btn-sm" data-next>下一页</button></div></div>
			</section>
		</section>`;
		this.company_control = frappe.ui.form.make_control({
			parent: this.wrapper.querySelector("[data-company]"), render_input: true,
			df: { fieldname: "company", label: "公司", fieldtype: "Link", options: "Company" },
		});
		this.company_control.set_value(this.current_company());
		this.wrapper.querySelector("[data-register-new]").addEventListener("click", () => this.new_registration());
		this.wrapper.querySelector("[data-overview]").addEventListener("click", () => this.show_overview());
		this.wrapper.querySelector("[data-refresh]").addEventListener("click", () => this.refresh_register());
		this.wrapper.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
			this.register_view = button.dataset.view;
			this.update_register_view();
			if (this.register_data) this.render_register_rows(this.register_data);
		}));
		this.update_register_view();
		const query = () => { this.start = 0; this.refresh_register(); };
		this.wrapper.querySelector("[data-query]").addEventListener("click", query);
		this.wrapper.querySelector("[data-search]").addEventListener("keydown", (event) => { if (event.key === "Enter") query(); });
		this.wrapper.querySelector("[data-clear]").addEventListener("click", () => {
			for (const selector of ["month", "search", "hired", "arrival"]) this.wrapper.querySelector(`[data-${selector}]`).value = "";
			this.company_control.set_value(this.current_company());
			query();
		});
		this.wrapper.querySelector("[data-prev]").addEventListener("click", () => { this.start = Math.max(0, this.start - 50); this.refresh_register(); });
		this.wrapper.querySelector("[data-next]").addEventListener("click", () => { this.start += 50; this.refresh_register(); });
		this.wrapper.querySelector("[data-sources]").addEventListener("click", () => frappe.set_route("List", "Job Applicant Source"));
	}

	new_registration() {
		frappe.new_doc("Interview Registration", { company: this.company_control?.get_value() || this.current_company() });
	}

	update_register_view() {
		this.wrapper.querySelectorAll("[data-view]").forEach((button) => {
			const active = button.dataset.view === this.register_view;
			button.classList.toggle("is-active", active);
			button.setAttribute("aria-pressed", String(active));
		});
	}

	refresh_register() {
		const results = this.wrapper.querySelector("[data-register-results]");
		if (!results) return;
		const request_id = ++this.request_id;
		const filters = {
			company: this.company_control.get_value() || "", month: this.wrapper.querySelector("[data-month]").value,
			search: this.wrapper.querySelector("[data-search]").value, hired: this.wrapper.querySelector("[data-hired]").value,
			arrival_status: this.wrapper.querySelector("[data-arrival]").value,
		};
		const key = JSON.stringify(filters);
		if (key !== this.register_filter_key) this.start = 0;
		this.register_filter_key = key;
		this.register_data = null;
		this.wrapper.querySelectorAll("[data-view]").forEach((button) => { button.disabled = true; });
		results.innerHTML = this.empty("正在读取面试人员登记…");
		for (const key of ["prev", "next"]) this.wrapper.querySelector(`[data-${key}]`).disabled = true;
		this.wrapper.querySelector("[data-page-info]").textContent = "";
		return Promise.resolve(frappe.call({
			method: "hrms.api.interview_registration.get_registrations",
			args: { ...filters, start: this.start },
		})).then((response) => {
			if (request_id !== this.request_id || this.mode !== "register") return;
			const data = response.message || {};
			this.wrapper.querySelector("[data-register-new]").hidden = !data.can_create;
			this.wrapper.querySelector("[data-register-new]").disabled = false;
			this.wrapper.querySelectorAll("[data-view]").forEach((button) => { button.disabled = false; });
			this.render_register_rows(data);
		}).catch(() => {
			if (request_id !== this.request_id || this.mode !== "register") return;
			this.wrapper.querySelector("[data-register-new]").disabled = true;
			results.innerHTML = this.empty("面试登记读取失败，请确认权限或稍后点击查询重试。");
		});
	}

	render_register_rows(data) {
		this.register_data = data;
		const rows = data.rows || [];
		const safe = (value) => frappe.utils.escape_html(String(value ?? ""));
		const columns = this.register_columns();
		const template = `<div class="interview-register__scroll" tabindex="0" aria-label="面试人员清单，可左右滚动"><table class="interview-register__table"><thead>
			<tr><th rowspan="2">月份</th><th rowspan="2">序号</th><th rowspan="2">姓名</th><th colspan="7">人员基本信息</th>${columns.slice(10).map(([, label]) => `<th rowspan="2">${label}</th>`).join("")}</tr>
			<tr>${columns.slice(3, 10).map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rows.map((row, index) => `<tr>${columns.map(([key]) => {
				if (key === "candidate_name") return `<td><button class="interview-register__name" data-registration="${safe(row.name)}">${safe(row[key])}</button></td>`;
				return `<td>${safe(key === "sequence" ? this.start + index + 1 : row[key])}</td>`;
			}).join("")}</tr>`).join("")}</tbody></table></div>`;
		this.wrapper.querySelector("[data-register-results]").innerHTML = rows.length
			? (this.register_view === "template" ? template : this.render_daily_rows(rows))
			: `<div class="interview-register__empty"><span aria-hidden="true">○</span><strong>暂无面试登记</strong><p>可调整查询条件，或点击上方“新增面试登记”开始填写。</p></div>`;
		this.wrapper.querySelectorAll("[data-registration]").forEach((button) => button.addEventListener("click", () => frappe.set_route("Form", "Interview Registration", button.dataset.registration)));
		this.wrapper.querySelector("[data-page-info]").textContent = rows.length ? `第 ${this.start + 1}–${this.start + rows.length} 条，每页 50 条` : "暂无记录";
		this.wrapper.querySelector("[data-prev]").disabled = this.start === 0;
		this.wrapper.querySelector("[data-next]").disabled = !data.has_more;
	}

	render_daily_rows(rows) {
		const safe = (value) => frappe.utils.escape_html(String(value ?? ""));
		const text = (value) => safe(value || "—");
		return `<div class="interview-register__daily-scroll"><table class="interview-register__daily"><thead><tr><th>面试人员</th><th>应聘岗位 / 渠道</th><th>面试安排</th><th>录用结果</th><th>分配部门 / 岗位</th><th>报到跟进</th><th>操作</th></tr></thead><tbody>${rows.map((row) => {
			const hired_label = row.hired === "是" ? "已录用" : row.hired === "否" ? "未录用" : "待确认";
			const hired_tone = row.hired === "是" ? "green" : row.hired === "否" ? "neutral" : "amber";
			const arrival = row.arrival_status || (row.hired === "是" ? "待报到" : "待定");
			return `<tr><td data-label="面试人员"><button class="interview-register__name" data-registration="${safe(row.name)}">${text(row.candidate_name)}</button><small>${text(row.phone)}</small></td>
				<td data-label="应聘岗位 / 渠道"><strong>${text(row.interview_position)}</strong><small>${text(row.source)}</small></td>
				<td data-label="面试安排"><strong>${text(row.interview_date)}</strong><small>面试官：${text(row.interviewer)}</small></td>
				<td data-label="录用结果"><span class="interview-register__badge interview-register__badge--${hired_tone}">${hired_label}</span></td>
				<td data-label="分配部门 / 岗位"><strong>${text(row.assigned_department)}</strong><small>${text(row.assigned_position)}</small></td>
				<td data-label="报到跟进"><span class="interview-register__badge interview-register__badge--${arrival === "已报到" ? "green" : arrival === "未报到" ? "amber" : "neutral"}">${text(arrival)}</span><small>${row.expected_start_date ? `预计 ${safe(row.expected_start_date)}` : "上班时间待定"}</small></td>
				<td data-label="操作"><button class="interview-register__open" data-registration="${safe(row.name)}">查看登记 <span aria-hidden="true">→</span></button></td></tr>`;
		}).join("")}</tbody></table></div>`;
	}

	show_overview() {
		this.mode = "overview";
		this.page.set_primary_action(__("新建招聘申请"), () => frappe.new_doc("Job Requisition"));
		this.page.set_secondary_action(__("面试人员登记"), () => { this.render_register_shell(); this.refresh(); });
		this.render_loading();
		this.refresh();
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
