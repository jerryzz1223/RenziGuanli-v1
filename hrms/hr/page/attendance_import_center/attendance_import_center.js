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
		this.company = this.get_context_company();
		this.attendance_month = frappe.datetime.str_to_obj(frappe.datetime.get_today()).toISOString().slice(0, 7);
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
					{ key: "daily", label: "每日考勤" },
					{ key: "monthly", label: "月考勤表" },
					{ key: "records", label: "明细记录" },
					{ key: "reports", label: "考勤报表" },
					{ key: "exceptions", label: "考勤确认" },
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
					<input class="form-control" type="month" data-month value="${this.escape(this.attendance_month)}">
					<button class="btn btn-primary" data-upload>${this.escape(__("上传考勤文件"))}</button>
				</div>
			</div>
		`;
	}

	render_kpi_grid() {
		const cards = [
			["出勤0人", "每日考勤", "出勤结果未及时更新?"],
			["总出勤0人", "月考勤", "同步本月考勤人员"],
			["本月满勤0人", "满勤", "核算考勤"],
			["旷工0人", "异常", "发送考勤确认"],
		];
		return `
			<div class="hrms-attendance-kpi-grid">
				${cards
					.map(
						([value, label, action]) => `
							<button class="hrms-attendance-kpi" data-view="${label === "每日考勤" ? "daily" : label === "月考勤" ? "monthly" : label === "异常" ? "exceptions" : "summary"}">
								<strong>${this.escape(__(value))}</strong>
								<span>${this.escape(__(label))}</span>
								<small>${this.escape(__(action))}</small>
							</button>
						`,
					)
					.join("")}
			</div>
		`;
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
		if (this.active_view === "daily") return this.load_daily_checks();
		if (this.active_view === "exceptions") return this.load_exceptions();
		if (this.active_view === "monthly") return this.load_monthly();
		if (this.active_view === "reports") return this.load_attendance_reports();
		if (this.active_view === "custom-rules") return this.load_custom_rules();
		if (this.active_view === "leave-records") return this.load_leave_records();
		if (this.active_view === "dingtalk") return this.render_dingtalk_integration();
		if (["clock-records", "makeup-records", "outing-records", "trip-records", "overtime-records"].includes(this.active_view)) return this.render_detail_record_view();
		if (["field-rules", "groups", "schedule", "rules", "clock-settings", "settings", "apple-rules", "seven-s-rules", "kpi-rules"].includes(this.active_view)) return this.render_settings_view();
		return this.render_summary();
	}

	open_uploader() {
		new frappe.ui.FileUploader({
			folder: "Home/Attachments",
			restrictions: { allowed_file_types: [".xlsx"] },
			on_success: (file) => {
				this.file_url = file.file_url;
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
						["考勤报表", "按 2号人事 逻辑组织系统报表、自定义报表和明细报表。", "reports"],
						["自定义规则", "沉淀本公司考勤、苹果树、7S、KPI规则，后续用于自动判定。", "custom-rules"],
					]
						.map(([title, desc, view]) => `<button class="hrms-attendance-quick" data-view="${view}"><strong>${this.escape(__(title))}</strong><span>${this.escape(__(desc))}</span></button>`)
						.join("")}
				</div>
			</div>
		`;
		this.body().querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => this.set_view(button.dataset.view)));
	}

	render_import(result = null) {
		const body = this.body();
		body.innerHTML = `
			<div class="hrms-attendance-section">
				<div class="hrms-attendance-list-head">
					<h3>${this.escape(__("考勤导入中心"))}</h3>
					<div><button class="btn btn-primary btn-sm" data-upload>${this.escape(__("选择文件"))}</button></div>
				</div>
				<div class="hrms-attendance-import-panel">
					<div class="hrms-attendance-upload-box" data-upload-zone>
						<strong>${this.escape(__("上传钉钉/考勤 Excel"))}</strong>
						<span>${this.escape(__("支持旧版 1.1每日统计、1.2请假单、1.3苹果树模板；也支持包含每日统计、打卡时间、原始记录、月度汇总的钉钉导出，以及“每日统计（钉钉导出）/每日统计（修改后）”双来源工作簿。上传后先只读预览。"))}</span>
						<button class="btn btn-primary btn-sm">${this.escape(__("选择文件"))}</button>
					</div>
					<div data-preview>
						${result ? this.render_preview_result(result) : `<div class="text-muted">${this.escape(__("上传后会先预览工作表和行数，不会立即写入数据。"))}</div>`}
					</div>
				</div>
			</div>
		`;
		body.querySelectorAll("[data-upload], [data-upload-zone]").forEach((button) => button.addEventListener("click", () => this.open_uploader()));
		const importButton = body.querySelector("[data-import]");
		if (importButton) importButton.addEventListener("click", () => this.import_attendance_workbook());
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
		return `
			<div class="hrms-attendance-preview">
				<h3>${this.escape(__("预览结果"))}</h3>
				<div class="mb-3"><strong>${this.escape(__("来源类型"))}：</strong>${this.escape(result.source_type || "legacy_workbook")}</div>
				<table class="table table-bordered">
					<thead><tr>${hasDailySources ? `<th>${this.escape(__("数据来源"))}</th>` : ""}<th>${this.escape(__("工作表"))}</th><th>${this.escape(__("状态"))}</th><th>${this.escape(__("行数"))}</th></tr></thead>
					<tbody>
						${sheets
							.map(
								(sheet) => `
									<tr>
										${hasDailySources ? `<td>${this.escape(__(sheet.source_kind === "dingtalk_raw" ? "钉钉原始导出" : "人工调整"))}</td>` : ""}
										<td>${this.escape(sheet.sheet_name)}</td>
										<td>${sheet.found === false ? this.escape(__("缺失")) : this.escape(__("已找到"))}</td>
										<td>${this.escape(sheet.row_count || 0)}</td>
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
					(result.missing_sheets || []).length
						? `<div class="alert alert-warning">${this.escape(__("缺少工作表：{0}", [result.missing_sheets.join("、")]))}</div>`
						: `<button class="btn btn-primary" data-import>${this.escape(__("确认导入每日统计"))}</button>`
				}
			</div>
		`;
	}

	preview_attendance_workbook() {
		frappe
			.call({
				method: "hrms.api.attendance_import.preview_attendance_workbook",
				args: { file_url: this.file_url },
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
				const rejected = Number(result.rejected_company_or_employee_rows || 0);
				frappe.show_alert({
					message: rejected ? __("已导入 {0} 条日核对，{1} 条因员工或公司未匹配未写入。", [result.inserted_day_checks || 0, rejected]) : __("考勤导入完成"),
					indicator: rejected ? "orange" : "green",
				});
				this.set_view("daily");
			});
	}

	load_daily_checks() {
		this.body().innerHTML = this.render_action_bar("每日考勤核对", [{ label: "生成考勤异常", action: "generate-exceptions", primary: true }]);
		this.bind_action_bar();
		if (!this.ensure_company()) return;
		frappe.call({
			method: "hrms.api.attendance_import.list_attendance_day_checks",
			args: { company: this.company, batch: this.batch, attendance_month: this.attendance_month, effective_only: 1 },
			callback: (response) =>
				this.render_table("每日考勤核对", ["姓名", "工号", "部门", "日期", "来源", "出勤结果", "班次", "上班时间", "下班时间", "标准工时", "实际出勤", "有效请假", "无效请假", "工作日加班", "休息日加班", "节假日加班", "大夜班", "小夜班", "旷工", "迟到", "早退", "上班缺卡", "下班缺卡", "未申请加班"], response.message || [], (row) => [
					row.employee_name,
					row.employee_code,
					row.department,
					row.attendance_date,
					row.source_kind,
					row.attendance_result,
					row.shift_name,
					row.actual_in_time,
					row.actual_out_time,
					row.standard_hours,
					row.actual_attendance_hours,
					row.valid_leave_summary || row.valid_leave_hours || row.leave_summary || row.leave_hours,
					row.invalid_leave_hours,
					row.workday_overtime_hours,
					row.restday_overtime_hours,
					row.holiday_overtime_hours,
					row.large_night_shift_count,
					row.small_night_shift_count,
					row.absent_hours,
					row.late_count,
					row.early_count,
					row.missing_in ? "是" : "",
					row.missing_out ? "是" : "",
					row.overtime_without_approval ? "是" : "",
				]),
		});
	}

	load_exceptions() {
		this.body().innerHTML = this.render_action_bar("考勤异常处理", []);
		frappe.call({
			method: "hrms.api.attendance_import.list_attendance_exceptions",
			args: { batch: this.batch },
			callback: (response) =>
				this.render_table("考勤异常处理", ["姓名", "工号", "出勤日期", "单位", "异常类型", "处理方式", "扣缺勤工时", "全勤扣款", "红苹果", "确认状态", "备注"], response.message || [], (row) => [
					row.employee_name,
					row.employee_code,
					row.attendance_date,
					row.department,
					row.exception_type,
					row.handling_method,
					row.deduct_absence_hours,
					row.full_attendance_deduction,
					row.red_apple_penalty,
					row.confirmation_status,
					row.remarks,
				]),
		});
	}

	load_monthly() {
		this.body().innerHTML = this.render_action_bar("月度考勤终稿", [
			{ label: "生成月度考勤终稿", action: "generate-monthly", primary: true },
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
		this.render_table("自定义规则", ["启用", "规则编码", "规则名称", "分组", "类型", "来源模块", "来源文件", "触发条件", "公式", "处理结果"], rows, (row) => [
			row.enabled ? "是" : "否",
			row.rule_code,
			row.rule_name,
			row.rule_group,
			row.rule_type,
			row.source_module,
			row.source_document,
			row.trigger_condition,
			row.formula,
			row.action_result,
		]);
	}

	open_rule_dialog() {
		const dialog = new frappe.ui.Dialog({
			title: __("新增自定义规则"),
			fields: [
				{ fieldname: "rule_code", fieldtype: "Data", label: __("规则编码"), reqd: 1 },
				{ fieldname: "rule_name", fieldtype: "Data", label: __("规则名称"), reqd: 1 },
				{ fieldname: "rule_group", fieldtype: "Select", label: __("规则分组"), options: "考勤\n苹果树\n7S\nKPI\n钉钉\n薪资前置\n其他", default: "考勤" },
				{ fieldname: "rule_type", fieldtype: "Data", label: __("规则类型") },
				{ fieldname: "source_module", fieldtype: "Data", label: __("来源模块") },
				{ fieldname: "source_document", fieldtype: "Small Text", label: __("来源文件/表单") },
				{ fieldname: "trigger_condition", fieldtype: "Small Text", label: __("触发条件") },
				{ fieldname: "formula", fieldtype: "Code", label: __("计算公式/表达式") },
				{ fieldname: "action_result", fieldtype: "Small Text", label: __("处理结果") },
				{ fieldname: "enabled", fieldtype: "Check", label: __("启用"), default: 1 },
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

	render_detail_record_view() {
		const title = this.view_map[this.active_view].label;
		const descriptions = {
			"clock-records": "后续钉钉打卡机对接后展示原始打卡时间、设备、地点和打卡来源。",
			"makeup-records": "展示钉钉补卡审批结果，支撑忘打卡异常处理。",
			"outing-records": "展示外出审批与外勤时长。",
			"trip-records": "展示出差审批与出勤豁免依据。",
			"overtime-records": "展示加班审批，与未申请加班异常互相校验。",
		};
		this.body().innerHTML = this.render_placeholder(title, descriptions[this.active_view] || "该明细视图将随钉钉审批/打卡数据接入开放。");
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
					<div><button class="btn btn-default btn-sm" data-view="custom-rules">${this.escape(__("查看规则"))}</button></div>
				</div>
				<ol>
					<li>${this.escape(__("在钉钉开放平台创建企业内部应用，取得 CorpId、AppKey、AppSecret。"))}</li>
					<li>${this.escape(__("为应用开通通讯录读取、考勤打卡、审批实例读取等权限，并完成企业授权。"))}</li>
					<li>${this.escape(__("本系统保存钉钉应用配置后，定时拉取打卡记录、补卡、请假、外出、出差、加班审批。"))}</li>
					<li>${this.escape(__("拉取后的原始数据先进入明细记录，再由自定义规则生成每日考勤、异常确认和月度终稿。"))}</li>
				</ol>
				<div class="alert alert-info">${this.escape(__("当前阶段先以 Excel 导入模拟钉钉输出，页面结构已按后续 API 对接预留。"))}</div>
			</div>
		`;
		this.body().querySelector("[data-view]").addEventListener("click", (event) => this.set_view(event.target.dataset.view));
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
				if (button.dataset.action === "generate-exceptions") this.generate_attendance_exceptions();
				if (button.dataset.action === "generate-monthly") this.generate_monthly_attendance_summary();
				if (button.dataset.action === "lock-month") this.lock_attendance_month();
				if (button.dataset.action === "unlock-month") this.unlock_attendance_month();
				if (button.dataset.action === "seed-rules") this.seed_attendance_custom_rules();
				if (button.dataset.action === "new-rule") this.open_rule_dialog();
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
