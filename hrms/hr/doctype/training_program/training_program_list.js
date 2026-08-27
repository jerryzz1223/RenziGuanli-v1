(() => {
	const routes = {
		plans: ["List", "Training Program"],
		events: ["List", "Training Event"],
		results: ["List", "Training Result"],
		feedback: ["List", "Training Feedback"],
		skills: ["List", "Employee Skill Map"],
	};

	const escape = (value) => frappe.utils.escape_html(String(value ?? ""));
	const number = (value) => escape(value || 0);
	const route = (key) => frappe.set_route(...routes[key]);

	function new_training_program() {
		const company = window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
		frappe.new_doc("Training Program", { company, approval_status: "Draft" });
	}

	function event_time(value) {
		return value ? frappe.datetime.str_to_user(value) : __("待安排");
	}

	function ensure_dashboard(listview) {
		const main = listview.page.main?.[0];
		if (!main) return null;
		let workspace = main.querySelector(".hrms-training-learning-workspace");
		if (workspace) return workspace;

		workspace = document.createElement("section");
		workspace.className = "hrms-training-learning-workspace";
		main.prepend(workspace);
		document.body.classList.add("hrms-training-learning-view");
		return workspace;
	}

	function render_dashboard(workspace, dashboard = {}, loading = false) {
		const metrics = dashboard.metrics || {};
		const risks = dashboard.risks || [];
		const events = dashboard.upcoming_events || [];
		const placeholder = loading ? "–" : 0;
		const steps = [
			["01", "培训计划", "明确对象、周期、预算与必修要求", "plans"],
			["02", "培训活动", "排期、签到、讲师与资格用途", "events"],
			["03", "考核结果", "登记成绩，识别不合格与补训", "results"],
			["04", "培训反馈", "收集满意度与改进建议", "feedback"],
			["05", "员工技能", "沉淀通过记录与岗位资格", "skills"],
		];

		workspace.innerHTML = `
			<div class="hrms-training-hero">
				<div>
					<p class="hrms-training-eyebrow">TRAINING & LEARNING</p>
					<h1>${__("培训学习")}</h1>
					<p>${__("从计划到技能沉淀的培训闭环，数据仅来自当前公司的现有培训单据。")}</p>
				</div>
				<div class="hrms-training-hero-actions">
					<button class="btn btn-primary" data-training-action="new-plan">${__("新建培训计划")}</button>
					<button class="btn btn-default" data-training-action="refresh">${__("刷新数据")}</button>
				</div>
			</div>
			<div class="hrms-training-summary">
				${summary_card(__("培训计划"), metrics.total_programs ?? placeholder, __("共 {0} 个计划", [number(metrics.total_programs ?? placeholder)]), "plans")}
				${summary_card(__("执行中"), metrics.active_programs ?? placeholder, __("已排期的培训计划"), "plans")}
				${summary_card(__("待开展活动"), metrics.scheduled_events ?? placeholder, __("已安排、尚未完成"), "events")}
				${summary_card(__("已完成活动"), metrics.completed_events ?? placeholder, __("可进入反馈与技能沉淀"), "results")}
			</div>
			<div class="hrms-training-content-grid">
				<div class="hrms-training-panel hrms-training-flow-panel">
					<div class="hrms-training-panel-heading"><div><p>${__("业务流程")}</p><h2>${__("培训闭环")}</h2></div><span>${__("按步骤办理")}</span></div>
					<div class="hrms-training-flow">
						${steps.map(([index, title, detail, key]) => `<button class="hrms-training-step" data-training-route="${key}"><span>${index}</span><strong>${__(title)}</strong><small>${__(detail)}</small><i>→</i></button>`).join("")}
					</div>
				</div>
				<div class="hrms-training-panel hrms-training-risk-panel">
					<div class="hrms-training-panel-heading"><div><p>${__("需要关注")}</p><h2>${__("培训待办")}</h2></div><button class="btn btn-link" data-training-route="results">${__("查看结果")}</button></div>
					<div class="hrms-training-risks">
						${risks.length ? risks.map((item) => `<button class="hrms-training-risk ${escape(item.tone)}" data-training-route="${item.title === "复训临期" ? "events" : "results"}"><span>${number(item.value)}</span><div><strong>${__(item.title)}</strong><small>${__(item.detail)}</small></div><i>→</i></button>`).join("") : `<div class="hrms-training-empty">${__("正在读取待办数据…")}</div>`}
					</div>
				</div>
			</div>
			<div class="hrms-training-panel hrms-training-events-panel">
				<div class="hrms-training-panel-heading"><div><p>${__("培训执行")}</p><h2>${__("近期培训活动")}</h2></div><button class="btn btn-link" data-training-route="events">${__("查看全部")}</button></div>
				<div class="hrms-training-events">
					${events.length ? events.map((item) => `<button class="hrms-training-event" data-training-event="${escape(item.name)}"><span class="hrms-training-event-date">${escape(event_time(item.start_time))}</span><strong>${escape(item.event_name)}</strong><small>${escape(item.training_category || __("未分类"))} · ${escape(item.location || __("地点待定"))}</small><i>→</i></button>`).join("") : `<div class="hrms-training-empty">${loading ? __("正在读取培训活动…") : __("暂无待开展的培训活动，可先从培训计划开始安排。")}</div>`}
				</div>
			</div>
			<div class="hrms-training-list-heading"><div><p>${__("原始数据")}</p><h2>${__("培训计划清单")}</h2></div><span>${__("支持原有搜索、筛选、导出与列表操作")}</span></div>
		`;
	}

	function summary_card(title, value, description, route_key) {
		return `<button class="hrms-training-summary-card" data-training-route="${route_key}"><span>${title}</span><strong>${number(value)}</strong><small>${description}</small><i>→</i></button>`;
	}

	function bind_dashboard_actions(workspace, reload) {
		workspace.onclick = (event) => {
			const action = event.target.closest("[data-training-action]")?.dataset.trainingAction;
			if (action === "new-plan") return new_training_program();
			if (action === "refresh") return reload();
			const route_key = event.target.closest("[data-training-route]")?.dataset.trainingRoute;
			if (route_key) return route(route_key);
			const event_name = event.target.closest("[data-training-event]")?.dataset.trainingEvent;
			if (event_name) frappe.set_route("Form", "Training Event", event_name);
		};
	}

	function load_dashboard(listview, workspace) {
		render_dashboard(workspace, {}, true);
		bind_dashboard_actions(workspace, () => load_dashboard(listview, workspace));
		frappe.call({
			method: "hrms.hr.doctype.training_program.training_program.get_training_learning_dashboard",
			args: { company: window.hrmsCompanyContext?.getCurrentCompany?.() || "" },
			callback: ({ message }) => {
				render_dashboard(workspace, message || {});
				bind_dashboard_actions(workspace, () => load_dashboard(listview, workspace));
			},
			error: () => {
				render_dashboard(workspace, { risks: [{ tone: "warning", title: __("数据暂不可用"), value: "!", detail: __("请刷新后重试，原培训计划清单不受影响。") }] });
				bind_dashboard_actions(workspace, () => load_dashboard(listview, workspace));
			},
		});
	}

	frappe.listview_settings["Training Program"] = {
		add_fields: ["status", "approval_status", "training_category", "plan_period", "owner_department", "trainer_name"],
		onload(listview) {
			if (listview.page.__training_learning_ready) return;
			listview.page.__training_learning_ready = true;
			listview.page.set_title(__("培训学习"));
			const workspace = ensure_dashboard(listview);
			if (workspace) load_dashboard(listview, workspace);
		},
		get_indicator(doc) {
			const status = doc.approval_status || doc.status;
			const colour = status === "Closed" || status === "Completed" ? "green" : status === "Approved" || status === "In Progress" ? "blue" : status === "Cancelled" ? "red" : "orange";
			return [__(status), colour, `status,=,${doc.status}`];
		},
		formatters: {
			training_category(value) { return value ? `<span class="indicator-pill blue">${escape(value)}</span>` : ""; },
			approval_status(value) { return value ? `<span class="indicator-pill ${value === "Approved" ? "green" : "orange"}">${escape(value)}</span>` : ""; },
		},
	};
})();
