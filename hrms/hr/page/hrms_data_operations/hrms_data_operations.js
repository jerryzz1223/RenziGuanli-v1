frappe.pages["hrms-data-operations"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("公司与数据处理中心"),
		single_column: true,
	});
	page.set_primary_action(__("刷新数据"), () => loadAll(), "refresh");

	const state = {
		overview: {},
		context: {},
		company: "",
		selected: new Set(),
		preview: null,
		overviewError: "",
	};

	function escape(value) {
		return frappe.utils.escape_html(value == null ? "" : String(value));
	}

	function levelClass(level) {
		return level === "危险" ? "danger" : level === "提醒" ? "warning" : "success";
	}

	function companyLabel(row) {
		return row.company_name && row.company_name !== row.name
			? `${row.company_name}（${row.name}）`
			: row.name;
	}

	function riskLabel(risk) {
		return risk === "critical" ? __("极高风险") : risk === "high" ? __("高风险") : __("可清除");
	}

	function renderCompanyPanel() {
		const companies = state.context.companies || [];
		const current = companies.find((row) => row.name === state.company) || {};
		const noCompany = !state.company;
		return `
			<div class="hrms-data-operations__panel hrms-company-panel">
				<div class="hrms-panel-heading">
					<div><h4>${__("公司与数据空间")}</h4><p>${__("所有导入、人事异动和薪资计算都必须先属于一家公司。")}</p></div>
					<div class="hrms-data-operations__actions">
						<button class="btn btn-default btn-sm" data-action="new-company">${__("新建公司")}</button>
						<button class="btn btn-default btn-sm" data-action="open-company"${noCompany ? " disabled" : ""}>${__("打开公司档案")}</button>
						<button class="btn btn-primary btn-sm" data-action="set-current-company"${noCompany ? " disabled" : ""}>${__("设为当前公司")}</button>
					</div>
				</div>
				<div class="hrms-company-toolbar">
					<label>${__("正在管理的公司")}</label>
					<select class="form-control" data-company-selector${companies.length ? "" : " disabled"}>
						${companies.map((row) => `<option value="${escape(row.name)}"${row.name === state.company ? " selected" : ""}>${escape(companyLabel(row))}</option>`).join("") || `<option>${__("请先新建公司")}</option>`}
					</select>
				</div>
				<div class="hrms-company-stats">
					<span><strong>${escape(current.employee_count || 0)}</strong> ${__("员工")}</span>
					<span><strong>${escape(current.department_count || 0)}</strong> ${__("部门")}</span>
					<span>${__("公司稳定编码：")}${escape(current.name || "-")}</span>
				</div>
			</div>`;
	}

	function renderCleanupPanel() {
		const modules = state.context.modules || [];
		const protectedItems = state.context.protected || [];
		return `
			<div class="hrms-data-operations__panel hrms-cleanup-panel">
				<div class="hrms-panel-heading">
					<div><h4>${__("数据清理中心")}</h4><p>${__("按模块清理演示或分阶段测试数据。所有模块默认不选中，必须先预览。")}</p></div>
					<button class="btn btn-primary" data-action="preview-cleanup"${state.selected.size ? "" : " disabled"}>${__("预览已选数据")}</button>
				</div>
				<div class="hrms-protected-note"><strong>${__("永久保留：")}</strong>${protectedItems.map(escape).join("、")}</div>
				<div class="hrms-cleanup-grid">
					${modules.map((module) => `
						<label class="hrms-cleanup-module is-${escape(module.risk)}${state.selected.has(module.key) ? " is-selected" : ""}">
							<input type="checkbox" data-module="${escape(module.key)}"${state.selected.has(module.key) ? " checked" : ""}>
							<span class="hrms-cleanup-module__content">
								<span class="hrms-cleanup-module__title">${escape(module.label)} <em>${escape(riskLabel(module.risk))}</em></span>
								<span>${escape(module.description)}</span>
								<strong>${__("{0} 条记录", [module.count || 0])}</strong>
							</span>
						</label>`).join("")}
				</div>
				<div data-cleanup-preview>${renderPreview()}</div>
			</div>`;
	}

	function renderPreview() {
		const preview = state.preview;
		if (!preview) return "";
		const blockers = preview.blockers || [];
		const linkedBlockers = preview.linked_blockers || [];
		const blocked = blockers.length || linkedBlockers.length;
		return `
			<div class="hrms-cleanup-preview${blocked ? " has-blockers" : ""}">
				<h5>${__("清理预览：{0} 条", [preview.count || 0])}</h5>
				<p>${escape((preview.module_labels || []).join("、"))}</p>
				${blockers.length ? `<div class="alert alert-warning">${__("员工花名册存在可一起清理的前置数据：")}${blockers.map((row) => `${escape(row.label)}(${escape(row.count)})`).join("、")}<div><button class="btn btn-default btn-xs mt-2" data-action="select-required">${__("一键加入前置模块")}</button></div></div>` : ""}
				${linkedBlockers.length ? `<div class="alert alert-danger"><strong>${__("仍有其他员工关联数据，暂不能清除花名册：")}</strong><ul>${linkedBlockers.slice(0, 10).map((row) => `<li>${escape(row.label || row.doctype)}：${escape(row.count)} ${__("条")}</li>`).join("")}</ul><small>${__("请先在对应业务页撤回或清理这些记录。")}</small></div>` : ""}
				<table class="table table-bordered"><thead><tr><th>${__("数据类型")}</th><th>${__("数量")}</th><th>${__("示例")}</th></tr></thead><tbody>
					${(preview.records || []).map((row) => `<tr><td>${escape(row.doctype)}</td><td>${escape(row.count)}</td><td>${escape((row.sample_names || []).join("、"))}</td></tr>`).join("") || `<tr><td colspan="3" class="text-muted">${__("已选模块暂无数据")}</td></tr>`}
				</tbody></table>
				<button class="btn btn-danger" data-action="execute-cleanup"${blocked || !preview.count ? " disabled" : ""}>${__("输入确认文本并执行清理")}</button>
			</div>`;
	}

	function renderCleanupLogs() {
		const logs = state.context.cleanup_logs || [];
		return `
			<div class="hrms-data-operations__panel">
				<div class="hrms-panel-heading"><div><h4>${__("最近清理记录")}</h4><p>${__("只记录成功执行的清理范围与数量，不保存被删除的敏感内容。")}</p></div></div>
				<table class="table table-bordered"><thead><tr><th>${__("时间")}</th><th>${__("模块")}</th><th>${__("数量")}</th><th>${__("执行人")}</th></tr></thead><tbody>
					${logs.map((row) => `<tr><td>${escape(frappe.datetime?.str_to_user?.(row.executed_at) || row.executed_at)}</td><td>${escape(row.modules)}</td><td>${escape(row.record_count)}</td><td>${escape(row.executed_by)}</td></tr>`).join("") || `<tr><td colspan="4" class="text-muted">${__("该公司暂无清理记录")}</td></tr>`}
				</tbody></table>
			</div>`;
	}

	function renderOperations() {
		const data = state.overview || {};
		const queues = data.queues || [];
		const actions = data.actions || [];
		return `
			${state.overviewError ? `<div class="alert alert-warning">${escape(state.overviewError)}</div>` : ""}
			<div class="hrms-data-operations__summary">
				<div class="hrms-data-operations__card"><small>${__("待处理任务")}</small><strong>${escape(data.queued_total || 0)}</strong><span>${__("队列上限：{0}", [data.queue_limit || "-"])}</span></div>
				<div class="hrms-data-operations__card is-${levelClass(data.level)}"><small>${__("运行状态")}</small><strong>${escape(data.level || "-")}</strong><span>${escape(data.message || "")}</span></div>
			</div>
			<div class="hrms-data-operations__panel">
				<h4>${__("后台队列")}</h4>
				<table class="table table-bordered"><thead><tr><th>${__("队列")}</th><th>${__("等待")}</th><th>${__("运行中")}</th><th>${__("状态")}</th></tr></thead><tbody>
					${queues.map((row) => `<tr><td>${escape(row.name)}</td><td>${escape(row.pending)}</td><td>${escape(row.running)}</td><td><span class="indicator-pill ${levelClass(row.level)}">${escape(row.level)}</span></td></tr>`).join("") || `<tr><td colspan="4" class="text-muted">${__("暂无队列数据")}</td></tr>`}
				</tbody></table>
			</div>
			<div class="hrms-data-operations__actions">${actions.map((action) => `<button class="btn btn-default" data-route="${escape(action.route)}">${escape(action.label)}</button>`).join("")}</div>`;
	}

	function render() {
		$(page.body).html(`
			<div class="hrms-data-operations">
				<div class="hrms-data-operations__notice alert alert-info"><strong>${__("系统管理员专用")}</strong><br>${__("清理功能按公司隔离，不会删除公司、组织架构、规则、模板或权限。")}</div>
				${renderCompanyPanel()}
				${renderCleanupPanel()}
				${renderCleanupLogs()}
				${renderOperations()}
			</div>`);
		bindEvents();
	}

	function bindEvents() {
		const body = page.body[0] || page.body;
		body.querySelector("[data-company-selector]")?.addEventListener("change", (event) => loadContext(event.target.value));
		body.querySelectorAll("[data-module]").forEach((checkbox) => checkbox.addEventListener("change", () => {
			checkbox.checked ? state.selected.add(checkbox.dataset.module) : state.selected.delete(checkbox.dataset.module);
			state.preview = null;
			render();
		}));
		body.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => {
			frappe.set_route(...button.dataset.route.replace(/^\/desk\//, "").split("/"));
		}));
		body.querySelector('[data-action="new-company"]')?.addEventListener("click", () => frappe.new_doc("Company"));
		body.querySelector('[data-action="open-company"]')?.addEventListener("click", () => frappe.set_route("Form", "Company", state.company));
		body.querySelector('[data-action="set-current-company"]')?.addEventListener("click", () => {
			const setCompany = () => {
				const selected = window.hrmsCompanyContext?.setCurrentCompany?.(state.company);
				if (selected !== state.company) {
					frappe.msgprint(__("公司上下文未能刷新，请刷新页面后重试。"));
					return;
				}
				frappe.show_alert({ message: __("已切换当前公司：{0}", [state.company]), indicator: "green" });
			};
			const knownCompanies = window.hrmsCompanyContext?.getCompanies?.() || [];
			if (!knownCompanies.includes(state.company) && window.hrmsCompanyContext?.reload) {
				window.hrmsCompanyContext.reload().then(setCompany);
				return;
			}
			setCompany();
		});
		body.querySelector('[data-action="select-required"]')?.addEventListener("click", () => {
			(state.preview?.blockers || []).forEach((row) => state.selected.add(row.key));
			state.preview = null;
			render();
			frappe.show_alert({ message: __("已加入前置模块，请重新预览。"), indicator: "blue" });
		});
		body.querySelector('[data-action="preview-cleanup"]')?.addEventListener("click", previewCleanup);
		body.querySelector('[data-action="execute-cleanup"]')?.addEventListener("click", confirmCleanup);
	}

	function selectedModules() {
		return Array.from(state.selected);
	}

	function previewCleanup() {
		return frappe.call({
			method: "hrms.api.data_operations.preview_company_data_cleanup",
			args: { company: state.company, modules: selectedModules() },
			freeze: true,
			freeze_message: __("正在生成清理预览…"),
		}).then((response) => {
			state.preview = response.message || null;
			render();
		});
	}

	function confirmCleanup() {
		const preview = state.preview;
		if (!preview) return;
		const dialog = new frappe.ui.Dialog({
			title: __("确认清理公司数据"),
			fields: [
				{ fieldtype: "HTML", fieldname: "warning", options: `<div class="alert alert-danger">${__("即将清除 {0} 的 {1} 条数据。此操作不可撤销。", [escape(state.company), preview.count])}<br><strong>${escape(preview.confirmation_text)}</strong></div>` },
				{ fieldtype: "Data", fieldname: "confirmation", label: __("输入上方完整确认文本"), reqd: 1 },
				{ fieldtype: "Check", fieldname: "acknowledge", label: __("我已确认公司和数据范围"), reqd: 1 },
			],
			primary_action_label: __("执行清理"),
			primary_action(values) {
				if (values.confirmation !== preview.confirmation_text || !values.acknowledge) {
					frappe.msgprint(__("确认文本不匹配，未执行任何清理。"));
					return;
				}
				frappe.call({
					method: "hrms.api.data_operations.execute_company_data_cleanup",
					args: { company: state.company, modules: selectedModules(), confirm: values.confirmation, plan_token: preview.plan_token },
					freeze: true,
					freeze_message: __("正在清理已选数据…"),
				}).then((response) => {
					dialog.hide();
					frappe.msgprint({ title: __("清理完成"), message: escape(response.message?.message || ""), indicator: "green" });
					state.selected.clear();
					state.preview = null;
					loadContext(state.company);
				});
			},
		});
		dialog.show();
	}

	function loadContext(company) {
		$(page.body).html(`<div class="text-muted">${__("正在读取公司数据空间…")}</div>`);
		return frappe.call("hrms.api.data_operations.get_company_data_management_context", { company }).then((response) => {
			state.context = response.message || {};
			state.company = state.context.company || "";
			state.selected.clear();
			state.preview = null;
			render();
		});
	}

	function loadAll() {
		$(page.body).html(`<div class="text-muted">${__("正在读取数据处理状态…")}</div>`);
		const currentCompany = window.hrmsCompanyContext?.getCurrentCompany?.() || "";
		return Promise.allSettled([
			frappe.call("hrms.api.data_operations.get_data_operations_overview"),
			frappe.call("hrms.api.data_operations.get_company_data_management_context", { company: currentCompany }),
		]).then(([overviewResult, contextResult]) => {
			if (contextResult.status !== "fulfilled") throw contextResult.reason;
			state.overview = overviewResult.status === "fulfilled" ? overviewResult.value.message || {} : {};
			state.overviewError = overviewResult.status === "fulfilled" ? "" : __("后台队列状态暂时不可用，不影响公司与数据空间管理。");
			state.context = contextResult.value.message || {};
			state.company = state.context.company || "";
			state.selected.clear();
			state.preview = null;
			render();
		});
	}

	loadAll();
};
