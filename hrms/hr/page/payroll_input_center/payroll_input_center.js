frappe.pages["payroll-input-center"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("薪酬管理中心"),
		single_column: true,
	});

	wrapper.payroll_input_center = new PayrollInputCenter(page);
	wrapper.payroll_input_center.show();
};

frappe.pages["payroll-input-center"].on_page_show = function (wrapper) {
	if (wrapper.payroll_input_center) {
		wrapper.payroll_input_center.refresh_from_route();
	}
};

class PayrollInputCenter {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.file_url = "";
		this.salary_structure_file_url = "";
		this.data_closure_file_url = "";
		this.payroll_month = frappe.datetime.str_to_obj(frappe.datetime.get_today()).toISOString().slice(0, 7);
		this.company = this.get_context_company();
		this.attendance_lock_version = "";
		this.available_attendance_locks = [];
		this.can_edit_payroll_rules = false;
		this.show_all_settlement_details = false;
		this.pending_config_anchor = "";
		this.payroll_configuration_items = [];
		this.payroll_rule_rows = [];
		this.payroll_mapping_rows = [];
		this.process_readiness = {};
		this.month_runbook = null;
		this.source_form_imports = [
			{ key: "reward_punishment", label: "奖惩提报" },
			{ key: "skill_certificate_allowance", label: "证书与多能工津贴" },
			{ key: "full_attendance_bonus", label: "全勤奖" },
			{ key: "housing_allowance", label: "住房补贴" },
			{ key: "education_allowance", label: "学历补贴" },
			{ key: "dormitory_fee", label: "宿舍费与水电扣款" },
			{ key: "social_insurance", label: "社保公积金名单" },
			{ key: "service_award", label: "继续服务奖" },
			{ key: "exit_payroll_settlement", label: "离职人员薪资结算" },
		];
		this.tabs = [
			{ key: "monthly-workbench", label: "本月算薪" },
			{ key: "employee-salary", label: "员工薪资" },
			{ key: "monthly-payroll", label: "月工资表" },
			{ key: "payroll-disbursement", label: "工资发放" },
			{ key: "data-closure", label: "数据闭环导入" },
			{ key: "salary-rules", label: "薪资规则" },
			{ key: "salary-templates", label: "工资表模板" },
			{ key: "salary-assignments", label: "员工分配" },
			{ key: "salary-master", label: "薪资主数据" },
			{ key: "welfare-sources", label: "福利扣款" },
			{ key: "variables", label: "变量导入" },
			{ key: "inputs", label: "薪资输入表" },
			{ key: "settlements", label: "薪资结算表" },
			{ key: "payroll-reports", label: "薪酬报表" },
			{ key: "payroll-analysis", label: "薪酬分析" },
			{ key: "annual-bonus", label: "年终奖计算" },
			{ key: "salary-slips", label: "发送工资条" },
		];
		this.primary_tabs = [
			{ key: "monthly-workbench", label: "本月算薪" },
			{ key: "employee-salary", label: "员工薪资" },
			{ key: "salary-rules", label: "薪酬项目与规则" },
			{ key: "payroll-reports", label: "报表与发放" },
		];
		this.process_steps = [
			{ key: "master", label: "基础资料", route: "employee-salary", description: "只读校验人事员工与组织资料" },
			{ key: "items", label: "薪酬项目", route: "salary-rules", description: "定义工资项与计算规则" },
			{ key: "templates", label: "工资表模板", route: "salary-templates", description: "组合应发、应扣与公司承担项" },
			{ key: "assignments", label: "员工分配", route: "salary-assignments", description: "分配模板并维护已批准员工定薪" },
			{ key: "sources", label: "月度来源", route: "data-closure", description: "锁定考勤与确认当月变量" },
			{ key: "calculation", label: "试算复核", route: "monthly-workbench", description: "生成输入与结算结果" },
			{ key: "delivery", label: "报表发放", route: "payroll-reports", description: "确认、导出与发放" },
		];
		this.active_tab = this.resolve_tab(frappe.get_route()[1] || "monthly-workbench");
		this.active_process_step = this.process_step_for(this.active_tab);
	}

	show() {
		this.page.clear_inner_toolbar?.();
		this.page.set_primary_action(__("导入薪资资料"), () => this.open_payroll_import_selector());
		this.bind_route_events();
		this.bind_company_context();
		this.render();
		this.load_active_tab();
		this.refresh_company_context_when_ready();
	}

	get_context_company() {
		return (
			window.hrmsCompanyContext?.getCurrentCompany?.() ||
			(frappe.defaults && frappe.defaults.get_user_default && frappe.defaults.get_user_default("Company")) ||
			""
		);
	}

	bind_company_context() {
		if (this.company_context_bound) return;
		this.company_context_bound = true;
		this.handle_company_context_change = (event) => {
			const company = event?.detail?.company || this.get_context_company();
			if (!company || company === this.company) return;
			this.company = company;
			this.attendance_lock_version = "";
			this.available_attendance_locks = [];
			this.process_readiness = {};
			this.month_runbook = null;
			this.render();
			this.load_active_tab();
		};
		window.addEventListener("hrms:company-context-changed", this.handle_company_context_change);
	}

	refresh_company_context_when_ready() {
		const ready = window.hrmsCompanyContext?.ready?.();
		if (!ready || typeof ready.then !== "function") return;
		ready.then((company) => {
			if (!company || company === this.company) return;
			this.company = company;
			this.attendance_lock_version = "";
			this.available_attendance_locks = [];
			this.process_readiness = {};
			this.month_runbook = null;
			this.render();
			this.load_active_tab();
		});
	}

	bind_route_events() {
		if (this.route_events_bound) return;
		this.route_events_bound = true;
		this.handle_hrms_route_change = (event) => {
			const tab = this.tab_from_route_detail(event.detail);
			if (tab) this.refresh_from_route(tab);
		};
		window.addEventListener("hrms:route-change", this.handle_hrms_route_change);
	}

	tab_from_current_route() {
		const route = frappe.get_route ? frappe.get_route() : [];
		return this.resolve_tab(route[1] || "monthly-workbench");
	}

	tab_from_route_detail(detail) {
		const value = String((detail && (detail.slug || detail.route)) || "");
		const normalized = value.replace(/^\/desk\/?/, "").replace(/^\/app\/?/, "").replace(/\/$/, "");
		const parts = normalized.split("/").filter(Boolean);
		if (parts[0] !== "payroll-input-center") return "";
		return this.resolve_tab(parts[1] || "monthly-workbench");
	}

	refresh_from_route(tab = "") {
		const next_tab = this.resolve_tab(tab || this.tab_from_current_route());
		const has_body = Boolean(this.body());
		if (next_tab === this.active_tab && has_body) return;
		this.active_tab = next_tab;
		this.active_process_step = this.process_step_for(next_tab);
		this.render();
		this.load_active_tab();
	}

	resolve_tab(tab) {
		return this.tabs.some((item) => item.key === tab) ? tab : "monthly-workbench";
	}

	primary_tab_for(tab) {
		if (["monthly-workbench", "monthly-payroll", "data-closure", "welfare-sources", "variables", "inputs", "settlements"].includes(tab)) return "monthly-workbench";
		if (["employee-salary"].includes(tab)) return "employee-salary";
		if (["salary-rules", "salary-templates", "salary-assignments", "salary-master"].includes(tab)) return "salary-rules";
		return "payroll-reports";
	}

	process_step_for(tab) {
		if (tab === "employee-salary") return "master";
		if (tab === "salary-rules") return "items";
		if (tab === "salary-templates") return "templates";
		if (["salary-assignments", "salary-master"].includes(tab)) return "assignments";
		if (["data-closure", "welfare-sources", "variables"].includes(tab)) return "sources";
		if (["monthly-workbench", "monthly-payroll", "inputs", "settlements"].includes(tab)) return "calculation";
		return "delivery";
	}

	render_process_guide() {
		return `
			<div class="hrms-payroll-process-guide" aria-label="薪酬配置与核算步骤">
				<div class="hrms-payroll-process-caption">
					<strong>${frappe.utils.escape_html(__("薪酬实施步骤"))}</strong>
					<span>${frappe.utils.escape_html(__("点击哪一步，下方只显示该步的说明、状态和操作入口。"))}</span>
				</div>
				<div class="hrms-payroll-process-steps">
					${this.process_steps
						.map((step, index) => {
							const state = this.process_state_for(step.key);
							return `<button class="hrms-payroll-process-step is-${state.state} ${step.key === this.active_process_step ? "is-selected" : ""}" data-process-key="${frappe.utils.escape_html(step.key)}" data-process-route="${frappe.utils.escape_html(step.route)}" data-process-anchor="${frappe.utils.escape_html(step.anchor || "")}" title="${frappe.utils.escape_html(state.detail || __(step.description))}" aria-current="${step.key === this.active_process_step ? "step" : "false"}">
								<span class="hrms-payroll-process-index">${index + 1}</span>
								<span><strong>${frappe.utils.escape_html(__(step.label))}</strong><small data-process-state>${frappe.utils.escape_html(state.label)}</small></span>
							</button>`;
						})
						.join("")}
				</div>
			</div>`;
	}

	process_state_for(key) {
		const data = this.process_readiness?.[key];
		if (data) {
			return {
				state: data.state || "pending",
				label: data.label || __("待完成"),
				detail: data.detail || "",
			};
		}
		const activeKey = this.active_process_step || this.process_step_for(this.active_tab);
		if (key === activeKey) return { state: "current", label: __("当前查看"), detail: "" };
		return { state: "pending", label: __("待检查"), detail: "" };
	}

	update_process_guide_status(statuses = {}) {
		this.process_readiness = Object.assign({}, this.process_readiness || {}, statuses);
		this.wrapper.querySelectorAll("[data-process-key]").forEach((button) => {
			const state = this.process_state_for(button.dataset.processKey);
			button.className = `hrms-payroll-process-step is-${state.state} ${button.dataset.processKey === this.active_process_step ? "is-selected" : ""}`;
			button.title = state.detail || button.title || "";
			const label = button.querySelector("[data-process-state]");
			if (label) label.textContent = state.label;
		});
	}

	process_status_from_runbook(runbook = {}) {
		const byKey = {};
		(runbook.process_steps || []).forEach((step) => {
			byKey[step.key] = {
				state: step.tone === "ready" ? "complete" : step.tone === "blocked" ? "blocked" : step.tone === "warning" ? "warning" : "pending",
				label: step.status || __("待完成"),
				detail: step.detail || step.summary || "",
			};
		});
		return byKey;
	}

	open_process_step(route, anchor = "") {
		this.pending_config_anchor = anchor || "";
		this.route_to_tab(route);
	}

	render() {
		this.wrapper.innerHTML = `
			<div class="hrms-payroll-input-center">
				<div class="hrms-payroll-input-head">
					<div>
						<h2>${frappe.utils.escape_html(__("薪酬管理中心"))}</h2>
						<p>${frappe.utils.escape_html(__("联动人事基础资料，按步骤维护薪酬项目、员工定薪、月度来源、试算与发放。"))}</p>
					</div>
					<div class="hrms-payroll-input-controls">
						<input class="form-control" data-company data-company-context readonly aria-readonly="true" title="${frappe.utils.escape_html(__("请在顶部公司切换器中切换公司"))}" placeholder="${frappe.utils.escape_html(__("公司"))}" value="${frappe.utils.escape_html(this.company || "")}">
						<input class="form-control" type="month" data-month value="${frappe.utils.escape_html(this.payroll_month)}">
						<select class="form-control" data-lock-version title="${frappe.utils.escape_html(__("薪资只能使用已锁定的月度考勤终稿"))}">
							<option value="">${frappe.utils.escape_html(__("加载考勤锁定版本..."))}</option>
						</select>
						<button class="btn btn-default" data-upload>${frappe.utils.escape_html(__("上传 Excel"))}</button>
					</div>
				</div>
				<div class="hrms-payroll-input-tabs" aria-label="薪酬主导航">
					${this.primary_tabs
						.map(
							(tab) => `
								<button class="btn btn-default btn-sm ${tab.key === this.primary_tab_for(this.active_tab) ? "active" : ""}" data-tab="${frappe.utils.escape_html(tab.key)}">
									${frappe.utils.escape_html(__(tab.label))}
								</button>
							`,
						)
						.join("")}
				</div>
				${this.render_process_guide()}
				<div data-payroll-body></div>
			</div>
		`;
		this.wrapper.querySelector("[data-upload]").addEventListener("click", () => this.open_uploader());
		this.wrapper.querySelector("[data-month]").addEventListener("change", (event) => {
			this.payroll_month = event.target.value;
			this.attendance_lock_version = "";
			this.available_attendance_locks = [];
			this.process_readiness = {};
			this.month_runbook = null;
			this.render_attendance_lock_options();
			this.load_available_attendance_locks();
			this.load_active_tab();
		});
		this.wrapper.querySelector("[data-lock-version]").addEventListener("change", (event) => {
			this.attendance_lock_version = event.target.value;
			this.load_active_tab();
		});
		this.wrapper.querySelectorAll("[data-tab]").forEach((button) => {
			button.addEventListener("click", () => {
				this.active_tab = button.dataset.tab;
				this.active_process_step = this.process_step_for(this.active_tab);
				frappe.set_route("payroll-input-center", this.active_tab);
				this.render();
				this.load_active_tab();
			});
		});
		this.wrapper.querySelectorAll("[data-process-route]").forEach((button) => {
			button.addEventListener("click", () => this.open_process_step(button.dataset.processRoute, button.dataset.processAnchor));
		});
		this.render_attendance_lock_options();
		this.load_available_attendance_locks();
	}

	render_attendance_lock_options() {
		const select = this.wrapper.querySelector("[data-lock-version]");
		if (!select) return;
		const locks = this.available_attendance_locks || [];
		const options = [`<option value="">${frappe.utils.escape_html(locks.length ? __("请选择考勤锁定版本") : __("暂无已锁定考勤终稿"))}</option>`];
		locks.forEach((lock) => {
			const label = `${lock.is_current ? __("当前") : __("历史")} V${lock.attendance_lock_version} · ${lock.summary_count || 0}${__("人")} · ${lock.locked_on || __("锁定时间未记录")}`;
			options.push(`<option value="${frappe.utils.escape_html(lock.attendance_lock_version)}" ${String(lock.attendance_lock_version) === String(this.attendance_lock_version) ? "selected" : ""}>${frappe.utils.escape_html(label)}</option>`);
		});
		select.innerHTML = options.join("");
	}

	load_available_attendance_locks() {
		if (!this.company || !this.payroll_month) return;
		frappe.call({
			method: "hrms.api.payroll_input.list_available_payroll_attendance_locks",
			args: { company: this.company, payroll_month: this.payroll_month },
			callback: (response) => {
				this.available_attendance_locks = response.message?.locks || [];
				const selectedExists = this.available_attendance_locks.some((row) => String(row.attendance_lock_version) === String(this.attendance_lock_version));
				if (!selectedExists) {
					this.attendance_lock_version = (this.available_attendance_locks.find((row) => row.is_current) || this.available_attendance_locks[0] || {}).attendance_lock_version || "";
				}
				this.render_attendance_lock_options();
				this.load_active_tab();
			},
		});
	}

	body() {
		return this.wrapper.querySelector("[data-payroll-body]");
	}

	scope_args(extra = {}) {
		return Object.assign(
			{
				company: this.company,
				payroll_month: this.payroll_month,
				attendance_lock_version: this.attendance_lock_version,
			},
			extra,
		);
	}

	load_active_tab() {
		if (this.active_tab === "monthly-workbench") {
			this.load_monthly_workbench();
			return;
		}
		if (this.active_tab === "employee-salary") {
			this.load_employee_salary_profiles();
			return;
		}
		if (this.active_tab === "monthly-payroll") {
			this.load_monthly_payroll();
			return;
		}
		if (this.active_tab === "payroll-disbursement") {
			this.load_payroll_disbursement();
			return;
		}
		if (this.active_tab === "data-closure") {
			this.load_data_closure_import_plan();
			return;
		}
		if (this.active_tab === "salary-rules") {
			this.load_salary_rules();
			return;
		}
		if (this.active_tab === "salary-templates") {
			this.load_salary_template_step();
			return;
		}
		if (this.active_tab === "salary-assignments") {
			this.load_salary_assignment_step();
			return;
		}
		if (this.active_tab === "salary-master") {
			this.load_salary_master();
			return;
		}
		if (this.active_tab === "welfare-sources") {
			this.load_welfare_sources();
			return;
		}
		if (this.active_tab === "settlements") {
			this.load_settlements();
			return;
		}
		if (this.active_tab === "inputs") {
			this.load_inputs();
			return;
		}
		if (this.active_tab === "payroll-reports") {
			this.load_payroll_reports();
			return;
		}
		if (this.active_tab === "payroll-analysis") {
			this.load_payroll_analysis();
			return;
		}
		if (this.active_tab === "annual-bonus") {
			this.load_annual_bonus();
			return;
		}
		if (this.active_tab === "salary-slips") {
			this.load_salary_slips();
			return;
		}
		this.render_variable_import();
	}

	open_uploader() {
		new frappe.ui.FileUploader({
			folder: "Home/Attachments",
			restrictions: { allowed_file_types: [".xlsx"] },
			on_success: (file) => {
				this.file_url = file.file_url;
				this.preview_payroll_variable_workbook();
			},
		});
	}

	open_salary_structure_uploader() {
		new frappe.ui.FileUploader({
			folder: "Home/Attachments",
			restrictions: { allowed_file_types: [".xlsx"] },
			on_success: (file) => {
				this.salary_structure_file_url = file.file_url;
				this.preview_salary_structure_workbook();
			},
		});
	}

	open_data_closure_uploader() {
		new frappe.ui.FileUploader({
			folder: "Home/Attachments",
			restrictions: { allowed_file_types: [".xlsx"] },
			on_success: (file) => {
				this.data_closure_file_url = file.file_url;
				this.preview_payroll_data_closure_workbook();
			},
		});
	}

	open_payroll_import_selector() {
		const choices = [
			"薪资变量 Excel",
			"薪资架构/薪资构成 Excel",
			"数据闭环 Excel",
			"单项来源表单导入",
		];
		const dialog = new frappe.ui.Dialog({
			title: __("导入薪资资料"),
			fields: [
				{
					fieldname: "import_target",
					fieldtype: "Select",
					label: __("导入内容"),
					options: choices.join("\n"),
					reqd: 1,
				},
				{
					fieldtype: "HTML",
					fieldname: "import_help",
					options: `<div class="text-muted">${frappe.utils.escape_html(__("顶部只保留统一入口；具体来源在这里选择。取消文件选择不会改变页面状态。"))}</div>`,
				},
			],
			primary_action_label: __("继续"),
			primary_action: (values) => {
				dialog.hide();
				this.handle_payroll_import_choice(values.import_target);
			},
		});
		dialog.show();
	}

	handle_payroll_import_choice(choice) {
		if (choice === "薪资架构/薪资构成 Excel") {
			this.active_tab = "salary-master";
			frappe.set_route("payroll-input-center", this.active_tab);
			this.render();
			this.load_active_tab();
			this.open_salary_structure_uploader();
			return;
		}
		if (choice === "数据闭环 Excel") {
			this.active_tab = "data-closure";
			frappe.set_route("payroll-input-center", this.active_tab);
			this.render();
			this.load_active_tab();
			this.open_data_closure_uploader();
			return;
		}
		if (choice === "单项来源表单导入") {
			this.open_source_form_import_selector();
			return;
		}
		this.active_tab = "variables";
		frappe.set_route("payroll-input-center", this.active_tab);
		this.render();
		this.load_active_tab();
		this.open_uploader();
	}

	open_source_form_import_selector() {
		const labels = this.source_form_imports.map((item) => item.label);
		const dialog = new frappe.ui.Dialog({
			title: __("单项来源表单导入"),
			fields: [
				{
					fieldname: "source_label",
					fieldtype: "Select",
					label: __("来源表单"),
					options: labels.join("\n"),
					reqd: 1,
				},
			],
			primary_action_label: __("打开导入"),
			primary_action: (values) => {
				const source = this.source_form_imports.find((item) => item.label === values.source_label);
				dialog.hide();
				if (!source) return;
				if (!window.hrmsFormImport?.open) {
					frappe.msgprint(__("导入组件正在加载，请稍后重试。"));
					return;
				}
				window.hrmsFormImport.open(source.key, { title: `${source.label}${__("导入")}` });
			},
		});
		dialog.show();
	}

	route_to_tab(tab) {
		this.active_tab = this.resolve_tab(tab);
		this.active_process_step = this.process_step_for(this.active_tab);
		frappe.set_route("payroll-input-center", this.active_tab);
		this.render();
		this.load_active_tab();
	}

	load_monthly_workbench() {
		const hasLockedAttendance = Boolean(this.attendance_lock_version);
		this.body().innerHTML = `
			<div class="hrms-payroll-runbook-head hrms-payroll-step-head">
				<div>
					<span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("步骤 6 · 计算与复核"))}</span>
					<h3>${frappe.utils.escape_html(__("本月薪酬统算"))}</h3>
					<p>${frappe.utils.escape_html(__("先确定薪资档案，再读取同公司、同月份、同锁定版本的考勤终稿和已确认变量；所有金额均由系统试算后进入结算表。"))}</p>
				</div>
				<div class="hrms-payroll-action-group">
					<button class="btn btn-default btn-sm" data-workbench-action="refresh">${frappe.utils.escape_html(__("刷新状态"))}</button>
					<button class="btn btn-default btn-sm" data-workbench-action="import">${frappe.utils.escape_html(__("导入本月资料"))}</button>
					<button class="btn btn-primary btn-sm" data-workbench-action="generate-input" ${hasLockedAttendance ? "" : "disabled"} title="${frappe.utils.escape_html(hasLockedAttendance ? __("按当前锁定版本生成") : __("请先选择已锁定考勤版本"))}">${frappe.utils.escape_html(__("生成薪资输入表"))}</button>
					<button class="btn btn-primary btn-sm" data-workbench-action="generate-settlement" ${hasLockedAttendance ? "" : "disabled"} title="${frappe.utils.escape_html(hasLockedAttendance ? __("按当前锁定版本试算") : __("请先选择已锁定考勤版本"))}">${frappe.utils.escape_html(__("试算本月工资"))}</button>
				</div>
			</div>
			<div class="hrms-payroll-scope-notice">
				<strong>${frappe.utils.escape_html(__("本次结算范围"))}</strong>
				<span data-workbench-scope>${frappe.utils.escape_html(this.company || __("未选择公司"))} / ${frappe.utils.escape_html(this.payroll_month)} / ${frappe.utils.escape_html(this.attendance_lock_version || __("未填写考勤锁定版本"))}</span>
				<small>${frappe.utils.escape_html(__("系统拒绝读取未锁定考勤、跨公司数据和不同锁定版本的数据。"))}</small>
			</div>
			<div data-workbench-cards></div>
			<div data-workbench-runbook></div>
			<div class="hrms-payroll-input-panel hrms-payroll-project-map">
				<div class="hrms-payroll-project-map-head">
					<div><h3>${frappe.utils.escape_html(__("薪酬项目与数据来源"))}</h3><p>${frappe.utils.escape_html(__("结算表只显示结果；每个项目的规则、来源和导入入口在这里统一定位。"))}</p></div>
					<button class="btn btn-default btn-sm" data-workbench-action="rules">${frappe.utils.escape_html(__("查看全部规则"))}</button>
				</div>
				<div class="hrms-payroll-project-grid">
					${this.render_project_map_items()}
				</div>
			</div>
		`;
		this.body().querySelectorAll("[data-workbench-action]").forEach((button) => {
			button.addEventListener("click", () => this.handle_workbench_action(button.dataset.workbenchAction));
		});
		this.refresh_monthly_workbench();
	}

	render_project_map_items() {
		const projects = [
			["固定薪资", "底薪、职能/职务、证书、多能工、全薪", "员工薪资异动 + 薪资架构", "salary-master"],
			["考勤结算", "标准/出勤/缺勤、1.5/2/3 倍加班、夜班、旷工", "已锁定月度考勤终稿", "data-closure"],
			["奖金补贴", "苹果树、全勤、住房、学历、提案改善、生产奖", "已确认月度变量或福利来源", "welfare-sources"],
			["扣款与公司成本", "宿舍水电、社保/公积金、个税、已发福利、继续服务奖", "已确认月度变量或福利来源", "welfare-sources"],
		];
		return projects
			.map(
				([title, items, source, route]) => `
					<button class="hrms-payroll-project-item" data-project-route="${frappe.utils.escape_html(route)}">
						<strong>${frappe.utils.escape_html(__(title))}</strong>
						<span>${frappe.utils.escape_html(__(items))}</span>
						<small>${frappe.utils.escape_html(__(source))}</small>
					</button>`,
			)
			.join("");
	}

	handle_workbench_action(action) {
		if (action === "refresh") return this.refresh_monthly_workbench();
		if (action === "import") return this.open_payroll_import_selector();
		if (action === "rules") return this.route_to_tab("salary-rules");
		if (action === "generate-input") return this.generate_payroll_input_records(() => this.refresh_monthly_workbench());
		if (action === "generate-settlement") return this.generate_payroll_settlement_records(() => this.refresh_monthly_workbench());
	}

	refresh_monthly_workbench() {
		if (!this.attendance_lock_version) {
			this.month_runbook = null;
			this.update_process_guide_status({
				master: { state: "pending", label: __("待核对"), detail: __("先核对员工基础资料和定薪覆盖。") },
				items: { state: "pending", label: __("待核对"), detail: __("先确认薪酬项目与公式规则。") },
				templates: { state: "pending", label: __("待核对"), detail: __("先确认工资表字段映射。") },
				assignments: { state: "pending", label: __("待核对"), detail: __("先确认员工定薪分配。") },
				sources: { state: "blocked", label: __("缺考勤锁定"), detail: __("请选择同公司、同月份的已锁定考勤终稿版本。") },
				calculation: { state: "blocked", label: __("不可试算"), detail: __("薪资试算必须先绑定考勤锁定版本。") },
				delivery: { state: "pending", label: __("后续步骤"), detail: __("试算并确认后才能发放。") },
			});
			const cardsTarget = this.wrapper.querySelector("[data-workbench-cards]");
			const runbookTarget = this.wrapper.querySelector("[data-workbench-runbook]");
			if (cardsTarget) cardsTarget.innerHTML = "";
			if (runbookTarget) runbookTarget.innerHTML = `<div class="hrms-payroll-input-panel hrms-payroll-blocker">
				<strong>${frappe.utils.escape_html(__("当前不能生成薪资"))}</strong>
				<span>${frappe.utils.escape_html(__("缺少同公司、同月份的已锁定考勤版本。请先在考勤模块完成月度考勤终稿锁定，或通过“数据闭环导入”导入带锁定版本的月度考勤终稿。"))}</span>
				<button class="btn btn-default btn-sm" data-runbook-route="data-closure">${frappe.utils.escape_html(__("处理月度来源"))}</button>
			</div>`;
			runbookTarget?.querySelector("[data-runbook-route]")?.addEventListener("click", (event) => this.route_to_tab(event.currentTarget.dataset.runbookRoute));
			return;
		}
		frappe.call({
			method: "hrms.api.payroll_input.get_payroll_month_runbook",
			args: this.scope_args(),
			callback: (response) => this.render_monthly_runbook(response.message || {}),
		});
	}

	render_monthly_runbook(runbook) {
		this.month_runbook = runbook;
		this.update_process_guide_status(this.process_status_from_runbook(runbook));
		const cardsTarget = this.wrapper.querySelector("[data-workbench-cards]");
		const runbookTarget = this.wrapper.querySelector("[data-workbench-runbook]");
		if (!cardsTarget || !runbookTarget) return;
		cardsTarget.innerHTML = this.render_metric_cards(runbook.cards || []);
		runbookTarget.innerHTML = `<div class="hrms-payroll-runbook-list">${(runbook.stages || [])
			.map(
				(stage, index) => `
					<div class="hrms-payroll-runbook-step is-${frappe.utils.escape_html(stage.tone || "pending")}">
						<div class="hrms-payroll-runbook-number">${index + 1}</div>
						<div class="hrms-payroll-runbook-copy"><strong>${frappe.utils.escape_html(__(stage.title))}</strong><span>${frappe.utils.escape_html(__(stage.summary))}</span><small>${frappe.utils.escape_html(__(stage.detail || ""))}</small></div>
						<div class="hrms-payroll-runbook-state"><b>${frappe.utils.escape_html(__(stage.status))}</b><span>${frappe.utils.escape_html(String(stage.count ?? 0))}${stage.unit ? frappe.utils.escape_html(__(stage.unit)) : ""}</span></div>
						${stage.route ? `<button class="btn btn-default btn-sm" data-runbook-route="${frappe.utils.escape_html(stage.route)}">${frappe.utils.escape_html(__(stage.action_label || "查看"))}</button>` : ""}
					</div>`,
			)
			.join("")}</div>${runbook.warning ? `<div class="hrms-payroll-runbook-warning">${frappe.utils.escape_html(__(runbook.warning))}</div>` : ""}`;
		runbookTarget.querySelectorAll("[data-runbook-route]").forEach((button) => {
			button.addEventListener("click", () => this.route_to_tab(button.dataset.runbookRoute));
		});
		this.body().querySelectorAll("[data-project-route]").forEach((button) => {
			button.addEventListener("click", () => this.route_to_tab(button.dataset.projectRoute));
		});
	}

	load_employee_salary_profiles() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head hrms-payroll-step-head">
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("步骤 1 · 只读校验"))}</span><h3>${frappe.utils.escape_html(__("核对人事基础资料"))}</h3><p>${frappe.utils.escape_html(__("薪酬模块只读取员工主档，不在这里重复编辑。"))}</p></div>
				<button class="btn btn-primary btn-sm" data-open-personnel-master>${frappe.utils.escape_html(__("前往人事 · 员工花名册"))}</button>
			</div>
			<div class="hrms-payroll-step-purpose">
				<div><strong>${frappe.utils.escape_html(__("这一步做什么"))}</strong><span>${frappe.utils.escape_html(__("检查公司、工号、姓名、部门、岗位、在职状态和入职/转正日期，确保考勤与薪资能匹配到同一个员工。"))}</span></div>
				<div><strong>${frappe.utils.escape_html(__("去哪里修改"))}</strong><span>${frappe.utils.escape_html(__("在“人事 → 员工花名册”维护；保存后本页自动读取最新结果。员工定薪放在第 4 步。"))}</span></div>
			</div>
			<div data-employee-salary-cards></div>
			<div class="hrms-payroll-preview-note" data-employee-preview-note></div>
			<div data-employee-salary-table></div>
		`;
		this.body().querySelector("[data-open-personnel-master]").addEventListener("click", () => frappe.set_route("List", "Employee"));
		frappe.call({
			method: "hrms.api.payroll_input.list_employee_salary_profiles",
			args: this.scope_args({ page_length: 1000 }),
			callback: (response) => {
				const result = response.message || {};
				const counts = result.counts || {};
				const rows = result.rows || [];
				const missingRows = rows.filter((row) => !row.employee_code || !row.department || !row.designation || !row.employee_status || !row.date_of_joining);
				const cards = [
					{ label: "在职", value: counts.active || 0 },
					{ label: "正式", value: counts.regular || 0 },
					{ label: "试用", value: counts.probation || 0 },
					{ label: "待补基础资料", value: missingRows.length },
				];
				const cardTarget = this.wrapper.querySelector("[data-employee-salary-cards]");
				if (cardTarget) cardTarget.innerHTML = this.render_metric_cards(cards);
				const tableTarget = this.wrapper.querySelector("[data-employee-salary-table]");
				if (!tableTarget) return;
				const previewRows = [...missingRows, ...rows.filter((row) => !missingRows.includes(row))].slice(0, 20);
				const noteTarget = this.wrapper.querySelector("[data-employee-preview-note]");
				if (noteTarget) noteTarget.textContent = __("只读预览前 {0} 人（待补资料优先），共 {1} 人。如需修改，请前往人事花名册。", [previewRows.length, counts.active || rows.length]);
				tableTarget.innerHTML = this.render_table("员工基础资料预览", ["姓名", "工号", "部门", "岗位", "工作性质", "员工状态", "入职日期", "转正日期", "基础资料状态"], previewRows, (row) => [
					row.employee_name,
					row.employee_code,
					row.department,
					row.designation,
					row.employment_type,
					row.employee_status,
					row.date_of_joining,
					row.confirmation_date,
					!row.employee_code || !row.department || !row.designation || !row.employee_status || !row.date_of_joining ? __("待补全") : __("已就绪"),
				]);
			},
		});
	}

	load_monthly_payroll() {
		const hasLockedAttendance = Boolean(this.attendance_lock_version);
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<h3>${frappe.utils.escape_html(__("月工资表"))}</h3>
				<div>
					<button class="btn btn-default btn-sm" data-refresh-dependencies>${frappe.utils.escape_html(__("刷新来源状态"))}</button>
					<button class="btn btn-primary btn-sm" data-generate-monthly ${hasLockedAttendance ? "" : "disabled"} title="${frappe.utils.escape_html(hasLockedAttendance ? __("生成薪资结算表") : __("请先选择已锁定考勤版本"))}">${frappe.utils.escape_html(__("生成薪资结算表"))}</button>
				</div>
			</div>
			<div class="text-muted">
				${frappe.utils.escape_html(__("月工资表按员工花名册、考勤终稿、福利扣款、薪资输入表和薪资结算表检查结算覆盖率，作为工资发放前的总控页面。"))}
			</div>
			<div data-monthly-payroll-cards></div>
			<div data-payroll-dependencies></div>
		`;
		this.body().querySelector("[data-generate-monthly]").addEventListener("click", () => this.generate_payroll_settlement_records());
		this.body().querySelector("[data-refresh-dependencies]").addEventListener("click", () => this.load_monthly_payroll());
		frappe.call({
			method: "hrms.api.payroll_input.list_monthly_payroll_overview",
			args: this.scope_args(),
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-monthly-payroll-cards]");
				if (target) target.innerHTML = this.render_metric_cards(response.message?.cards || []);
			},
		});
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_dependency_status",
			args: this.scope_args(),
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-payroll-dependencies]");
				if (!target) return;
				target.innerHTML = this.render_table("薪资来源状态", ["来源", "系统表", "记录数", "状态"], response.message || [], (row) => [
					row.source,
					row.doctype,
					row.count,
					row.status,
				]);
			},
		});
	}

	load_payroll_disbursement() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<h3>${frappe.utils.escape_html(__("工资发放"))}</h3>
				<button class="btn btn-default btn-sm" data-open-settlements>${frappe.utils.escape_html(__("查看薪资结算表"))}</button>
			</div>
			<div class="text-muted">
				${frappe.utils.escape_html(__("工资发放暂以薪资结算表的实发工资为准，保留发放状态和确认状态；正式工资条稳定后再接发送流程。"))}
			</div>
			<div data-disbursement-table></div>
		`;
		this.body().querySelector("[data-open-settlements]").addEventListener("click", () => {
			this.active_tab = "settlements";
			frappe.set_route("payroll-input-center", this.active_tab);
			this.render();
			this.load_active_tab();
		});
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_disbursement_records",
			args: this.scope_args(),
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-disbursement-table]");
				if (!target) return;
				target.innerHTML = this.render_table("工资发放", ["姓名", "工号", "部门", "应付工资", "实发工资", "公司实际负担总计", "结算状态", "发放状态", "确认状态"], response.message || [], (row) => [
					row.employee_name,
					row.employee_code,
					row.department,
					row.gross_pay,
					row.net_pay,
					row.company_cost_total,
					row.calculation_status,
					row.payment_status,
					row.confirmation_status,
				]);
			},
		});
	}

	load_data_closure_import_plan(preview = null) {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head hrms-payroll-step-head">
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("步骤 5 · 当月数据"))}</span><h3>${frappe.utils.escape_html(__("确认月度来源"))}</h3><p>${frappe.utils.escape_html(__("只处理当月考勤终稿和已确认的奖金、补贴、扣款等变量。"))}</p></div>
				<div>
					<button class="btn btn-default btn-sm" data-download-data-template>${frappe.utils.escape_html(__("下载模板"))}</button>
					<button class="btn btn-default btn-sm" data-upload-data-closure>${frappe.utils.escape_html(__("上传闭环数据"))}</button>
					${preview ? `<button class="btn btn-primary btn-sm" data-import-data-closure>${frappe.utils.escape_html(__("导入闭环数据"))}</button>` : ""}
				</div>
			</div>
			<div class="hrms-payroll-step-purpose">
				<div><strong>${frappe.utils.escape_html(__("必须满足"))}</strong><span>${frappe.utils.escape_html(__("考勤必须同公司、同月份且已锁定；变量与福利扣款必须已确认或已批准零申报。"))}</span></div>
				<div><strong>${frappe.utils.escape_html(__("不在本步做"))}</strong><span>${frappe.utils.escape_html(__("不修改员工主档、定薪或计算公式，不直接产生正式工资。"))}</span></div>
			</div>
			<div data-data-closure-preview>${preview ? this.render_data_closure_preview(preview) : ""}</div>
			<div data-import-template-table></div>
			<div data-settlement-field-table></div>
		`;
		this.body().querySelector("[data-download-data-template]").addEventListener("click", () => this.download_data_closure_template());
		this.body().querySelector("[data-upload-data-closure]").addEventListener("click", () => this.open_data_closure_uploader());
		const importButton = this.body().querySelector("[data-import-data-closure]");
		if (importButton) importButton.addEventListener("click", () => this.import_payroll_data_closure_workbook());
		this.load_payroll_import_templates();
	}

	load_payroll_import_templates() {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_import_templates",
			callback: (response) => {
				const data = response.message || {};
				const templateTarget = this.wrapper.querySelector("[data-import-template-table]");
				if (templateTarget) {
					const rows = [];
					(data.templates || []).filter((template) => ["福利扣款来源导入", "月度考勤终稿导入"].includes(template.sheet_name)).forEach((template) => {
						(template.columns || []).forEach((column) => {
							rows.push({
								sheet_name: template.sheet_name,
								target_doctype: template.target_doctype,
								excel_column: column.excel_column,
								system_field: column.system_field,
								description: column.description,
							});
						});
					});
					templateTarget.innerHTML = this.render_table("Excel导入方案", ["工作表", "目标表", "Excel字段", "系统字段", "说明"], rows, (row) => [
						row.sheet_name,
						row.target_doctype,
						row.excel_column,
						row.system_field,
						row.description,
					]);
				}
				const settlementTarget = this.wrapper.querySelector("[data-settlement-field-table]");
				if (settlementTarget) {
					settlementTarget.innerHTML = this.render_table("薪资结算字段对应", ["Excel列", "Excel字段名", "系统字段", "来源模块", "公式/来源"], data.settlement_fields || [], (row) => [
						row.excel_column,
						row.excel_label,
						row.system_field,
						row.source_module,
						row.formula_expression || row.source_detail,
					]);
				}
			},
		});
	}

	render_data_closure_preview(result) {
		return this.render_table("闭环数据预览", ["工作表", "目标表", "状态", "行数"], result.sheets || [], (row) => [
			row.sheet_name,
			row.target_doctype,
			row.found ? "已找到" : "未找到",
			row.row_count || 0,
		]);
	}

	preview_payroll_data_closure_workbook() {
		frappe
			.call({
				method: "hrms.api.payroll_input.preview_payroll_data_closure_workbook",
				args: { file_url: this.data_closure_file_url },
				freeze: true,
				freeze_message: __("正在预览闭环数据..."),
			})
			.then((response) => this.load_data_closure_import_plan(response.message || {}));
	}

	download_data_closure_template() {
		frappe.call({
			method: "hrms.api.payroll_input.create_payroll_data_closure_template_file",
			freeze: true,
			freeze_message: __("正在生成导入模板..."),
			callback: (response) => {
				const file_url = response.message?.file_url;
				if (file_url) window.open(file_url, "_blank");
			},
		});
	}

	import_payroll_data_closure_workbook() {
		frappe.call({
			method: "hrms.api.payroll_input.import_payroll_data_closure_workbook",
			args: this.scope_args({ file_url: this.data_closure_file_url }),
			freeze: true,
			freeze_message: __("正在导入闭环数据..."),
			callback: (response) => {
				const created = response.message?.created_or_updated || {};
				frappe.show_alert({ message: __("闭环数据导入完成：{0}", [JSON.stringify(created)]), indicator: "green" });
				this.load_data_closure_import_plan();
			},
		});
	}

	load_salary_rules() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head hrms-payroll-step-head">
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("步骤 2 · 在本页配置"))}</span><h3>${frappe.utils.escape_html(__("定义薪酬项目"))}</h3><p>${frappe.utils.escape_html(__("只处理底薪、津贴、奖金、扣款和公司承担项；工资表模板与员工分配分别在后两步处理。"))}</p></div>
				<div class="hrms-payroll-action-group">
					<button class="btn btn-default btn-sm" data-open-payroll-components>${frappe.utils.escape_html(__("打开标准工资项"))}</button>
					<button class="btn btn-default btn-sm" data-download-formulas>${frappe.utils.escape_html(__("下载公式模板"))}</button>
					<button class="btn btn-default btn-sm" data-import-formulas>${frappe.utils.escape_html(__("导入公式"))}</button>
					<button class="btn btn-primary btn-sm" data-new-formula>${frappe.utils.escape_html(__("新增/修改公式"))}</button>
				</div>
			</div>
			<div class="hrms-payroll-step-purpose">
				<div><strong>${frappe.utils.escape_html(__("结果"))}</strong><span>${frappe.utils.escape_html(__("每个薪酬项目都有唯一编码、收支方向、来源或公式，可以被工资表模板引用。"))}</span></div>
				<div><strong>${frappe.utils.escape_html(__("不在本步做"))}</strong><span>${frappe.utils.escape_html(__("不分配员工，不导入本月考勤或变量，不生成工资。"))}</span></div>
			</div>
			<section class="hrms-payroll-config-section hrms-payroll-calculation-template" id="payroll-input-template">
				<div class="hrms-payroll-project-map-head">
					<div><h3>${frappe.utils.escape_html(__("必需输入（只读）· 工资计算模板"))}</h3><p>${frappe.utils.escape_html(__("先确认三类输入，再点击下方计算结果维护公式；输入数据在对应步骤维护。"))}</p></div>
					<span class="hrms-payroll-template-status">${frappe.utils.escape_html(__("公司级模板"))}</span>
				</div>
				<div class="hrms-payroll-source-groups" data-payroll-input-groups></div>
			</section>
			<section class="hrms-payroll-config-section" id="payroll-formulas">
				<div class="hrms-payroll-project-map-head">
					<div><h3>${frappe.utils.escape_html(__("计算结果"))}</h3><p>${frappe.utils.escape_html(__("点击结果卡即可选择字段、组合函数、校验并保存。"))}</p></div>
					<div class="hrms-payroll-action-group"><input class="form-control input-sm" data-formula-search placeholder="${frappe.utils.escape_html(__("搜索计算结果"))}"><button class="btn btn-default btn-sm" data-reset-formulas>${frappe.utils.escape_html(__("初始化公司公式"))}</button></div>
				</div>
				<div data-payroll-formula-table></div>
			</section>
			<details class="hrms-payroll-advanced hrms-payroll-project-library" id="payroll-config-items">
				<summary>${frappe.utils.escape_html(__("专业设置：查看全部薪酬项目"))}</summary>
				<div class="hrms-payroll-project-map-head">
					<div><h3>${frappe.utils.escape_html(__("薪酬项目清单"))}</h3><p>${frappe.utils.escape_html(__("按类型检查项目是否已连接数据来源或计算规则。"))}</p></div>
					<input class="form-control input-sm" data-payroll-item-search placeholder="${frappe.utils.escape_html(__("搜索项目"))}">
				</div>
				<div data-payroll-item-summary></div><div data-payroll-item-filters></div><div data-payroll-item-catalog></div>
			</details>
			<details class="hrms-payroll-advanced" id="payroll-advanced">
				<summary>${frappe.utils.escape_html(__("高级设置：项目来源规则与字段映射"))}</summary>
				<div class="hrms-payroll-project-map-head"><div><h3>${frappe.utils.escape_html(__("来源与资格规则"))}</h3><p>${frappe.utils.escape_html(__("用于全勤、补贴资格和审计说明；日常公式修改不需要进入这里。"))}</p></div><button class="btn btn-default btn-sm" data-refresh-default-rules>${frappe.utils.escape_html(__("刷新来源规则"))}</button></div>
				<div data-rule-permission></div><div data-salary-rule-table></div>
				<div class="hrms-payroll-project-map-head"><div><h3>${frappe.utils.escape_html(__("Excel 字段映射"))}</h3></div><div><button class="btn btn-default btn-sm" data-refresh-field-mappings>${frappe.utils.escape_html(__("刷新字段映射"))}</button><button class="btn btn-default btn-sm" data-edit-field-mapping>${frappe.utils.escape_html(__("维护映射"))}</button></div></div>
				<div data-payroll-field-mapping-table></div>
			</details>
		`;
		this.body().querySelector("[data-refresh-default-rules]").addEventListener("click", () => this.ensure_default_payroll_rules());
		this.body().querySelector("[data-refresh-field-mappings]").addEventListener("click", () => this.ensure_default_payroll_field_mappings());
		this.body().querySelector("[data-open-payroll-components]").addEventListener("click", () => frappe.set_route("List", "Salary Component"));
		this.body().querySelector("[data-new-formula]").addEventListener("click", () => this.edit_payroll_formula());
		this.body().querySelector("[data-download-formulas]").addEventListener("click", () => this.download_payroll_formula_template());
		this.body().querySelector("[data-import-formulas]").addEventListener("click", () => this.open_payroll_formula_import());
		this.body().querySelector("[data-reset-formulas]").addEventListener("click", () => this.ensure_default_payroll_formulas());
		this.body().querySelector("[data-edit-field-mapping]").addEventListener("click", () => this.edit_payroll_field_mapping());
		this.body().querySelector("[data-formula-search]").addEventListener("input", (event) => this.filter_payroll_formulas(event.target.value));
		this.body().querySelector("[data-payroll-item-search]").addEventListener("input", (event) => this.filter_payroll_configuration_items(event.target.value));
		this.load_rule_permission();
		this.load_payroll_rules();
		this.load_payroll_field_mappings();
		this.load_payroll_formula_catalog();
		this.load_payroll_configuration_items();
	}

	load_salary_template_step() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head hrms-payroll-step-head">
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("步骤 3 · 标准 HRMS 档案"))}</span><h3>${frappe.utils.escape_html(__("组合工资表模板"))}</h3><p>${frappe.utils.escape_html(__("把第 2 步的应发、应扣和公司承担项组合成可复用模板。"))}</p></div>
				<button class="btn btn-primary btn-sm" data-open-salary-templates>${frappe.utils.escape_html(__("打开工资表模板"))}</button>
			</div>
			<div class="hrms-payroll-step-purpose">
				<div><strong>${frappe.utils.escape_html(__("这里保存什么"))}</strong><span>${frappe.utils.escape_html(__("模板只保存工资项组合、计算顺序与计薪周期，不保存某个员工的实际金额。"))}</span></div>
				<div><strong>${frappe.utils.escape_html(__("下一步"))}</strong><span>${frappe.utils.escape_html(__("模板启用后，到第 4 步分配给员工，并维护生效日与已批准定薪。"))}</span></div>
			</div>
			<div data-salary-template-summary></div>
		`;
		this.body().querySelector("[data-open-salary-templates]").addEventListener("click", () => frappe.set_route("List", "Salary Structure"));
		frappe.call({
			method: "frappe.client.get_list",
			args: { doctype: "Salary Structure", fields: ["name", "company", "is_active", "payroll_frequency"], filters: this.company ? { company: this.company } : {}, limit_page_length: 50 },
			callback: (response) => {
				const rows = response.message || [];
				const target = this.wrapper.querySelector("[data-salary-template-summary]");
				if (!target) return;
				target.innerHTML = `<div class="hrms-payroll-metric-grid"><div class="hrms-payroll-metric"><div class="text-muted">${frappe.utils.escape_html(__("当前公司模板"))}</div><strong>${rows.length}</strong></div><div class="hrms-payroll-metric"><div class="text-muted">${frappe.utils.escape_html(__("已启用"))}</div><strong>${rows.filter((row) => Number(row.is_active)).length}</strong></div></div>${this.render_table("工资表模板预览", ["模板", "公司", "计薪周期", "状态"], rows, (row) => [row.name, row.company, row.payroll_frequency, Number(row.is_active) ? __("已启用") : __("已停用")])}`;
			},
		});
	}

	load_salary_assignment_step() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head hrms-payroll-step-head">
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("步骤 4 · 在本页维护"))}</span><h3>${frappe.utils.escape_html(__("员工分配与已批准定薪"))}</h3><p>${frappe.utils.escape_html(__("先把工资表模板分配给员工，再保存该员工已批准、有生效日的固定薪资。"))}</p></div>
				<div class="hrms-payroll-action-group"><button class="btn btn-default btn-sm" data-open-standard-assignments>${frappe.utils.escape_html(__("打开模板分配"))}</button><button class="btn btn-default btn-sm" data-download-salary-change-template>${frappe.utils.escape_html(__("下载定薪模板"))}</button><button class="btn btn-default btn-sm" data-import-salary-change>${frappe.utils.escape_html(__("导入员工定薪"))}</button><button class="btn btn-primary btn-sm" data-new-salary-change>${frappe.utils.escape_html(__("新增员工定薪"))}</button></div>
			</div>
			<div class="hrms-payroll-step-purpose">
				<div><strong>${frappe.utils.escape_html(__("与人事如何联动"))}</strong><span>${frappe.utils.escape_html(__("员工、部门、岗位来自人事主档；本步只增加薪酬专属的模板分配、金额、生效日和审批状态。"))}</span></div>
				<div><strong>${frappe.utils.escape_html(__("生效条件"))}</strong><span>${frappe.utils.escape_html(__("只有已批准、当月有效且非试运营值的定薪记录才能进入试算。"))}</span></div>
			</div>
			<div data-salary-assignment-overview></div>
			<div data-salary-changes></div>
		`;
		this.body().querySelector("[data-open-standard-assignments]").addEventListener("click", () => frappe.set_route("List", "Salary Structure Assignment"));
		this.body().querySelector("[data-download-salary-change-template]").addEventListener("click", () => this.download_employee_salary_change_template());
		this.body().querySelector("[data-import-salary-change]").addEventListener("click", () => this.open_employee_salary_change_import());
		this.body().querySelector("[data-new-salary-change]").addEventListener("click", () => this.open_employee_salary_change_dialog());
		frappe.call({
			method: "hrms.api.payroll_input.get_salary_architecture_workbench",
			args: { company: this.company, payroll_month: this.payroll_month },
			callback: (response) => {
				const result = response.message || {};
				this.update_process_guide_status(this.process_status_from_salary_architecture(result));
				const coverage = result.coverage || {};
				const standardPayroll = result.standard_payroll || {};
				const missing = result.missing_profiles || [];
				const pending = result.pending_changes || [];
				const trial = result.trial_profiles || [];
				const target = this.wrapper.querySelector("[data-salary-assignment-overview]");
				if (!target) return;
				const assignmentGap = Math.max((coverage.active_employee_count || 0) - (standardPayroll.assignment_count || 0), 0);
				target.innerHTML = `${this.render_metric_cards([{ label: "在职员工", value: coverage.active_employee_count || 0 }, { label: "有效模板分配", value: standardPayroll.assignment_count || 0 }, { label: "已批准定薪", value: coverage.approved_profile_count || 0 }, { label: "缺口项", value: assignmentGap + missing.length + pending.length + trial.length }])}${assignmentGap || missing.length || pending.length || trial.length ? `<div class="hrms-payroll-salary-alert"><strong>${frappe.utils.escape_html(__("当前不能通过第 4 步"))}</strong>${assignmentGap ? `<span>${frappe.utils.escape_html(__("缺少有效工资表模板分配：{0} 人", [assignmentGap]))}</span>` : ""}${missing.length ? `<span>${frappe.utils.escape_html(__("缺少已批准定薪：{0} 人", [missing.length]))}</span>` : ""}${pending.length ? `<span>${frappe.utils.escape_html(__("待审核薪资异动：{0} 条", [pending.length]))}</span>` : ""}${trial.length ? `<span>${frappe.utils.escape_html(__("待替换试运营定薪：{0} 人", [trial.length]))}</span>` : ""}</div>` : `<div class="hrms-payroll-salary-ready">${frappe.utils.escape_html(__("员工模板分配和定薪已覆盖当前月份，可以进入第 5 步。"))}</div>`}`;
			},
		});
		this.load_employee_salary_changes();
	}

	load_payroll_formula_catalog() {
		frappe.call({
			method: "hrms.api.payroll_input.get_payroll_formula_catalog",
			args: { company: this.company, payroll_month: this.payroll_month },
			callback: (response) => {
				this.payroll_formula_catalog = response.message || {};
				this.render_payroll_input_groups();
				this.render_payroll_formula_table();
			},
		});
	}

	render_payroll_input_groups() {
		const target = this.wrapper.querySelector("[data-payroll-input-groups]");
		if (!target) return;
		const fields = this.payroll_formula_catalog?.fields || [];
		const groups = [
			{ key: "薪资字段", title: "员工薪资档案", note: "底薪、职能津贴、证书及多能工津贴", route: "employee-salary" },
			{ key: "考勤字段", title: "已锁定考勤终稿", note: "标准/出勤工时、加班、旷工、夜班", route: "monthly-workbench" },
			{ key: "月度变量", title: "已确认月度变量", note: "奖金补贴、社保公积金、税费与扣款", route: "welfare-sources" },
		];
		target.innerHTML = groups.map((group, index) => {
			const names = fields.filter((field) => field.group === group.key).map((field) => field.label);
			const preview = names.slice(0, 5).join("、");
			const remainder = Math.max(names.length - 5, 0);
			return `<button data-source-route="${frappe.utils.escape_html(group.route)}"><i>${index + 1}</i><div><strong>${frappe.utils.escape_html(__(group.title))}</strong><small>${frappe.utils.escape_html(__(group.note))}</small></div><span>${frappe.utils.escape_html(String(names.length))}${frappe.utils.escape_html(__("项"))}</span><p>${frappe.utils.escape_html(preview)}${remainder ? `<b>+${remainder}</b>` : ""}</p><em>${frappe.utils.escape_html(__("打开维护"))}</em></button>`;
		}).join("");
		target.querySelectorAll("[data-source-route]").forEach((button) => button.addEventListener("click", () => this.route_to_tab(button.dataset.sourceRoute)));
	}

	render_payroll_formula_table() {
		const target = this.wrapper.querySelector("[data-payroll-formula-table]");
		if (!target) return;
		const formulas = this.payroll_formula_catalog?.formulas || [];
		target.innerHTML = `<div class="hrms-payroll-formula-list">${formulas.map((formula, index) => {
			const dependencyCount = (formula.dependencies || []).length;
			return `<button title="${frappe.utils.escape_html(formula.expression || "")}" data-formula-row="${index}" data-formula-search="${frappe.utils.escape_html([formula.output_label, formula.expression, ...(formula.dependencies || [])].join(" ").toLowerCase())}"><span>${formula.order}</span><div><strong>${frappe.utils.escape_html(formula.output_label)}</strong><small>${dependencyCount ? frappe.utils.escape_html(__("需要 {0} 个输入", [dependencyCount])) : frappe.utils.escape_html(__("固定值或独立公式"))}</small></div><em>v${frappe.utils.escape_html(String(formula.version || 1))}</em><b>${frappe.utils.escape_html(__("编辑"))}</b></button>`;
		}).join("")}</div>`;
		target.querySelectorAll("[data-formula-row]").forEach((button) => button.addEventListener("click", () => this.edit_payroll_formula(formulas[Number(button.dataset.formulaRow)])));
	}

	filter_payroll_formulas(query = "") {
		const value = String(query || "").trim().toLowerCase();
		this.wrapper.querySelectorAll("[data-formula-row]").forEach((row) => { row.hidden = Boolean(value && !(row.dataset.formulaSearch || "").includes(value)); });
	}

	edit_payroll_formula(formula = {}) {
		if (!this.can_edit_payroll_rules) {
			frappe.msgprint(__("您没有维护薪资公式的权限"));
			return;
		}
		const catalog = this.payroll_formula_catalog || {};
		const outputOptions = (catalog.fields || []).filter((field) => field.group === "计算结果").map((field) => ({ label: field.label, value: field.fieldname }));
		const paletteGroups = ["薪资字段", "考勤字段", "月度变量", "计算结果"];
		const paletteHtml = `<div class="hrms-payroll-formula-helper">
			<div class="hrms-payroll-formula-hint">${frappe.utils.escape_html(__("点击字段或函数即可插入；金额与工时字段均使用中文名称。"))}</div>
			<input type="search" data-formula-field-search placeholder="${frappe.utils.escape_html(__("搜索可用字段"))}">
			<div class="hrms-payroll-formula-palette">
				${paletteGroups.map((group) => `<section data-formula-group><strong>${frappe.utils.escape_html(__(group))}</strong><div>${(catalog.fields || []).filter((field) => field.group === group).map((field) => `<button type="button" data-formula-token="[${frappe.utils.escape_html(field.label)}]" data-formula-label="${frappe.utils.escape_html(field.label.toLowerCase())}">${frappe.utils.escape_html(field.label)}</button>`).join("")}</div></section>`).join("")}
				<section data-formula-group><strong>${frappe.utils.escape_html(__("函数"))}</strong><div>${(catalog.functions || []).map((item) => `<button type="button" data-formula-token="${frappe.utils.escape_html(item.signature)}" data-formula-label="${frappe.utils.escape_html(`${item.name} ${item.label || ""}`.toLowerCase())}">${frappe.utils.escape_html(item.name)}</button>`).join("")}</div></section>
			</div>
		</div>`;
		const dialog = new frappe.ui.Dialog({
			title: formula.output_label ? __("设置：{0}", [formula.output_label]) : __("新增/修改计算公式"),
			size: "large",
			fields: [
				{ fieldname: "output_field", fieldtype: "Select", label: __("计算结果"), options: outputOptions, reqd: 1, default: formula.output_field || outputOptions[0]?.value },
				{ fieldname: "formula_expression", fieldtype: "Small Text", label: __("计算公式"), description: __("示例：ROUND([底薪] / 174 * [平日加班时数] * 1.5, 2)"), reqd: 1, default: formula.expression || "" },
				{ fieldname: "palette", fieldtype: "HTML", options: paletteHtml },
				{ fieldname: "rule_text", fieldtype: "Data", label: __("规则说明"), default: formula.description || "" },
				{ fieldtype: "Section Break" },
				{ fieldname: "effective_from", fieldtype: "Date", label: __("生效开始") },
				{ fieldtype: "Column Break" },
				{ fieldname: "effective_to", fieldtype: "Date", label: __("生效结束") },
				{ fieldtype: "Section Break" },
				{ fieldname: "validation", fieldtype: "HTML" },
			],
			primary_action_label: __("校验并保存"),
			primary_action: (values) => {
				frappe.call({ method: "hrms.api.payroll_input.validate_payroll_formula", args: { company: this.company, output_field: values.output_field, expression: values.formula_expression }, callback: (response) => {
					const result = response.message || {};
					if (!result.valid) { dialog.get_field("validation").$wrapper.html(`<div class="alert alert-danger">${frappe.utils.escape_html(result.message || __("公式无效"))}</div>`); return; }
					frappe.call({ method: "hrms.api.payroll_input.upsert_payroll_formula", args: { company: this.company, ...values }, freeze: true, freeze_message: __("正在保存公式..."), callback: () => { dialog.hide(); frappe.show_alert({ message: __("公式已保存并进入下一次试算"), indicator: "green" }); this.load_payroll_formula_catalog(); } });
				} });
			},
		});
		dialog.show();
		dialog.$wrapper[0].querySelectorAll("[data-formula-token]").forEach((button) => button.addEventListener("click", () => {
			const control = dialog.get_field("formula_expression");
			const current = control.get_value() || "";
			control.set_value(`${current}${current && !current.endsWith(" ") ? " " : ""}${button.dataset.formulaToken}`);
		}));
		const fieldSearch = dialog.$wrapper[0].querySelector("[data-formula-field-search]");
		fieldSearch?.addEventListener("input", () => {
			const query = fieldSearch.value.trim().toLowerCase();
			dialog.$wrapper[0].querySelectorAll("[data-formula-group]").forEach((section) => {
				let visible = 0;
				section.querySelectorAll("[data-formula-label]").forEach((button) => {
					button.hidden = Boolean(query && !button.dataset.formulaLabel.includes(query));
					if (!button.hidden) visible += 1;
				});
				section.hidden = visible === 0;
			});
		});
	}

	ensure_default_payroll_formulas() {
		frappe.call({ method: "hrms.api.payroll_input.ensure_default_payroll_formulas", args: { company: this.company }, freeze: true, freeze_message: __("正在初始化公司公式..."), callback: () => { frappe.show_alert({ message: __("公司公式已初始化"), indicator: "green" }); this.load_payroll_formula_catalog(); } });
	}

	download_payroll_formula_template() {
		frappe.call({ method: "hrms.api.payroll_input.create_payroll_formula_template_file", args: { company: this.company }, freeze: true, freeze_message: __("正在生成公式模板..."), callback: (response) => { if (response.message?.file_url) window.open(response.message.file_url, "_blank"); } });
	}

	open_payroll_formula_import() {
		new frappe.ui.FileUploader({ folder: "Home/Attachments", restrictions: { allowed_file_types: [".xlsx"] }, on_success: (file) => this.preview_payroll_formula_import(file.file_url) });
	}

	preview_payroll_formula_import(fileUrl) {
		frappe.call({ method: "hrms.api.payroll_input.preview_payroll_formula_workbook", args: { file_url: fileUrl, company: this.company }, freeze: true, freeze_message: __("正在校验公式..."), callback: (response) => {
			const result = response.message || {};
			const dialog = new frappe.ui.Dialog({ title: __("公式导入预览"), fields: [{ fieldname: "preview", fieldtype: "HTML", options: this.render_table("", ["结果项目", "计算公式", "状态"], result.rows || [], (row) => [row["结果项目"], row["计算公式"], row.valid ? __("通过") : row.message]) }], primary_action_label: __("确认导入"), primary_action: () => {
				frappe.call({ method: "hrms.api.payroll_input.import_payroll_formula_workbook", args: { file_url: fileUrl, company: this.company }, freeze: true, freeze_message: __("正在导入公式..."), callback: () => { dialog.hide(); frappe.show_alert({ message: __("公式导入完成"), indicator: "green" }); this.load_payroll_formula_catalog(); } });
			} });
			dialog.show();
			if (result.valid_count !== result.row_count) dialog.get_primary_btn().prop("disabled", true);
		} });
	}

	open_payroll_configuration_guide() {
		const currentKey = this.active_process_step || this.process_step_for(this.active_tab);
		const dialog = new frappe.ui.Dialog({
			title: __("薪酬配置操作指南"),
			fields: [
				{
					fieldname: "guide",
					fieldtype: "HTML",
					options: `<div class="hrms-payroll-guide-dialog"><p>${frappe.utils.escape_html(__("按顺序完成前置数据。点击步骤关键词会关闭指南并跳到对应板块。"))}</p>${this.process_steps
						.map((step, index) => `<button data-guide-route="${frappe.utils.escape_html(step.route)}" data-guide-anchor="${frappe.utils.escape_html(step.anchor || "")}" class="${step.key === currentKey ? "is-current" : ""}"><span>${index + 1}</span><div><strong>${frappe.utils.escape_html(__(step.label))}</strong><small>${frappe.utils.escape_html(__(step.description))}</small></div>${step.key === currentKey ? `<em>${frappe.utils.escape_html(__("当前步骤"))}</em>` : ""}</button>`)
						.join("")}</div>`,
				},
			],
			primary_action_label: __("关闭"),
			primary_action: () => dialog.hide(),
		});
		dialog.show();
		dialog.$wrapper[0].querySelectorAll("[data-guide-route]").forEach((button) => {
			button.addEventListener("click", () => {
				dialog.hide();
				this.open_process_step(button.dataset.guideRoute, button.dataset.guideAnchor);
			});
		});
	}

	render_configuration_area(area, index) {
		return `<div class="hrms-payroll-configuration-row"><span>${index}</span><div><strong>${frappe.utils.escape_html(__(area.title))}</strong><small>${frappe.utils.escape_html(__(area.description))}</small></div><button class="btn btn-default btn-sm" data-open-payroll-doctype="${frappe.utils.escape_html(area.doctype)}" data-payroll-route-type="${frappe.utils.escape_html(area.route_type || "List")}">${frappe.utils.escape_html(__(area.action))}</button></div>`;
	}

	scroll_to_configuration_anchor(anchor) {
		const target = this.body()?.querySelector(`#${anchor}`);
		if (!target) return;
		this.body().querySelectorAll("[data-config-jump]").forEach((button) => button.classList.toggle("active", button.dataset.configJump === anchor));
		const processKey = anchor === "payroll-config-templates" ? "templates" : anchor === "payroll-config-assignments" ? "assignments" : "items";
		this.set_process_step_state(processKey);
		target.scrollIntoView({ behavior: "smooth", block: "start" });
	}

	set_process_step_state(activeKey) {
		const activeIndex = this.process_steps.findIndex((step) => step.key === activeKey);
		if (activeIndex < 0) return;
		this.active_process_step = activeKey;
		this.wrapper.querySelectorAll("[data-process-key]").forEach((button, index) => {
			const state = index < activeIndex ? "complete" : index === activeIndex ? "current" : "upcoming";
			button.classList.remove("is-complete", "is-current", "is-upcoming");
			button.classList.add(`is-${state}`);
			const label = button.querySelector("[data-process-state]");
			if (label) label.textContent = state === "complete" ? __("已在前序") : state === "current" ? __("当前步骤") : __("后续步骤");
		});
	}

	load_payroll_configuration_items() {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_configuration_items",
			args: { company: this.company },
			callback: (response) => {
				const result = response.message || {};
				this.payroll_configuration_items = result.items || [];
				const summaryTarget = this.wrapper.querySelector("[data-payroll-item-summary]");
				if (summaryTarget) {
					const summary = result.summary || {};
					summaryTarget.innerHTML = `<div class="hrms-payroll-item-summary"><span><strong>${frappe.utils.escape_html(String(summary.item_count || 0))}</strong>${frappe.utils.escape_html(__("个独立项目"))}</span><span><strong>${frappe.utils.escape_html(String(summary.mapped_count || 0))}</strong>${frappe.utils.escape_html(__("个已连接字段"))}</span><span><strong>${frappe.utils.escape_html(String(summary.rule_count || 0))}</strong>${frappe.utils.escape_html(__("套关联规则"))}</span></div>`;
				}
				const filtersTarget = this.wrapper.querySelector("[data-payroll-item-filters]");
				if (filtersTarget) {
					filtersTarget.innerHTML = [__("全部"), ...(result.categories || [])]
						.map((category, index) => `<button class="${index === 0 ? "active" : ""}" data-payroll-item-category="${frappe.utils.escape_html(index === 0 ? "" : category)}">${frappe.utils.escape_html(category)}</button>`)
						.join("");
					filtersTarget.querySelectorAll("[data-payroll-item-category]").forEach((button) => {
						button.addEventListener("click", () => {
							filtersTarget.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
							this.filter_payroll_configuration_items(this.wrapper.querySelector("[data-payroll-item-search]")?.value || "", button.dataset.payrollItemCategory || "");
						});
					});
				}
				this.render_payroll_configuration_items(this.payroll_configuration_items);
			},
		});
	}

	render_payroll_configuration_items(items) {
		const target = this.wrapper.querySelector("[data-payroll-item-catalog]");
		if (!target) return;
		target.innerHTML = items.length
			? items
					.map((item, index) => {
						const searchText = [item.item_name, item.item_code, item.category, item.source_module, item.result_field, item.aggregate_target].filter(Boolean).join(" ").toLowerCase();
						const canConfigure = Boolean(item.rule_code || item.mapping_code);
						return `<article class="hrms-payroll-item-option" data-payroll-item-card data-item-index="${index}" data-item-category="${frappe.utils.escape_html(item.category || "")}" data-item-search="${frappe.utils.escape_html(searchText)}">
							<div class="hrms-payroll-item-option-head"><span>${frappe.utils.escape_html(__(item.category || "其他"))}</span><em>${frappe.utils.escape_html(__(item.configuration_status || "待配置"))}</em></div>
							<strong>${frappe.utils.escape_html(__(item.item_name || item.item_code))}</strong>
							<code>${frappe.utils.escape_html(item.result_field || item.item_code || "")}</code>
							<dl><div><dt>${frappe.utils.escape_html(__("来源"))}</dt><dd>${frappe.utils.escape_html(__(item.source_module || "未设置"))}</dd></div><div><dt>${frappe.utils.escape_html(__("取值"))}</dt><dd>${frappe.utils.escape_html(__(item.calculation_mode || "来源字段"))}</dd></div>${item.aggregate_target ? `<div><dt>${frappe.utils.escape_html(__("汇总到"))}</dt><dd>${frappe.utils.escape_html(__(item.aggregate_target))}</dd></div>` : ""}</dl>
							<div class="hrms-payroll-item-option-footer"><span>${frappe.utils.escape_html(__(item.data_type || "金额"))} · ${frappe.utils.escape_html(__(item.direction || "参与结算"))}</span><button class="btn btn-default btn-xs" data-configure-payroll-item="${index}">${frappe.utils.escape_html(__(canConfigure ? "设置" : "维护来源"))}</button></div>
						</article>`;
					})
					.join("")
			: `<div class="text-muted">${frappe.utils.escape_html(__("暂无匹配的薪酬项目。"))}</div>`;
		target.querySelectorAll("[data-configure-payroll-item]").forEach((button) => {
			button.addEventListener("click", () => this.configure_payroll_item(this.payroll_configuration_items[Number(button.dataset.configurePayrollItem)]));
		});
	}

	filter_payroll_configuration_items(query = "", category = null) {
		const normalized = String(query || "").trim().toLowerCase();
		const activeCategory = category === null ? this.wrapper.querySelector("[data-payroll-item-filters] button.active")?.dataset.payrollItemCategory || "" : category;
		this.wrapper.querySelectorAll("[data-payroll-item-card]").forEach((card) => {
			const matchesQuery = !normalized || (card.dataset.itemSearch || "").includes(normalized);
			const matchesCategory = !activeCategory || card.dataset.itemCategory === activeCategory;
			card.hidden = !(matchesQuery && matchesCategory);
		});
	}

	configure_payroll_item(item) {
		if (!item) return;
		if (item.rule_code) {
			const rule = this.payroll_rule_rows.find((row) => row.rule_code === item.rule_code);
			if (rule) return this.edit_payroll_rule(rule);
		}
		if (item.mapping_code) {
			const mapping = this.payroll_mapping_rows.find((row) => row.mapping_code === item.mapping_code);
			if (mapping) return this.edit_payroll_field_mapping(mapping);
		}
		frappe.show_alert({ message: __("该项目通过已确认月度来源进入结算。"), indicator: "blue" });
		this.route_to_tab("welfare-sources");
	}

	payroll_configuration_areas() {
		return [
			{ title: "工资项", description: "定义底薪、津贴、奖金、扣款、公司承担项及其税务属性。", doctype: "Salary Component", action: "维护工资项" },
			{ title: "工资表模板", description: "组合应发、应扣和公司承担工资项；用于不同人员类别或部门。", doctype: "Salary Structure", action: "维护模板" },
			{ title: "员工薪资分配", description: "把模板按公司、员工和生效日期分配；一名员工同一期间只能使用一套有效结构。", doctype: "Salary Structure Assignment", action: "维护分配" },
			{ title: "永新计薪规则", description: "维护全勤、加班、夜班、福利资格和结算参数；规则按当前公司隔离。", doctype: "HRMS Payroll Rule", action: "打开规则档案" },
			{ title: "全局薪资设置", description: "维护工资周期、舍入和工资单通用设置；此项为系统全局设置，不是公司专属。", doctype: "Payroll Settings", route_type: "Form", action: "打开设置" },
			{ title: "月工资表", description: "只在考勤锁定、来源确认和试算复核完成后创建正式工资表。", doctype: "Payroll Entry", action: "查看工资表" },
			{ title: "操作记录", description: "查看薪资规则、模板和结算记录的版本变更，支持审计追溯。", doctype: "Version", action: "查看记录" },
		];
	}

	load_rule_permission() {
		frappe.call({
			method: "hrms.api.payroll_input.can_edit_payroll_rules",
			callback: (response) => {
				this.can_edit_payroll_rules = Boolean(response.message);
				const target = this.wrapper.querySelector("[data-rule-permission]");
				if (!target) return;
				target.innerHTML = `<div class="text-muted">${frappe.utils.escape_html(this.can_edit_payroll_rules ? __("当前账号可以修改薪资规则。") : __("当前账号只能查看薪资规则。"))}</div>`;
			},
		});
	}

	load_payroll_rules() {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_rules",
			args: { company: this.company },
			callback: (response) => {
					this.payroll_rule_rows = response.message || [];
					const target = this.wrapper.querySelector("[data-salary-rule-table]");
					if (!target) return;
					target.innerHTML = this.render_table("薪资规则", ["分类", "规则编码", "规则名称", "规则来源", "公式说明", "执行方式", "执行参数", "执行状态", "规则说明", "来源资料", "缺失规则说明", "状态"], this.payroll_rule_rows, (row) => [
					row.rule_category,
					row.rule_code,
					row.rule_name,
					row.rule_origin,
					row.formula_expression,
					row.execution_mode,
					JSON.stringify(row.parameters || {}),
					row.execution_status,
					row.rule_text,
					[row.source_file, row.source_sheet, row.source_cell].filter(Boolean).join(" / "),
					row.missing_rule_note,
					row.status,
				]);
			},
		});
	}

	validate_payroll_rule_execution() {
		frappe.call({
			method: "hrms.api.payroll_input.validate_payroll_rule_execution",
			args: { company: this.company, payroll_month: this.payroll_month },
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-rule-execution-status]");
				if (!target) return;
				const result = response.message || {};
				const rows = result.rules || [];
				target.innerHTML = `<div class="hrms-payroll-input-panel"><strong>${frappe.utils.escape_html(result.valid ? __("可执行规则校验通过") : __("可执行规则校验未通过"))}</strong><div class="text-muted">${frappe.utils.escape_html(__("试算月份：{0}；只有通过的参数化规则会被读取。", [result.payroll_month || this.payroll_month]))}</div>${this.render_table("", ["规则编码", "来源", "状态", "生效参数"], rows, (row) => [row.rule_code, row.source || "", row.message || "", JSON.stringify(row.parameters || {})])}</div>`;
			},
		});
	}

	ensure_default_payroll_rules() {
		if (!this.can_edit_payroll_rules) {
			frappe.msgprint(__("您没有维护薪资规则的权限"));
			return;
		}
		frappe.call({
			method: "hrms.api.payroll_input.ensure_default_payroll_rules",
			args: { company: this.company },
			freeze: true,
			freeze_message: __("正在刷新默认薪资规则..."),
			callback: () => {
				frappe.show_alert({ message: __("默认薪资规则已刷新"), indicator: "green" });
				this.load_payroll_rules();
				this.load_payroll_configuration_items();
			},
		});
	}

	edit_payroll_rule(rule = {}) {
		if (!this.can_edit_payroll_rules) {
			frappe.msgprint(__("您没有维护薪资规则的权限"));
			return;
		}
		frappe.prompt(
			[
				{ fieldname: "name", fieldtype: "Data", hidden: 1, default: rule.name || "" },
				{ fieldname: "company", fieldtype: "Link", options: "Company", label: __("公司"), reqd: 1, default: this.company, read_only: 1 },
				{ fieldname: "rule_code", fieldtype: "Data", label: __("规则编码"), reqd: 1, default: rule.rule_code || "" },
				{ fieldname: "rule_name", fieldtype: "Data", label: __("规则名称"), reqd: 1, default: rule.rule_name || "" },
				{ fieldname: "rule_category", fieldtype: "Select", label: __("规则分类"), options: "薪资架构\n考勤\n福利补贴\n宿舍\n社保公积金\n薪资结算\n税费扣款\n奖金福利\n其他", default: rule.rule_category || "其他" },
				{ fieldname: "rule_scope", fieldtype: "Data", label: __("适用范围"), default: rule.rule_scope || "" },
				{ fieldname: "effective_from", fieldtype: "Date", label: __("生效开始"), default: rule.effective_from || "" },
				{ fieldname: "effective_to", fieldtype: "Date", label: __("生效结束"), default: rule.effective_to || "" },
				{ fieldname: "formula_expression", fieldtype: "Code", label: __("公式说明（不直接执行）"), default: rule.formula_expression || "" },
				{ fieldname: "parameters_json", fieldtype: "Code", label: __("执行参数 JSON（参与计算）"), default: JSON.stringify(rule.parameters || {}, null, 2) },
				{ fieldname: "rule_text", fieldtype: "Small Text", label: __("规则说明"), default: rule.rule_text || "" },
				{ fieldname: "source_file", fieldtype: "Data", label: __("来源资料"), default: rule.source_file || "" },
				{ fieldname: "source_sheet", fieldtype: "Data", label: __("来源工作表"), default: rule.source_sheet || "" },
				{ fieldname: "source_cell", fieldtype: "Data", label: __("来源单元格/行"), default: rule.source_cell || "" },
				{ fieldname: "missing_rule_note", fieldtype: "Small Text", label: __("缺失规则说明"), default: rule.missing_rule_note || "" },
				{ fieldname: "status", fieldtype: "Select", label: __("状态"), options: "草稿\n已启用\n已停用", default: rule.status || "已启用" },
			],
			(values) => {
				frappe
					.call({
						method: "hrms.api.payroll_input.upsert_payroll_rule",
						args: values,
						freeze: true,
						freeze_message: __("正在保存薪资规则..."),
					})
					.then(() => {
						frappe.show_alert({ message: __("薪资规则已保存"), indicator: "green" });
						this.load_payroll_rules();
						this.validate_payroll_rule_execution();
						this.load_payroll_configuration_items();
					});
			},
			__("新增/修改规则"),
		);
	}

	load_payroll_field_mappings() {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_field_mappings",
			callback: (response) => {
					this.payroll_mapping_rows = response.message || [];
					const target = this.wrapper.querySelector("[data-payroll-field-mapping-table]");
					if (!target) return;
					target.innerHTML = this.render_table("薪资结算字段映射", ["Excel列", "Excel字段名", "系统字段", "来源模块", "公式表达式", "对应规则", "来源说明"], this.payroll_mapping_rows, (row) => [
					row.excel_column,
					row.excel_label,
					row.system_field,
					row.source_module,
					row.formula_expression,
					row.rule_code,
					row.source_detail,
				]);
			},
		});
	}

	ensure_default_payroll_field_mappings() {
		if (!this.can_edit_payroll_rules) {
			frappe.msgprint(__("您没有维护薪资字段映射的权限"));
			return;
		}
		frappe.call({
			method: "hrms.api.payroll_input.ensure_default_payroll_field_mappings",
			freeze: true,
			freeze_message: __("正在刷新薪资结算字段映射..."),
			callback: () => {
				frappe.show_alert({ message: __("薪资结算字段映射已刷新"), indicator: "green" });
				this.load_payroll_field_mappings();
				this.load_payroll_configuration_items();
			},
		});
	}

	edit_payroll_field_mapping(mapping = {}) {
		if (!this.can_edit_payroll_rules) {
			frappe.msgprint(__("您没有维护薪资字段映射的权限"));
			return;
		}
		frappe.prompt(
			[
				{ fieldname: "name", fieldtype: "Data", hidden: 1, default: mapping.name || "" },
				{ fieldname: "mapping_code", fieldtype: "Data", label: __("映射编码"), reqd: 1, default: mapping.mapping_code || "" },
				{ fieldname: "display_order", fieldtype: "Int", label: __("显示顺序"), default: mapping.display_order || 0 },
				{ fieldname: "excel_column", fieldtype: "Data", label: __("Excel列"), reqd: 1, default: mapping.excel_column || "" },
				{ fieldname: "excel_label", fieldtype: "Data", label: __("Excel字段名"), reqd: 1, default: mapping.excel_label || "" },
				{ fieldname: "system_field", fieldtype: "Data", label: __("系统字段"), default: mapping.system_field || "" },
				{ fieldname: "source_module", fieldtype: "Select", label: __("来源模块"), options: "员工档案\n薪资主数据\n考勤终稿\n福利扣款\n薪资变量\n薪资结算\n公式计算\n导出辅助", default: mapping.source_module || "" },
				{ fieldname: "formula_expression", fieldtype: "Code", label: __("公式表达式"), default: mapping.formula_expression || "" },
				{ fieldname: "rule_code", fieldtype: "Data", label: __("对应规则"), default: mapping.rule_code || "" },
				{ fieldname: "source_detail", fieldtype: "Small Text", label: __("来源说明"), default: mapping.source_detail || "" },
				{ fieldname: "status", fieldtype: "Select", label: __("状态"), options: "已启用\n已停用", default: mapping.status || "已启用" },
			],
			(values) => {
				frappe
					.call({
						method: "hrms.api.payroll_input.upsert_payroll_field_mapping",
						args: values,
						freeze: true,
						freeze_message: __("正在保存薪资字段映射..."),
					})
					.then(() => {
						frappe.show_alert({ message: __("薪资字段映射已保存"), indicator: "green" });
						this.load_payroll_field_mappings();
						this.load_payroll_configuration_items();
					});
			},
			__("新增/修改字段映射"),
		);
	}

	load_salary_master(preview = null) {
		this.body().innerHTML = `
			<div class="hrms-payroll-runbook-head">
				<div>
					<h3>${frappe.utils.escape_html(__("薪资架构与员工定薪"))}</h3>
					<p>${frappe.utils.escape_html(__("先维护薪资架构和薪资档位，再为每位员工建立已批准的定薪记录；只有该记录、已锁定考勤终稿和已确认福利扣款共同满足时，才能进入正式薪资试算。"))}</p>
				</div>
				<div class="hrms-payroll-action-group">
					<button class="btn btn-default btn-sm" data-download-salary-change-template>${frappe.utils.escape_html(__("下载员工定薪模板"))}</button>
					<button class="btn btn-default btn-sm" data-import-salary-change>${frappe.utils.escape_html(__("导入员工定薪"))}</button>
					<button class="btn btn-default btn-sm" data-new-salary-change>${frappe.utils.escape_html(__("新增员工定薪"))}</button>
					<button class="btn btn-primary btn-sm" data-upload-salary-structure>${frappe.utils.escape_html(__("导入薪资架构"))}</button>
				</div>
			</div>
			<div class="hrms-payroll-scope-notice">
				<strong>${frappe.utils.escape_html(__("薪资主数据范围"))}</strong>
				<span>${frappe.utils.escape_html(this.company || __("未选择公司"))} / ${frappe.utils.escape_html(this.payroll_month || __("未选择月份"))}</span>
				<small>${frappe.utils.escape_html(__("试运营、测试或未批准的薪资记录会明确提示，不能作为正式工资发放依据。"))}</small>
			</div>
			<div data-salary-architecture-overview></div>
			<div data-salary-structure-preview>${preview ? this.render_salary_structure_preview(preview) : ""}</div>
			<div data-salary-versions></div>
			<div data-salary-grades></div>
			<div data-salary-changes></div>
		`;
		this.body().querySelector("[data-upload-salary-structure]").addEventListener("click", () => this.open_salary_structure_uploader());
		this.body().querySelector("[data-download-salary-change-template]").addEventListener("click", () => this.download_employee_salary_change_template());
		this.body().querySelector("[data-import-salary-change]").addEventListener("click", () => this.open_employee_salary_change_import());
		this.body().querySelector("[data-new-salary-change]").addEventListener("click", () => this.open_employee_salary_change_dialog());
		const importButton = this.body().querySelector("[data-import-salary-structure]");
		if (importButton) importButton.addEventListener("click", () => this.import_salary_structure_workbook());
		this.load_salary_architecture_overview();
		this.load_salary_structure_versions();
		this.load_salary_grades();
		this.load_employee_salary_changes();
	}

	load_salary_architecture_overview() {
		frappe.call({
			method: "hrms.api.payroll_input.get_salary_architecture_workbench",
			args: { company: this.company, payroll_month: this.payroll_month },
			callback: (response) => {
				const result = response.message || {};
				const target = this.wrapper.querySelector("[data-salary-architecture-overview]");
				if (!target) return;
				target.innerHTML = this.render_salary_architecture_overview(result);
				this.update_process_guide_status(this.process_status_from_salary_architecture(result));
				target.querySelectorAll("[data-salary-master-route]").forEach((button) => {
					button.addEventListener("click", () => this.route_to_tab(button.dataset.salaryMasterRoute));
				});
			},
		});
	}

	process_status_from_salary_architecture(result = {}) {
		const coverage = result.coverage || {};
		const rules = result.rules || {};
		const standardPayroll = result.standard_payroll || {};
		const stages = result.stages || [];
		const stageByKey = {};
		stages.forEach((stage) => {
			stageByKey[stage.key] = stage;
		});
		const employeeReady = (coverage.active_employee_count || 0) > 0;
		const rulesReady = stageByKey.rules?.tone === "ready";
		const profileReady = stageByKey.profile?.tone === "ready" && stageByKey.trial?.tone !== "blocked";
		const templateReady = (standardPayroll.template_count || 0) > 0;
		const assignmentReady = (standardPayroll.assignment_count || 0) >= (coverage.active_employee_count || 0) && profileReady;
		return {
			master: {
				state: employeeReady ? "complete" : "blocked",
				label: employeeReady ? __("已满足") : __("缺员工资料"),
				detail: __("员工基础资料必须先维护公司、工号、姓名、部门、岗位、状态和入职信息。"),
			},
			items: {
				state: rulesReady ? "complete" : "blocked",
				label: rulesReady ? __("已满足") : __("缺薪资规则"),
				detail: __("工资项、启用公式和字段映射必须完整。"),
			},
			templates: {
				state: templateReady ? "complete" : "blocked",
				label: templateReady ? __("已满足") : __("缺工资表模板"),
				detail: __("必须至少有一套当前公司已启用的标准 HRMS 工资表模板。"),
			},
			assignments: {
				state: assignmentReady ? "complete" : "blocked",
				label: assignmentReady ? __("已满足") : __("缺员工分配/定薪"),
				detail: __("每位参与算薪员工必须有有效模板分配和当月有效、已批准、非测试的定薪记录。"),
			},
		};
	}

	render_salary_architecture_overview(result) {
		const coverage = result.coverage || {};
		const stages = result.stages || [];
		const missing = result.missing_profiles || [];
		const trial = result.trial_profiles || [];
		const pending = result.pending_changes || [];
		return `
			<div class="hrms-payroll-metric-grid">
				<div class="hrms-payroll-metric"><div class="text-muted">${frappe.utils.escape_html(__("在职员工"))}</div><strong>${frappe.utils.escape_html(String(coverage.active_employee_count || 0))}</strong></div>
				<div class="hrms-payroll-metric"><div class="text-muted">${frappe.utils.escape_html(__("已批准定薪覆盖"))}</div><strong>${frappe.utils.escape_html(`${coverage.approved_profile_count || 0} / ${coverage.active_employee_count || 0}`)}</strong></div>
				<div class="hrms-payroll-metric"><div class="text-muted">${frappe.utils.escape_html(__("定薪覆盖率"))}</div><strong>${frappe.utils.escape_html(`${coverage.coverage_percent || 0}%`)}</strong></div>
				<div class="hrms-payroll-metric"><div class="text-muted">${frappe.utils.escape_html(__("缺少定薪"))}</div><strong>${frappe.utils.escape_html(String(coverage.missing_profile_count || 0))}</strong></div>
			</div>
			<div class="hrms-payroll-salary-readiness">
				${stages
					.map(
						(stage, index) => `
							<div class="hrms-payroll-salary-stage is-${frappe.utils.escape_html(stage.tone || "pending")}">
								<span>${index + 1}</span><div><strong>${frappe.utils.escape_html(__(stage.title || ""))}</strong><small>${frappe.utils.escape_html(__(stage.detail || ""))}</small></div><em>${frappe.utils.escape_html(__(stage.status || ""))} · ${frappe.utils.escape_html(String(stage.count || 0))}${frappe.utils.escape_html(__(stage.unit || ""))}</em>
							</div>`,
					)
					.join("")}
			</div>
			${
				missing.length || trial.length || pending.length
					? `<div class="hrms-payroll-salary-alert">
						<strong>${frappe.utils.escape_html(__("需要处理的薪资主数据"))}</strong>
						${missing.length ? `<span>${frappe.utils.escape_html(__("缺少已批准定薪：{0} 人", [missing.length]))}${missing.length ? `（${frappe.utils.escape_html(missing.slice(0, 5).map((row) => row.employee_name || row.employee_code).join("、"))}${missing.length > 5 ? "…" : ""}）` : ""}</span>` : ""}
						${pending.length ? `<span>${frappe.utils.escape_html(__("待审核薪资异动：{0} 条", [pending.length]))}</span>` : ""}
						${trial.length ? `<span>${frappe.utils.escape_html(__("试运营测试定薪：{0} 人，必须替换后才可正式发薪", [trial.length]))}</span>` : ""}
						<button class="btn btn-default btn-sm" data-salary-master-route="employee-salary">${frappe.utils.escape_html(__("查看员工薪资"))}</button>
					</div>`
					: `<div class="hrms-payroll-salary-ready">${frappe.utils.escape_html(__("薪资架构和员工定薪已满足当前月份的基础检查；下一步请确认月度考勤终稿、福利扣款与薪资变量。"))}<button class="btn btn-default btn-sm" data-salary-master-route="monthly-workbench">${frappe.utils.escape_html(__("进入本月算薪"))}</button></div>`
			}
		`;
	}

	download_employee_salary_change_template() {
		frappe.call({
			method: "hrms.api.payroll_input.create_employee_salary_change_template_file",
			freeze: true,
			freeze_message: __("正在生成员工定薪模板..."),
			callback: (response) => {
				const fileUrl = response.message?.file_url;
				if (fileUrl) window.open(fileUrl, "_blank");
			},
		});
	}

	open_employee_salary_change_import() {
		if (!window.hrmsFormImport?.open) {
			frappe.msgprint(__("表单导入组件正在加载，请稍后重试。"));
			return;
		}
		window.hrmsFormImport.open("salary_structure_change", {
			title: __("员工定薪/薪资构成调整导入"),
			company: this.company,
		});
	}

	open_employee_salary_change_dialog() {
		const dialog = new frappe.ui.Dialog({
			title: __("新增员工定薪"),
			fields: [
				{ fieldname: "company", fieldtype: "Link", options: "Company", label: __("公司"), default: this.company, read_only: 1, reqd: 1 },
				{ fieldname: "employee", fieldtype: "Link", options: "Employee", label: __("员工"), reqd: 1, get_query: () => ({ filters: { company: this.company, status: "Active" } }) },
				{ fieldname: "effective_date", fieldtype: "Date", label: __("生效日期"), default: `${this.payroll_month || frappe.datetime.get_today().slice(0, 7)}-01`, reqd: 1 },
				{ fieldname: "change_reason", fieldtype: "Select", label: __("异动原因"), options: "入职定薪\n转正调薪\n晋升调薪\n岗位调整\n年度调薪\n其他", default: "入职定薪", reqd: 1 },
				{ fieldname: "salary_grade", fieldtype: "Link", options: "HRMS Salary Grade", label: __("薪资档位"), description: __("选择后，未填写的金额会按档位自动带入。") },
				{ fieldname: "base_salary", fieldtype: "Currency", label: __("底薪") },
				{ fieldname: "function_allowance", fieldtype: "Currency", label: __("职能津贴") },
				{ fieldname: "certificate_allowance", fieldtype: "Currency", label: __("证书津贴") },
				{ fieldname: "multi_skill_allowance", fieldtype: "Currency", label: __("多能工津贴") },
				{ fieldname: "full_salary", fieldtype: "Currency", label: __("薪资小计"), description: __("可留空，系统自动合计。") },
				{ fieldname: "social_insurance_enabled", fieldtype: "Check", label: __("缴纳社保") },
				{ fieldname: "housing_fund_enabled", fieldtype: "Check", label: __("缴纳公积金") },
				{ fieldname: "status", fieldtype: "Select", label: __("状态"), options: "草稿\n待审核", default: "草稿", reqd: 1, description: __("新增记录须经人事审核后才会生效并参与月度结算。") },
				{ fieldname: "remarks", fieldtype: "Small Text", label: __("备注") },
			],
			primary_action_label: __("保存定薪记录"),
			primary_action: (values) => {
				frappe.call({
					method: "hrms.api.payroll_input.create_employee_salary_change",
					args: values,
					freeze: true,
					freeze_message: __("正在保存员工定薪..."),
					callback: () => {
						dialog.hide();
						frappe.show_alert({ message: __("员工定薪已保存；只有已批准记录会进入本月薪资试算。"), indicator: "green" });
						this.load_salary_master();
					},
				});
			},
		});
		dialog.show();
	}

	render_salary_structure_preview(result) {
		return `
			<div class="hrms-payroll-input-panel">
				<h3>${frappe.utils.escape_html(__("薪资架构预览"))}</h3>
				<table class="table table-bordered">
					<tbody>
						<tr><th>${frappe.utils.escape_html(__("工作表"))}</th><td>${frappe.utils.escape_html(result.sheet_name || "薪资架构")}</td></tr>
						<tr><th>${frappe.utils.escape_html(__("状态"))}</th><td>${result.found ? frappe.utils.escape_html(__("已找到")) : frappe.utils.escape_html(__("缺失"))}</td></tr>
						<tr><th>${frappe.utils.escape_html(__("识别档位"))}</th><td>${frappe.utils.escape_html(result.grade_rows || 0)}</td></tr>
					</tbody>
				</table>
				${result.found ? `<button class="btn btn-primary btn-sm" data-import-salary-structure>${frappe.utils.escape_html(__("确认导入薪资架构"))}</button>` : ""}
			</div>
		`;
	}

	preview_salary_structure_workbook() {
		frappe
			.call({
				method: "hrms.api.payroll_input.preview_salary_structure_workbook",
				args: { file_url: this.salary_structure_file_url },
				freeze: true,
				freeze_message: __("正在预览薪资架构..."),
			})
			.then((response) => this.load_salary_master(response.message || {}));
	}

	import_salary_structure_workbook() {
		frappe.prompt(
			[
				{ fieldname: "structure_version", fieldtype: "Data", label: __("薪资架构版本"), reqd: 1 },
				{ fieldname: "effective_from", fieldtype: "Date", label: __("生效开始"), reqd: 1 },
				{ fieldname: "effective_to", fieldtype: "Date", label: __("生效结束") },
			],
			(values) => {
				frappe
					.call({
						method: "hrms.api.payroll_input.import_salary_structure_workbook",
						args: {
							file_url: this.salary_structure_file_url,
							structure_version: values.structure_version,
							effective_from: values.effective_from,
							effective_to: values.effective_to,
						},
						freeze: true,
						freeze_message: __("正在导入薪资架构..."),
					})
					.then(() => {
						frappe.show_alert({ message: __("薪资架构导入完成"), indicator: "green" });
						this.load_salary_master();
					});
			},
			__("导入薪资架构"),
		);
	}

	load_salary_structure_versions() {
		frappe.call({
			method: "hrms.api.payroll_input.list_salary_structure_versions",
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-salary-versions]");
				if (!target) return;
				target.innerHTML = this.render_table("薪资架构版本", ["版本", "状态", "生效开始", "生效结束", "来源文件"], response.message || [], (row) => [
					row.structure_version,
					row.status,
					row.effective_from,
					row.effective_to,
					row.source_file,
				]);
			},
		});
	}

	load_salary_grades() {
		frappe.call({
			method: "hrms.api.payroll_input.list_salary_grades",
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-salary-grades]");
				if (!target) return;
				target.innerHTML = this.render_table("薪资档位", ["版本", "岗性", "岗级", "底薪", "职能津贴", "证书津贴", "多能工津贴", "薪资小计", "全勤奖标准", "租房补贴标准"], response.message || [], (row) => [
					row.salary_structure_version,
					row.job_nature,
					row.job_grade,
					row.base_salary,
					row.function_allowance,
					row.certificate_allowance,
					row.multi_skill_allowance,
					row.full_salary,
					row.full_attendance_bonus_standard,
					row.rental_subsidy_standard,
				]);
			},
		});
	}

	load_employee_salary_changes() {
		frappe.call({
			method: "hrms.api.payroll_input.list_employee_salary_changes",
			args: this.scope_args(),
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-salary-changes]");
				if (!target) return;
				target.innerHTML = this.render_table("员工薪资异动", ["姓名", "工号", "部门", "最近调整日/生效日", "调整原因", "固定工资（底薪）", "职能津贴", "证书津贴", "多能工津贴", "总工资（薪资小计）", "状态"], response.message || [], (row) => [
					row.employee_name,
					row.employee_code,
					row.department,
					row.effective_date,
					row.change_reason,
					row.base_salary,
					row.function_allowance,
					row.certificate_allowance,
					row.multi_skill_allowance,
					row.full_salary,
					row.status,
				]);
			},
		});
	}

	load_welfare_sources() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<h3>${frappe.utils.escape_html(__("福利扣款来源中心"))}</h3>
				<div>
					<button class="btn btn-default btn-sm" data-add-welfare-source>${frappe.utils.escape_html(__("新增来源"))}</button>
					<button class="btn btn-primary btn-sm" data-sync-welfare-sources>${frappe.utils.escape_html(__("同步到薪资变量"))}</button>
				</div>
			</div>
			<div class="text-muted">
				${frappe.utils.escape_html(__("统一维护学历补贴资格与月报、租房补贴申请/登记/月度明细、宿舍入住/退宿/水电住宿费、社保公积金个人/公司承担、提案改善奖、继续服务奖、所得税、水电扣款等月度变量。"))}
			</div>
			<div data-welfare-rules></div>
			<div data-welfare-source-table></div>
		`;
		this.body().querySelector("[data-add-welfare-source]").addEventListener("click", () => this.add_welfare_source());
		this.body().querySelector("[data-sync-welfare-sources]").addEventListener("click", () => this.sync_welfare_sources_to_payroll_variables());
		this.load_welfare_rules();
		this.load_welfare_source_records();
	}

	load_welfare_rules() {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_welfare_source_rules",
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-welfare-rules]");
				if (!target) return;
				const rules = response.message || [];
				target.innerHTML = this.render_table("福利扣款规则", ["来源类型", "规则主题", "方向", "结算变量", "规则快照"], rules, (row) => [
					row.source_type,
					row.title,
					row.direction,
					row.variable_type,
					row.rule,
				]);
			},
		});
	}

	add_welfare_source() {
		frappe.prompt(
			[
				{ fieldname: "source_type", fieldtype: "Select", label: __("来源类型"), reqd: 1, options: "薪资构成\n奖惩提报\n证书多能工津贴\n全勤奖\n学历补贴\n租房补贴\n宿舍住宿费\n宿舍水电费\n社保个人\n社保公司\n公积金个人\n公积金公司\n提案改善奖\n继续服务奖\n苹果树\n离职薪资结算\n所得税\n年终奖所得税\n水电费及扣款\n已发福利\n生产奖\n高温补贴\n手机话费补贴\n油费补贴\n其他奖金\n其他扣款" },
				{ fieldname: "employee_code", fieldtype: "Data", label: __("工号") },
				{ fieldname: "employee_name", fieldtype: "Data", label: __("姓名"), reqd: 1 },
				{ fieldname: "department", fieldtype: "Link", label: __("部门"), options: "Department" },
				{ fieldname: "amount", fieldtype: "Currency", label: __("金额"), reqd: 1 },
				{ fieldname: "source_reference", fieldtype: "Data", label: __("来源单据/说明") },
				{ fieldname: "confirmation_status", fieldtype: "Select", label: __("确认状态"), options: "待确认\n已确认\n已驳回\n草稿", default: "待确认" },
				{ fieldname: "remarks", fieldtype: "Small Text", label: __("备注") },
			],
			(values) => {
				frappe
					.call({
						method: "hrms.api.payroll_input.upsert_payroll_welfare_source_record",
						args: this.scope_args(values),
						freeze: true,
						freeze_message: __("正在保存福利扣款来源..."),
					})
					.then(() => {
						frappe.show_alert({ message: __("福利扣款来源已保存"), indicator: "green" });
						this.load_welfare_source_records();
					});
			},
			__("新增福利扣款来源"),
		);
	}

	load_welfare_source_records() {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_welfare_source_records",
			args: this.scope_args(),
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-welfare-source-table]");
				if (!target) return;
				target.innerHTML = this.render_table("福利扣款来源记录", ["姓名", "工号", "部门", "来源类型", "结算变量", "方向", "金额", "资格状态", "确认状态", "来源单据/说明"], response.message || [], (row) => [
					row.employee_name,
					row.employee_code,
					row.department,
					row.source_type,
					row.variable_type,
					row.direction,
					row.amount,
					row.eligibility_status,
					row.confirmation_status,
					row.source_reference,
				]);
			},
		});
	}

	sync_welfare_sources_to_payroll_variables() {
		frappe.call({
			method: "hrms.api.payroll_input.sync_welfare_sources_to_payroll_variables",
			args: this.scope_args(),
			freeze: true,
			freeze_message: __("正在同步福利扣款来源..."),
			callback: (response) => {
				const count = response.message?.created || 0;
				frappe.show_alert({ message: __("已同步 {0} 条薪资变量", [count]), indicator: "green" });
				this.load_welfare_source_records();
			},
		});
	}

	render_variable_import(result = null) {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-panel">
				<div class="hrms-payroll-upload-box" data-upload-zone>
					<strong>${frappe.utils.escape_html(__("上传薪资变量 Excel"))}</strong>
					<span>${frappe.utils.escape_html(__("支持全勤奖、住房补贴、学历补贴、社保名单、每月员工住宿费用明细表；也兼容完整薪资结算表。"))}</span>
					<button class="btn btn-primary btn-sm">${frappe.utils.escape_html(__("选择文件"))}</button>
				</div>
				<div data-preview>${result ? this.render_preview(result) : `<div class="text-muted">${frappe.utils.escape_html(__("上传后会先预览各工作表行数，不会立即写入。"))}</div>`}</div>
			</div>
			<div class="hrms-payroll-input-panel">
				<div class="hrms-payroll-input-list-head">
					<h3>${frappe.utils.escape_html(__("导入批次"))}</h3>
					<div class="text-muted">${frappe.utils.escape_html(__("可追溯上次导入来源表单；删除批次会同步清空同月份薪资输入表，结算表不会自动删除。"))}</div>
				</div>
				<div data-import-batch-table></div>
			</div>
			<div data-variable-table></div>
		`;
		this.body().querySelector("[data-upload-zone]").addEventListener("click", () => this.open_uploader());
		const importButton = this.body().querySelector("[data-import]");
		if (importButton) importButton.addEventListener("click", () => this.import_payroll_variable_workbook());
		this.load_import_batches();
		this.load_variables();
	}

	render_preview(result) {
		return `
			<h3>${frappe.utils.escape_html(__("预览结果"))}</h3>
			<table class="table table-bordered">
				<thead><tr><th>${frappe.utils.escape_html(__("工作表"))}</th><th>${frappe.utils.escape_html(__("状态"))}</th><th>${frappe.utils.escape_html(__("行数"))}</th><th>${frappe.utils.escape_html(__("可导入"))}</th></tr></thead>
				<tbody>
					${(result.sheets || [])
						.map(
							(sheet) => `
								<tr>
									<td>${frappe.utils.escape_html(sheet.sheet_name)}</td>
									<td>${sheet.found ? frappe.utils.escape_html(__("已找到")) : frappe.utils.escape_html(__("缺失"))}</td>
									<td>${frappe.utils.escape_html(sheet.row_count || 0)}</td>
									<td>${frappe.utils.escape_html(sheet.mapped_rows || 0)}</td>
								</tr>
							`,
						)
						.join("")}
				</tbody>
			</table>
			<button class="btn btn-primary" data-import>${frappe.utils.escape_html(__("确认导入变量"))}</button>
		`;
	}

	preview_payroll_variable_workbook() {
		frappe
			.call({
				method: "hrms.api.payroll_input.preview_payroll_variable_workbook",
				args: { file_url: this.file_url },
				freeze: true,
				freeze_message: __("正在预览薪资变量..."),
			})
			.then((response) => this.render_variable_import(response.message || {}));
	}

	import_payroll_variable_workbook() {
		frappe
			.call({
				method: "hrms.api.payroll_input.import_payroll_variable_workbook",
				args: this.scope_args({ file_url: this.file_url }),
				freeze: true,
				freeze_message: __("正在导入薪资变量..."),
			})
			.then(() => {
				frappe.show_alert({ message: __("薪资变量导入完成"), indicator: "green" });
				this.load_import_batches();
				this.load_variables();
			});
	}

	load_import_batches() {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_variable_import_batches",
			args: this.scope_args(),
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-import-batch-table]");
				if (!target) return;
				this.render_import_batches(target, response.message || []);
			},
		});
	}

	render_import_batches(target, rows) {
		target.innerHTML = `
			<div class="hrms-payroll-table-wrap">
				<table class="table table-bordered hrms-payroll-input-table">
					<thead>
						<tr>
							<th>${frappe.utils.escape_html(__("薪资月份"))}</th>
							<th>${frappe.utils.escape_html(__("来源文件"))}</th>
							<th>${frappe.utils.escape_html(__("来源工作表"))}</th>
							<th>${frappe.utils.escape_html(__("变量行数"))}</th>
							<th>${frappe.utils.escape_html(__("导入人"))}</th>
							<th>${frappe.utils.escape_html(__("导入时间"))}</th>
							<th>${frappe.utils.escape_html(__("状态"))}</th>
							<th>${frappe.utils.escape_html(__("操作"))}</th>
						</tr>
					</thead>
					<tbody>
						${
							rows.length
								? rows.map((row) => `
									<tr>
										<td>${frappe.utils.escape_html(row.payroll_month || "")}</td>
										<td>${frappe.utils.escape_html(row.source_file_label || row.source_file || "")}</td>
										<td>${frappe.utils.escape_html(row.source_sheets || "")}</td>
										<td>${frappe.utils.escape_html(String(row.actual_variable_rows ?? row.variable_rows ?? 0))}</td>
										<td>${frappe.utils.escape_html(row.imported_by || "")}</td>
										<td>${frappe.utils.escape_html(row.imported_on || "")}</td>
										<td>${frappe.utils.escape_html(row.status || "")}</td>
										<td><button class="btn btn-danger btn-xs" data-delete-import-batch="${frappe.utils.escape_html(row.name)}">${frappe.utils.escape_html(__("删除批次"))}</button></td>
									</tr>
								`).join("")
								: `<tr><td colspan="8" class="text-muted">${frappe.utils.escape_html(__("暂无导入批次"))}</td></tr>`
						}
					</tbody>
				</table>
			</div>
		`;
		target.querySelectorAll("[data-delete-import-batch]").forEach((button) => {
			button.addEventListener("click", () => this.delete_import_batch(button.dataset.deleteImportBatch));
		});
	}

	delete_import_batch(batch_name) {
		frappe.confirm(
			__("确认删除该导入批次？同月份薪资输入表已清空，请重新生成；结算表不会自动删除。"),
			() => {
				frappe.call({
					method: "hrms.api.payroll_input.delete_payroll_variable_import_batch",
					args: this.scope_args({ batch_name }),
					freeze: true,
					freeze_message: __("正在删除导入批次..."),
					callback: (response) => {
						const result = response.message || {};
						frappe.show_alert({
							message: result.message || __("导入批次已删除，同月份薪资输入表已清空，请重新生成；结算表不会自动删除。"),
							indicator: "orange",
						});
						this.load_import_batches();
						this.load_variables();
					},
				});
			},
		);
	}

	load_variables() {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_variable_records",
			args: this.scope_args(),
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-variable-table]");
				if (!target) return;
				this.render_variable_records(target, response.message || []);
			},
		});
	}

	render_variable_records(target, rows) {
		target.innerHTML = `
			<div class="hrms-payroll-table-wrap">
				<table class="table table-bordered hrms-payroll-input-table">
					<thead>
						<tr>
							<th>${frappe.utils.escape_html(__("姓名"))}</th>
							<th>${frappe.utils.escape_html(__("工号"))}</th>
							<th>${frappe.utils.escape_html(__("部门"))}</th>
							<th>${frappe.utils.escape_html(__("变量类型"))}</th>
							<th>${frappe.utils.escape_html(__("金额"))}</th>
							<th>${frappe.utils.escape_html(__("来源工作表"))}</th>
							<th>${frappe.utils.escape_html(__("导入批次"))}</th>
							<th>${frappe.utils.escape_html(__("操作"))}</th>
						</tr>
					</thead>
					<tbody>
						${
							rows.length
								? rows.map((row) => `
									<tr>
										<td>${frappe.utils.escape_html(row.employee_name || "")}</td>
										<td>${frappe.utils.escape_html(row.employee_code || "")}</td>
										<td>${frappe.utils.escape_html(row.department || "")}</td>
										<td>${frappe.utils.escape_html(row.variable_type || "")}</td>
										<td>${frappe.utils.escape_html(this.format_money(row.amount))}</td>
										<td>${frappe.utils.escape_html(row.source_sheet || "")}</td>
										<td>${frappe.utils.escape_html(row.import_batch || "")}</td>
										<td><button class="btn btn-default btn-xs" data-edit-variable-record="${frappe.utils.escape_html(row.name)}">${frappe.utils.escape_html(__("编辑"))}</button></td>
									</tr>
								`).join("")
								: `<tr><td colspan="8" class="text-muted">${frappe.utils.escape_html(__("薪资变量记录暂无数据"))}</td></tr>`
						}
					</tbody>
				</table>
			</div>
		`;
		target.querySelectorAll("[data-edit-variable-record]").forEach((button) => {
			const row = rows.find((item) => item.name === button.dataset.editVariableRecord);
			button.addEventListener("click", () => this.edit_variable_record(row));
		});
	}

	edit_variable_record(row) {
		if (!row) return;
		frappe.prompt(
			[
				{ fieldname: "employee", fieldtype: "Link", options: "Employee", label: __("员工"), default: row.employee },
				{ fieldname: "employee_code", fieldtype: "Data", label: __("工号"), default: row.employee_code },
				{ fieldname: "employee_name", fieldtype: "Data", label: __("姓名"), default: row.employee_name },
				{ fieldname: "department", fieldtype: "Link", options: "Department", label: __("部门"), default: row.department },
				{ fieldname: "variable_type", fieldtype: "Select", label: __("变量类型"), options: "全勤奖\n住房补贴\n学历补贴\n宿舍扣款\n社保个人\n公积金个人\n其他奖金\n其他扣款\n底薪\n职能津贴\n职务津贴\n证书津贴\n多能工津贴\n证书及多能工津贴\n全薪\n薪资小计\n生产奖\n提案改善奖\n继续服务奖\n苹果树\n所得税\n年终奖所得税\n水电费及扣款\n社保公司\n公积金公司\n已发福利\n夜班津贴\n迟到金额+全勤奖扣款\n离职薪资结算", default: row.variable_type },
				{ fieldname: "amount", fieldtype: "Currency", label: __("金额"), default: row.amount },
				{ fieldname: "source_sheet", fieldtype: "Data", label: __("来源工作表"), default: row.source_sheet },
				{ fieldname: "remarks", fieldtype: "Small Text", label: __("备注"), default: row.remarks },
			],
			(values) => {
				frappe.call({
					method: "hrms.api.payroll_input.update_payroll_variable_record",
					args: Object.assign({ name: row.name }, values),
					freeze: true,
					freeze_message: __("正在保存薪资变量明细..."),
					callback: (response) => {
						frappe.show_alert({
							message: response.message?.message || __("薪资变量明细已保存；同月份薪资输入表已清空，请重新生成；结算表不会自动删除。"),
							indicator: "green",
						});
						this.load_variables();
					},
				});
			},
			__("编辑薪资变量明细"),
		);
	}

	load_inputs() {
		const hasLockedAttendance = Boolean(this.attendance_lock_version);
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<div>
					<h3>${frappe.utils.escape_html(__("薪资输入表"))}</h3>
					<div class="text-muted">${frappe.utils.escape_html(__("按员工花名册、考勤终稿和福利扣款来源生成计薪输入，先核对工时和变量，再进入结算。"))}</div>
				</div>
				<button class="btn btn-primary btn-sm" data-generate ${hasLockedAttendance ? "" : "disabled"} title="${frappe.utils.escape_html(hasLockedAttendance ? __("生成薪资输入表") : __("请先选择已锁定考勤版本"))}">${frappe.utils.escape_html(__("生成薪资输入表"))}</button>
			</div>
			<div data-input-cards></div>
			<div class="hrms-payroll-filter-row">
				<input class="form-control" data-input-search placeholder="${frappe.utils.escape_html(__("姓名、工号、部门"))}">
				<span class="text-muted" data-input-count></span>
			</div>
			<div data-input-table></div>
		`;
		this.body().querySelector("[data-generate]").addEventListener("click", () => this.generate_payroll_input_records());
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_input_records",
			args: this.scope_args({ page_length: 500 }),
			callback: (response) => {
				this.render_payroll_input_rows(response.message || []);
			},
		});
	}

	generate_payroll_input_records(after_generate = null) {
		if (!this.ensure_payroll_generation_scope(__("生成薪资输入表"))) return;
		frappe.call({
			method: "hrms.api.payroll_input.generate_payroll_input_records",
			args: this.scope_args(),
			freeze: true,
			freeze_message: __("正在生成薪资输入表..."),
			callback: () => {
				frappe.show_alert({ message: __("薪资输入表已按锁定考勤和同范围变量生成"), indicator: "green" });
				if (after_generate) return after_generate();
				this.load_inputs();
			},
		});
	}

	render_payroll_input_rows(rows) {
		const search = this.wrapper.querySelector("[data-input-search]");
		const cardsTarget = this.wrapper.querySelector("[data-input-cards]");
		const tableTarget = this.wrapper.querySelector("[data-input-table]");
		const countTarget = this.wrapper.querySelector("[data-input-count]");
		if (!tableTarget) return;
		const render = () => {
			const filteredRows = this.filter_people_rows(rows, search && search.value);
			if (countTarget) countTarget.textContent = __("{0} 条 / 共 {1} 条", [filteredRows.length, rows.length]);
			if (cardsTarget) {
				cardsTarget.innerHTML = this.render_metric_cards([
					{ label: "员工", value: rows.length },
					{ label: "实际出勤", value: this.format_number(this.sum(rows, "actual_attendance_hours")) },
					{ label: "调整后工时", value: this.format_number(this.sum(rows, "adjusted_working_hours")) },
					{ label: "加班合计", value: this.format_number(this.sum(rows, "overtime_1_5_hours") + this.sum(rows, "overtime_2_hours") + this.sum(rows, "overtime_3_hours")) },
				]);
			}
			tableTarget.innerHTML = this.render_table("薪资输入表", ["姓名", "工号", "部门", "标准工时", "实际出勤", "调整后工时", "1.5倍加班", "2倍加班", "3倍加班", "红绿苹果", "全勤奖", "住房补贴", "学历补贴", "宿舍扣款", "社保个人", "公积金个人", "应发前置合计", "应扣前置合计", "状态"], filteredRows, (row) => [
				row.employee_name,
				row.employee_code,
				row.department,
				this.format_number(row.standard_hours),
				this.format_number(row.actual_attendance_hours),
				this.format_number(row.adjusted_working_hours),
				this.format_number(row.overtime_1_5_hours),
				this.format_number(row.overtime_2_hours),
				this.format_number(row.overtime_3_hours),
				this.format_money(row.apple_reward_amount),
				this.format_money(row.full_attendance_bonus),
				this.format_money(row.housing_subsidy),
				this.format_money(row.education_subsidy),
				this.format_money(row.dormitory_deduction),
				this.format_money(row.social_security_personal),
				this.format_money(row.housing_fund_personal),
				this.format_money(row.preliminary_earning_total),
				this.format_money(row.preliminary_deduction_total),
				row.settlement_status,
			]);
		};
		if (search) search.addEventListener("input", render);
		render();
	}

	load_settlements() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<div>
					<h3>${frappe.utils.escape_html(__("薪资结算表"))}</h3>
					<div class="text-muted">${frappe.utils.escape_html(__("由薪资主数据、月度考勤终稿、福利扣款来源和薪资输入表计算生成；导入完整薪资表时也会保留同口径字段。"))}</div>
				</div>
				<div class="hrms-payroll-action-group">
					<button class="btn btn-default btn-sm" data-toggle-settlement-details>
						${frappe.utils.escape_html(__(this.show_all_settlement_details ? "收起细项" : "显示所有细项"))}
					</button>
					<button class="btn btn-default btn-sm" data-confirm-settlement>${frappe.utils.escape_html(__("确认本月结算"))}</button>
					<button class="btn btn-primary btn-sm" data-generate-settlement>${frappe.utils.escape_html(__("生成薪资结算表"))}</button>
				</div>
			</div>
			<div data-settlement-dependencies></div>
			<div data-settlement-cards></div>
			<div class="hrms-payroll-filter-row">
				<input class="form-control" data-settlement-search placeholder="${frappe.utils.escape_html(__("姓名、工号、部门"))}">
				<span class="text-muted" data-settlement-count></span>
			</div>
			<div data-settlement-table></div>
		`;
		this.body().querySelector("[data-generate-settlement]").addEventListener("click", () => this.generate_payroll_settlement_records());
		this.body().querySelector("[data-confirm-settlement]").addEventListener("click", () => this.confirm_payroll_settlement_records());
		this.body().querySelector("[data-toggle-settlement-details]").addEventListener("click", () => {
			this.show_all_settlement_details = !this.show_all_settlement_details;
			this.load_settlements();
		});
		this.load_settlement_dependencies();
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_settlement_records",
			args: this.scope_args({ page_length: 500 }),
			callback: (response) => {
				this.render_payroll_settlement_rows(response.message || []);
			},
		});
	}

	load_settlement_dependencies() {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_dependency_status",
			args: this.scope_args(),
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-settlement-dependencies]");
				if (!target) return;
				const rows = (response.message || []).filter((row) =>
					["员工花名册", "薪资主数据/薪资异动", "月度考勤终稿", "福利扣款来源", "薪资输入表", "薪资结算表"].includes(row.source),
				);
				target.innerHTML = this.render_dependency_strip(rows);
			},
		});
	}

	render_payroll_settlement_rows(rows) {
		const search = this.wrapper.querySelector("[data-settlement-search]");
		const cardsTarget = this.wrapper.querySelector("[data-settlement-cards]");
		const tableTarget = this.wrapper.querySelector("[data-settlement-table]");
		const countTarget = this.wrapper.querySelector("[data-settlement-count]");
		if (!tableTarget) return;
		const render = () => {
			const filteredRows = this.filter_people_rows(rows, search && search.value);
			if (countTarget) countTarget.textContent = __("{0} 条 / 共 {1} 条", [filteredRows.length, rows.length]);
			if (cardsTarget) {
				cardsTarget.innerHTML = this.render_metric_cards([
					{ label: "员工", value: rows.length },
					{ label: "应付工资", value: this.format_money(this.sum(rows, "gross_pay")) },
					{ label: "实发工资", value: this.format_money(this.sum(rows, "net_pay")) },
					{ label: "公司负担", value: this.format_money(this.sum(rows, "company_cost_total")) },
				]);
			}
			const columns = this.settlement_columns(this.show_all_settlement_details);
			tableTarget.innerHTML = this.render_table("薪资结算表", columns.map((column) => column.label), filteredRows, (row) =>
				columns.map((column) => this.format_settlement_cell(row, column)),
			);
		};
		if (search) search.addEventListener("input", render);
		render();
	}

	settlement_columns(show_all_details) {
		const core = [
			{ label: "姓名", field: "employee_name", type: "text" },
			{ label: "工号", field: "employee_code", type: "text" },
			{ label: "部门", field: "department", type: "text" },
			{ label: "底薪", field: "base_salary", type: "money" },
			{ label: "薪资小计", field: "salary_subtotal", type: "money" },
			{ label: "标准工时", field: "standard_hours", type: "number" },
			{ label: "基本出勤", field: "basic_attendance_hours", type: "number" },
			{ label: "平日加班", field: "weekday_overtime_hours", type: "number" },
			{ label: "周末加班", field: "weekend_overtime_hours", type: "number" },
			{ label: "节假日加班", field: "holiday_overtime_hours", type: "number" },
			{ label: "加班费", field: "overtime_pay_total", type: "money" },
			{ label: "夜班津贴", field: "night_shift_allowance", type: "money" },
			{ label: "出勤工资", field: "attendance_wage", type: "money" },
			{ label: "奖金", field: "bonus_total", type: "money" },
			{ label: "惩处", field: "punishment_total", type: "money" },
			{ label: "应付工资", field: "gross_pay", type: "money" },
			{ label: "社保个人", field: "social_security_personal", type: "money" },
			{ label: "公积金个人", field: "housing_fund_personal", type: "money" },
			{ label: "计税工资", field: "taxable_salary", type: "money" },
			{ label: "所得税", field: "income_tax", type: "money" },
			{ label: "水电扣款", field: "utilities_deduction", type: "money" },
			{ label: "实发工资", field: "net_pay", type: "money" },
			{ label: "社保公司", field: "social_security_company", type: "money" },
			{ label: "公积金公司", field: "housing_fund_company", type: "money" },
			{ label: "公司负担", field: "company_cost_total", type: "money" },
			{ label: "状态", field: "calculation_status", type: "text" },
		];
		if (!show_all_details) return core;
		return [
			{ label: "姓名", field: "employee_name", type: "text" },
			{ label: "工号", field: "employee_code", type: "text" },
			{ label: "部门", field: "department", type: "text" },
			{ label: "底薪", field: "base_salary", type: "money" },
			{ label: "职能津贴", field: "function_allowance", type: "money" },
			{ label: "证书及多能工津贴", field: "certificate_skill_allowance", type: "money" },
			{ label: "薪资小计", field: "salary_subtotal", type: "money" },
			{ label: "标准工时", field: "standard_hours", type: "number" },
			{ label: "基本出勤工时", field: "basic_attendance_hours", type: "number" },
			{ label: "缺勤工时", field: "missing_hours", type: "number" },
			{ label: "调整前周末加班", field: "raw_weekend_overtime_hours", type: "number" },
			{ label: "调整后缺勤工时", field: "adjusted_absence_hours", type: "number" },
			{ label: "缺勤扣除金额", field: "absence_deduction_amount", type: "money" },
			{ label: "调整后周末加班", field: "weekend_overtime_hours", type: "number" },
			{ label: "平日加班时数", field: "weekday_overtime_hours", type: "number" },
			{ label: "节假日加班时数", field: "holiday_overtime_hours", type: "number" },
			{ label: "平日加班工资", field: "weekday_overtime_pay", type: "money" },
			{ label: "周末加班工资", field: "weekend_overtime_pay", type: "money" },
			{ label: "节假日加班工资", field: "holiday_overtime_pay", type: "money" },
			{ label: "加班费小计", field: "overtime_pay_total", type: "money" },
			{ label: "大夜班次数", field: "large_night_shift_count", type: "number" },
			{ label: "小夜班次数", field: "small_night_shift_count", type: "number" },
			{ label: "夜班津贴", field: "night_shift_allowance", type: "money" },
			{ label: "出勤工资", field: "attendance_wage", type: "money" },
			{ label: "提案改善奖", field: "proposal_improvement_bonus", type: "money" },
			{ label: "红绿苹果", field: "apple_reward_amount", type: "money" },
			{ label: "补贴奖金合计", field: "subsidy_bonus_total", type: "money" },
			{ label: "生产奖", field: "production_bonus", type: "money" },
			{ label: "奖金合计", field: "bonus_total", type: "money" },
			{ label: "旷工时数", field: "absenteeism_hours", type: "number" },
			{ label: "旷工扣款", field: "absenteeism_deduction", type: "money" },
			{ label: "迟到/全勤扣款", field: "late_full_attendance_deduction", type: "money" },
			{ label: "惩处小计", field: "punishment_total", type: "money" },
			{ label: "应付工资", field: "gross_pay", type: "money" },
			{ label: "社保个人", field: "social_security_personal", type: "money" },
			{ label: "公积金个人", field: "housing_fund_personal", type: "money" },
			{ label: "已发福利", field: "paid_proposal_birthday_welfare", type: "money" },
			{ label: "计税工资", field: "taxable_salary", type: "money" },
			{ label: "继续服务奖", field: "continuing_service_bonus", type: "money" },
			{ label: "所得税", field: "income_tax", type: "money" },
			{ label: "年终奖所得税", field: "year_end_bonus_tax", type: "money" },
			{ label: "水电费及扣款", field: "utilities_deduction", type: "money" },
			{ label: "实发工资", field: "net_pay", type: "money" },
			{ label: "社保公司", field: "social_security_company", type: "money" },
			{ label: "公积金公司", field: "housing_fund_company", type: "money" },
			{ label: "公司实际负担总计", field: "company_cost_total", type: "money" },
			{ label: "调整后实发工资", field: "export_tax_adjusted_net_pay", type: "money" },
			{ label: "状态", field: "calculation_status", type: "text" },
		];
	}

	format_settlement_cell(row, column) {
		if (column.type === "money") return this.format_money(row[column.field]);
		if (column.type === "number") return this.format_number(row[column.field]);
		return row[column.field];
	}

	confirm_payroll_settlement_records() {
		frappe.confirm(
			__("确认后，本公司、本月份、本考勤锁定版本的薪资结算不能再被重新试算覆盖。确认继续吗？"),
			() => {
				frappe.call({
					method: "hrms.api.payroll_input.confirm_payroll_settlement_records",
					args: this.scope_args(),
					freeze: true,
					freeze_message: __("正在确认薪资结算..."),
					callback: (response) => {
						frappe.show_alert({ message: __("已确认 {0} 条薪资结算", [response.message?.confirmed || 0]), indicator: "green" });
						this.load_settlements();
					},
				});
			},
		);
	}

	generate_payroll_settlement_records(after_generate = null) {
		if (!this.ensure_payroll_generation_scope(__("试算本月工资"))) return;
		frappe.call({
			method: "hrms.api.payroll_input.generate_payroll_settlement_records",
			args: this.scope_args(),
			freeze: true,
			freeze_message: __("正在生成薪资结算表..."),
			callback: () => {
				frappe.show_alert({ message: __("薪资结算表已重新试算，请完成差异复核后确认"), indicator: "green" });
				if (after_generate) return after_generate();
				this.load_active_tab();
			},
		});
	}

	ensure_payroll_generation_scope(actionLabel) {
		if (!this.company || !this.payroll_month || !this.attendance_lock_version) {
			frappe.msgprint({
				title: __("缺少薪资试算前置条件"),
				indicator: "red",
				message: `<div class="hrms-payroll-preflight-message">
					<p>${frappe.utils.escape_html(__("{0} 必须先绑定完整结算范围。", [actionLabel]))}</p>
					<ol>
						<li>${frappe.utils.escape_html(__("选择公司：当前 {0}", [this.company || "未选择"]))}</li>
						<li>${frappe.utils.escape_html(__("选择月份：当前 {0}", [this.payroll_month || "未选择"]))}</li>
						<li>${frappe.utils.escape_html(__("选择已锁定考勤版本：当前 {0}", [this.attendance_lock_version || "未选择"]))}</li>
					</ol>
					<p>${frappe.utils.escape_html(__("完整链条是：员工基础资料 → 已批准定薪/薪资架构 → 薪酬规则与字段映射 → 已锁定月度考勤终稿 → 已确认变量/福利扣款 → 生成薪资输入表 → 试算薪资结算表 → 复核确认与发放。"))}</p>
				</div>`,
			});
			this.update_process_guide_status({
				sources: { state: "blocked", label: __("缺考勤锁定"), detail: __("请选择已锁定考勤版本。") },
				calculation: { state: "blocked", label: __("不可试算"), detail: __("缺少完整结算范围。") },
			});
			return false;
		}
		return true;
	}

	load_payroll_reports() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head hrms-payroll-step-head">
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("步骤 7 · 已确认结果"))}</span><h3>${frappe.utils.escape_html(__("薪酬报表与发放"))}</h3><p>${frappe.utils.escape_html(__("只消费第 6 步已复核并确认的结算结果。"))}</p></div>
				<button class="btn btn-default btn-sm" data-open-monthly>${frappe.utils.escape_html(__("查看月工资表"))}</button>
			</div>
			<div class="text-muted">
				${frappe.utils.escape_html(__("按部门汇总薪资结算结果，覆盖应付工资、实发工资、加班、奖金、扣款、社保公积金和公司实际负担。"))}
			</div>
			<div data-payroll-report-table></div>
		`;
		this.body().querySelector("[data-open-monthly]").addEventListener("click", () => {
			this.active_tab = "monthly-payroll";
			frappe.set_route("payroll-input-center", this.active_tab);
			this.render();
			this.load_active_tab();
		});
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_report_summary",
			args: this.scope_args(),
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-payroll-report-table]");
				if (!target) return;
				target.innerHTML = this.render_table("薪酬报表", ["部门", "人数", "应付工资", "实发工资", "加班工资", "奖金小计", "惩处小计", "个人社保", "个人公积金", "公司社保", "公司公积金", "公司实际负担总计"], response.message || [], (row) => [
					row.department,
					row.headcount,
					row.gross_pay,
					row.net_pay,
					row.overtime_pay_total,
					row.bonus_total,
					row.punishment_total,
					row.social_security_personal,
					row.housing_fund_personal,
					row.social_security_company,
					row.housing_fund_company,
					row.company_cost_total,
				]);
			},
		});
	}

	load_payroll_analysis() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<h3>${frappe.utils.escape_html(__("薪酬分析"))}</h3>
				<button class="btn btn-default btn-sm" data-open-rules>${frappe.utils.escape_html(__("查看计薪规则"))}</button>
			</div>
			<div class="text-muted">
				${frappe.utils.escape_html(__("从薪资结算表拆解成本构成，用于检查加班、奖金福利、惩处扣款、社保公积金和公司总成本是否异常。"))}
			</div>
			<div data-payroll-analysis-cards></div>
			<div data-payroll-analysis-table></div>
		`;
		this.body().querySelector("[data-open-rules]").addEventListener("click", () => {
			this.active_tab = "salary-rules";
			frappe.set_route("payroll-input-center", this.active_tab);
			this.render();
			this.load_active_tab();
		});
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_analysis",
			args: this.scope_args(),
			callback: (response) => {
				const result = response.message || {};
				const cardTarget = this.wrapper.querySelector("[data-payroll-analysis-cards]");
				if (cardTarget) cardTarget.innerHTML = this.render_metric_cards(result.cost_buckets || []);
				const tableTarget = this.wrapper.querySelector("[data-payroll-analysis-table]");
				if (!tableTarget) return;
				tableTarget.innerHTML = this.render_table("薪酬分析", ["部门", "人数", "应付工资", "实发工资", "加班工资", "奖金小计", "惩处小计", "公司实际负担总计"], result.department_rows || [], (row) => [
					row.department,
					row.headcount,
					row.gross_pay,
					row.net_pay,
					row.overtime_pay_total,
					row.bonus_total,
					row.punishment_total,
					row.company_cost_total,
				]);
			},
		});
	}

	load_annual_bonus() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<h3>${frappe.utils.escape_html(__("年终奖计算"))}</h3>
				<button class="btn btn-default btn-sm" data-open-welfare>${frappe.utils.escape_html(__("维护年终奖所得税"))}</button>
			</div>
			<div class="hrms-payroll-input-panel">
				<h3>${frappe.utils.escape_html(__("规则状态"))}</h3>
				<div class="text-muted">${frappe.utils.escape_html(__("公司资料中已提供“年终奖所得税”作为薪资变量字段，但未提供完整年终奖基数、发放对象、服务期折算、税额计算规则。当前阶段先通过福利扣款来源中心导入年终奖所得税，待规则完整后再生成正式年终奖计算表。"))}</div>
			</div>
		`;
		this.body().querySelector("[data-open-welfare]").addEventListener("click", () => {
			this.active_tab = "welfare-sources";
			frappe.set_route("payroll-input-center", this.active_tab);
			this.render();
			this.load_active_tab();
		});
	}

	load_salary_slips() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<h3>${frappe.utils.escape_html(__("发送工资条"))}</h3>
				<button class="btn btn-default btn-sm" data-open-disbursement>${frappe.utils.escape_html(__("查看工资发放"))}</button>
			</div>
			<div class="text-muted">
				${frappe.utils.escape_html(__("工资条发送以薪资结算表稳定、员工确认后为前置条件；当前展示待生成工资条名单，暂不直接生成正式 Salary Slip。"))}
			</div>
			<div data-slip-table></div>
		`;
		this.body().querySelector("[data-open-disbursement]").addEventListener("click", () => {
			this.active_tab = "payroll-disbursement";
			frappe.set_route("payroll-input-center", this.active_tab);
			this.render();
			this.load_active_tab();
		});
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_disbursement_records",
			args: this.scope_args(),
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-slip-table]");
				if (!target) return;
				target.innerHTML = this.render_table("发送工资条", ["姓名", "工号", "部门", "实发工资", "结算状态", "工资条状态"], response.message || [], (row) => [
					row.employee_name,
					row.employee_code,
					row.department,
					row.net_pay,
					row.calculation_status,
					"待生成工资条",
				]);
			},
		});
	}

	filter_people_rows(rows, keyword) {
		const text = String(keyword || "").trim().toLowerCase();
		if (!text) return rows;
		return rows.filter((row) =>
			[row.employee_name, row.employee_code, row.department, row.designation, row.calculation_status, row.settlement_status]
				.some((value) => String(value || "").toLowerCase().includes(text)),
		);
	}

	sum(rows, fieldname) {
		return rows.reduce((total, row) => total + (Number(row[fieldname]) || 0), 0);
	}

	format_number(value) {
		const number = Number(value);
		if (!Number.isFinite(number)) return "";
		return number.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
	}

	format_money(value) {
		const number = Number(value);
		if (!Number.isFinite(number)) return "";
		return number.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	render_metric_cards(cards) {
		return `
			<div class="hrms-payroll-metric-grid">
				${cards
					.map(
						(card) => `
							<div class="hrms-payroll-metric">
								<div class="text-muted">${frappe.utils.escape_html(__(card.label || ""))}</div>
								<strong>${frappe.utils.escape_html(String(card.value ?? 0))}</strong>
							</div>
						`,
					)
					.join("")}
			</div>
		`;
	}

	render_dependency_strip(rows) {
		return `
			<div class="hrms-payroll-source-strip">
				${rows
					.map(
						(row) => `
							<div class="hrms-payroll-source-item">
								<span>${frappe.utils.escape_html(__(row.source || ""))}</span>
								<strong>${frappe.utils.escape_html(String(row.count ?? 0))}</strong>
								<em>${frappe.utils.escape_html(__(row.status || ""))}</em>
							</div>
						`,
					)
					.join("")}
			</div>
		`;
	}

	render_table(title, columns, rows, mapRow) {
		return `
			<div class="hrms-payroll-table-wrap">
				<table class="table table-bordered hrms-payroll-input-table">
					<thead><tr>${columns.map((column) => `<th>${frappe.utils.escape_html(__(column))}</th>`).join("")}</tr></thead>
					<tbody>
						${
							rows.length
								? rows.map((row) => `<tr>${mapRow(row).map((cell) => `<td>${frappe.utils.escape_html(String(cell ?? ""))}</td>`).join("")}</tr>`).join("")
								: `<tr><td colspan="${columns.length}" class="text-muted">${frappe.utils.escape_html(__(`${title}暂无数据`))}</td></tr>`
						}
					</tbody>
				</table>
			</div>
		`;
	}
}
