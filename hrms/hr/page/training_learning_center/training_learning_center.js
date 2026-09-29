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

	flow(index, title, detail, route) {
		return `<button class="hrms-training-step" data-training-home-route="${this.escape(route)}"><span>${this.escape(index)}</span><strong>${this.escape(title)}</strong><small>${this.escape(detail)}</small><i>→</i></button>`;
	}

	render(data) {
		const metrics = data.metrics || {};
		const risks = data.risks || [];
		const events = data.upcoming_events || [];
		this.wrapper.innerHTML = `
			<section class="hrms-training-home">
				<header class="hrms-training-home-hero">
					<div><p>TRAINING & LEARNING</p><h1>${__("培训学习主页")}</h1><span>${__("集中查看培训执行、待办、近期安排和闭环进度。")}</span></div>
					<div><button class="btn btn-primary" data-training-home-route="training-program">${__("查看培训计划")}</button><button class="btn btn-default" data-training-home-refresh>${__("刷新数据")}</button></div>
				</header>
				<div class="hrms-training-home-metrics">
					${this.metric(__("年度计划"), metrics.planned_courses, __("计划表中的应开课程"), "training-program")}
					${this.metric(__("已实施计划"), metrics.implemented_plans, __("已匹配实际上课"), "training-program")}
					${this.metric(__("待实施计划"), metrics.pending_plans, __("尚未匹配实际课程"), "training-program")}
					${this.metric(__("临时新增"), metrics.temporary_events, __("计划外实际课程"), "training-event")}
					${this.metric(__("已完成活动"), metrics.completed_events, __("已完成的培训场次"), "completed-training-event")}
				</div>
				<div class="hrms-training-home-grid">
					<section class="hrms-training-panel hrms-training-flow-panel">
						<div class="hrms-training-panel-heading"><div><p>${__("业务流程")}</p><h2>${__("培训闭环")}</h2></div><span>${__("按步骤办理")}</span></div>
						<div class="hrms-training-flow">
							${this.flow("01", __("培训计划"), __("上传并查看年度课程"), "training-program")}
							${this.flow("02", __("培训活动"), __("排期、签到与授课"), "training-event")}
							${this.flow("03", __("考核结果"), __("成绩、不合格与补训"), "training-result")}
							${this.flow("04", __("培训反馈"), __("满意度与改进建议"), "training-feedback")}
							${this.flow("05", __("员工技能"), __("记录与岗位资格沉淀"), "employee-skill-map")}
						</div>
					</section>
					<section class="hrms-training-panel hrms-training-risk-panel">
						<div class="hrms-training-panel-heading"><div><p>${__("需要关注")}</p><h2>${__("培训待办")}</h2></div><button class="btn btn-link" data-training-home-route="training-result">${__("查看结果")}</button></div>
						<div class="hrms-training-risks">${risks.map((item) => `<button class="hrms-training-risk ${this.escape(item.tone)}" data-training-home-route="${item.title === "复训临期" ? "training-event" : "training-result"}"><span>${this.escape(item.value || 0)}</span><div><strong>${this.escape(item.title)}</strong><small>${this.escape(item.detail)}</small></div><i>→</i></button>`).join("")}</div>
					</section>
				</div>
				<section class="hrms-training-panel hrms-training-home-events">
					<div class="hrms-training-panel-heading"><div><p>${__("培训执行")}</p><h2>${__("近期培训活动")}</h2></div><button class="btn btn-link" data-training-home-route="training-event">${__("查看全部")}</button></div>
					<div class="hrms-training-home-event-list">${events.length ? events.map((event) => `<button data-training-home-route="training-event"><span>${this.escape(event.start_time ? frappe.datetime.str_to_user(event.start_time) : __("待安排"))}</span><div><strong>${this.escape(event.event_name)}</strong><small>${this.escape(event.training_category || __("未分类"))} · ${this.escape(event.location || __("地点待定"))}</small></div><i>→</i></button>`).join("") : `<div class="hrms-training-empty">${__("暂无待开展的培训活动，可从培训计划开始安排。")}</div>`}</div>
				</section>
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
			"training-event": { view: "activities", status: "全部" },
			"completed-training-event": { view: "activities", status: "已完成" },
			"training-result": { view: "activities", status: "已完成" },
			"training-feedback": { view: "activities", status: "已完成" },
			"employee-skill-map": { view: "activities", status: "已完成" },
		}[route] || { view: "plans", status: "全部" };
	}
}
