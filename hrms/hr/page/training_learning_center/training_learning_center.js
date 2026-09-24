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
	}

	company() {
		return window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	}

	show() {
		this.page.set_title(__("培训学习主页"));
		this.wrapper.innerHTML = `<section class="hrms-training-home"><div class="hrms-training-home-state">${__("正在读取培训统计与近期安排…")}</div></section>`;
		frappe.call({
			method: "hrms.hr.doctype.training_program.training_program.get_training_learning_dashboard",
			args: { company: this.company(), include_plan_management: 0 },
		}).then(({ message }) => this.render(message || {})).catch(() => this.render_error());
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
					${this.metric(__("已完成活动"), metrics.completed_events, __("已完成的培训场次"), "training-event")}
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
		this.wrapper.querySelectorAll("[data-training-home-refresh]").forEach((button) => button.addEventListener("click", () => this.show()));
		this.wrapper.querySelectorAll("[data-training-home-route]").forEach((button) => button.addEventListener("click", () => frappe.set_route("List", this.doctype(button.dataset.trainingHomeRoute))));
	}

	doctype(route) {
		return {
			"training-program": "Training Program",
			"training-event": "Training Event",
			"training-result": "Training Result",
			"training-feedback": "Training Feedback",
			"employee-skill-map": "Employee Skill Map",
		}[route] || "Training Program";
	}
}
