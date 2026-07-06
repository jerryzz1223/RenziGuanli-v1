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
		this.can_edit_payroll_rules = false;
		this.show_all_settlement_details = false;
		this.tabs = [
			{ key: "employee-salary", label: "员工薪资" },
			{ key: "monthly-payroll", label: "月工资表" },
			{ key: "payroll-disbursement", label: "工资发放" },
			{ key: "data-closure", label: "数据闭环导入" },
			{ key: "salary-rules", label: "薪资规则" },
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
		this.active_tab = this.resolve_tab(frappe.get_route()[1] || "salary-rules");
	}

	show() {
		this.page.set_primary_action(__("上传薪资变量"), () => this.open_uploader());
		this.bind_route_events();
		this.render();
		this.load_active_tab();
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
		return this.resolve_tab(route[1] || "salary-rules");
	}

	tab_from_route_detail(detail) {
		const value = String((detail && (detail.slug || detail.route)) || "");
		const normalized = value.replace(/^\/desk\/?/, "").replace(/^\/app\/?/, "").replace(/\/$/, "");
		const parts = normalized.split("/").filter(Boolean);
		if (parts[0] !== "payroll-input-center") return "";
		return this.resolve_tab(parts[1] || "salary-rules");
	}

	refresh_from_route(tab = "") {
		const next_tab = this.resolve_tab(tab || this.tab_from_current_route());
		const has_body = Boolean(this.body());
		if (next_tab === this.active_tab && has_body) return;
		this.active_tab = next_tab;
		this.render();
		this.load_active_tab();
	}

	resolve_tab(tab) {
		return this.tabs.some((item) => item.key === tab) ? tab : "salary-rules";
	}

	render() {
		this.wrapper.innerHTML = `
			<div class="hrms-payroll-input-center">
				<div class="hrms-payroll-input-head">
					<div>
						<h2>${frappe.utils.escape_html(__("薪酬管理中心"))}</h2>
						<p>${frappe.utils.escape_html(__("统一维护薪资主数据、变量导入、福利扣款、薪资输入表和薪资结算表；旧薪资输入中心入口继续保留。"))}</p>
					</div>
					<div class="hrms-payroll-input-controls">
						<input class="form-control" type="month" data-month value="${frappe.utils.escape_html(this.payroll_month)}">
						<button class="btn btn-default" data-upload>${frappe.utils.escape_html(__("上传 Excel"))}</button>
					</div>
				</div>
				<div class="hrms-payroll-input-tabs">
					${this.tabs
						.map(
							(tab) => `
								<button class="btn btn-default btn-sm ${tab.key === this.active_tab ? "active" : ""}" data-tab="${frappe.utils.escape_html(tab.key)}">
									${frappe.utils.escape_html(__(tab.label))}
								</button>
							`,
						)
						.join("")}
				</div>
				<div data-payroll-body></div>
			</div>
		`;
		this.wrapper.querySelector("[data-upload]").addEventListener("click", () => this.open_uploader());
		this.wrapper.querySelector("[data-month]").addEventListener("change", (event) => {
			this.payroll_month = event.target.value;
			this.load_active_tab();
		});
		this.wrapper.querySelectorAll("[data-tab]").forEach((button) => {
			button.addEventListener("click", () => {
				this.active_tab = button.dataset.tab;
				frappe.set_route("payroll-input-center", this.active_tab);
				this.render();
				this.load_active_tab();
			});
		});
	}

	body() {
		return this.wrapper.querySelector("[data-payroll-body]");
	}

	load_active_tab() {
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

	load_employee_salary_profiles() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<h3>${frappe.utils.escape_html(__("员工薪资"))}</h3>
				<button class="btn btn-default btn-sm" data-open-salary-master>${frappe.utils.escape_html(__("维护薪资主数据"))}</button>
			</div>
			<div class="text-muted">
				${frappe.utils.escape_html(__("联动员工花名册与员工薪资异动，展示在职、正式、试用、待离职员工的固定工资、总工资和最近调薪原因。"))}
			</div>
			<div data-employee-salary-cards></div>
			<div data-employee-salary-table></div>
		`;
		this.body().querySelector("[data-open-salary-master]").addEventListener("click", () => {
			this.active_tab = "salary-master";
			frappe.set_route("payroll-input-center", this.active_tab);
			this.render();
			this.load_active_tab();
		});
		frappe.call({
			method: "hrms.api.payroll_input.list_employee_salary_profiles",
			args: { payroll_month: this.payroll_month },
			callback: (response) => {
				const result = response.message || {};
				const counts = result.counts || {};
				const cards = [
					{ label: "在职", value: counts.active || 0 },
					{ label: "正式", value: counts.regular || 0 },
					{ label: "试用", value: counts.probation || 0 },
					{ label: "待离职", value: counts.pending_exit || 0 },
				];
				const cardTarget = this.wrapper.querySelector("[data-employee-salary-cards]");
				if (cardTarget) cardTarget.innerHTML = this.render_metric_cards(cards);
				const tableTarget = this.wrapper.querySelector("[data-employee-salary-table]");
				if (!tableTarget) return;
				tableTarget.innerHTML = this.render_table("员工薪资", ["姓名", "工号", "部门", "岗位", "工作性质", "员工状态", "固定工资", "总工资", "入职日期", "转正日期", "最近调整日", "调整原因", "结算状态"], result.rows || [], (row) => [
					row.employee_name,
					row.employee_code,
					row.department,
					row.designation,
					row.employment_type,
					row.employee_status,
					row.fixed_salary,
					row.total_salary,
					row.date_of_joining,
					row.confirmation_date,
					row.latest_adjustment_date,
					row.adjustment_reason,
					row.settlement_status,
				]);
			},
		});
	}

	load_monthly_payroll() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<h3>${frappe.utils.escape_html(__("月工资表"))}</h3>
				<div>
					<button class="btn btn-default btn-sm" data-refresh-dependencies>${frappe.utils.escape_html(__("刷新来源状态"))}</button>
					<button class="btn btn-primary btn-sm" data-generate-monthly>${frappe.utils.escape_html(__("生成薪资结算表"))}</button>
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
			args: { payroll_month: this.payroll_month },
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-monthly-payroll-cards]");
				if (target) target.innerHTML = this.render_metric_cards(response.message?.cards || []);
			},
		});
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_dependency_status",
			args: { payroll_month: this.payroll_month },
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
			args: { payroll_month: this.payroll_month },
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
			<div class="hrms-payroll-input-list-head">
				<h3>${frappe.utils.escape_html(__("数据闭环导入"))}</h3>
				<div>
					<button class="btn btn-default btn-sm" data-download-data-template>${frappe.utils.escape_html(__("下载模板"))}</button>
					<button class="btn btn-default btn-sm" data-upload-data-closure>${frappe.utils.escape_html(__("上传闭环数据"))}</button>
					${preview ? `<button class="btn btn-primary btn-sm" data-import-data-closure>${frappe.utils.escape_html(__("导入闭环数据"))}</button>` : ""}
				</div>
			</div>
			<div class="text-muted">
				${frappe.utils.escape_html(__("Excel导入方案：一个工作簿可以包含“员工薪资异动导入”“福利扣款来源导入”“月度考勤终稿导入”三张表，也可以直接包含“完整薪资结算表”。系统按表名识别，导入后再生成或查看薪资输入表和薪资结算表。"))}
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
					(data.templates || []).forEach((template) => {
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
			args: { file_url: this.data_closure_file_url, payroll_month: this.payroll_month },
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
			<div class="hrms-payroll-input-list-head">
				<h3>${frappe.utils.escape_html(__("薪资规则"))}</h3>
				<div>
					<button class="btn btn-default btn-sm" data-refresh-default-rules>${frappe.utils.escape_html(__("刷新默认规则"))}</button>
					<button class="btn btn-default btn-sm" data-refresh-field-mappings>${frappe.utils.escape_html(__("刷新字段映射"))}</button>
					<button class="btn btn-primary btn-sm" data-edit-payroll-rule>${frappe.utils.escape_html(__("新增/修改规则"))}</button>
					<button class="btn btn-primary btn-sm" data-edit-field-mapping>${frappe.utils.escape_html(__("新增/修改字段映射"))}</button>
				</div>
			</div>
			<div class="text-muted">
				${frappe.utils.escape_html(__("规则中心统一管理薪资架构、考勤、福利补贴、宿舍、社保公积金、薪资结算、税费扣款等公式/规则；有权限时可以修改。"))}
			</div>
			<div data-rule-permission></div>
			<div data-salary-rule-table></div>
			<div data-payroll-field-mapping-table></div>
		`;
		this.body().querySelector("[data-refresh-default-rules]").addEventListener("click", () => this.ensure_default_payroll_rules());
		this.body().querySelector("[data-refresh-field-mappings]").addEventListener("click", () => this.ensure_default_payroll_field_mappings());
		this.body().querySelector("[data-edit-payroll-rule]").addEventListener("click", () => this.edit_payroll_rule());
		this.body().querySelector("[data-edit-field-mapping]").addEventListener("click", () => this.edit_payroll_field_mapping());
		this.load_rule_permission();
		this.load_payroll_rules();
		this.load_payroll_field_mappings();
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
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-salary-rule-table]");
				if (!target) return;
				target.innerHTML = this.render_table("薪资规则", ["分类", "规则编码", "规则名称", "公式/规则", "规则说明", "来源资料", "缺失规则说明", "状态"], response.message || [], (row) => [
					row.rule_category,
					row.rule_code,
					row.rule_name,
					row.formula_expression,
					row.rule_text,
					[row.source_file, row.source_sheet, row.source_cell].filter(Boolean).join(" / "),
					row.missing_rule_note,
					row.status,
				]);
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
			freeze: true,
			freeze_message: __("正在刷新默认薪资规则..."),
			callback: () => {
				frappe.show_alert({ message: __("默认薪资规则已刷新"), indicator: "green" });
				this.load_payroll_rules();
			},
		});
	}

	edit_payroll_rule() {
		if (!this.can_edit_payroll_rules) {
			frappe.msgprint(__("您没有维护薪资规则的权限"));
			return;
		}
		frappe.prompt(
			[
				{ fieldname: "rule_code", fieldtype: "Data", label: __("规则编码"), reqd: 1 },
				{ fieldname: "rule_name", fieldtype: "Data", label: __("规则名称"), reqd: 1 },
				{ fieldname: "rule_category", fieldtype: "Select", label: __("规则分类"), options: "薪资架构\n考勤\n福利补贴\n宿舍\n社保公积金\n薪资结算\n税费扣款\n奖金福利\n其他", default: "其他" },
				{ fieldname: "formula_expression", fieldtype: "Code", label: __("公式/规则") },
				{ fieldname: "parameters_json", fieldtype: "Code", label: __("参数 JSON"), default: "{}" },
				{ fieldname: "rule_text", fieldtype: "Small Text", label: __("规则说明") },
				{ fieldname: "source_file", fieldtype: "Data", label: __("来源资料") },
				{ fieldname: "source_sheet", fieldtype: "Data", label: __("来源工作表") },
				{ fieldname: "missing_rule_note", fieldtype: "Small Text", label: __("缺失规则说明") },
				{ fieldname: "status", fieldtype: "Select", label: __("状态"), options: "草稿\n已启用\n已停用", default: "已启用" },
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
					});
			},
			__("新增/修改规则"),
		);
	}

	load_payroll_field_mappings() {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_field_mappings",
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-payroll-field-mapping-table]");
				if (!target) return;
				target.innerHTML = this.render_table("薪资结算字段映射", ["Excel列", "Excel字段名", "系统字段", "来源模块", "公式表达式", "对应规则", "来源说明"], response.message || [], (row) => [
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
			},
		});
	}

	edit_payroll_field_mapping() {
		if (!this.can_edit_payroll_rules) {
			frappe.msgprint(__("您没有维护薪资字段映射的权限"));
			return;
		}
		frappe.prompt(
			[
				{ fieldname: "mapping_code", fieldtype: "Data", label: __("映射编码"), reqd: 1 },
				{ fieldname: "display_order", fieldtype: "Int", label: __("显示顺序") },
				{ fieldname: "excel_column", fieldtype: "Data", label: __("Excel列"), reqd: 1 },
				{ fieldname: "excel_label", fieldtype: "Data", label: __("Excel字段名"), reqd: 1 },
				{ fieldname: "system_field", fieldtype: "Data", label: __("系统字段") },
				{ fieldname: "source_module", fieldtype: "Select", label: __("来源模块"), options: "员工档案\n薪资主数据\n考勤终稿\n福利扣款\n薪资变量\n薪资结算\n公式计算\n导出辅助" },
				{ fieldname: "formula_expression", fieldtype: "Code", label: __("公式表达式") },
				{ fieldname: "rule_code", fieldtype: "Data", label: __("对应规则") },
				{ fieldname: "source_detail", fieldtype: "Small Text", label: __("来源说明") },
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
					});
			},
			__("新增/修改字段映射"),
		);
	}

	load_salary_master(preview = null) {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<h3>${frappe.utils.escape_html(__("薪资主数据"))}</h3>
				<button class="btn btn-primary btn-sm" data-upload-salary-structure>${frappe.utils.escape_html(__("导入薪资架构"))}</button>
			</div>
			<div class="text-muted">
				${frappe.utils.escape_html(__("维护薪资架构版本、薪资档位、员工薪资异动，作为后续薪资结算表的底薪、职能津贴、证书津贴、多能工津贴和薪资小计来源。"))}
			</div>
			<div data-salary-structure-preview>${preview ? this.render_salary_structure_preview(preview) : ""}</div>
			<div data-salary-versions></div>
			<div data-salary-grades></div>
			<div data-salary-changes></div>
		`;
		this.body().querySelector("[data-upload-salary-structure]").addEventListener("click", () => this.open_salary_structure_uploader());
		const importButton = this.body().querySelector("[data-import-salary-structure]");
		if (importButton) importButton.addEventListener("click", () => this.import_salary_structure_workbook());
		this.load_salary_structure_versions();
		this.load_salary_grades();
		this.load_employee_salary_changes();
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
			args: { payroll_month: this.payroll_month },
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-salary-changes]");
				if (!target) return;
				target.innerHTML = this.render_table("员工薪资异动", ["姓名", "工号", "部门", "生效日期", "底薪", "职能津贴", "证书津贴", "多能工津贴", "薪资小计", "状态"], response.message || [], (row) => [
					row.employee_name,
					row.employee_code,
					row.department,
					row.effective_date,
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
				{ fieldname: "source_type", fieldtype: "Select", label: __("来源类型"), reqd: 1, options: "学历补贴\n租房补贴\n宿舍住宿费\n宿舍水电费\n社保个人\n社保公司\n公积金个人\n公积金公司\n提案改善奖\n继续服务奖\n所得税\n年终奖所得税\n水电费及扣款\n已发福利\n生产奖\n高温补贴\n手机话费补贴\n油费补贴\n其他奖金\n其他扣款" },
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
						args: { ...values, payroll_month: this.payroll_month },
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
			args: { payroll_month: this.payroll_month },
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
			args: { payroll_month: this.payroll_month },
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
				args: { file_url: this.file_url, payroll_month: this.payroll_month },
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
			args: { payroll_month: this.payroll_month },
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
					args: { batch_name },
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
			args: { payroll_month: this.payroll_month },
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
				{ fieldname: "variable_type", fieldtype: "Select", label: __("变量类型"), options: "全勤奖\n住房补贴\n学历补贴\n宿舍扣款\n社保个人\n公积金个人\n其他奖金\n其他扣款\n底薪\n职能津贴\n证书及多能工津贴\n薪资小计\n生产奖\n提案改善奖\n继续服务奖\n所得税\n年终奖所得税\n水电费及扣款\n社保公司\n公积金公司\n已发福利\n夜班津贴\n迟到金额+全勤奖扣款", default: row.variable_type },
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
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<div>
					<h3>${frappe.utils.escape_html(__("薪资输入表"))}</h3>
					<div class="text-muted">${frappe.utils.escape_html(__("按员工花名册、考勤终稿和福利扣款来源生成计薪输入，先核对工时和变量，再进入结算。"))}</div>
				</div>
				<button class="btn btn-primary btn-sm" data-generate>${frappe.utils.escape_html(__("生成薪资输入表"))}</button>
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
			args: { payroll_month: this.payroll_month, page_length: 500 },
			callback: (response) => {
				this.render_payroll_input_rows(response.message || []);
			},
		});
	}

	generate_payroll_input_records() {
		frappe.call({
			method: "hrms.api.payroll_input.generate_payroll_input_records",
			args: { payroll_month: this.payroll_month },
			freeze: true,
			freeze_message: __("正在生成薪资输入表..."),
			callback: () => this.load_inputs(),
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
		this.body().querySelector("[data-toggle-settlement-details]").addEventListener("click", () => {
			this.show_all_settlement_details = !this.show_all_settlement_details;
			this.load_settlements();
		});
		this.load_settlement_dependencies();
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_settlement_records",
			args: { payroll_month: this.payroll_month, page_length: 500 },
			callback: (response) => {
				this.render_payroll_settlement_rows(response.message || []);
			},
		});
	}

	load_settlement_dependencies() {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_dependency_status",
			args: { payroll_month: this.payroll_month },
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

	generate_payroll_settlement_records() {
		frappe.call({
			method: "hrms.api.payroll_input.generate_payroll_settlement_records",
			args: { payroll_month: this.payroll_month },
			freeze: true,
			freeze_message: __("正在生成薪资结算表..."),
			callback: () => this.load_active_tab(),
		});
	}

	load_payroll_reports() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<h3>${frappe.utils.escape_html(__("薪酬报表"))}</h3>
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
			args: { payroll_month: this.payroll_month },
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
			args: { payroll_month: this.payroll_month },
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
			args: { payroll_month: this.payroll_month },
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
