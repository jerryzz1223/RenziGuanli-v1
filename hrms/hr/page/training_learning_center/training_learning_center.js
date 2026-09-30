frappe.pages["training-learning-center"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("培训学习主页"), single_column: true });
	wrapper.trainingLearningHome = new TrainingLearningHome(page);
	wrapper.trainingLearningHome.show();
};

frappe.pages["training-learning-center"].on_page_show = function (wrapper) {
	wrapper.trainingLearningHome?.show();
};

class TrainingLearningHome {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.escape = (value) => frappe.utils.escape_html(String(value ?? ""));
		this.data = null;
		this.last_loaded_at = 0;
		this.load_promise = null;
		this.cache_ttl = 30_000;
		this.loaded_company = null;
	}

	company() {
		return window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	}

	show(force = false) {
		this.page.set_title(__("培训学习主页"));
		const company = this.company();
		if (!force && this.data && this.loaded_company === company && Date.now() - this.last_loaded_at < this.cache_ttl) {
			if (!this.wrapper.querySelector(".hrms-training-home-metrics")) this.render(this.data);
			return Promise.resolve(this.data);
		}
		if (this.load_promise) {
			return this.loading_company === company ? this.load_promise : this.load_promise.then(() => this.show(force));
		}
		if (this.loaded_company !== company) this.wrapper.innerHTML = `<section class="hrms-training-home"><div class="hrms-training-home-state">${__("正在读取培训统计与近期安排…")}</div></section>`;
		this.loading_company = company;
		const button = this.wrapper.querySelector("[data-training-home-refresh]");
		if (button) {
			button.disabled = true;
			button.setAttribute("aria-busy", "true");
		}
		// The deployed Frappe version returns a jQuery Deferred from frappe.call.
		// Normalize it before chaining so Promise.prototype.finally is available;
		// otherwise the page-load hook throws after the route has changed and Desk
		// leaves the previously visible page mounted under the new navigation shell.
		this.load_promise = Promise.resolve(frappe.call({
			method: "hrms.hr.doctype.training_program.training_program.get_training_learning_dashboard",
			args: { company, include_plan_management: 0 },
		})).then(({ message }) => {
			if (company !== this.company()) return;
			this.data = message || {};
			this.loaded_company = company;
			this.last_loaded_at = Date.now();
			this.render(this.data);
			return this.data;
		}).catch(() => {
			if (company !== this.company()) return;
			if (this.loaded_company !== company) this.render_error();
			else frappe.show_alert?.({ message: __("刷新失败，已保留上次数据。"), indicator: "orange" });
		}).finally(() => {
			if (button && button.isConnected) {
				button.disabled = false;
				button.removeAttribute("aria-busy");
			}
			this.load_promise = null;
		});
		return this.load_promise;
	}

	render_error() {
		this.wrapper.innerHTML = `<section class="hrms-training-home"><div class="hrms-training-home-state"><strong>${__("培训主页数据暂时无法读取")}</strong><button class="btn btn-default" data-training-home-refresh>${__("重新加载")}</button></div></section>`;
		this.bind();
	}

	metric(label, value, note, route) {
		return `<button class="hrms-training-home-metric" data-training-home-route="${this.escape(route)}"><span>${this.escape(label)}</span><strong>${this.escape(value || 0)}</strong><small>${this.escape(note)}</small><i>→</i></button>`;
	}

	render(data) {
		const metrics = data.metrics || {};
		const events = data.scheduled_events_preview || data.upcoming_events || [];
		const departments = data.department_summary || [];
		const planned = Number(metrics.planned_courses) || 0;
		const implemented = Number(metrics.implemented_plans) || 0;
		const rate = planned ? Math.round(implemented / planned * 100) : 0;
		const attention = [
			{ label: __("计划关联待确认"), value: metrics.review_matches, detail: __("实际课程与计划的关联需要确认"), route: "review-training-match" },
			{ label: __("完成后结果未提交"), value: metrics.pending_results, detail: __("已完成活动尚无已提交结果"), route: "pending-training-result" },
			{ label: __("排期已过仍待开展"), value: metrics.overdue_events, detail: __("活动日期已过，状态仍为待开展"), route: "training-event" },
			{ label: __("需补训标记"), value: metrics.retraining_count, detail: __("已提交结果中标记需补训的人次"), route: "completed-training-event" },
			{ label: __("复训未来30天到期"), value: metrics.retraining_due, detail: __("有复训截止日期的活动数"), route: "training-event" },
		];
		this.wrapper.innerHTML = `
			<section class="hrms-training-home">
				<header class="hrms-training-home-hero">
					<div><p>TRAINING & LEARNING</p><h1>${__("培训学习主页")}</h1><span>${this.escape(this.company() || __("当前公司"))} · ${__("全部已录入计划与活动")}</span></div>
					<div><button class="btn btn-primary" data-training-home-route="training-program">${__("查看培训计划")}</button><button class="btn btn-default" data-training-home-refresh>${__("刷新数据")}</button></div>
				</header>
				<div class="hrms-training-home-metrics">
					${this.metric(__("计划课程"), planned, __("当前公司全部计划课程"), "annual-training-program")}
					${this.metric(__("已实施计划"), implemented, __("有已完成活动的计划"), "implemented-training-program")}
					${this.metric(__("待实施计划"), metrics.pending_plans, __("尚无已完成活动"), "pending-training-program")}
					${this.metric(__("已完成活动"), metrics.completed_events, __("实际培训活动数"), "completed-training-event")}
					${this.metric(__("名单人次"), metrics.participant_instances, __("活动名单累计，含未开展活动"), "training-event")}
				</div>
				<div class="hrms-training-home-grid">
					<section class="hrms-training-panel hrms-training-home-progress">
						<div class="hrms-training-panel-heading"><div><p>${__("计划执行")}</p><h2>${__("计划实施进度")}</h2></div><button class="btn btn-link" data-training-home-route="training-program">${__("查看计划")}</button></div>
						<div class="hrms-training-home-progress-number"><strong>${planned ? `${rate}%` : "—"}</strong><span>${implemented} / ${planned} ${__("项计划已实施")}</span></div>
						<div class="hrms-training-home-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${rate}" aria-label="${__("计划实施率")}"><span style="width: ${rate}%"></span></div>
						<div class="hrms-training-home-progress-breakdown"><button type="button" data-training-home-route="pending-training-program">${__("待实施")} <strong>${this.escape(metrics.pending_plans || 0)}</strong></button><span>${__("关联待确认")} <strong>${this.escape(metrics.review_matches || 0)}</strong></span><button type="button" data-training-home-route="temporary-training-event">${__("临时新增活动")} <strong>${this.escape(metrics.temporary_events || 0)}</strong></button></div>
						<p class="hrms-training-home-definition">${__("实施率 = 有已完成活动的计划 ÷ 全部计划课程；临时新增活动不计入计划。")}</p>
					</section>
					<section class="hrms-training-panel hrms-training-home-attention">
						<div class="hrms-training-panel-heading"><div><p>${__("需要处理")}</p><h2>${__("管理关注事项")}</h2></div></div>
						<div class="hrms-training-home-attention-list">${attention.map((item) => `<button data-training-home-route="${item.route}"><span class="${Number(item.value) > 0 ? "has-items" : ""}">${this.escape(item.value || 0)}</span><div><strong>${this.escape(item.label)}</strong><small>${this.escape(item.detail)}</small></div><i>→</i></button>`).join("")}</div>
					</section>
				</div>
				<div class="hrms-training-home-grid">
					<section class="hrms-training-panel hrms-training-home-departments">
						<div class="hrms-training-panel-heading"><div><p>${__("部门分布")}</p><h2>${__("待实施计划最多的部门")}</h2></div><span>${__("按待实施数排序")}</span></div>
						${departments.length ? `<div class="hrms-training-home-department-list">${departments.slice(0, 6).map((row) => `<div><strong>${this.escape(row.department)}</strong><span>${__("已实施")} ${this.escape(row.implemented)} / ${this.escape(row.planned)}</span><b>${__("待实施")} ${this.escape(row.pending)}</b></div>`).join("")}</div><p class="hrms-training-home-definition">${__("显示前 6 个部门；完整课程请查看培训计划。")}</p>` : `<div class="hrms-training-empty">${__("当前公司还没有已录入的计划课程。")}</div>`}
					</section>
					<section class="hrms-training-panel hrms-training-home-events">
						<div class="hrms-training-panel-heading"><div><p>${__("培训安排")}</p><h2>${__("待开展活动排期")}</h2></div><button class="btn btn-link" data-training-home-route="training-event">${__("查看全部")}</button></div>
						<div class="hrms-training-home-event-list">${events.length ? events.map((event) => `<button data-training-home-route="training-event"><span>${this.escape(event.start_time ? frappe.datetime.str_to_user(event.start_time) : __("待安排"))}${event.is_overdue ? ` <em>${__("已逾期")}</em>` : ""}</span><div><strong>${this.escape(event.event_name)}</strong><small>${this.escape(event.training_category || __("未分类"))} · ${this.escape(event.location || __("地点待定"))}</small></div><i>→</i></button>`).join("") : `<div class="hrms-training-empty">${__("暂无已排期的待开展活动。")}</div>`}</div>
					</section>
				</div>
			</section>`;
		this.bind();
	}

	bind() {
		this.wrapper.querySelectorAll("[data-training-home-refresh]").forEach((button) => button.addEventListener("click", () => this.show(true)));
		this.wrapper.querySelectorAll("[data-training-home-route]").forEach((button) => button.addEventListener("click", () => this.navigate(button.dataset.trainingHomeRoute)));
	}

	navigate(route) {
		const destination = this.destination(route);
		window.hrmsTrainingPlanNavigation = destination;
		frappe.set_route("List", "Training Program");
	}

	destination(route) {
		return {
			"training-program": { view: "plans", status: "全部" },
			"annual-training-program": { view: "plans", status: "年度计划" },
			"implemented-training-program": { view: "plans", status: "已实施" },
			"pending-training-program": { view: "plans", status: "待实施" },
			"training-event": { view: "activities", status: "全部" },
			"review-training-match": { view: "plans", status: "待确认" },
			"pending-training-result": { view: "activities", status: "结果未提交" },
			"temporary-training-event": { view: "activities", status: "临时新增" },
			"completed-training-event": { view: "activities", status: "已完成" },
			"training-result": { view: "activities", status: "已完成" },
			"training-feedback": { view: "activities", status: "已完成" },
			"employee-skill-map": { view: "activities", status: "已完成" },
		}[route] || { view: "plans", status: "全部" };
	}
}
