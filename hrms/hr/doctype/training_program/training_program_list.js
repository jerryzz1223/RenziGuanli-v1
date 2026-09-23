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
	const importApi = "hrms.api.training_import";
	const currentCompany = () => window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	let importState = { company: "", plan_file_url: "", record_file_url: "", preview: null };

	function get_import_state(company) {
		if (importState.company !== company) importState = { company, plan_file_url: "", record_file_url: "", preview: null };
		return importState;
	}

	function new_training_program() {
		const company = currentCompany();
		frappe.new_doc("Training Program", { company, approval_status: "Draft" });
	}

	function open_training_import(reload) {
		if (!window.hrmsCapabilities?.require("training_submit")) return;
		const company = currentCompany();
		if (!company) return frappe.msgprint(__("请先在页面顶部选择当前公司。"));
		const state = get_import_state(company);
		const dialog = new frappe.ui.Dialog({
			title: __("年度资料导入与员工匹配"),
			size: "extra-large",
			fields: [{ fieldtype: "HTML", fieldname: "training_import_body" }],
		});

		const unresolved = () => (state.preview?.identities || []).filter((item) => item.status !== "matched");
		const statusLabel = {
			department_mismatch: __("部门不一致"),
			ambiguous: __("存在同名候选"),
			unmatched: __("主档未找到"),
			missing_code: __("缺少公司工号"),
		};

		function upload(kind) {
			new frappe.ui.FileUploader({
				folder: "Home/Attachments",
				allow_multiple: false,
				make_attachments_public: false,
				disable_file_browser: true,
				allow_web_link: false,
				allow_take_photo: false,
				allow_toggle_private: false,
				restrictions: { allowed_file_types: [".xlsx"] },
				on_success(file) {
					state[kind] = file.file_url;
					state.preview = null;
					render();
					reload?.();
					if (state.plan_file_url && state.record_file_url) preview();
				},
			});
		}

		function clearSelection() {
			state.plan_file_url = "";
			state.record_file_url = "";
			state.preview = null;
			render();
			reload?.();
		}

		function preview() {
			frappe.call({
				method: `${importApi}.preview_training_workbooks`,
				args: { plan_file_url: state.plan_file_url, record_file_url: state.record_file_url, company },
				freeze: true,
				freeze_message: __("正在完整读取计划总表、实际记录和员工公司工号…"),
			}).then((response) => {
				state.preview = response.message || {};
				render();
				reload?.();
			});
		}

		function identityRows() {
			return unresolved().map((item) => {
				const candidates = (item.candidates || []).filter((candidate) => candidate.employee_code);
				const candidateControl = candidates.length
					? `<select class="form-control input-sm" data-training-identity="${escape(item.identity_key)}"><option value="">${escape(__("请选择候选员工"))}</option>${candidates.map((candidate) => `<option value="${escape(candidate.employee_code)}">${escape([candidate.employee_code, candidate.employee_name, candidate.department, candidate.status, candidate.date_of_joining ? `${candidate.date_of_joining} 入职` : "", candidate.relieving_date ? `${candidate.relieving_date} 离职` : ""].filter(Boolean).join(" · "))}</option>`).join("")}</select>`
					: `<input class="form-control input-sm" data-training-identity="${escape(item.identity_key)}" value="" placeholder="${escape(__("输入当前公司工号"))}">`;
				const searchText = [item.employee_name, item.source_department, statusLabel[item.status], ...candidates.map((candidate) => candidate.employee_code)].join(" ").toLowerCase();
				return `<tr data-training-match-row data-status="${escape(item.status)}" data-search="${escape(searchText)}"><td><strong>${escape(item.employee_name)}</strong><small>${escape(__("来源部门：{0}", [item.source_department]))}</small></td><td>${escape(item.record_count)}</td><td><span class="hrms-training-match-status ${escape(item.status)}">${escape(statusLabel[item.status] || item.status)}</span></td><td>${candidateControl}</td><td>${candidates.length ? escape(candidates.map((candidate) => candidate.department || __("无部门")).join("；")) : `<span class="text-muted">${escape(__("请根据原表姓名核对工号"))}</span>`}</td></tr>`;
			}).join("");
		}

		function updateMatchProgress() {
			const inputs = dialog.$wrapper.find("[data-training-identity]");
			const completed = inputs.toArray().filter((input) => input.value.trim()).length;
			const sourceErrors = (state.preview?.plan?.error_count || 0) + (state.preview?.records?.error_count || 0);
			const pending = inputs.length - completed;
			dialog.$wrapper.find("[data-training-match-progress]").text(__("已确认 {0} / {1} 组", [completed, inputs.length]));
			dialog.$wrapper.find("[data-training-progress-fill]").css("width", `${inputs.length ? Math.round(completed / inputs.length * 100) : 100}%`);
			dialog.get_primary_btn()
				.prop("disabled", Boolean(sourceErrors || pending))
				.attr("title", pending ? __("请先完成剩余 {0} 组员工公司工号匹配。", [pending]) : "");
		}

		function bindMatchingTools() {
			const wrapper = dialog.$wrapper;
			wrapper.find("[data-training-identity]").on("change input", updateMatchProgress);
			wrapper.find("[data-training-match-search], [data-training-match-filter]").on("input change", () => {
				const query = String(wrapper.find("[data-training-match-search]").val() || "").trim().toLowerCase();
				const filter = wrapper.find("[data-training-match-filter]").val() || "";
				wrapper.find("[data-training-match-row]").each((_index, row) => {
					const matchesQuery = !query || String(row.dataset.search || "").includes(query);
					const matchesFilter = !filter || row.dataset.status === filter;
					row.hidden = !(matchesQuery && matchesFilter);
				});
			});
			wrapper.find("[data-training-reselect]").on("click", () => {
				clearSelection();
			});
			updateMatchProgress();
		}

		function importData() {
			const identity_map = {};
			dialog.$wrapper.find("[data-training-identity]").each((_index, input) => {
				identity_map[input.dataset.trainingIdentity] = input.value.trim();
			});
			const missing = Object.entries(identity_map).filter(([, value]) => !value);
			if (missing.length) return frappe.msgprint(__("仍有 {0} 组姓名/部门没有填写公司工号，不能导入。", [missing.length]));
			frappe.confirm(
				__("将写入 {0} 条培训计划、{1} 场历史培训和 {2} 条逐人参训记录。历史活动会标记为已完成，培训结果先保留为草稿，复核提交后才进入员工技能。是否继续？", [state.preview.plan.row_count, state.preview.records.event_count, state.preview.records.row_count]),
				() => frappe.call({
					method: `${importApi}.import_training_workbooks`,
					args: {
						plan_file_url: state.plan_file_url,
						record_file_url: state.record_file_url,
						company,
						plan_token: state.preview.plan_token,
						identity_map: JSON.stringify(identity_map),
						confirm_import: 1,
					},
					freeze: true,
					freeze_message: __("正在写入培训计划、活动和结果草稿…"),
				}).then((response) => {
					const result = response.message || {};
					importState = { company, plan_file_url: "", record_file_url: "", preview: null };
					dialog.hide();
					frappe.msgprint({
						title: __("培训数据导入完成"),
						indicator: "green",
						message: `${escape(result.message || "")}<br>${escape(__("新增计划 {0}，更新草稿计划 {1}，保留已审批计划 {2}；新增活动 {3}；结果草稿 {4}。", [result.programs_created || 0, result.programs_updated || 0, result.programs_locked || 0, result.events_created || 0, result.results_created_as_draft || 0]))}`,
					});
					reload?.();
				}),
			);
		}

		function render() {
			const body = dialog.fields_dict.training_import_body.$wrapper;
			if (!state.preview) {
				body.html(`<div class="hrms-training-import"><div class="hrms-training-import-steps"><span class="active"><b>1</b>${escape(__("上传原表"))}</span><span><b>2</b>${escape(__("数据校验"))}</span><span><b>3</b>${escape(__("公司工号匹配"))}</span><span><b>4</b>${escape(__("确认入库"))}</span></div><div class="hrms-training-import-note"><strong>${escape(__("当前公司：{0}", [company]))}</strong><span>${escape(__("以计划总表和教育训练登记表的标准表头为准；清除选择不会删除服务器审计附件。"))}</span></div><div class="hrms-training-upload-grid"><button class="hrms-training-upload-card ${state.plan_file_url ? "selected" : ""}" data-upload-plan><span>01</span><strong>${escape(__("年度教育训练计划"))}</strong><small>${escape(state.plan_file_url || __("点击选择 .xlsx 文件"))}</small><i>${state.plan_file_url ? "✓" : "+"}</i></button><button class="hrms-training-upload-card ${state.record_file_url ? "selected" : ""}" data-upload-record><span>02</span><strong>${escape(__("教育训练登记表"))}</strong><small>${escape(state.record_file_url || __("点击选择 .xlsx 文件"))}</small><i>${state.record_file_url ? "✓" : "+"}</i></button></div>${state.plan_file_url || state.record_file_url ? `<div class="text-right"><button class="btn btn-link text-danger" data-training-clear>${escape(__("清除已选文件"))}</button></div>` : ""}</div>`);
				body.find("[data-upload-plan]").on("click", () => upload("plan_file_url"));
				body.find("[data-upload-record]").on("click", () => upload("record_file_url"));
				body.find("[data-training-clear]").on("click", clearSelection);
				dialog.set_primary_action(__("解析并进入员工匹配"), preview);
				dialog.get_primary_btn().prop("disabled", !(state.plan_file_url && state.record_file_url));
				return;
			}
			const sourceErrors = (state.preview.plan?.error_count || 0) + (state.preview.records?.error_count || 0);
			const unresolvedIdentities = unresolved().length;
			const strictMatched = state.preview.records.row_count - state.preview.unresolved_record_count;
			body.html(`<div class="hrms-training-import"><div class="hrms-training-import-steps"><span class="done"><b>✓</b>${escape(__("上传原表"))}</span><span class="done"><b>✓</b>${escape(__("数据校验"))}</span><span class="active"><b>3</b>${escape(__("公司工号匹配"))}</span><span><b>4</b>${escape(__("确认入库"))}</span></div><div class="hrms-training-import-summary"><div><span>${escape(__("年度计划"))}</span><strong>${number(state.preview.plan.row_count)}</strong><small>${escape(__("计划 {0} / 临时 {1}", [state.preview.plan.planned_count, state.preview.plan.temporary_count]))}</small></div><div><span>${escape(__("实际培训"))}</span><strong>${number(state.preview.records.event_count)}</strong><small>${escape(__("{0} 条逐人记录", [state.preview.records.row_count]))}</small></div><div class="success"><span>${escape(__("严格匹配"))}</span><strong>${number(strictMatched)}</strong><small>${escape(__("已按公司工号确认"))}</small></div><div class="warning"><span>${escape(__("待人工确认"))}</span><strong>${number(state.preview.unresolved_record_count)}</strong><small>${escape(__("{0} 组姓名/部门", [unresolvedIdentities]))}</small></div></div>${sourceErrors ? `<div class="alert alert-danger">${escape(__("原表存在 {0} 条结构或数据错误，需先修正。", [sourceErrors]))}</div>` : ""}${unresolvedIdentities ? `<div class="hrms-training-match-heading"><div><h5>${escape(__("员工公司工号匹配"))}</h5><p>${escape(__("只显示未能严格自动匹配的记录；必须逐组确认，不使用 Frappe 员工编号。"))}</p></div><div class="hrms-training-match-progress"><strong data-training-match-progress></strong><span><i data-training-progress-fill></i></span></div></div><div class="hrms-training-match-toolbar"><input class="form-control" data-training-match-search placeholder="${escape(__("搜索姓名、部门或公司工号"))}"><select class="form-control" data-training-match-filter><option value="">${escape(__("全部差异"))}</option><option value="department_mismatch">${escape(statusLabel.department_mismatch)}</option><option value="ambiguous">${escape(statusLabel.ambiguous)}</option><option value="unmatched">${escape(statusLabel.unmatched)}</option><option value="missing_code">${escape(statusLabel.missing_code)}</option></select><button class="btn btn-default" data-training-reselect>${escape(__("清除两份文件并重新选择"))}</button></div><div class="table-responsive hrms-training-identity-table"><table class="table table-bordered table-sm"><thead><tr><th>${escape(__("来源人员"))}</th><th>${escape(__("记录数"))}</th><th>${escape(__("差异类型"))}</th><th>${escape(__("公司工号 / 候选员工"))}</th><th>${escape(__("当前主档部门"))}</th></tr></thead><tbody>${identityRows()}</tbody></table></div>` : `<div class="hrms-training-match-complete"><span>✓</span><div><strong>${escape(__("员工匹配已全部完成"))}</strong><p>${escape(__("所有逐人培训记录均已按姓名、来源部门和公司工号唯一匹配。"))}</p></div></div>`}</div>`);
			dialog.set_primary_action(unresolvedIdentities ? __("确认匹配并导入") : __("确认导入"), importData);
			dialog.get_primary_btn().prop("disabled", Boolean(sourceErrors));
			bindMatchingTools();
		}

		dialog.show();
		render();
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
		const state = get_import_state(currentCompany());
		const pendingIdentities = (state.preview?.identities || []).filter((item) => item.status !== "matched").length;
		const importActionLabel = state.preview
			? pendingIdentities ? __("继续匹配 {0} 组员工", [pendingIdentities]) : __("查看校验结果并导入")
			: state.plan_file_url || state.record_file_url ? __("继续上传原表") : __("开始上传与匹配");

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
			<div class="hrms-training-import-center">
				<div class="hrms-training-import-center-copy">
					<p>${__("年度资料工作区")}</p>
					<h2>${__("教育训练计划导入与员工匹配")}</h2>
					<span>${__("以年度计划总表和安全培训教育记录为准，先解析校验，再用当前公司的公司工号匹配员工。")}</span>
				</div>
				<div class="hrms-training-import-path">
					<div class="${state.plan_file_url && state.record_file_url ? "done" : "active"}"><b>01</b><span>${__("两份原表")}</span><small>${state.plan_file_url && state.record_file_url ? __("已选择") : __("计划表 + 记录表")}</small></div>
					<div class="${state.preview ? "done" : ""}"><b>02</b><span>${__("完整解析")}</span><small>${state.preview ? __("{0} 计划 / {1} 活动", [state.preview.plan.row_count, state.preview.records.event_count]) : __("主汇总页校验")}</small></div>
					<div class="${state.preview ? pendingIdentities ? "active warning" : "done" : ""}"><b>03</b><span>${__("员工匹配")}</span><small>${state.preview ? pendingIdentities ? __("待确认 {0} 组", [pendingIdentities]) : __("已全部匹配") : __("仅使用公司工号")}</small></div>
					<div><b>04</b><span>${__("确认入库")}</span><small>${__("计划、活动与结果草稿")}</small></div>
				</div>
				<button class="btn btn-primary" data-training-action="import">${importActionLabel}<span>→</span></button>
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
			if (action === "import") return open_training_import(reload);
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
