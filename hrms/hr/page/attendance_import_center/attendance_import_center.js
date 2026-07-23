frappe.pages["attendance-import-center"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("考勤工作台"),
		single_column: true,
	});

	wrapper.attendance_import_center = new AttendanceImportCenter(page);
	wrapper.attendance_import_center.show();
};

frappe.pages["attendance-import-center"].on_page_show = function (wrapper) {
	if (wrapper.attendance_import_center) {
		wrapper.attendance_import_center.refresh_from_route();
	}
};

class AttendanceImportCenter {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.file_url = "";
		this.batch = "";
		this.import_templates = null;
		this.preview_result = null;
		this.import_result = null;
		this.company = this.get_context_company();
		this.attendance_month = frappe.datetime.str_to_obj(frappe.datetime.get_today()).toISOString().slice(0, 7);
		this.attendance_date = "";
		this.last_sync_log = "";
		this.last_sync_batch = "";
		this.workflow_views = [
			{ key: "import", label: "考勤导入中心" },
			{ key: "daily", label: "每日考勤核对" },
			{ key: "exceptions", label: "考勤异常处理" },
			{ key: "monthly", label: "月度考勤终稿" },
		];
		this.view_groups = [
			{
				title: "考勤统计",
				items: [
					{ key: "summary", label: "统计首页" },
					{ key: "import-batches", label: "导入批次" },
					{ key: "daily", label: "每日考勤" },
					{ key: "monthly", label: "月考勤表" },
					{ key: "reports", label: "考勤报表" },
					{ key: "exceptions", label: "考勤确认" },
					{ key: "department-confirmations", label: "部门确认" },
				],
			},
			{
				title: "明细记录",
				items: [
					{ key: "clock-records", label: "打卡记录" },
					{ key: "makeup-records", label: "补卡记录" },
					{ key: "leave-records", label: "请假记录" },
					{ key: "outing-records", label: "外出记录" },
					{ key: "trip-records", label: "出差记录" },
					{ key: "overtime-records", label: "加班记录" },
				],
			},
			{
				title: "考勤管理",
				items: [
					{ key: "field-rules", label: "字段管理" },
					{ key: "custom-rules", label: "自定义规则" },
					{ key: "groups", label: "考勤分组" },
					{ key: "schedule", label: "排班管理" },
					{ key: "rules", label: "考勤规则" },
					{ key: "clock-settings", label: "打卡方式" },
					{ key: "settings", label: "考勤设置" },
					{ key: "dingtalk", label: "钉钉打卡对接" },
					{ key: "sync-logs", label: "钉钉同步记录" },
				],
			},
			{
				title: "绩效奖惩关联",
				items: [
					{ key: "apple-rules", label: "苹果树" },
					{ key: "seven-s-rules", label: "7S" },
					{ key: "kpi-rules", label: "KPI" },
				],
			},
		];
		this.view_map = this.view_groups.flatMap((group) => group.items).reduce((map, item) => {
			map[item.key] = item;
			return map;
		}, {});
		this.active_view = this.resolve_view(frappe.get_route()[1] || "summary");
	}

	show() {
		this.page.set_primary_action(__("上传考勤文件"), () => this.open_uploader());
		this.bind_route_events();
		this.bind_company_context();
		this.render();
		this.load_active_view();
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
			this.render();
			this.load_active_view();
		};
		window.addEventListener("hrms:company-context-changed", this.handle_company_context_change);
	}

	refresh_company_context_when_ready() {
		const ready = window.hrmsCompanyContext?.ready?.();
		if (!ready || typeof ready.then !== "function") return;
		ready.then((company) => {
			if (!company || company === this.company) return;
			this.company = company;
			this.render();
			this.load_active_view();
		});
	}

	bind_route_events() {
		if (this.route_events_bound) return;
		this.route_events_bound = true;
		this.handle_hrms_route_change = (event) => {
			const view = this.view_from_route_detail(event.detail);
			if (view) this.refresh_from_route(view);
		};
		window.addEventListener("hrms:route-change", this.handle_hrms_route_change);
	}

	view_from_current_route() {
		const route = frappe.get_route ? frappe.get_route() : [];
		return this.resolve_view(route[1] || "summary");
	}

	view_from_route_detail(detail) {
		const value = String((detail && (detail.slug || detail.route)) || "");
		const normalized = value.replace(/^\/desk\/?/, "").replace(/^\/app\/?/, "").replace(/\/$/, "");
		const parts = normalized.split("/").filter(Boolean);
		if (parts[0] !== "attendance-import-center") return "";
		return this.resolve_view(parts[1] || "summary");
	}

	refresh_from_route(view = "") {
		const next_view = this.resolve_view(view || this.view_from_current_route());
		const has_body = Boolean(this.body());
		if (next_view === this.active_view && has_body) return;
		this.active_view = next_view;
		this.render();
		this.load_active_view();
	}

	resolve_view(view) {
		return this.view_map[view] || this.workflow_views.find((item) => item.key === view) ? view : "summary";
	}

	escape(value) {
		return frappe.utils.escape_html(String(value ?? ""));
	}

	render() {
		this.wrapper.innerHTML = `
			<div class="hrms-attendance-import-center">
				${this.render_header()}
				${this.render_kpi_grid()}
				${this.render_toolbar()}
				<section class="hrms-attendance-main" data-attendance-body></section>
			</div>
		`;
		this.bind_shell_events();
		this.load_dashboard_summary();
	}

	render_header() {
		return `
			<div class="hrms-attendance-import-head">
				<div>
					<h2>${this.escape(__("考勤工作台"))}</h2>
					<p>${this.escape(__("按 2号人事 的考勤统计、明细记录、考勤报表、考勤管理逻辑组织；以公司考勤、苹果树、7S、KPI资料作为规则来源。"))}</p>
				</div>
				<div class="hrms-attendance-import-controls">
					<input class="form-control" type="text" data-company data-company-context readonly aria-readonly="true" title="${this.escape(__("请在顶部公司切换器中切换公司"))}" value="${this.escape(this.company)}" placeholder="${this.escape(__("公司"))}">
					<label class="hrms-attendance-filter-control"><span>${this.escape(__("汇总月份"))}</span><input class="form-control" type="month" data-month value="${this.escape(this.attendance_month)}"></label>
					<label class="hrms-attendance-filter-control"><span>${this.escape(__("核对日期"))}</span><input class="form-control" type="date" data-attendance-date value="${this.escape(this.attendance_date)}"></label>
					<button class="btn btn-default btn-sm hrms-attendance-clear-date ${this.attendance_date ? "" : "hide"}" data-clear-attendance-date title="${this.escape(__("清除日期，查看整月"))}">×</button>
					<button class="btn btn-primary" data-upload>${this.escape(__("上传考勤文件"))}</button>
				</div>
			</div>
		`;
	}

	render_kpi_grid() {
		const cards = [
			["--", "每日考勤", "正在读取有效考勤数据", "attendance-people"],
			["--", "有效记录", "按员工和日期去重后", "total-rows"],
			["--", "正常出勤", "可进入月度复核的正常记录", "normal-rows"],
			["--", "待确认异常", "确认或驳回后才能锁定月度", "pending-exceptions"],
		];
		return `
			<div class="hrms-attendance-kpi-grid">
				${cards
					.map(
						([value, label, action, key]) => `
							<button class="hrms-attendance-kpi" data-view="${label === "每日考勤" || label === "有效记录" || label === "正常出勤" ? "daily" : label === "待确认异常" ? "exceptions" : "summary"}">
								<strong data-kpi="${key}">${this.escape(__(value))}</strong>
								<span>${this.escape(__(label))}</span>
								<small>${this.escape(__(action))}</small>
							</button>
						`,
					)
					.join("")}
			</div>
		`;
	}

	load_dashboard_summary() {
		if (!this.company) return;
		frappe.call({
			method: "hrms.api.attendance_import.get_attendance_review_dashboard",
			args: { company: this.company, attendance_month: this.attendance_month, attendance_date: this.attendance_date, batch: this.batch },
			callback: (response) => {
				const data = response.message || {};
				this.dashboard_summary = data;
				const values = {
					"attendance-people": `${data.attendance_people || 0}人`,
					"total-rows": `${data.total_rows || 0}条`,
					"normal-rows": `${data.normal_rows || 0}条`,
					"pending-exceptions": `${data.exceptions?.pending || 0}条`,
				};
				Object.entries(values).forEach(([key, value]) => {
					const target = this.wrapper.querySelector(`[data-kpi="${key}"]`);
					if (target) target.textContent = value;
				});
			},
		});
	}

	render_toolbar() {
		return `
			<div class="hrms-attendance-toolbar">
				<div>
					<button class="btn btn-default btn-sm" data-action="refresh">${this.escape(__("刷新"))}</button>
					<button class="btn btn-default btn-sm" data-view="field-rules">${this.escape(__("选择表头"))}</button>
					<button class="btn btn-default btn-sm" data-action="export">${this.escape(__("导出"))}</button>
					<button class="btn btn-default btn-sm" data-action="sort-department">${this.escape(__("按部门排序"))}</button>
				</div>
				<div>
					<button class="btn btn-primary btn-sm" data-action="add-report">${this.escape(__("添加报表"))}</button>
					<button class="btn btn-default btn-sm" data-action="subscribe">${this.escape(__("邮件订阅"))}</button>
					<button class="btn btn-default btn-sm" data-view="groups">${this.escape(__("编辑分组"))}</button>
				</div>
			</div>
		`;
	}

	render_workflow_tabs() {
		return `
			<div class="hrms-attendance-tabs">
				${this.workflow_views
					.map(
						(view) => `
							<button class="btn btn-default btn-sm ${view.key === this.active_view ? "active" : ""}" data-view="${this.escape(view.key)}">
								${this.escape(__(view.label))}
							</button>
						`,
					)
					.join("")}
			</div>
		`;
	}

	bind_shell_events() {
		this.wrapper.querySelectorAll("[data-upload]").forEach((button) => button.addEventListener("click", () => this.open_uploader()));
		this.wrapper.querySelector("[data-month]").addEventListener("change", (event) => {
			this.attendance_month = event.target.value;
			if (this.attendance_date && !this.attendance_date.startsWith(this.attendance_month)) this.attendance_date = "";
			this.batch = "";
			this.load_active_view();
		});
		this.wrapper.querySelector("[data-attendance-date]").addEventListener("change", (event) => {
			this.attendance_date = event.target.value || "";
			if (this.attendance_date) this.attendance_month = this.attendance_date.slice(0, 7);
			this.batch = "";
			this.render();
			this.load_active_view();
		});
		this.wrapper.querySelector("[data-clear-attendance-date]").addEventListener("click", () => {
			this.attendance_date = "";
			this.batch = "";
			this.render();
			this.load_active_view();
		});
		this.wrapper.querySelectorAll("[data-view]").forEach((button) => {
			button.addEventListener("click", () => this.set_view(button.dataset.view));
		});
		this.wrapper.querySelectorAll("[data-action]").forEach((button) => {
			button.addEventListener("click", () => this.handle_action(button.dataset.action));
		});
	}

	set_view(view) {
		this.active_view = this.resolve_view(view);
		this.announce_view_change(this.active_view);
		frappe.set_route("attendance-import-center", this.active_view);
		this.render();
		this.load_active_view();
	}

	announce_view_change(view) {
		if (!window.CustomEvent) return;
		const slug = `attendance-import-center/${view}`;
		window.dispatchEvent(
			new CustomEvent("hrms:route-change", {
				detail: { route: `/desk/${slug}`, slug },
			}),
		);
	}

	handle_action(action) {
		if (action === "refresh") {
			this.load_active_view();
			return;
		}
		if (action === "add-report") {
			this.set_view("reports");
			return;
		}
		if (action === "subscribe") {
			frappe.show_alert({ message: __("邮件订阅将在报表权限完善后开放"), indicator: "blue" });
			return;
		}
		frappe.show_alert({ message: __("该操作会随当前视图的数据能力逐步开放"), indicator: "gray" });
	}

	body() {
		return this.wrapper.querySelector("[data-attendance-body]");
	}

	ensure_company() {
		if (this.company) return true;
		frappe.msgprint(__("请先选择公司。"));
		return false;
	}

	load_active_view() {
		if (this.active_view === "import") return this.render_import();
		if (this.active_view === "import-batches") return this.load_attendance_import_batches();
		if (this.active_view === "daily") return this.load_daily_checks();
		if (this.active_view === "exceptions") return this.load_exceptions();
		if (this.active_view === "department-confirmations") return this.load_department_confirmations();
		if (this.active_view === "monthly") return this.load_monthly();
		if (this.active_view === "reports") return this.load_attendance_reports();
		if (this.active_view === "custom-rules") return this.load_custom_rules();
		if (this.active_view === "field-rules") return this.load_field_mapping_center();
		if (this.active_view === "rules") return this.load_attendance_rule_center();
		if (this.active_view === "leave-records") return this.load_leave_records();
		if (this.active_view === "dingtalk") return this.render_dingtalk_integration();
		if (this.active_view === "sync-logs") return this.load_dingtalk_sync_logs();
		if (["clock-records", "makeup-records", "outing-records", "trip-records", "overtime-records"].includes(this.active_view)) return this.render_detail_record_view();
		if (["groups", "schedule", "clock-settings", "settings", "apple-rules", "seven-s-rules", "kpi-rules"].includes(this.active_view)) return this.render_settings_view();
		return this.render_summary();
	}

	open_uploader() {
		new frappe.ui.FileUploader({
			folder: "Home/Attachments",
			restrictions: { allowed_file_types: [".xlsx"] },
			on_success: (file) => {
				this.file_url = file.file_url;
				this.preview_result = null;
				this.import_result = null;
				this.active_view = "import";
				this.announce_view_change(this.active_view);
				this.render();
				this.preview_attendance_workbook();
			},
		});
	}

	render_summary() {
		this.body().innerHTML = `
			<div class="hrms-attendance-section">
				<div class="hrms-attendance-list-head">
					<h3>${this.escape(__("考勤统计首页"))}</h3>
					<div><button class="btn btn-primary btn-sm" data-view="import">${this.escape(__("导入本月考勤"))}</button></div>
				</div>
				<div class="hrms-attendance-quick-grid">
					${[
						["每日考勤", "按天查看出勤结果、缺卡、迟到、早退、请假和加班。", "daily"],
						["月考勤表", "汇总标准工时、实际出勤、加班、夜班、苹果树和扣款前置项。", "monthly"],
						["部门确认", "按部门确认月度人数、出勤、请假和异常，确认后才能锁定考勤。", "department-confirmations"],
						["考勤报表", "按 2号人事 逻辑组织系统报表、自定义报表和明细报表。", "reports"],
						["自定义规则", "沉淀本公司考勤、苹果树、7S、KPI规则，后续用于自动判定。", "custom-rules"],
						["钉钉同步中心", "查看同步状态、员工映射、原始打卡记录和每日考勤草稿。", "dingtalk"],
					]
						.map(([title, desc, view]) => `<button class="hrms-attendance-quick" data-view="${view}"><strong>${this.escape(__(title))}</strong><span>${this.escape(__(desc))}</span></button>`)
						.join("")}
				</div>
			</div>
		`;
		this.body().querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => this.set_view(button.dataset.view)));
	}

	render_import(result = this.preview_result) {
		this.preview_result = result;
		const body = this.body();
		body.innerHTML = `
			<div class="hrms-attendance-section">
				<div class="hrms-attendance-list-head">
					<h3>${this.escape(__("考勤导入中心"))}</h3>
					<div><button class="btn btn-default btn-sm" data-open-import-batches>${this.escape(__("管理导入批次"))}</button> <button class="btn btn-primary btn-sm" data-upload>${this.escape(__("选择文件"))}</button></div>
				</div>
				<div class="hrms-attendance-import-panel">
					${this.render_import_template_catalog()}
					<div class="hrms-attendance-upload-box" data-upload-zone>
						<strong>${this.escape(__("上传钉钉/考勤 Excel"))}</strong>
						<span>${this.escape(__("推荐先下载“公司考勤工作簿（推荐）”。整套工作簿包含每日统计、出勤明细、出勤异常和苹果树；也可上传钉钉四表原始导出或旧版三表兼容文件。上传后先只读预览。"))}</span>
						<button class="btn btn-primary btn-sm">${this.escape(__("选择文件"))}</button>
					</div>
					<div data-preview>
						${this.import_result ? this.render_import_completion(this.import_result) : result ? this.render_preview_result(result) : `<div class="text-muted">${this.escape(__("上传后会先预览工作表和行数，不会立即写入数据。"))}</div>`}
					</div>
				</div>
			</div>
		`;
		body.querySelectorAll("[data-upload], [data-upload-zone]").forEach((button) => button.addEventListener("click", () => this.open_uploader()));
		body.querySelectorAll("[data-open-import-batches]").forEach((button) => button.addEventListener("click", () => this.set_view("import-batches")));
		body.querySelectorAll("[data-download-template]").forEach((button) => button.addEventListener("click", () => this.download_attendance_template(button.dataset.downloadTemplate)));
		const importButton = body.querySelector("[data-import]");
		if (importButton) importButton.addEventListener("click", () => this.import_attendance_workbook());
		if (!this.import_templates) this.load_attendance_import_templates();
	}

	render_import_template_catalog() {
		if (!this.import_templates) {
			return `<div class="hrms-attendance-template-catalog text-muted">${this.escape(__("正在加载可下载模板..."))}</div>`;
		}
		return `
			<div class="hrms-attendance-template-catalog">
				<div class="hrms-attendance-template-catalog__head">
					<div><strong>${this.escape(__("先下载正确格式"))}</strong><span>${this.escape(__("推荐使用整套工作簿上传；单表模板用于替换对应页签。"))}</span></div>
				</div>
				<div class="hrms-attendance-template-grid">
					${this.import_templates
						.map(
							(template) => `
								<div class="hrms-attendance-template-card ${template.upload_mode === "whole_workbook" ? "is-primary" : ""}">
									<div><strong>${this.escape(__(template.label))}</strong><small>${this.escape(__(template.upload_mode === "whole_workbook" ? "可直接上传" : "单表替换用"))}</small></div>
									<p>${this.escape(__(template.description))}</p>
									<span>${this.escape(__((template.sheet_names || []).join("、")))}</span>
									<button class="btn btn-default btn-sm" data-download-template="${this.escape(template.key)}">${this.escape(__("下载模板"))}</button>
								</div>
							`,
						)
						.join("")}
				</div>
			</div>
		`;
	}

	load_attendance_import_templates() {
		frappe.call({
			method: "hrms.api.attendance_import.list_attendance_import_templates",
			callback: (response) => {
				this.import_templates = response.message || [];
				if (this.active_view === "import") this.render_import();
			},
		});
	}

	download_attendance_template(templateKey) {
		frappe.call({
			method: "hrms.api.attendance_import.create_attendance_import_template_file",
			args: { template_key: templateKey },
			freeze: true,
			freeze_message: __("正在生成考勤模板..."),
			callback: (response) => {
				const file = response.message || {};
				if (!file.file_url) return;
				const link = document.createElement("a");
				link.href = file.file_url;
				link.download = file.file_name || "考勤导入模板.xlsx";
				link.target = "_blank";
				document.body.appendChild(link);
				link.click();
				link.remove();
				frappe.show_alert({ message: __("模板已生成，可填写后上传预览。"), indicator: "green" });
			},
		});
	}

	render_preview_result(result) {
		const dailySources = Object.values(result.daily_sources || {});
		const hasDailySources = dailySources.length > 0;
		const mappings = hasDailySources
			? dailySources.flatMap((source) =>
					Object.entries(source.field_mapping || {}).map(([from, to]) => ({ source_kind: source.source_kind, from, to })),
				)
			: Object.entries(result.field_mapping || {}).map(([from, to]) => ({ source_kind: "", from, to }));
		const sheets = hasDailySources ? dailySources : result.sheets || [];
		const warnings = result.quality_warnings || [];
		const validation = result.import_validation || {};
		const validationStatus = validation.status || ((result.missing_sheets || []).length ? "需核对" : "可导入");
		const hasImportBehavior = sheets.some((sheet) => sheet.import_behavior);
		return `
			<div class="hrms-attendance-preview">
				<h3>${this.escape(__("预览结果"))}</h3>
				<div class="mb-3"><strong>${this.escape(__("来源类型"))}：</strong>${this.escape(result.source_type || "legacy_workbook")}</div>
				<div class="hrms-attendance-validation ${validationStatus === "可导入" ? "is-ready" : "is-warning"}">
					<div><strong>${this.escape(__("字段映射与导入校验"))}</strong><span>${this.escape(__(validationStatus))}</span></div>
					<p>${this.escape(__(validation.notice || "字段映射只决定文件如何写入每日考勤核对；规则不会自动修改导入数据、月度终稿或薪资。"))}</p>
					<small>${this.escape(__("已匹配字段 {0} 个；仅留存字段 {1} 个。", [validation.matched_field_count || 0, validation.source_only_field_count || 0]))}${validation.missing_required_fields?.length ? ` ${this.escape(__("缺少必填字段：{0}", [validation.missing_required_fields.join("、")]))}` : ""}</small>
				</div>
				<table class="table table-bordered">
					<thead><tr>${hasDailySources ? `<th>${this.escape(__("数据来源"))}</th>` : ""}<th>${this.escape(__("工作表"))}</th><th>${this.escape(__("状态"))}</th><th>${this.escape(__("行数"))}</th>${hasImportBehavior ? `<th>${this.escape(__("导入处理"))}</th>` : ""}</tr></thead>
					<tbody>
						${sheets
							.map(
								(sheet) => `
									<tr>
										${hasDailySources ? `<td>${this.escape(__(sheet.source_kind === "dingtalk_raw" ? "钉钉原始导出" : "人工调整"))}</td>` : ""}
										<td>${this.escape(sheet.sheet_name)}</td>
										<td>${sheet.found === false ? this.escape(__("缺失")) : this.escape(__("已找到"))}</td>
										<td>${this.escape(sheet.row_count || 0)}</td>
										${hasImportBehavior ? `<td>${this.escape(__(sheet.import_behavior || "-"))}</td>` : ""}
									</tr>
								`,
							)
							.join("")}
					</tbody>
				</table>
				${
					mappings.length
						? `<h4>${this.escape(__("字段映射"))}</h4><table class="table table-sm"><thead><tr>${hasDailySources ? `<th>${this.escape(__("数据来源"))}</th>` : ""}<th>${this.escape(__("来源字段"))}</th><th>${this.escape(__("预览字段"))}</th></tr></thead><tbody>${mappings
								.map((mapping) => `<tr>${hasDailySources ? `<td>${this.escape(__(mapping.source_kind === "dingtalk_raw" ? "钉钉原始导出" : "人工调整"))}</td>` : ""}<td>${this.escape(mapping.from)}</td><td>${this.escape(mapping.to)}</td></tr>`)
								.join("")}</tbody></table>`
						: ""
				}
				${
					warnings.length
						? `<h4>${this.escape(__("数据质量告警"))}</h4><ul>${warnings
								.map((warning) => `<li>${this.escape(warning.label)}：${this.escape(warning.count || 0)}</li>`)
								.join("")}</ul>`
						: ""
				}
				${
					(result.missing_sheets || []).length || validationStatus !== "可导入"
						? `<div class="alert alert-warning">${this.escape((result.missing_sheets || []).length ? __("缺少工作表：{0}", [result.missing_sheets.join("、")]) : __("请先补齐必填字段映射，再确认导入。"))}</div>`
						: `<button class="btn btn-primary" data-import>${this.escape(__("确认导入每日统计"))}</button>`
				}
			</div>
		`;
	}

	render_import_completion(result) {
		const inserted = Number(result.inserted_day_checks || 0);
		const rejected = Number(result.rejected_company_or_employee_rows || 0);
		const isDuplicate = Boolean(result.duplicate);
		const referenceCounts = result.reference_only_sheet_rows || {};
		const referenceText = Object.entries(referenceCounts)
			.map(([sheet, count]) => `${sheet} ${count} ${__("行")}`)
			.join("；");
		const title = isDuplicate ? __("文件未重复写入") : inserted ? __("导入完成") : __("未写入日核对数据");
		const message = isDuplicate
			? __("该文件已有有效导入批次，系统没有重复写入。")
			: inserted
				? __("已写入 {0} 条每日考勤核对。", [inserted])
				: __("系统没有写入每日考勤核对，请查看批次中的员工匹配和字段校验结果。");
		return `
			<div class="alert ${inserted || isDuplicate ? "alert-success" : "alert-warning"}">
				<strong>${this.escape(title)}</strong>
				<p>${this.escape(message)}${rejected ? ` ${this.escape(__("另有 {0} 条因员工或公司未匹配未写入。", [rejected]))}` : ""}</p>
				<small>${this.escape(__("导入批次：{0}", [result.batch || "-"]))}${referenceText ? `；${this.escape(__("仅作核对来源：{0}", [referenceText]))}` : ""}</small>
			</div>
			<div class="hrms-attendance-import-completion-actions">
				<button class="btn btn-default btn-sm" data-open-import-batches>${this.escape(__("查看导入批次"))}</button>
				<button class="btn btn-primary btn-sm" data-upload>${this.escape(__("继续导入文件"))}</button>
			</div>
		`;
	}

	preview_attendance_workbook() {
		frappe
			.call({
				method: "hrms.api.attendance_import.preview_attendance_workbook",
				args: { file_url: this.file_url, company: this.company },
				freeze: true,
				freeze_message: __("正在预览考勤文件..."),
			})
			.then((response) => this.render_import(response.message || {}));
	}

	import_attendance_workbook() {
		if (!this.ensure_company()) return;
		frappe
			.call({
				method: "hrms.api.attendance_import.import_attendance_workbook",
				args: { file_url: this.file_url, attendance_month: this.attendance_month, company: this.company },
				freeze: true,
				freeze_message: __("正在导入考勤数据..."),
			})
			.then((response) => {
				const result = response.message || {};
				this.batch = result.batch || "";
				this.import_result = result;
				this.preview_result = null;
				this.file_url = "";
				const rejected = Number(result.rejected_company_or_employee_rows || 0);
				const inserted = Number(result.inserted_day_checks || 0);
				const isDuplicate = Boolean(result.duplicate);
				frappe.show_alert({
					message: isDuplicate
						? __("文件已有有效导入批次，未重复写入。")
						: inserted
							? __("已写入 {0} 条日核对，字段映射与校验结果已随批次留档。", [inserted])
							: __("未写入日核对数据，请查看导入批次中的校验结果。"),
					indicator: isDuplicate || inserted ? (rejected ? "orange" : "green") : "orange",
				});
				this.set_view("daily");
			});
	}

	load_attendance_import_batches() {
		this.body().innerHTML = this.render_action_bar("导入批次管理", [
			{ label: "撤回最近一次导入", action: "revoke-latest-import", primary: true },
			{ label: "前往导入中心", action: "open-import" },
		]);
		this.body().querySelector("[data-table]").insertAdjacentHTML(
			"beforebegin",
			`<div class="hrms-attendance-rule-notice"><strong>${this.escape(__("清理测试数据"))}</strong><p>${this.escape(__("撤回或批量删除会清除所选批次派生的每日核对、异常、请假证据和苹果树记录；上传文件与批次审计记录会保留。"))}</p><small>${this.escape(__("已锁定或已生成月度终稿的月份不会被清理，以免影响正式结算。请在当前公司和汇总月份范围内操作。"))}</small></div>`,
		);
		this.bind_action_bar();
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.attendance_import.list_attendance_import_batches",
			args: { company: this.company, attendance_month: this.attendance_month, page_length: 100 },
			callback: (response) => this.render_attendance_import_batches(response.message || []),
		});
	}

	render_attendance_import_batches(rows) {
		const table = this.body().querySelector("[data-table]");
		if (!table) return;
		table.innerHTML = `<div class="hrms-attendance-list-head hrms-attendance-import-batch-actions"><span class="text-muted">${this.escape(__("已显示当前公司 {0} 的导入批次。", [this.attendance_month]))}</span><button class="btn btn-default btn-sm" data-bulk-revoke-import>${this.escape(__("批量删除选中数据"))}</button></div><div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table"><thead><tr><th><input type="checkbox" data-toggle-import-batches aria-label="${this.escape(__("选择全部可清理批次"))}"></th><th>${this.escape(__("导入时间 / 批次"))}</th><th>${this.escape(__("来源"))}</th><th>${this.escape(__("状态"))}</th><th>${this.escape(__("数据影响"))}</th><th>${this.escape(__("操作"))}</th></tr></thead><tbody>${rows.length ? rows.map((row) => {
			const impact = row.impact || {};
			const impactText = __("日核对 {0}；异常 {1}；请假证据 {2}；苹果树 {3}", [impact.day_checks || 0, impact.exceptions || 0, impact.leave_evidence || 0, impact.apple_records || 0]);
			return `<tr><td><input type="checkbox" data-import-batch-checkbox="${this.escape(row.name)}" ${row.can_revoke ? "" : "disabled"}></td><td><strong>${this.escape(row.imported_on || row.creation || "-")}</strong><br><small>${this.escape(row.name)}</small></td><td>${this.escape(row.source_type || "-")}<br><small>${this.escape(row.source_file || __("无附件"))}</small></td><td><span class="hrms-attendance-status ${row.can_revoke ? "" : "is-warning"}">${this.escape(row.status || "-")}</span></td><td>${this.escape(impactText)}</td><td>${row.can_revoke ? `<button class="btn btn-default btn-xs" data-revoke-import-batch="${this.escape(row.name)}">${this.escape(__("撤回数据"))}</button>` : `<small class="text-muted">${this.escape(row.revoke_blocker || __("不可清理"))}</small>`}</td></tr>`;
		}).join("") : `<tr><td colspan="6" class="text-muted">${this.escape(__("当前公司和月份没有可管理的导入批次。"))}</td></tr>`}</tbody></table></div>`;
		table.querySelector("[data-toggle-import-batches]")?.addEventListener("change", (event) => table.querySelectorAll("[data-import-batch-checkbox]:not(:disabled)").forEach((box) => { box.checked = event.target.checked; }));
		table.querySelectorAll("[data-revoke-import-batch]").forEach((button) => button.addEventListener("click", () => this.open_attendance_import_revoke_dialog([button.dataset.revokeImportBatch])));
		table.querySelector("[data-bulk-revoke-import]")?.addEventListener("click", () => {
			const selected = Array.from(table.querySelectorAll("[data-import-batch-checkbox]:checked")).map((box) => box.dataset.importBatchCheckbox);
			if (!selected.length) return frappe.msgprint(__("请先选择至少一个可清理的导入批次。"));
			this.open_attendance_import_revoke_dialog(selected);
		});
	}

	open_attendance_import_revoke_dialog(batchNames = [], isLatest = false) {
		const selectedCount = batchNames.length;
		const dialog = new frappe.ui.Dialog({
			title: isLatest ? __("撤回最近一次导入") : __("确认批量删除导入数据"),
			fields: [
				{ fieldtype: "HTML", fieldname: "warning", options: `<div class="hrms-attendance-dialog-note"><strong>${this.escape(__("此操作会清除派生数据"))}</strong><p>${this.escape(isLatest ? __("系统将选择当前公司和月份最近一次可撤回的导入批次。") : __("将清理 {0} 个所选批次。", [selectedCount]))}</p><small>${this.escape(__("不会删除原始 Excel 文件或批次审计记录；已锁定或已有月度终稿的数据不能在此操作。"))}</small></div>` },
				{ fieldname: "reason", fieldtype: "Small Text", label: __("清理原因"), reqd: 1, default: __("清理测试导入数据") },
			],
			primary_action_label: __("确认清除"),
			primary_action: (values) => {
				const method = isLatest ? "hrms.api.attendance_import.revoke_latest_attendance_import_batch" : "hrms.api.attendance_import.bulk_revoke_attendance_import_batches";
				const args = isLatest
					? { company: this.company, attendance_month: this.attendance_month, reason: values.reason }
					: { company: this.company, batches_json: batchNames, reason: values.reason };
				frappe.call({
					method,
					args,
					freeze: true,
					freeze_message: __("正在清除导入数据..."),
					callback: (response) => {
						dialog.hide();
						const result = response.message || {};
						frappe.show_alert({ message: result.message || __("已撤回导入数据；原始文件和批次审计记录仍保留。"), indicator: "orange" });
						this.batch = "";
						this.load_dashboard_summary();
						this.load_attendance_import_batches();
					},
				});
			},
		});
		dialog.show();
	}

	open_latest_attendance_import_revoke_dialog() {
		if (!this.ensure_company()) return;
		this.open_attendance_import_revoke_dialog([], true);
	}

	load_daily_checks() {
		this.body().innerHTML = this.render_action_bar("每日考勤核对", [
			{ label: "前往导入中心", action: "open-import", primary: true },
		]);
		this.body().querySelector("[data-table]").insertAdjacentHTML(
			"beforebegin",
			`<div class="hrms-attendance-review-panel" data-daily-summary>
				<div><strong>${this.escape(this.attendance_date ? __("单日数据审查与来源") : __("整月数据审查与来源"))}</strong><span>${this.escape(this.attendance_date ? __("当前仅显示 {0}；可点击顶部 × 清除日期，恢复整月查看。", [this.attendance_date]) : __("未选择日期，当前显示整月数据；选择顶部“核对日期”可查看某一天。"))}</span></div>
				<div class="hrms-attendance-source-filters">
					<button class="btn btn-sm ${!this.daily_source ? "btn-primary" : "btn-default"}" data-daily-source="">${this.escape(__("全部有效数据"))}</button>
					<button class="btn btn-sm ${this.daily_source === "钉钉原始导出" ? "btn-primary" : "btn-default"}" data-daily-source="钉钉原始导出">${this.escape(__("钉钉导入表"))}</button>
					<button class="btn btn-sm ${this.daily_source === "人工调整" ? "btn-primary" : "btn-default"}" data-daily-source="人工调整">${this.escape(__("人工调整"))}</button>
					<button class="btn btn-sm ${this.daily_source === "钉钉API同步" ? "btn-primary" : "btn-default"}" data-daily-source="钉钉API同步">${this.escape(__("历史同步数据"))}</button>
				</div>
				<small class="text-muted">${this.escape(__("本试用版以钉钉导出的 Excel/CSV 为唯一输入。历史同步数据仅保留查阅和人工核对，不会在此页面发起 API 拉取。"))}</small>
			</div>`,
		);
		this.bind_action_bar();
		this.body().querySelectorAll("[data-daily-source]").forEach((button) =>
			button.addEventListener("click", () => {
				this.daily_source = button.dataset.dailySource || "";
				this.load_daily_checks();
			}),
		);
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.attendance_import.list_attendance_day_checks",
			args: { company: this.company, batch: this.batch, attendance_month: this.attendance_month, attendance_date: this.attendance_date, source_kind: this.daily_source || "", effective_only: this.daily_source ? 0 : 1, page_length: 200 },
			callback: (response) => this.render_daily_checks(response.message || []),
		});
		this.load_daily_review_summary();
	}

	load_daily_review_summary() {
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.attendance_import.get_attendance_review_dashboard",
			args: { company: this.company, attendance_month: this.attendance_month, attendance_date: this.attendance_date, batch: this.batch },
			callback: (response) => {
				const data = response.message || {};
				const target = this.body().querySelector("[data-daily-summary]");
				if (!target) return;
				const sources = Object.entries(data.source_counts || {}).map(([name, count]) => `${name} ${count}条`).join("；") || __("暂无数据");
				target.querySelector("div span").textContent = __("{0}有效记录 {1} 条，异常 {2} 条，未匹配 {3} 条。来源：{4}", [data.attendance_date ? `${data.attendance_date} ` : "", data.total_rows || 0, data.anomaly_rows || 0, data.unmatched_rows || 0, sources]);
			},
		});
	}

	render_daily_checks(rows) {
		const table = this.body().querySelector("[data-table]");
		if (!table) return;
		table.innerHTML = `
			<div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table">
				<thead><tr><th>${this.escape(__("员工"))}</th><th>${this.escape(__("工号"))}</th><th>${this.escape(__("日期"))}</th><th>${this.escape(__("来源"))}</th><th>${this.escape(__("班次"))}</th><th>${this.escape(__("上下班"))}</th><th>${this.escape(__("实际出勤"))}</th><th>${this.escape(__("考勤结果"))}</th><th>${this.escape(__("待核对项"))}</th><th>${this.escape(__("操作"))}</th></tr></thead>
				<tbody>${rows.length ? rows.map((row) => {
					const checks = [row.missing_in ? __("上班缺卡") : "", row.missing_out ? __("下班缺卡") : "", row.absent_hours ? __("旷工") : "", row.late_count ? __("迟到") : "", row.early_count ? __("早退") : ""].filter(Boolean).join("、") || "-";
					const adjustment = row.source_kind === "人工调整" ? ` <small class="text-muted">v${this.escape(row.correction_version || 1)}</small>` : "";
					return `<tr><td>${this.escape(row.employee_name)}</td><td>${this.escape(row.employee_code)}</td><td>${this.escape(row.attendance_date)}</td><td><span class="hrms-attendance-source">${this.escape(row.source_kind)}</span>${adjustment}</td><td>${this.escape(row.shift_name || "-")}</td><td>${this.escape(`${row.actual_in_time || "--"} / ${row.actual_out_time || "--"}`)}</td><td>${this.escape(row.actual_attendance_hours || 0)}</td><td>${this.escape(row.attendance_result || "待核对")}</td><td>${this.escape(checks)}</td><td><button class="btn btn-default btn-xs" data-day-check="${this.escape(row.name)}">${this.escape(__("核对/人工更正"))}</button></td></tr>`;
				}).join("") : `<tr><td colspan="10" class="text-muted">${this.escape(__("当前筛选下暂无每日考勤数据。"))}</td></tr>`}</tbody>
			</table></div>`;
		table.querySelectorAll("[data-day-check]").forEach((button) => button.addEventListener("click", () => this.open_day_check_review(button.dataset.dayCheck)));
	}

	open_day_check_review(name) {
		frappe.call({
			method: "hrms.api.attendance_import.get_attendance_day_check_review_context",
			args: { name },
			freeze: true,
			freeze_message: __("正在读取考勤来源..."),
			callback: (response) => {
				const context = response.message || {};
				const row = context.day_check || {};
				const source = context.raw_row || {};
				const dialog = new frappe.ui.Dialog({
					title: __("每日考勤核对与人工更正"),
					fields: [
						{ fieldtype: "HTML", fieldname: "source_note", options: `<div class="hrms-attendance-dialog-note"><strong>${this.escape(__("原始来源"))}</strong><p>${this.escape(__(context.notice || "人工更正会新增一个版本，不会覆盖或删除原始导入记录。"))}</p><small>${this.escape(__("批次：{0}；工作表：{1}；源行：{2}", [context.batch?.name || row.import_batch || "-", row.source_sheet || "-", row.source_row_number || "-"]))}</small><pre>${this.escape(JSON.stringify(source, null, 2).slice(0, 3000))}</pre></div>` },
						{ fieldname: "actual_in_time", fieldtype: "Data", label: __("实际上班时间"), default: row.actual_in_time || "" },
						{ fieldname: "actual_out_time", fieldtype: "Data", label: __("实际下班时间"), default: row.actual_out_time || "" },
						{ fieldname: "actual_attendance_hours", fieldtype: "Float", label: __("实际出勤（小时）"), default: row.actual_attendance_hours || 0 },
						{ fieldname: "attendance_result", fieldtype: "Data", label: __("考勤结果"), default: row.attendance_result || "" },
						{ fieldname: "missing_in", fieldtype: "Check", label: __("上班缺卡"), default: row.missing_in || 0 },
						{ fieldname: "missing_out", fieldtype: "Check", label: __("下班缺卡"), default: row.missing_out || 0 },
						{ fieldname: "absent_hours", fieldtype: "Float", label: __("旷工（小时）"), default: row.absent_hours || 0 },
						{ fieldname: "late_count", fieldtype: "Int", label: __("迟到次数"), default: row.late_count || 0 },
						{ fieldname: "early_count", fieldtype: "Int", label: __("早退次数"), default: row.early_count || 0 },
						{ fieldname: "reason", fieldtype: "Small Text", label: __("人工更正原因"), reqd: 1 },
					],
					primary_action_label: __("保存人工更正"),
					primary_action: (values) => {
						const { reason, ...changes } = values;
						frappe.call({
							method: "hrms.api.attendance_import.create_attendance_manual_adjustment",
							args: { name: row.name, changes, reason },
							freeze: true,
							freeze_message: __("正在创建人工更正版本..."),
							callback: (adjustment) => {
								dialog.hide();
								frappe.show_alert({ message: adjustment.message?.notice || __("已创建人工更正版本；原始记录仍保留。"), indicator: "green" });
								this.daily_source = "";
								this.load_daily_checks();
							},
						});
					},
				});
				dialog.show();
			},
		});
	}

	load_exceptions() {
		this.body().innerHTML = this.render_action_bar("考勤异常处理", []);
		this.exception_status = this.exception_status || "待确认";
		this.body().querySelector("[data-table]").insertAdjacentHTML("beforebegin", `<div class="hrms-attendance-review-panel"><div><strong>${this.escape(__("人事审核队列"))}</strong><span>${this.escape(__("确认代表异常进入月度核算；驳回代表不纳入本次月度考勤，必须保留原因。"))}</span></div><div class="hrms-attendance-source-filters">${[["待确认", "待确认"], ["", "全部"], ["已确认", "已确认"], ["已驳回", "已驳回"]].map(([value, label]) => `<button class="btn ${this.exception_status === value ? "btn-primary" : "btn-default"} btn-sm" data-exception-status="${this.escape(value)}">${this.escape(__(label))}</button>`).join("")}</div></div>`);
		this.body().querySelectorAll("[data-exception-status]").forEach((button) => button.addEventListener("click", () => { this.exception_status = button.dataset.exceptionStatus || ""; this.load_exceptions(); }));
		frappe.call({ method: "hrms.api.attendance_import.get_attendance_review_dashboard", args: { company: this.company, attendance_month: this.attendance_month, attendance_date: this.attendance_date, batch: this.batch }, callback: (response) => {
			const types = response.message?.exceptions?.by_type || {};
			const panel = this.body().querySelector(".hrms-attendance-review-panel span");
			if (panel && Object.keys(types).length) panel.textContent = __("待确认 {0} 条：{1}。确认代表异常进入月度核算；驳回必须保留原因。", [response.message.exceptions.pending || 0, Object.entries(types).map(([type, count]) => `${type} ${count}条`).join("；")]);
		} });
		frappe.call({
			method: "hrms.api.attendance_import.list_attendance_exceptions",
			args: { company: this.company, attendance_month: this.attendance_month, attendance_date: this.attendance_date, batch: this.batch, confirmation_status: this.exception_status, page_length: 200 },
			callback: (response) => this.render_exceptions(response.message || []),
		});
	}

	render_exceptions(rows) {
		const table = this.body().querySelector("[data-table]");
		if (!table) return;
		table.innerHTML = `<div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table"><thead><tr><th>${this.escape(__("员工"))}</th><th>${this.escape(__("日期"))}</th><th>${this.escape(__("异常"))}</th><th>${this.escape(__("处理规则"))}</th><th>${this.escape(__("影响"))}</th><th>${this.escape(__("状态"))}</th><th>${this.escape(__("操作"))}</th></tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td>${this.escape(`${row.employee_name || ""} ${row.employee_code || ""}`)}</td><td>${this.escape(row.attendance_date)}</td><td>${this.escape(row.exception_type)}</td><td class="hrms-attendance-long-cell">${this.escape(row.handling_method || "-")}</td><td>${this.escape(__("缺勤 {0}h / 红苹果 {1}", [row.deduct_absence_hours || 0, row.red_apple_penalty || 0]))}</td><td><span class="hrms-attendance-status ${row.confirmation_status === "待确认" ? "is-pending" : ""}">${this.escape(row.confirmation_status)}</span></td><td>${row.confirmation_status === "待确认" ? `<button class="btn btn-primary btn-xs" data-review-exception="${this.escape(row.name)}" data-decision="confirm">${this.escape(__("确认"))}</button> <button class="btn btn-default btn-xs" data-review-exception="${this.escape(row.name)}" data-decision="reject">${this.escape(__("驳回"))}</button>` : `<button class="btn btn-default btn-xs" data-review-exception="${this.escape(row.name)}" data-decision="view">${this.escape(__("查看"))}</button>`}</td></tr>`).join("") : `<tr><td colspan="7" class="text-muted">${this.escape(__("当前筛选下没有考勤异常。"))}</td></tr>`}</tbody></table></div>`;
		table.querySelectorAll("[data-review-exception]").forEach((button) => button.addEventListener("click", () => this.open_exception_review(button.dataset.reviewException, button.dataset.decision)));
	}

	open_exception_review(name, decision) {
		frappe.call({
			method: "hrms.api.attendance_import.get_attendance_exception_review_context",
			args: { name },
			callback: (response) => {
				const context = response.message || {};
				const exception = context.exception || {};
				const check = context.day_check || {};
				const isView = decision === "view";
				const dialog = new frappe.ui.Dialog({
					title: isView ? __("考勤异常审核记录") : decision === "confirm" ? __("确认考勤异常") : __("驳回考勤异常"),
					fields: [
						{ fieldtype: "HTML", fieldname: "detail", options: `<div class="hrms-attendance-review-detail"><p><b>${this.escape(exception.employee_name || "-")}</b> · ${this.escape(exception.attendance_date || "-")} · ${this.escape(exception.exception_type || "-")}</p><p>${this.escape(exception.handling_method || "")}</p><p>${this.escape(__("来源：{0}；打卡：{1} / {2}；实际出勤：{3} 小时", [check.source_kind || "-", check.actual_in_time || "--", check.actual_out_time || "--", check.actual_attendance_hours || 0]))}</p><p>${this.escape(__("当前状态：{0}", [exception.confirmation_status || "待确认"]))}</p></div>` },
						{ fieldname: "remarks", fieldtype: "Small Text", label: __("审核备注/驳回原因"), default: exception.remarks || "", reqd: decision === "reject" },
					],
					primary_action_label: isView ? __("关闭") : decision === "confirm" ? __("确认并纳入月度审核") : __("驳回本次异常"),
					primary_action: (values) => {
						if (isView) return dialog.hide();
						frappe.call({ method: "hrms.api.attendance_import.review_attendance_exception", args: { name, decision, remarks: values.remarks || "" }, freeze: true, freeze_message: __("正在保存审核结果..."), callback: () => { dialog.hide(); this.load_exceptions(); this.load_dashboard_summary(); } });
					},
				});
				dialog.show();
			},
		});
	}

	load_monthly() {
		this.body().innerHTML = this.render_action_bar("月度考勤终稿", [
			{ label: "生成月度考勤终稿", action: "generate-monthly", primary: true },
			{ label: "部门确认", action: "open-department-confirmations" },
			{ label: "锁定本月考勤", action: "lock-month" },
			{ label: "解锁本月考勤", action: "unlock-month" },
		]);
		this.bind_action_bar();
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.attendance_import.list_monthly_attendance_summary",
			args: { company: this.company, attendance_month: this.attendance_month },
			callback: (response) =>
				this.render_table("月度考勤终稿", ["姓名", "工号", "部门", "标准工时", "实际出勤", "实际打卡出勤", "应补1倍工时", "应扣2倍工时", "调整后缺勤工时", "1.5倍加班", "2倍加班", "3倍加班", "1.5倍结算", "2倍结算", "3倍结算", "夜班津贴", "全勤扣款", "旷工扣款工时", "调整后工时", "绿苹果", "红苹果", "苹果树金额"], response.message || [], (row) => [
					row.employee_name,
					row.employee_code,
					row.department,
					row.standard_hours,
					row.actual_attendance_hours,
					row.actual_clock_attendance_hours,
					row.paid_leave_makeup_hours,
					row.leave_deductible_hours,
					row.adjusted_absence_hours,
					row.overtime_1_5_hours,
					row.overtime_2_hours,
					row.overtime_3_hours,
					row.overtime_1_5_settlement_hours,
					row.overtime_2_settlement_hours,
					row.overtime_3_settlement_hours,
					row.night_shift_allowance,
					row.full_attendance_deduction,
					row.absence_deduction_hours,
					row.adjusted_working_hours,
					row.green_apples,
					row.red_apples,
					row.apple_reward_amount,
				]),
		});
	}

	load_department_confirmations() {
		this.body().innerHTML = this.render_action_bar("部门确认", [
			{ label: "刷新确认清单", action: "refresh-department-confirmations" },
			{ label: "查看月度终稿", action: "open-monthly" },
		]);
		this.body().querySelector("[data-table]").insertAdjacentHTML(
			"beforebegin",
			`<div class="hrms-attendance-review-panel"><div><strong>${this.escape(__("月度部门确认"))}</strong><span>${this.escape(__("此处按部门汇总有效日考勤。部门确认后，才可以锁定本月考勤并交接薪资；源数据变化会自动要求重新确认。"))}</span></div></div>`,
		);
		this.bind_action_bar();
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.attendance_import.list_attendance_department_confirmations",
			args: { company: this.company, attendance_month: this.attendance_month, page_length: 200 },
			callback: (response) => this.render_department_confirmations(response.message || []),
		});
	}

	render_department_confirmations(rows) {
		const table = this.body().querySelector("[data-table]");
		if (!table) return;
		table.innerHTML = `<div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table"><thead><tr><th>${this.escape(__("部门"))}</th><th>${this.escape(__("现有人数"))}</th><th>${this.escape(__("出勤人数"))}</th><th>${this.escape(__("请假人数"))}</th><th>${this.escape(__("异常人数"))}</th><th>${this.escape(__("确认状态"))}</th><th>${this.escape(__("确认信息"))}</th><th>${this.escape(__("操作"))}</th></tr></thead><tbody>${rows.length ? rows.map((row) => {
			const isPending = row.confirmation_status !== "已确认";
			const confirmation = row.confirmed_by ? `${row.confirmed_by}${row.confirmed_on ? ` · ${row.confirmed_on}` : ""}` : "-";
			return `<tr><td>${this.escape(row.department)}</td><td>${this.escape(row.current_headcount || 0)}</td><td>${this.escape(row.attendance_count || 0)}</td><td>${this.escape(row.leave_count || 0)}</td><td>${this.escape(row.exception_count || 0)}</td><td><span class="hrms-attendance-status ${isPending ? "is-pending" : ""}">${this.escape(row.confirmation_status)}</span></td><td class="hrms-attendance-long-cell">${this.escape(row.return_reason || confirmation)}</td><td>${isPending ? `<button class="btn btn-primary btn-xs" data-review-department-confirmation="${this.escape(row.name)}" data-decision="confirm">${this.escape(__("确认"))}</button> <button class="btn btn-default btn-xs" data-review-department-confirmation="${this.escape(row.name)}" data-decision="return">${this.escape(__("退回"))}</button>` : `<button class="btn btn-default btn-xs" data-open-department-confirmation="${this.escape(row.name)}">${this.escape(__("查看"))}</button>`}</td></tr>`;
		}).join("") : `<tr><td colspan="8" class="text-muted">${this.escape(__("当前月份没有可确认的部门考勤数据。请先导入或同步每日考勤。"))}</td></tr>`}</tbody></table></div>`;
		table.querySelectorAll("[data-review-department-confirmation]").forEach((button) => button.addEventListener("click", () => this.open_department_confirmation_review(button.dataset.reviewDepartmentConfirmation, button.dataset.decision)));
		table.querySelectorAll("[data-open-department-confirmation]").forEach((button) => button.addEventListener("click", () => frappe.set_route("Form", "HRMS Attendance Department Confirmation", button.dataset.openDepartmentConfirmation)));
	}

	open_department_confirmation_review(name, decision) {
		const isReturn = decision === "return";
		const dialog = new frappe.ui.Dialog({
			title: isReturn ? __("退回部门确认") : __("确认部门考勤"),
			fields: [
				{ fieldname: "remarks", fieldtype: "Small Text", label: isReturn ? __("退回原因") : __("确认备注"), reqd: isReturn },
				{ fieldname: "signoff_attachment", fieldtype: "Attach", label: __("签字凭证（可选）") },
			],
			primary_action_label: isReturn ? __("确认退回") : __("确认并纳入月结"),
			primary_action: (values) => frappe.call({
				method: "hrms.api.attendance_import.review_attendance_department_confirmation",
				args: { name, decision, remarks: values.remarks || "", signoff_attachment: values.signoff_attachment || "" },
				freeze: true,
				freeze_message: __("正在保存部门确认..."),
				callback: () => { dialog.hide(); this.load_department_confirmations(); },
			}),
		});
		dialog.show();
	}

	load_leave_records() {
		this.body().innerHTML = this.render_action_bar("请假记录", []);
		frappe.call({
			method: "hrms.api.attendance_import.list_attendance_leave_evidence",
			args: { batch: this.batch },
			callback: (response) =>
				this.render_table("请假记录", ["姓名", "部门", "请假类型", "开始时间", "结束时间", "请假时长", "审批结果", "审批状态", "有效审批"], response.message || [], (row) => [
					row.employee_name,
					row.department,
					row.leave_type,
					row.leave_start,
					row.leave_end,
					row.leave_hours,
					row.approval_result,
					row.approval_status,
					row.is_valid_approval ? "是" : "否",
				]),
		});
	}

	load_attendance_reports() {
		const reportGroups = [
			{
				title: "汇总统计表",
				reports: [
					["考勤汇总表（样式一）", "员工当月出勤、请假、外勤、出差、加班等所有考勤情况的汇总统计"],
					["异常考勤汇总表", "员工当月迟到、早退、旷工、缺卡等情况的汇总统计"],
					["补卡统计表", "员工当月补卡次数统计及补卡明细展示"],
					["加班汇总表", "员工当月节假日加班、工作日加班、周末加班的时长统计"],
				],
			},
			{
				title: "明细记录表",
				reports: [
					["打卡记录", "按员工、日期、设备、地点展示原始打卡记录"],
					["请假汇总表", "员工当月请假明细及使用调休情况的统计展示"],
					["外勤汇总表", "按部门统计当月外出、出差情况的人数和总时长"],
					["员工日出勤工时统计表", "员工的月度每日工作时长统计"],
				],
			},
			{
				title: "自定义报表",
				reports: [
					["本公司考勤终稿", "来源于 1.12考勤终稿，可按薪资前置字段调整表头"],
					["苹果树月考勤版", "来源于 4.2苹果树 与 1.9苹果树，用于月度奖惩核对"],
					["7S/KPI奖惩来源", "只显示绩效来源规则，不替代绩效模块"],
				],
			},
		];
		this.body().innerHTML = `
			<div class="hrms-attendance-section">
				<div class="hrms-attendance-list-head">
					<h3>${this.escape(__("考勤报表"))}</h3>
					<div class="hrms-attendance-report-tabs"><span>${this.escape(__("系统报表"))}</span><span>${this.escape(__("自定义报表"))}</span></div>
				</div>
				${reportGroups
					.map(
						(group) => `
							<div class="hrms-attendance-report-group">
								<h4>${this.escape(__(group.title))}</h4>
								<table class="table">
									<thead><tr><th>${this.escape(__("报表名称"))}</th><th>${this.escape(__("描述"))}</th></tr></thead>
									<tbody>${group.reports.map(([name, desc]) => `<tr><td>${this.escape(__(name))}</td><td>${this.escape(__(desc))}</td></tr>`).join("")}</tbody>
								</table>
							</div>
						`,
					)
					.join("")}
			</div>
		`;
	}

	load_custom_rules() {
		this.body().innerHTML = this.render_action_bar("自定义规则", [
			{ label: "规则中心", action: "open-rule-center" },
			{ label: "初始化公司规则", action: "seed-rules" },
			{ label: "新增规则", action: "new-rule", primary: true },
		]);
		this.bind_action_bar();
		frappe.call({
			method: "hrms.api.attendance_import.list_attendance_custom_rules",
			args: { page_length: 100 },
			callback: (response) => this.render_custom_rules(response.message || []),
		});
	}

	render_custom_rules(rows) {
		const table = this.body().querySelector("[data-table]");
		if (!table) return;
		table.innerHTML = `<div class="alert alert-info">${this.escape(__("规则仅在手工运行提示检查时产生只读核对结果。公式不会被直接执行，也不会自动改写导入数据。"))}</div><div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table"><thead><tr><th>${this.escape(__("启用"))}</th><th>${this.escape(__("规则编码"))}</th><th>${this.escape(__("规则名称"))}</th><th>${this.escape(__("分组"))}</th><th>${this.escape(__("使用方式"))}</th><th>${this.escape(__("最近提示检查/命中"))}</th><th>${this.escape(__("来源与触发条件"))}</th><th>${this.escape(__("处理建议"))}</th><th>${this.escape(__("操作"))}</th></tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td>${row.enabled ? this.escape(__("是")) : this.escape(__("否"))}</td><td>${this.escape(row.rule_code)}</td><td>${this.escape(row.rule_name)}</td><td>${this.escape(row.rule_group)}</td><td><span class="hrms-attendance-source">${this.escape(row.application_mode || "仅展示")}</span></td><td>${this.escape(`${row.last_evaluated_on || "未运行"} / ${row.last_hit_count || 0}`)}</td><td class="hrms-attendance-long-cell"><strong>${this.escape(row.source_document || "-")}</strong><br>${this.escape(row.trigger_condition || "-")}</td><td class="hrms-attendance-long-cell">${this.escape(row.action_result || "-")}</td><td><button class="btn btn-default btn-xs" data-edit-rule="${this.escape(row.rule_code)}">${this.escape(__("编辑"))}</button></td></tr>`).join("") : `<tr><td colspan="9" class="text-muted">${this.escape(__("尚无自定义规则，可初始化公司规则或新增规则。"))}</td></tr>`}</tbody></table></div>`;
		table.querySelectorAll("[data-edit-rule]").forEach((button) => button.addEventListener("click", () => this.open_rule_dialog(rows.find((rule) => rule.rule_code === button.dataset.editRule))));
	}

	open_rule_dialog(existing = {}) {
		const dialog = new frappe.ui.Dialog({
			title: existing.rule_code ? __("编辑自定义规则") : __("新增自定义规则"),
			fields: [
				{ fieldname: "rule_code", fieldtype: "Data", label: __("规则编码"), reqd: 1, default: existing.rule_code || "", read_only: Boolean(existing.rule_code) },
				{ fieldname: "rule_name", fieldtype: "Data", label: __("规则名称"), reqd: 1, default: existing.rule_name || "" },
				{ fieldname: "rule_group", fieldtype: "Select", label: __("规则分组"), options: "考勤\n苹果树\n7S\nKPI\n钉钉\n薪资前置\n其他", default: existing.rule_group || "考勤" },
				{ fieldname: "rule_type", fieldtype: "Data", label: __("规则类型"), default: existing.rule_type || "" },
				{ fieldname: "application_mode", fieldtype: "Select", label: __("使用方式"), options: "仅展示\n导入校验\n异常提示", default: existing.application_mode || "仅展示", description: __("仅“异常提示”可由人事手工运行；不会自动生成扣款或改写导入数据。") },
				{ fieldname: "source_module", fieldtype: "Data", label: __("来源模块"), default: existing.source_module || "" },
				{ fieldname: "source_document", fieldtype: "Small Text", label: __("来源文件/表单"), default: existing.source_document || "" },
				{ fieldname: "trigger_condition", fieldtype: "Small Text", label: __("触发条件"), default: existing.trigger_condition || "" },
				{ fieldname: "formula", fieldtype: "Code", label: __("计算公式/表达式"), default: existing.formula || "" },
				{ fieldname: "action_result", fieldtype: "Small Text", label: __("处理结果"), default: existing.action_result || "" },
				{ fieldname: "remarks", fieldtype: "Small Text", label: __("备注"), default: existing.remarks || "" },
				{ fieldname: "enabled", fieldtype: "Check", label: __("启用"), default: existing.enabled ?? 1 },
			],
			primary_action_label: __("保存"),
			primary_action: (values) => {
				frappe.call({
					method: "hrms.api.attendance_import.upsert_attendance_custom_rule",
					args: { rule: values },
					callback: () => {
						dialog.hide();
						this.load_custom_rules();
					},
				});
			},
		});
		dialog.show();
	}

	load_field_mapping_center() {
		this.body().innerHTML = this.render_action_bar("字段管理", [{ label: "前往导入中心", action: "open-import" }]);
		this.bind_action_bar();
		frappe.call({
			method: "hrms.api.attendance_import.get_attendance_field_mapping_catalog",
			callback: (response) => this.render_field_mapping_center(response.message || {}),
		});
	}

	render_field_mapping_center(catalog) {
		const table = this.body().querySelector("[data-table]");
		if (!table) return;
		table.innerHTML = `<div class="hrms-attendance-rule-notice"><strong>${this.escape(__("字段映射与导入校验"))}</strong><p>${this.escape(__(catalog.notice || "导入前预览字段映射，确认后再写入每日考勤核对。"))}</p><small>${this.escape(__(catalog.write_policy || "只读说明，不写入考勤数据"))}</small></div><div class="hrms-attendance-quick-grid">${(catalog.profiles || []).map((profile) => `<div class="hrms-attendance-quick"><strong>${this.escape(profile.label)}</strong><span>${this.escape(__("工作表：{0}", [(profile.source_sheets || []).join("、")]))}</span><small>${this.escape(__("必填：{0}", [(profile.required_target_fields || []).join("、")]))}</small></div>`).join("")}</div><div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table"><thead><tr><th>${this.escape(__("系统字段"))}</th><th>${this.escape(__("显示名称"))}</th><th>${this.escape(__("导入要求"))}</th></tr></thead><tbody>${(catalog.fields || []).map((field) => `<tr><td>${this.escape(field.fieldname)}</td><td>${this.escape(field.label)}</td><td>${this.escape(field.required ? __("必填") : __("可选"))}</td></tr>`).join("")}</tbody></table></div>`;
	}

	load_attendance_rule_center() {
		this.body().innerHTML = this.render_action_bar("考勤规则", [{ label: "运行提示检查", action: "evaluate-rules", primary: true }, { label: "维护规则", action: "open-custom-rules" }]);
		this.bind_action_bar();
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.attendance_import.get_attendance_rule_usage_summary",
			args: { company: this.company, attendance_month: this.attendance_month },
			callback: (response) => this.render_attendance_rule_center(response.message || {}),
		});
	}

	render_attendance_rule_center(summary) {
		const table = this.body().querySelector("[data-table]");
		if (!table) return;
		const modeCount = (mode) => summary.mode_counts?.[mode] || 0;
		const currentScope = summary.attendance_date || this.attendance_date || __("整月");
		table.innerHTML = `<div class="hrms-attendance-rule-notice"><strong>${this.escape(__("规则使用边界"))}</strong><p>${this.escape(__(summary.execution_notice || "规则不会自动修改导入数据、月度终稿或薪资。"))}</p><small>${this.escape(__("当前范围：{0} / {1} / {2}；有效日核对 {3} 条。只有受控的内置异常提示规则会读取这些记录，自定义公式只作为制度说明保存。", [summary.company || this.company || "-", summary.attendance_month || this.attendance_month, currentScope, summary.effective_day_check_count || 0]))}</small></div><div class="hrms-attendance-kpi-grid hrms-attendance-rule-kpis"><div class="hrms-attendance-kpi"><strong>${this.escape(summary.enabled_rules || 0)}</strong><span>${this.escape(__("已启用规则"))}</span><small>${this.escape(__("不等于自动执行"))}</small></div><div class="hrms-attendance-kpi"><strong>${this.escape(summary.executable_rule_count || 0)}</strong><span>${this.escape(__("可运行提示"))}</span><small>${this.escape(__("有受控执行器"))}</small></div><div class="hrms-attendance-kpi"><strong>${this.escape(modeCount("仅展示"))}</strong><span>${this.escape(__("仅展示"))}</span><small>${this.escape(__("制度与来源说明"))}</small></div><div class="hrms-attendance-kpi"><strong>${this.escape(modeCount("导入校验"))}</strong><span>${this.escape(__("导入校验"))}</span><small>${this.escape(__("字段映射与质量"))}</small></div></div><div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table"><thead><tr><th>${this.escape(__("规则与来源"))}</th><th>${this.escape(__("使用方式"))}</th><th>${this.escape(__("可执行性"))}</th><th>${this.escape(__("最近检查范围 / 命中"))}</th><th>${this.escape(__("处理建议"))}</th><th>${this.escape(__("操作"))}</th></tr></thead><tbody>${(summary.rules || []).map((rule) => `<tr><td><strong>${this.escape(rule.rule_name)}</strong><br><small>${this.escape(rule.rule_code)} · ${this.escape(rule.source_document || __("未填写来源"))}</small></td><td>${this.escape(rule.application_mode || "仅展示")}</td><td><strong>${this.escape(rule.execution_status || __("待识别"))}</strong><br><small>${this.escape(rule.execution_description || "-")}</small></td><td>${this.escape(rule.last_evaluated_on || __("未运行"))}<br><strong>${this.escape(__("命中 {0} 条", [rule.last_hit_count || 0]))}</strong><br><small>${this.escape(this.rule_evaluation_scope_text(rule.last_evaluation_summary))}</small></td><td class="hrms-attendance-long-cell">${this.escape(rule.action_result || "-")}</td><td>${rule.execution_status === "可运行" ? `<button class="btn btn-default btn-xs" data-rule-hits="${this.escape(rule.rule_code)}">${this.escape(__("查看命中"))}</button>` : `<button class="btn btn-default btn-xs" data-edit-rule-from-center="${this.escape(rule.rule_code)}">${this.escape(__("查看规则"))}</button>`}</td></tr>`).join("") || `<tr><td colspan="6" class="text-muted">${this.escape(__("暂无规则，请先初始化或新增规则。"))}</td></tr>`}</tbody></table></div>`;
		table.querySelectorAll("[data-rule-hits]").forEach((button) => button.addEventListener("click", () => this.open_rule_hit_list(button.dataset.ruleHits)));
		table
			.querySelectorAll("[data-edit-rule-from-center]")
			.forEach((button) => button.addEventListener("click", () => this.open_custom_rule_from_center(button.dataset.editRuleFromCenter)));
	}

	rule_evaluation_scope_text(serialized) {
		if (!serialized) return __("尚无检查范围");
		try {
			const scope = JSON.parse(serialized);
			return __("{0} · 有效记录 {1} 条", [scope.attendance_date || "-", scope.effective_day_checks || 0]);
		} catch (error) {
			return serialized;
		}
	}

	open_custom_rule_from_center(ruleCode) {
		frappe.call({
			method: "hrms.api.attendance_import.list_attendance_custom_rules",
			args: { page_length: 200 },
			callback: (response) => this.open_rule_dialog((response.message || []).find((rule) => rule.rule_code === ruleCode) || {}),
		});
	}

	open_rule_hit_list(ruleCode) {
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.attendance_import.get_attendance_rule_hits",
			args: { company: this.company, attendance_month: this.attendance_month, attendance_date: this.attendance_date, rule_code: ruleCode, page_length: 200 },
			freeze: true,
			freeze_message: __("正在读取规则命中明细..."),
			callback: (response) => {
				const result = response.message || {};
				const hits = result.hits || [];
				const dialog = new frappe.ui.Dialog({
					title: __("{0} · 命中明细", [result.rule?.rule_name || ruleCode]),
					fields: [{ fieldtype: "HTML", fieldname: "rule_hits", options: `<div class="hrms-attendance-dialog-note"><p>${this.escape(__(result.notice || ""))}</p><small>${this.escape(__("范围：{0} / {1}；有效日核对 {2} 条，命中 {3} 条。", [result.attendance_month || this.attendance_month, result.attendance_date || "整月", result.effective_day_check_count || 0, hits.length]))}</small></div><div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table"><thead><tr><th>${this.escape(__("员工"))}</th><th>${this.escape(__("日期"))}</th><th>${this.escape(__("命中依据"))}</th><th>${this.escape(__("来源"))}</th><th>${this.escape(__("操作"))}</th></tr></thead><tbody>${hits.length ? hits.map((hit) => `<tr><td>${this.escape(`${hit.employee_name || "-"} ${hit.employee_code || ""}`)}</td><td>${this.escape(hit.attendance_date || "-")}</td><td>${this.escape(hit.reason || "-")}</td><td>${this.escape(hit.source_kind || "-")}</td><td><button class="btn btn-default btn-xs" data-rule-day-check="${this.escape(hit.day_check)}">${this.escape(__("打开日核对"))}</button></td></tr>`).join("") : `<tr><td colspan="5" class="text-muted">${this.escape(__("当前范围没有命中记录。"))}</td></tr>`}</tbody></table></div>` }],
					primary_action_label: __("关闭"),
					primary_action: () => dialog.hide(),
				});
				dialog.show();
				dialog.$wrapper.find("[data-rule-day-check]").on("click", (event) => this.open_day_check_review(event.currentTarget.dataset.ruleDayCheck));
			},
		});
	}

	run_attendance_rule_evaluation() {
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.attendance_import.evaluate_attendance_rules",
			args: { company: this.company, attendance_month: this.attendance_month, attendance_date: this.attendance_date },
			freeze: true,
			freeze_message: __("正在运行只读提示检查..."),
			callback: (response) => {
				const result = response.message || {};
				const hits = (result.results || []).filter((item) => item.status === "已提示").reduce((total, item) => total + Number(item.hit_count || 0), 0);
				frappe.show_alert({ message: __("已运行 {0} 条提示规则，发现 {1} 个需核对项；未改写任何导入数据。", [result.rules_evaluated || 0, hits]), indicator: "blue" });
				this.load_attendance_rule_center();
			},
		});
	}

	render_detail_record_view() {
		const title = this.view_map[this.active_view].label;
		const approvalTypes = {
			"makeup-records": "补卡",
			"outing-records": "外出",
			"trip-records": "出差",
			"overtime-records": "加班",
		};
		const isClockRecord = this.active_view === "clock-records";
		this.body().innerHTML = this.render_action_bar(title, [
			{ label: "钉钉同步日期", action: "dingtalk-sync", primary: true },
			{ label: "同步记录", action: "open-sync-logs" },
			{ label: "查看钉钉同步中心", action: "open-dingtalk" },
		]);
		const table = this.body().querySelector("[data-table]");
		table.insertAdjacentHTML(
			"beforebegin",
			`<div class="alert alert-info mb-3">${this.escape(
				isClockRecord
					? __("这里显示已同步到系统的钉钉打卡明细；原始数据仍可在钉钉原始记录中追溯。")
					: __("这里显示已配置审批流程编码且已同步的钉钉审批明细；未配置流程编码时不会把审批数据误写入考勤。"),
			)}</div>`,
		);
		this.bind_action_bar();
		if (isClockRecord) this.load_dingtalk_clock_records();
		else this.load_dingtalk_approval_records(approvalTypes[this.active_view]);
	}

	load_dingtalk_clock_records() {
		if (!this.ensure_company()) return;
		const table = this.body().querySelector("[data-table]");
		table.insertAdjacentHTML("beforebegin", `<div class="hrms-attendance-review-panel" data-clock-quality><div><strong>${this.escape(__("钉钉打卡数据质量"))}</strong><span>${this.escape(__("正在核对 API 原始记录是否含有可用的上下班打卡事件..."))}</span></div></div>`);
		frappe.call({
			method: "hrms.api.dingtalk_integration.get_dingtalk_clock_record_summary",
			args: { company: this.company, attendance_month: this.attendance_month, work_date: this.attendance_date },
			callback: (response) => {
				const quality = response.message || {};
				const target = this.body().querySelector("[data-clock-quality]");
				if (!target) return;
				target.classList.toggle("is-warning", !quality.usable_for_daily_review);
				target.querySelector("div span").textContent = __("原始响应 {0} 条；含可用打卡明细 {1} 条；可解析打卡事件 {2} 条；空明细 {3} 条。{4}", [quality.raw_records || 0, quality.usable_records || 0, quality.punch_events || 0, quality.empty_detail_records || 0, quality.message || ""]);
			},
		});
		frappe.call({
			method: "hrms.api.dingtalk_integration.list_dingtalk_clock_records",
			args: { company: this.company, attendance_month: this.attendance_month, work_date: this.attendance_date, page_length: 200 },
			callback: (response) =>
				this.render_table("打卡记录", ["姓名", "工号", "部门", "映射状态", "日期", "打卡时间", "类型", "结果", "地点", "设备", "来源"], response.message || [], (row) => [
					row.employee_name,
					row.employee_code,
					row.department,
					row.mapping_status,
					row.attendance_date,
					row.check_time,
					row.check_type,
					row.time_result,
					row.location,
					row.device,
					row.source,
				]),
		});
	}

	load_dingtalk_approval_records(approvalType) {
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.dingtalk_integration.list_dingtalk_approval_records",
			args: { company: this.company, attendance_month: this.attendance_month, approval_type: approvalType, page_length: 200 },
			callback: (response) =>
				this.render_table(`${approvalType}记录`, ["姓名", "工号", "部门", "映射状态", "业务日期", "审批类型", "审批状态", "流程编码", "审批单号"], response.message || [], (row) => [
					row.employee_name,
					row.employee_code,
					row.department,
					row.mapping_status,
					row.business_date,
					row.approval_type,
					row.approval_status,
					row.process_code,
					row.approval_no,
				]),
		});
	}

	render_settings_view() {
		const title = this.view_map[this.active_view].label;
		const descriptions = {
			"field-rules": "维护考勤统计字段、表头顺序和公式字段，例如出勤时长、夜班津贴、调整后工时。",
			groups: "按部门/班制设置考勤组，关联出勤日、休息日、排班和适用人员。",
			schedule: "承接排班管理，后续与班次计划和钉钉班次同步。",
			rules: "维护迟到、早退、旷工、缺卡、未申请加班等判定规则。",
			"clock-settings": "配置钉钉打卡机、移动打卡、地点范围和设备来源。",
			settings: "配置考勤月份、审批过滤、导入模板、月度确认流程。",
			"apple-rules": "展示 4.2苹果树 中绿苹果、红苹果和钉钉苹果树导出的规则来源。",
			"seven-s-rules": "展示 4.3 7S 稽核、整改、得分汇总与奖惩来源。",
			"kpi-rules": "展示 4.4 KPI 中月会资料提交、经营月报、重要指标达成的奖惩来源。",
		};
		this.body().innerHTML = this.render_placeholder(title, descriptions[this.active_view] || "配置项将在后续分阶段开放。", "custom-rules");
		this.body().querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => this.set_view(button.dataset.view)));
	}

	render_dingtalk_integration() {
		this.body().innerHTML = `
			<div class="hrms-attendance-section hrms-attendance-integration">
				<div class="hrms-attendance-list-head">
					<h3>${this.escape(__("钉钉打卡对接"))}</h3>
					<div>
						<button class="btn btn-default btn-sm" data-action="dingtalk-settings">${this.escape(__("配置钉钉"))}</button>
						<button class="btn btn-default btn-sm" data-action="dingtalk-directory">${this.escape(__("同步组织和员工"))}</button>
						<button class="btn btn-primary btn-sm" data-action="dingtalk-sync">${this.escape(__("手工同步日期"))}</button>
						<button class="btn btn-default btn-sm" data-action="open-sync-logs">${this.escape(__("同步记录"))}</button>
					</div>
				</div>
				<div class="alert alert-info">${this.escape(__("钉钉数据不会直接改员工主档、月度锁定记录或薪资。先同步组织与员工并核对映射，再同步某一天的考勤，系统才会生成可复核的每日考勤草稿。"))}</div>
				<div class="hrms-dingtalk-sync-progress" data-dingtalk-progress hidden></div>
				<div class="hrms-attendance-quick-grid" data-dingtalk-status><div class="text-muted">${this.escape(__("正在读取钉钉同步状态..."))}</div></div>
				<div class="hrms-attendance-import-panel mt-3">
					<h4>${this.escape(__("使用顺序"))}</h4>
					<p>${this.escape(__("1. 同步组织和员工 → 2. 在员工映射中处理待匹配/冲突 → 3. 手工同步一个日期 → 4. 到每日考勤核对查看草稿 → 5. 处理异常 → 6. 生成并锁定月度终稿。"))}</p>
					<div>
						<button class="btn btn-default btn-sm" data-action="open-mappings">${this.escape(__("查看员工映射"))}</button>
						<button class="btn btn-default btn-sm" data-action="open-logs">${this.escape(__("刷新同步状态"))}</button>
						<button class="btn btn-default btn-sm" data-action="open-sync-logs">${this.escape(__("查看同步记录"))}</button>
						<button class="btn btn-default btn-sm" data-action="open-raw">${this.escape(__("查看原始记录"))}</button>
						<button class="btn btn-default btn-sm" data-view="clock-records">${this.escape(__("查看打卡记录"))}</button>
					</div>
				</div>
			</div>
		`;
		this.body().querySelector("[data-action='dingtalk-settings']").addEventListener("click", () => frappe.set_route("hr-settings-center", "dingtalk-integration"));
		this.body().querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => this.set_view(button.dataset.view)));
		this.body().querySelector("[data-action='dingtalk-sync']").addEventListener("click", () => this.sync_dingtalk_attendance_for_date());
		this.body().querySelector("[data-action='dingtalk-directory']").addEventListener("click", () => this.sync_dingtalk_directory());
		this.body().querySelector("[data-action='open-mappings']").addEventListener("click", () => frappe.set_route("List", "HRMS DingTalk User Map"));
		this.body().querySelector("[data-action='open-logs']").addEventListener("click", () => this.load_dingtalk_status());
		this.body().querySelectorAll("[data-action='open-sync-logs']").forEach((button) => button.addEventListener("click", () => this.set_view("sync-logs")));
		this.body().querySelector("[data-action='open-raw']").addEventListener("click", () => frappe.set_route("List", "HRMS DingTalk Raw Record"));
		this.load_dingtalk_status();
	}

	set_dingtalk_sync_progress(state) {
		this.dingtalk_sync_state = state;
		const panel = this.body()?.querySelector("[data-dingtalk-progress]");
		if (!panel) return;
		const steps = ["连接检查", "组织同步", "员工同步", "映射汇总"];
		const current = Math.max(0, steps.indexOf(state.step));
		const progress = state.done ? 100 : Math.round((current / (steps.length - 1)) * 100);
		panel.hidden = false;
		panel.innerHTML = `
			<div class="hrms-dingtalk-sync-progress-head">
				<div><strong class="${state.failed ? "is-failed" : state.done ? "is-done" : "is-running"}">${this.escape(state.title || __("钉钉同步"))}</strong><span>${this.escape(state.message || "")}</span></div>
				<span class="hrms-dingtalk-sync-progress-percent">${progress}%</span>
			</div>
			<div class="hrms-dingtalk-progress-track"><i style="width:${progress}%"></i></div>
			<div class="hrms-dingtalk-sync-steps">${steps
				.map((step, index) => `<span class="${index < current || state.done ? "is-complete" : index === current && !state.done ? "is-active" : ""}"><b>${index + 1}</b>${this.escape(__(step))}</span>`)
				.join("")}</div>
			${state.summary ? `<div class="hrms-dingtalk-sync-summary">${this.escape(state.summary)}</div>` : ""}
			${state.error ? `<div class="hrms-dingtalk-sync-error">${this.escape(state.error)}</div>` : ""}`;
		this.body().querySelectorAll("[data-action='dingtalk-directory'], [data-action='dingtalk-sync']").forEach((button) => {
			button.disabled = !state.done && !state.failed;
		});
	}

	read_dingtalk_error(response) {
		const messages = response?._server_messages;
		if (!messages) return response?.message || __("同步请求失败，请查看最近同步日志。");
		try {
			const parsed = JSON.parse(messages);
			return parsed.map((item) => JSON.parse(item).message || item).join("；");
		} catch (error) {
			return String(messages);
		}
	}

	load_dingtalk_status() {
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.dingtalk_integration.get_dingtalk_attendance_hub_status",
			args: { company: this.company, attendance_month: this.attendance_month },
			callback: (response) => this.render_dingtalk_status(response.message || {}),
		});
	}

	render_dingtalk_status(status) {
		const target = this.body().querySelector("[data-dingtalk-status]");
		if (!target) return;
		const connection = status.connection || {};
		const raw = status.raw_records || {};
		const mappings = status.mappings || {};
		const attendance = status.attendance || {};
		const cards = [
			[connection.enabled && connection.api_mode ? "已连接" : "未启用", "连接状态", connection.configured ? "已保存应用凭证" : "请先完成钉钉配置"],
			[`${raw.department || 0} / ${raw.user || 0}`, "组织 / 员工原始记录", `已映射 ${mappings.matched || 0}，待处理 ${mappings.pending || 0}`],
			[raw.attendance || 0, "钉钉考勤原始记录", `本月草稿 ${attendance.daily_drafts || 0} 条`],
			[attendance.exceptions || 0, "本月考勤异常", connection.daily_sync_enabled ? "每日自动同步已启用" : "每日自动同步未启用"],
		];
		target.innerHTML = `${cards
			.map(([value, label, note]) => `<div class="hrms-attendance-kpi"><strong>${this.escape(value)}</strong><span>${this.escape(__(label))}</span><small>${this.escape(note)}</small></div>`)
			.join("")}
			<div class="hrms-attendance-import-panel" style="grid-column: 1 / -1">
				<h4>${this.escape(__("最近同步日志"))}</h4>
				${
					(status.logs || []).length
						? `<table class="table table-sm"><thead><tr><th>${this.escape(__("类型"))}</th><th>${this.escape(__("业务日期"))}</th><th>${this.escape(__("状态"))}</th><th>${this.escape(__("接收/新建/失败"))}</th><th>${this.escape(__("说明"))}</th><th>${this.escape(__("完成时间"))}</th></tr></thead><tbody>${status.logs
								.map((log) => `<tr class="${log.status === "失败" || log.status === "部分失败" ? "hrms-dingtalk-log-failed" : ""}"><td>${this.escape(log.sync_type)}</td><td>${this.escape(log.business_date || "-")}</td><td>${this.escape(log.status)}</td><td>${this.escape(`${log.records_received || 0} / ${log.records_created || 0} / ${log.records_failed || 0}`)}</td><td title="${this.escape(log.error_message || "")}">${this.escape(log.error_message || "-")}</td><td>${this.escape(log.finished_at || log.started_at || "-")}</td></tr>`)
								.join("")}</tbody></table>`
						: `<div class="text-muted">${this.escape(__("尚未产生同步日志。请先完成钉钉配置并同步组织和员工。"))}</div>`
				}
			</div>`;
	}

	sync_dingtalk_directory() {
		if (!this.ensure_company()) return;
		this.set_dingtalk_sync_progress({ step: "连接检查", title: __("正在连接钉钉"), message: __("正在验证应用凭证并准备同步范围..."), summary: __("请保持当前页面打开；每个阶段完成后会显示实际数量。") });
		frappe.call({
			method: "hrms.api.dingtalk_integration.sync_departments_from_dingtalk",
			args: { company: this.company },
			callback: (response) => {
				const departments = response.message || {};
				if (departments.failed) {
					this.set_dingtalk_sync_progress({ step: "组织同步", title: __("组织同步部分失败"), message: __("已停止员工同步，避免在组织数据不完整时建立错误映射。"), failed: true, summary: __("已接收 {0} 条，失败 {1} 条。", [departments.received || 0, departments.failed || 0]), error: departments.error_message || __("请查看最近同步日志中的失败原因。") });
					this.load_dingtalk_status();
					return;
				}
				this.set_dingtalk_sync_progress({ step: "员工同步", title: __("组织同步完成，正在同步员工"), message: __("组织记录已接收 {0} 条；正在按部门拉取员工并建立待核对映射。", [departments.received || 0]), summary: __("组织同步完成：{0} 条。", [departments.received || 0]) });
				this.sync_dingtalk_users_after_departments(departments);
			},
			error: (response) => {
				this.set_dingtalk_sync_progress({ step: "组织同步", title: __("组织同步失败"), message: __("没有继续同步员工。"), failed: true, error: this.read_dingtalk_error(response) });
				this.load_dingtalk_status();
			},
		});
	}

	sync_dingtalk_users_after_departments(departments) {
		frappe.call({
			method: "hrms.api.dingtalk_integration.sync_users_from_dingtalk",
			args: { company: this.company },
			callback: (response) => {
				const users = response.message || {};
				const failed = Number(users.failed || 0);
				this.set_dingtalk_sync_progress({
					step: "映射汇总",
					title: failed ? __("员工同步部分失败") : __("组织与员工同步完成"),
					message: failed ? __("已保留成功记录，失败记录不会写入员工主档。") : __("请进入员工映射，核对待匹配或冲突记录。"),
					done: !failed,
					failed: Boolean(failed),
					summary: __("组织 {0} 条；员工接收 {1} 条；失败 {2} 条。", [departments.received || 0, users.received || 0, failed]),
					error: users.error_message || "",
				});
				this.load_dingtalk_status();
			},
			error: (response) => {
				this.set_dingtalk_sync_progress({ step: "员工同步", title: __("员工同步失败"), message: __("组织记录已保留；没有生成新的员工映射。"), failed: true, error: this.read_dingtalk_error(response) });
				this.load_dingtalk_status();
			},
		});
	}

	sync_dingtalk_attendance_for_date() {
		if (!this.ensure_company()) return;
		frappe.prompt(
			[{ fieldname: "work_date", fieldtype: "Date", label: __("同步考勤日期"), default: this.attendance_date || frappe.datetime.add_days(frappe.datetime.get_today(), -1), reqd: 1 }],
			(values) => this.run_dingtalk_attendance_sync(values.work_date),
			__("手工同步钉钉考勤"),
			__("开始同步"),
		);
	}

	set_attendance_sync_progress(state) {
		const body = this.body();
		if (!body) return;
		let panel = body.querySelector("[data-attendance-sync-progress]");
		if (!panel) {
			body.insertAdjacentHTML("afterbegin", `<div class="hrms-dingtalk-sync-progress" data-attendance-sync-progress></div>`);
			panel = body.querySelector("[data-attendance-sync-progress]");
		}
		const steps = ["连接检查", "拉取原始数据", "校验打卡明细", "生成每日草稿", "生成异常队列"];
		const current = Math.max(0, steps.indexOf(state.step));
		const progress = state.done ? 100 : Math.round((current / (steps.length - 1)) * 100);
		panel.innerHTML = `<div class="hrms-dingtalk-sync-progress-head"><div><strong class="${state.failed ? "is-failed" : state.done ? "is-done" : "is-running"}">${this.escape(state.title || __("钉钉考勤同步"))}</strong><span>${this.escape(state.message || "")}</span></div><div class="hrms-attendance-sync-actions"><span class="hrms-dingtalk-sync-progress-percent">${progress}%</span>${state.sync_log && !state.done && !state.failed ? `<button class="btn btn-default btn-xs" data-cancel-dingtalk-sync="${this.escape(state.sync_log)}" title="${this.escape(__("撤销本次同步"))}">× ${this.escape(__("撤销"))}</button>` : ""}</div></div><div class="hrms-dingtalk-progress-track"><i style="width:${progress}%"></i></div><div class="hrms-dingtalk-sync-steps hrms-attendance-sync-steps">${steps.map((step, index) => `<span class="${index < current || state.done ? "is-complete" : index === current && !state.done ? "is-active" : ""}"><b>${index + 1}</b>${this.escape(__(step))}</span>`).join("")}</div>${state.summary ? `<div class="hrms-dingtalk-sync-summary">${this.escape(state.summary)}</div>` : ""}${state.error ? `<div class="hrms-dingtalk-sync-error">${this.escape(state.error)}</div>` : ""}`;
		panel.querySelectorAll("[data-cancel-dingtalk-sync]").forEach((button) => button.addEventListener("click", () => this.cancel_dingtalk_attendance_sync(button.dataset.cancelDingtalkSync)));
	}

	run_dingtalk_attendance_sync(workDate) {
		this.attendance_date = workDate;
		this.attendance_month = String(workDate).slice(0, 7);
		this.batch = "";
		this.set_attendance_sync_progress({ step: "连接检查", title: __("正在提交钉钉考勤同步"), message: __("任务提交后可关闭页面；服务器会在后台继续处理，不会修改员工主档或薪资。") });
		frappe.call({
			method: "hrms.api.dingtalk_integration.queue_dingtalk_attendance_sync",
			args: { work_date: workDate, company: this.company },
			callback: (response) => {
				const queued = response.message || {};
				this.last_sync_log = queued.sync_log || "";
				this.set_attendance_sync_progress({ step: "连接检查", title: __("钉钉考勤已进入后台队列"), message: __("可继续浏览其他页面；完成后可在“钉钉同步记录”定位本次日期。"), sync_log: this.last_sync_log, summary: __("同步日期：{0}", [workDate]) });
				this.watch_dingtalk_attendance_sync(this.last_sync_log, workDate);
			},
			error: (error) => this.set_attendance_sync_progress({ step: "连接检查", title: __("钉钉考勤提交失败"), failed: true, error: this.read_dingtalk_error(error) }),
		});
	}

	watch_dingtalk_attendance_sync(syncLog, workDate, attempt = 0) {
		if (!syncLog || attempt > 300) return;
		frappe.call({
			method: "hrms.api.dingtalk_integration.list_dingtalk_attendance_sync_runs",
			args: { company: this.company, work_date: workDate, page_length: 20 },
			callback: (response) => {
				const run = (response.message || []).find((item) => item.name === syncLog);
				if (!run) return setTimeout(() => this.watch_dingtalk_attendance_sync(syncLog, workDate, attempt + 1), 2000);
				const status = run.status || "已排队";
				const summary = __("接收 {0}；新建草稿 {1}；更新 {2}；失败 {3}。", [run.records_received || 0, run.records_created || 0, run.records_updated || 0, run.records_failed || 0]);
				if (["已排队", "运行中", "取消请求"].includes(status)) {
					this.set_attendance_sync_progress({ step: status === "已排队" ? "连接检查" : "拉取原始数据", title: status === "取消请求" ? __("正在撤销钉钉同步") : __("正在后台同步钉钉考勤"), message: status === "取消请求" ? __("正在结束当前请求；原始审计记录会保留。") : __("正在拉取原始数据并转换为可审核草稿。"), sync_log: syncLog, summary });
					return setTimeout(() => this.watch_dingtalk_attendance_sync(syncLog, workDate, attempt + 1), 2000);
				}
				this.last_sync_batch = run.batch || "";
				const cancelled = status === "已撤销";
				const failed = ["失败", "部分失败"].includes(status);
				this.set_attendance_sync_progress({ step: cancelled || failed ? "拉取原始数据" : "生成异常队列", title: cancelled ? __("本次钉钉同步已撤销") : failed ? __("钉钉同步未完成") : __("钉钉考勤同步完成，等待人事审核"), done: !failed, failed, message: cancelled ? __("已撤销本次生成的考勤草稿；原始数据保留用于审计。") : failed ? __("请在同步记录查看失败原因；不会影响月度或薪资。") : __("已生成可按日期查看的每日考勤草稿和异常审核队列。"), summary, error: failed ? run.error_message || "" : "" });
				this.load_dashboard_summary();
				if (["daily", "exceptions", "clock-records"].includes(this.active_view)) this.load_active_view();
			},
		});
	}

	cancel_dingtalk_attendance_sync(syncLog) {
		if (!syncLog) return;
		frappe.confirm(__("撤销后会删除本次同步生成的每日草稿和异常；钉钉原始记录会保留以便审计。确认继续吗？"), () => {
			frappe.call({ method: "hrms.api.dingtalk_integration.cancel_dingtalk_attendance_sync", args: { sync_log: syncLog }, freeze: true, freeze_message: __("正在撤销同步..."), callback: (response) => {
				const result = response.message || {};
				frappe.show_alert({ message: result.message || __("已提交撤销请求"), indicator: "orange" });
				this.watch_dingtalk_attendance_sync(syncLog, this.attendance_date || frappe.datetime.get_today());
			} });
		});
	}

	load_dingtalk_sync_logs() {
		this.body().innerHTML = this.render_action_bar("钉钉同步记录", [
			{ label: "同步日期", action: "dingtalk-sync", primary: true },
			{ label: "刷新记录", action: "refresh-sync-logs" },
		]);
		this.body().querySelector("[data-table]").insertAdjacentHTML(
			"beforebegin",
			`<div class="alert alert-info mb-3">${this.escape(__("每次 API 同步均会留下独立记录。已完成的同步可撤销其生成的每日草稿和异常；原始钉钉响应会保留，不会被删除。"))}</div>`,
		);
		this.bind_action_bar();
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.dingtalk_integration.list_dingtalk_attendance_sync_runs",
			args: { company: this.company, attendance_month: this.attendance_month, work_date: this.attendance_date, page_length: 100 },
			callback: (response) => this.render_dingtalk_sync_logs(response.message || []),
		});
	}

	render_dingtalk_sync_logs(rows) {
		const table = this.body().querySelector("[data-table]");
		if (!table) return;
		table.innerHTML = `<div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table"><thead><tr><th>${this.escape(__("同步日期"))}</th><th>${this.escape(__("状态"))}</th><th>${this.escape(__("接收/新建/失败"))}</th><th>${this.escape(__("草稿批次"))}</th><th>${this.escape(__("提交/完成时间"))}</th><th>${this.escape(__("说明"))}</th><th>${this.escape(__("操作"))}</th></tr></thead><tbody>${rows.length ? rows.map((row) => {
			const statusClass = ["失败", "部分失败"].includes(row.status) ? "is-warning" : row.status === "已撤销" ? "is-pending" : "";
			return `<tr><td>${this.escape(row.business_date || "-")}</td><td><span class="hrms-attendance-status ${statusClass}">${this.escape(row.status || "-")}</span></td><td>${this.escape(`${row.records_received || 0} / ${row.records_created || 0} / ${row.records_failed || 0}`)}</td><td>${this.escape(row.batch || "-")}</td><td>${this.escape(row.finished_at || row.started_at || "-")}</td><td class="hrms-attendance-long-cell">${this.escape(row.error_message || "-")}</td><td><button class="btn btn-default btn-xs" data-open-sync-date="${this.escape(row.business_date || "")}">${this.escape(__("查看当天"))}</button>${row.can_cancel ? ` <button class="btn btn-default btn-xs" data-cancel-dingtalk-sync="${this.escape(row.name)}">${this.escape(__("撤销"))}</button>` : ""}</td></tr>`;
		}).join("") : `<tr><td colspan="7" class="text-muted">${this.escape(this.attendance_date ? __("该日期暂无钉钉同步记录。") : __("本月暂无钉钉同步记录。"))}</td></tr>`}</tbody></table></div>`;
		table.querySelectorAll("[data-open-sync-date]").forEach((button) => button.addEventListener("click", () => {
			if (!button.dataset.openSyncDate) return;
			this.attendance_date = button.dataset.openSyncDate;
			this.attendance_month = this.attendance_date.slice(0, 7);
			this.batch = "";
			this.set_view("daily");
		}));
		table.querySelectorAll("[data-cancel-dingtalk-sync]").forEach((button) => button.addEventListener("click", () => this.cancel_dingtalk_attendance_sync(button.dataset.cancelDingtalkSync)));
	}

	render_placeholder(title, description, nextView = "") {
		return `
			<div class="hrms-attendance-section">
				<div class="hrms-attendance-list-head">
					<h3>${this.escape(__(title))}</h3>
					${nextView ? `<div><button class="btn btn-primary btn-sm" data-view="${nextView}">${this.escape(__("维护自定义规则"))}</button></div>` : "<div></div>"}
				</div>
				<p class="text-muted">${this.escape(__(description))}</p>
				<div class="hrms-attendance-empty">${this.escape(__("该视图已纳入考勤工作台导航，数据接入后会在此处展示。"))}</div>
			</div>
		`;
	}

	render_action_bar(title, actions) {
		return `
			<div class="hrms-attendance-section">
				<div class="hrms-attendance-list-head">
					<h3>${this.escape(__(title))}</h3>
					<div>
						${actions
							.map(
								(action) => `
									<button class="btn ${action.primary ? "btn-primary" : "btn-default"} btn-sm" data-action="${this.escape(action.action)}">
										${this.escape(__(action.label))}
									</button>
								`,
							)
							.join("")}
					</div>
				</div>
				<div data-table></div>
			</div>
		`;
	}

	bind_action_bar() {
		this.body().querySelectorAll("[data-action]").forEach((button) => {
			button.addEventListener("click", () => {
				if (button.dataset.action === "dingtalk-sync") this.sync_dingtalk_attendance_for_date();
				if (button.dataset.action === "open-dingtalk") this.set_view("dingtalk");
				if (button.dataset.action === "open-sync-logs") this.set_view("sync-logs");
				if (button.dataset.action === "refresh-sync-logs") this.load_dingtalk_sync_logs();
				if (button.dataset.action === "generate-exceptions") this.generate_attendance_exceptions();
				if (button.dataset.action === "generate-monthly") this.generate_monthly_attendance_summary();
				if (button.dataset.action === "open-department-confirmations") this.set_view("department-confirmations");
				if (button.dataset.action === "refresh-department-confirmations") this.load_department_confirmations();
				if (button.dataset.action === "open-monthly") this.set_view("monthly");
				if (button.dataset.action === "lock-month") this.lock_attendance_month();
				if (button.dataset.action === "unlock-month") this.unlock_attendance_month();
				if (button.dataset.action === "seed-rules") this.seed_attendance_custom_rules();
				if (button.dataset.action === "new-rule") this.open_rule_dialog();
				if (button.dataset.action === "open-rule-center") this.set_view("rules");
				if (button.dataset.action === "open-custom-rules") this.set_view("custom-rules");
				if (button.dataset.action === "open-import") this.set_view("import");
				if (button.dataset.action === "revoke-latest-import") this.open_latest_attendance_import_revoke_dialog();
				if (button.dataset.action === "evaluate-rules") this.run_attendance_rule_evaluation();
			});
		});
	}

	seed_attendance_custom_rules() {
		frappe.call({
			method: "hrms.api.attendance_import.seed_attendance_custom_rules",
			callback: () => this.load_custom_rules(),
		});
	}

	generate_attendance_exceptions() {
		frappe.call({
			method: "hrms.api.attendance_import.generate_attendance_exceptions",
			args: { batch: this.batch },
			freeze: true,
			freeze_message: __("正在生成考勤异常..."),
			callback: () => this.set_view("exceptions"),
		});
	}

	generate_monthly_attendance_summary() {
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.attendance_import.generate_monthly_attendance_summary",
			args: { company: this.company, attendance_month: this.attendance_month },
			freeze: true,
			freeze_message: __("正在生成月度考勤终稿..."),
			callback: () => this.load_monthly(),
		});
	}

	lock_attendance_month() {
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.attendance_import.lock_attendance_month",
			args: { company: this.company, attendance_month: this.attendance_month },
			freeze: true,
			freeze_message: __("正在锁定本月考勤..."),
			callback: () => this.load_monthly(),
		});
	}

	unlock_attendance_month() {
		if (!this.ensure_company()) return;
		frappe.prompt(
			[{ fieldname: "reason", fieldtype: "Small Text", label: __("解锁原因"), reqd: 1 }],
			(values) =>
				frappe.call({
					method: "hrms.api.attendance_import.unlock_attendance_month",
					args: { company: this.company, attendance_month: this.attendance_month, reason: values.reason },
					freeze: true,
					freeze_message: __("正在解锁本月考勤..."),
					callback: () => this.load_monthly(),
				}),
			__("解锁本月考勤"),
			__("确认"),
		);
	}

	render_table(title, columns, rows, mapRow) {
		const table = this.wrapper.querySelector("[data-table]");
		if (!table) return;
		table.innerHTML = `
			<div class="hrms-attendance-table-wrap">
				<table class="table table-bordered hrms-attendance-table">
					<thead><tr>${columns.map((column) => `<th>${this.escape(__(column))}</th>`).join("")}</tr></thead>
					<tbody>
						${
							rows.length
								? rows.map((row) => `<tr>${mapRow(row).map((cell) => `<td>${this.escape(cell)}</td>`).join("")}</tr>`).join("")
								: `<tr><td colspan="${columns.length}" class="text-muted">${this.escape(__(`${title}暂无数据`))}</td></tr>`
						}
					</tbody>
				</table>
			</div>
		`;
	}
}
