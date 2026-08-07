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
	wrapper.attendance_import_center?.activate();
};

frappe.pages["attendance-import-center"].on_page_hide = function (wrapper) {
	wrapper.attendance_import_center?.deactivate();
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
		this.processing_api = "hrms.api.attendance_processing_center";
		this.processing_batch = null;
		this.processing_batch_error = "";
		this.selected_source_type = "attendance_draft";
		this.exception_source_filter = "";
		this.selected_exception_record_ids = new Set();
		this.processing_sources = [
			{ key: "attendance_draft", label: "考勤初稿", description: "钉钉每日明细汇总；不吸收苹果树或忘打卡修正。" },
			{ key: "apple_tree", label: "苹果树", description: "独立苹果树奖惩来源；不包含特殊工时。" },
			{ key: "missing_card", label: "忘打卡", description: "独立补卡与人工核对来源。" },
		];
		this.final_required_sources = [
			{ key: "attendance_draft", label: "考勤初稿", kind: "主加工结果" },
			{ key: "apple_tree", label: "苹果树", kind: "主加工结果" },
			{ key: "missing_card", label: "忘打卡", kind: "主加工结果" },
			{ key: "housing_allowance", label: "住房补贴", kind: "后续核算来源" },
			{ key: "full_attendance", label: "全勤奖", kind: "后续核算来源" },
			{ key: "special_hours", label: "特殊工时", kind: "后续核算来源" },
		];
		this.monthly_support_sources = [
			{ key: "housing_allowance", label: "住房补贴", description: "上传当月住房补贴明细；系统核验工号、姓名与补贴金额列。" },
			{ key: "full_attendance", label: "全勤奖", description: "上传当月全勤奖明细；系统核验工号、姓名与全勤奖金额列。" },
			{ key: "special_hours", label: "特殊工时", description: "上传当月特殊工时人工登记表；系统核验员工、日期与工时。" },
		];
		this.exception_sources = [...this.processing_sources, ...this.monthly_support_sources];
		this.processing_statuses = ["未上传", "待加工", "待处理异常", "待确认", "已确认"];
		this.workflow_views = [
			{ key: "daily-import", label: "考勤汇总" },
			{ key: "exceptions", label: "异常处理" },
			{ key: "processing-results", label: "加工结果" },
		];
		this.view_groups = [
			{
				title: "考勤处理",
				items: [
					{ key: "daily-import", label: "考勤汇总" },
					{ key: "exceptions", label: "异常处理" },
					{ key: "processing-results", label: "加工结果" },
				],
			},
			{
				title: "数据台账",
				items: [
					{ key: "import-batches", label: "导入批次" },
					{ key: "manual-adjustments", label: "人工调整记录" },
				],
			},
			{
				title: "规则设置",
				items: [
					{ key: "field-mapping", label: "字段映射" },
					{ key: "department-mapping", label: "部门映射" },
					{ key: "processing-rules", label: "处理规则" },
				],
			},
		];
		this.route_aliases = {
			"summary": "daily-import",
			"import": "daily-import",
			"daily": "processing-results",
			"monthly": "monthly-final",
			"reports": "monthly-final",
			"department-confirmations": "exceptions",
			"custom-rules": "processing-rules",
			"field-rules": "field-mapping",
			"rules": "processing-rules",
			"groups": "processing-rules",
			"schedule": "processing-rules",
			"settings": "processing-rules",
			"clock-settings": "processing-rules",
			"dingtalk": "daily-import",
			"sync-logs": "import-batches",
			"clock-records": "processing-results",
			"makeup-records": "processing-results",
			"leave-records": "processing-results",
			"outing-records": "processing-results",
			"trip-records": "processing-results",
			"overtime-records": "processing-results",
			"apple-rules": "processing-results",
			"seven-s-rules": "processing-rules",
			"kpi-rules": "processing-rules",
		};
		this.view_map = this.view_groups.flatMap((group) => group.items).reduce((map, item) => {
			map[item.key] = item;
			return map;
		}, {});
		this.active_view = this.resolve_view(frappe.get_route()[1] || "daily-import");
		this.last_route_refresh_at = 0;
		this.cache_ttl = 30_000;
	}

	show() {
		// Upload belongs to each source's own workflow, never to the global shell.
		this.page.set_primary_action(null);
		this.activate(true);
		this.render();
		this.load_active_view();
		this.last_route_refresh_at = Date.now();
		this.refresh_company_context_when_ready();
	}

	is_active() {
		const container = this.wrapper.closest(".page-container");
		return !container || container.classList.contains("active");
	}

	activate(initial = false) {
		this.set_wide_layout(true);
		this.bind_route_events();
		this.bind_company_context();
		if (!initial) this.refresh_from_route("", true);
	}

	deactivate() {
		this.set_wide_layout(false);
		if (this.company_context_bound) {
			window.removeEventListener("hrms:company-context-changed", this.handle_company_context_change);
			this.company_context_bound = false;
		}
		if (this.route_events_bound) {
			window.removeEventListener("hrms:route-change", this.handle_hrms_route_change);
			this.route_events_bound = false;
		}
	}

	set_wide_layout(enabled) {
		const className = "hrms-attendance-wide-layout";
		this.wrapper.closest(".page-container")?.classList.toggle(className, enabled);
		this.wrapper.closest(".layout-main-section-wrapper")?.classList.toggle(className, enabled);
		this.wrapper.closest(".layout-main-section")?.classList.toggle(className, enabled);
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
			if (!this.is_active()) return;
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
			if (!this.is_active()) return;
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
			if (!this.is_active()) return;
			const view = this.view_from_route_detail(event.detail);
			if (view) this.refresh_from_route(view);
		};
		window.addEventListener("hrms:route-change", this.handle_hrms_route_change);
	}

	view_from_current_route() {
		const route = frappe.get_route ? frappe.get_route() : [];
		return this.resolve_view(route[1] || "daily-import");
	}

	view_from_route_detail(detail) {
		const value = String((detail && (detail.slug || detail.route)) || "");
		const normalized = value.replace(/^\/desk\/?/, "").replace(/^\/app\/?/, "").replace(/\/$/, "");
		const parts = normalized.split("/").filter(Boolean);
		if (parts[0] !== "attendance-import-center") return "";
		return this.resolve_view(parts[1] || "daily-import");
	}

	refresh_from_route(view = "", force = false) {
		const next_view = this.resolve_view(view || this.view_from_current_route());
		const has_body = Boolean(this.body());
		if (next_view === this.active_view && has_body) {
			if (!force || Date.now() - this.last_route_refresh_at < this.cache_ttl) return;
			this.last_route_refresh_at = Date.now();
			this.load_active_view();
			return;
		}
		this.active_view = next_view;
		this.render();
		this.load_active_view();
		this.last_route_refresh_at = Date.now();
	}

	resolve_view(view) {
		const normalized = this.route_aliases[view] || view;
		return this.view_map[normalized] || this.workflow_views.find((item) => item.key === normalized) ? normalized : "daily-import";
	}

	escape(value) {
		return frappe.utils.escape_html(String(value ?? ""));
	}

	format_attendance_month(month = this.attendance_month) {
		const [year, value] = String(month || "").split("-");
		const monthNumber = Number(value);
		return Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12 ? `${year}年${monthNumber}月` : "--";
	}

	set_attendance_month(month) {
		if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || "")) || month === this.attendance_month) return;
		this.attendance_month = month;
		this.processing_batch = null;
		this.processing_batch_error = "";
		this.batch = "";
		this.render();
		this.load_active_view();
	}

	shift_attendance_month(offset) {
		const [year, month] = this.attendance_month.split("-").map(Number);
		const date = new Date(year, month - 1 + Number(offset || 0), 1);
		const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
		this.set_attendance_month(next);
	}

	render_month_control() {
		return `
			<div class="hrms-attendance-month-control" aria-label="${this.escape(__("处理月份"))}">
				<span>${this.escape(__("处理月份"))}</span>
				<div class="hrms-attendance-month-switcher">
					<button class="btn btn-default btn-sm" type="button" data-month-shift="-1" title="${this.escape(__("上一个月"))}" aria-label="${this.escape(__("上一个月"))}">‹</button>
					<button class="btn btn-default btn-sm hrms-attendance-month-current" type="button" data-open-month-picker title="${this.escape(__("选择处理月份"))}">${this.escape(this.format_attendance_month())}</button>
					<button class="btn btn-default btn-sm" type="button" data-month-shift="1" title="${this.escape(__("下一个月"))}" aria-label="${this.escape(__("下一个月"))}">›</button>
				</div>
			</div>
		`;
	}

	open_month_picker() {
		let pickerYear = Number(this.attendance_month.slice(0, 4)) || new Date().getFullYear();
		const months = Array.from({ length: 12 }, (_unused, index) => index + 1);
		const dialog = new frappe.ui.Dialog({
			title: __("选择处理月份"),
			fields: [{ fieldname: "month_picker", fieldtype: "HTML" }],
		});
		const renderPicker = () => {
			const activeMonth = this.attendance_month;
			dialog.fields_dict.month_picker.$wrapper.html(`
				<div class="hrms-attendance-month-picker">
					<div class="hrms-attendance-month-picker__year">
						<button class="btn btn-default btn-sm" type="button" data-picker-year="-1" aria-label="${this.escape(__("上一年"))}">‹</button>
						<strong>${this.escape(String(pickerYear))}${this.escape(__("年"))}</strong>
						<button class="btn btn-default btn-sm" type="button" data-picker-year="1" aria-label="${this.escape(__("下一年"))}">›</button>
					</div>
					<div class="hrms-attendance-month-picker__months">
						${months.map((month) => {
							const value = `${pickerYear}-${String(month).padStart(2, "0")}`;
							return `<button class="btn btn-default btn-sm ${value === activeMonth ? "active" : ""}" type="button" data-picker-month="${value}">${this.escape(__("{0}月", [month]))}</button>`;
						}).join("")}
					</div>
					<button class="btn btn-link btn-sm" type="button" data-picker-current>${this.escape(__("回到本月"))}</button>
				</div>
			`);
			dialog.$wrapper.find("[data-picker-year]").on("click", (event) => {
				pickerYear += Number(event.currentTarget.dataset.pickerYear);
				renderPicker();
			});
			dialog.$wrapper.find("[data-picker-month]").on("click", (event) => {
				this.set_attendance_month(event.currentTarget.dataset.pickerMonth);
				dialog.hide();
			});
			dialog.$wrapper.find("[data-picker-current]").on("click", () => {
				const today = frappe.datetime.str_to_obj(frappe.datetime.get_today());
				this.set_attendance_month(today.toISOString().slice(0, 7));
				dialog.hide();
			});
		};
		dialog.show();
		renderPicker();
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
		this.update_processing_kpis();
	}

	render_header() {
		return `
			<div class="hrms-attendance-import-head">
				<div>
					<h2>${this.escape(__("考勤处理中心"))}</h2>
					<p>${this.escape(__("一个月度批次统一接收考勤初稿、苹果树、忘打卡三类文件；每类直接加工并自动检查，异常统一处理后再确认。"))}</p>
				</div>
				<div class="hrms-attendance-import-controls">
					<div class="hrms-attendance-company-context" title="${this.escape(__("请在顶部公司切换器中切换公司"))}"><span>${this.escape(__("当前公司"))}</span><strong>${this.escape(this.company || "--")}</strong></div>
					${this.render_month_control()}
				</div>
			</div>
		`;
	}

	render_kpi_grid() {
		const batch = this.processing_batch || {};
		const slots = batch.slots || [];
		const confirmed = slots.filter((slot) => slot.status === "已确认").length;
		const exceptions = slots.reduce((total, slot) => total + Number(slot.exception_count || 0), 0);
		const cards = [
			[batch.status || "读取中", "考勤处理批次", batch.batch_id || "按公司与月份读取", "processing-batch-status", "daily-import"],
			[`${confirmed}/3`, "已确认来源", "三个来源均确认后才能生成终稿", "confirmed-sources", "processing-results"],
			[`${exceptions}条`, "待确认异常", "异常不得静默丢行", "pending-exceptions", "exceptions"],
			[batch.final_outputs?.locked_version || "--", "终稿锁定版本", "签字版与财务版必须同源", "final-version", "monthly-final"],
		];
		return `
			<div class="hrms-attendance-kpi-grid">
				${cards
					.map(
						([value, label, action, key, view]) => `
							<button class="hrms-attendance-kpi" data-view="${this.escape(view)}">
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
		this.load_processing_batch({ rerender_active: false });
	}

	update_processing_kpis() {
		const batch = this.processing_batch || {};
		const slots = batch.slots || [];
		const values = {
			"processing-batch-status": batch.status || (this.processing_batch_error ? "接口未就绪" : "读取中"),
			"confirmed-sources": `${slots.filter((slot) => slot.status === "已确认").length}/3`,
			"pending-exceptions": `${slots.reduce((total, slot) => total + Number(slot.exception_count || 0), 0)}条`,
			"final-version": batch.final_outputs?.locked_version || "--",
		};
		Object.entries(values).forEach(([key, value]) => {
			const target = this.wrapper.querySelector(`[data-kpi="${key}"]`);
			if (target) target.textContent = value;
		});
	}

	render_toolbar() {
		return `
			<div class="hrms-attendance-toolbar">
				<div>
					<button class="btn btn-default btn-sm" data-action="refresh">${this.escape(__("刷新"))}</button>
					<span class="text-muted">${this.escape(__("所有加工、异常确认和人工改动均由服务端留痕；页面不会覆盖原始文件。"))}</span>
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
		this.wrapper.querySelectorAll("[data-month-shift]").forEach((button) => button.addEventListener("click", () => this.shift_attendance_month(button.dataset.monthShift)));
		this.wrapper.querySelector("[data-open-month-picker]")?.addEventListener("click", () => this.open_month_picker());
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
		if (action === "export") {
			this.show_attendance_export_dialog();
			return;
		}
		frappe.show_alert({ message: __("该操作会随当前视图的数据能力逐步开放"), indicator: "gray" });
	}

	show_attendance_export_dialog() {
		if (!this.ensure_company()) return;
		const profiles = [
			["company_attendance_workbook", "完整考勤工作簿（明细、请假、忘打卡、苹果树、月度三表）"],
			["daily_statistics", "每日统计"],
			["attendance_detail", "出勤明细（部门日报）"],
			["leave_evidence", "请假单"],
			["attendance_exception", "出勤异常处理表"],
			["missing_card", "忘打卡"],
			["apple_reward", "苹果树奖惩表"],
			["monthly_draft", "考勤初稿"],
			["monthly_signed", "考勤终稿（签字版）"],
			["monthly_finance", "考勤终稿（财务版）"],
		];
		const defaults = {
			daily: "daily_statistics",
			exceptions: "attendance_exception",
			"department-confirmations": "attendance_detail",
			"apple-rules": "apple_reward",
			monthly: "monthly_finance",
		};
		const defaultProfile = defaults[this.active_view] || "company_attendance_workbook";
		const labelForProfile = (profile) => profiles.find(([value]) => value === profile)?.[1] || profiles[0][1];
		const profileForLabel = (label) => profiles.find(([_value, optionLabel]) => optionLabel === label)?.[0] || "company_attendance_workbook";
		const dialog = new frappe.ui.Dialog({
			title: __("导出考勤"),
			fields: [
				{
					fieldname: "export_profile",
					fieldtype: "Select",
					label: __("导出表单"),
					options: profiles.map(([_value, label]) => label).join("\n"),
					default: labelForProfile(defaultProfile),
					reqd: 1,
				},
			],
			primary_action_label: __("生成并下载"),
			primary_action: (values) => {
				frappe.call({
					method: "hrms.api.attendance_import.download_attendance_export",
					args: {
						company: this.company,
						attendance_month: this.attendance_month,
						export_profile: profileForLabel(values.export_profile),
					},
					callback: (response) => {
						const result = response.message || {};
						if (result.file_url) window.open(result.file_url, "_blank");
						dialog.hide();
						frappe.show_alert({ message: __("已生成 {0}", [result.file_name || __("考勤导出文件")]), indicator: "green" });
					},
				});
			},
		});
		dialog.show();
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
		if (this.active_view === "daily-import") return this.load_daily_import();
		if (this.active_view === "processing-results") return this.load_processing_results();
		if (this.active_view === "exceptions") return this.load_processing_exceptions();
		if (this.active_view === "monthly-final") return this.load_monthly_final();
		if (this.active_view === "import-batches") return this.load_processing_ledger("batches");
		if (this.active_view === "manual-adjustments") return this.load_processing_ledger("adjustments");
		if (["field-mapping", "department-mapping", "processing-rules"].includes(this.active_view)) return this.load_processing_configuration();
		return this.load_daily_import();
	}

	processing_method(method) {
		return `${this.processing_api}.${method}`;
	}

	call_processing_api(method, args = {}, options = {}) {
		return frappe.call({
			method: this.processing_method(method),
			args,
			freeze: Boolean(options.freeze),
			freeze_message: options.freeze_message,
			callback: (response) => options.on_success?.(response.message || {}),
			error: (error) => {
				const message = this.read_dingtalk_error?.(error) || __("考勤处理接口尚未就绪，请稍后重试或联系系统管理员。操作没有被标记为成功。");
				this.processing_batch_error = message;
				options.on_error?.(message, error);
			},
		});
	}

	normalize_processing_batch(data = {}) {
		const supplied = new Map((data.slots || []).map((slot) => [slot.source_type, slot]));
		const slots = this.processing_sources.map((source) => {
			const slot = supplied.get(source.key) || {};
			const status = this.processing_statuses.includes(slot.status) ? slot.status : "未上传";
			return { ...source, ...slot, source_type: source.key, label: source.label, status };
		});
		return {
			...data,
			batch_id: data.batch_id || data.name || "",
			status: data.status || (slots.every((slot) => slot.status === "未上传") ? "未上传" : "待加工"),
			slots,
			finalization_inputs: data.finalization_inputs || data.snapshot_sources || [],
			final_outputs: data.final_outputs || {},
		};
	}

	load_processing_batch({ rerender_active = true, on_loaded } = {}) {
		if (!this.ensure_company()) return;
		this.processing_batch_error = "";
		this.call_processing_api(
			"get_processing_batch",
			{ company: this.company, attendance_month: this.attendance_month },
			{
				on_success: (data) => {
					this.processing_batch = this.normalize_processing_batch(data);
					this.update_processing_kpis();
					on_loaded?.(this.processing_batch);
					if (rerender_active) this.render_current_processing_view();
				},
				on_error: (message) => {
					this.processing_batch = null;
					this.processing_batch_error = message;
					this.update_processing_kpis();
					on_loaded?.(null);
					if (rerender_active) this.render_current_processing_view();
				},
			},
		);
	}

	render_current_processing_view() {
		if (this.active_view === "daily-import") return this.render_daily_import();
		if (this.active_view === "monthly-final") return this.render_monthly_final();
	}

	render_processing_notice() {
		if (!this.processing_batch_error) return "";
		return `<div class="hrms-attendance-api-notice"><strong>${this.escape(__("接口未就绪"))}</strong><span>${this.escape(this.processing_batch_error)}</span></div>`;
	}

	status_badge(status) {
		const normalized = String(status || "未上传");
		const className = {
			"未上传": "is-empty",
			"未就绪": "is-empty",
			"待加工": "is-pending",
			"待处理异常": "is-warning",
			"结构异常": "is-warning",
			"需补做加工检查": "is-warning",
			"待确认": "is-review",
			"已确认": "is-confirmed",
			"已就绪": "is-confirmed",
		}[normalized] || "is-neutral";
		return `<span class="hrms-attendance-processing-status ${className}">${this.escape(__(normalized))}</span>`;
	}

	review_status_badge(status) {
		const normalized = String(status || "待审核");
		const className = {
			"无需审核": "is-confirmed",
			"待审核": "is-warning",
			"已通过": "is-confirmed",
			"已驳回": "is-rejected",
		}[normalized] || "is-neutral";
		return `<span class="hrms-attendance-processing-status ${className}">${this.escape(__(normalized))}</span>`;
	}

	load_daily_import() {
		this.render_daily_import();
		this.load_processing_batch({ rerender_active: true });
	}

	render_daily_import() {
		const body = this.body();
		if (!body) return;
		const batch = this.processing_batch;
		body.innerHTML = `
			<div class="hrms-attendance-section">
				<div class="hrms-attendance-list-head">
					<div><h3>${this.escape(__("考勤汇总"))}</h3><small>${this.escape(__("本页完成六类来源的上传、加工、异常处理入口与终稿生成；无需在导入页和终稿页之间重复操作。"))}</small></div>
					<div class="text-muted">${this.escape(batch?.batch_id ? __("批次：{0}", [batch.batch_id]) : __("公司与月份确定批次"))}</div>
				</div>
				${this.render_processing_notice()}
				<div class="hrms-attendance-source-grid">
					${batch ? batch.slots.map((slot) => this.render_processing_slot(slot)).join("") : this.processing_sources.map((source) => this.render_processing_slot({ ...source, status: "读取中" }, true)).join("")}
				</div>
				<div class="hrms-attendance-process-footnote">${this.escape(__("状态流转：未上传 → 待加工 → 待处理异常 → 待确认 → 已确认。重新上传会创建新来源版本，不覆盖原始文件。"))}</div>
				${this.render_monthly_final_markup(batch)}
			</div>
		`;
		body.querySelectorAll("[data-slot-upload]").forEach((button) => button.addEventListener("click", () => this.open_slot_uploader(button.dataset.slotUpload)));
		body.querySelectorAll("[data-slot-action]").forEach((button) => button.addEventListener("click", () => this.run_slot_action(button.dataset.slotAction, button.dataset.sourceType)));
		body.querySelectorAll("[data-slot-download]").forEach((button) => button.addEventListener("click", () => this.download_slot_result(button.dataset.slotDownload)));
		body.querySelectorAll("[data-slot-open]").forEach((button) => button.addEventListener("click", () => {
			this.selected_source_type = button.dataset.slotOpen;
			this.exception_source_filter = button.dataset.slotOpen;
			this.set_view(button.dataset.slotTarget || "exceptions");
		}));
		this.bind_monthly_final_events(body);
	}

	render_processing_slot(slot, loading = false) {
		const fileName = slot.source_file_name || slot.file_name || slot.source_file || "--";
		const canProcess = Boolean(slot.can_process);
		const canDownload = Boolean(slot.processed_result?.file_url || slot.processing_result_file || slot.result_file_url);
		const hasPendingExceptions = slot.status === "待处理异常";
		const openTarget = hasPendingExceptions ? "exceptions" : "processing-results";
		const openLabel = hasPendingExceptions ? __("处理异常") : __("查看加工结果");
		return `
			<article class="hrms-attendance-source-card" data-source-slot="${this.escape(slot.source_type)}">
				<div class="hrms-attendance-source-card__head"><div><strong>${this.escape(__(slot.label))}</strong><small>${this.escape(__(slot.description || ""))}</small></div>${loading ? `<span class="text-muted">${this.escape(__("读取中"))}</span>` : this.status_badge(slot.status)}</div>
				<dl>
					<div><dt>${this.escape(__("文件"))}</dt><dd title="${this.escape(fileName)}">${this.escape(fileName)}</dd></div>
					<div><dt>${this.escape(__("月份"))}</dt><dd>${this.escape(slot.attendance_month || this.attendance_month || "--")}</dd></div>
					<div><dt>${this.escape(__("行数"))}</dt><dd>${this.escape(slot.row_count ?? "--")}</dd></div>
					<div><dt>${this.escape(__("异常数"))}</dt><dd>${this.escape(slot.exception_count ?? "--")}</dd></div>
				</dl>
				<div class="hrms-attendance-source-card__actions">
					<button class="btn btn-default btn-xs" data-slot-upload="${this.escape(slot.source_type)}" ${loading ? "disabled" : ""}>${this.escape(__(slot.source_file ? "重新上传" : "上传"))}</button>
					<button class="btn btn-primary btn-xs" data-slot-action="process_source_slot" data-source-type="${this.escape(slot.source_type)}" ${canProcess ? "" : "disabled"}>${this.escape(__("开始加工"))}</button>
					<button class="btn btn-default btn-xs" data-slot-download="${this.escape(slot.source_type)}" ${canDownload ? "" : "disabled"}>${this.escape(__("下载加工表"))}</button>
					<button class="btn btn-default btn-xs" data-slot-open="${this.escape(slot.source_type)}" data-slot-target="${this.escape(openTarget)}" ${loading || !slot.source_file ? "disabled" : ""}>${this.escape(openLabel)}</button>
				</div>
			</article>
		`;
	}

	open_slot_uploader(sourceType) {
		if (!this.ensure_company()) return;
		this.selected_source_type = sourceType || "attendance_draft";
		new frappe.ui.FileUploader({
			folder: "Home/Attachments",
			restrictions: { allowed_file_types: [".xlsx"] },
			on_success: (file) => {
				this.call_processing_api(
					"register_source_file",
					{ company: this.company, attendance_month: this.attendance_month, source_type: this.selected_source_type, file_url: file.file_url },
					{
						freeze: true,
						freeze_message: __("正在登记来源文件..."),
						on_success: () => {
							frappe.show_alert({ message: __("文件已登记，请直接开始加工；系统会同时完成结构检查。"), indicator: "green" });
							this.active_view = "daily-import";
							this.load_daily_import();
						},
						on_error: () => frappe.msgprint(__("文件已经上传，但处理中心接口未完成登记；页面不会把它显示为成功批次，请联系管理员后重试。")),
					},
				);
			},
		});
	}

	run_slot_action(method, sourceType) {
		if (!this.ensure_company()) return;
		this.call_processing_api(
			method,
			{ company: this.company, attendance_month: this.attendance_month, source_type: sourceType },
			{
				freeze: true,
				freeze_message: method === "precheck_source_slot" ? __("正在预检文件结构...") : __("正在加工并保留异常记录..."),
				on_success: () => {
					frappe.show_alert({ message: method === "precheck_source_slot" ? __("结构预检完成。") : __("加工完成，请处理异常并确认。"), indicator: "green" });
					this.load_daily_import();
				},
				on_error: (message) => frappe.msgprint(message),
			},
		);
	}

	download_slot_result(sourceType) {
		const slot = this.processing_batch?.slots?.find((item) => item.source_type === sourceType);
		if (!(slot?.processed_result?.file_url || slot?.processing_result_file || slot?.result_file_url)) return frappe.msgprint(__("当前没有可下载的加工结果，且不会伪造成功文件。"));
		this.download_processing_result(sourceType);
	}

	load_processing_results() {
		const body = this.body();
		body.innerHTML = this.render_processing_results([], true);
		this.bind_processing_result_events();
		if (!this.ensure_company()) return;
		this.call_processing_api(
			"list_processing_results",
			{ company: this.company, attendance_month: this.attendance_month, source_type: this.selected_source_type },
			{
				on_success: (data) => {
					const allRows = data.processed_rows || [];
					const visibleRows = allRows.filter((row) => row.review_status !== "待审核");
					body.innerHTML = this.render_processing_results(visibleRows, false, { ...data, pending_exception_count: allRows.length - visibleRows.length });
					this.bind_processing_result_events();
				},
				on_error: (message) => {
					body.innerHTML = this.render_processing_results([], false, { error: message });
					this.bind_processing_result_events();
				},
			},
		);
	}

	render_processing_source_tabs() {
		return `<div class="hrms-attendance-result-tabs">${this.exception_sources.map((source) => `<button class="btn btn-default btn-sm ${source.key === this.selected_source_type ? "active" : ""}" data-result-source="${this.escape(source.key)}">${this.escape(__(source.label))}</button>`).join("")}</div>`;
	}

	processing_source_label(sourceType) {
		return this.exception_sources.find((source) => source.key === sourceType)?.label || __("其他来源");
	}

	processing_field_label(fieldName) {
		const labels = {
			employee_code: "工号", employee_name: "姓名", department: "部门", standard_hours: "标准工时", actual_attendance_hours: "实际出勤工时",
			created_at: "创建时间", punch_time: "补卡时间", punch_type: "补卡类型", reason: "补卡理由", approval_result: "审批结果", approval_status: "审批状态",
			included: "是否计入", red_apples: "红苹果", amount: "红苹果金额",
			workday_overtime_hours: "工作日加班工时", restday_overtime_hours: "休息日加班工时", holiday_overtime_hours: "节假日加班工时",
			large_night_shifts: "大夜班次数", small_night_shifts: "小夜班次数", personal_leave_hours: "事假工时", sick_leave_hours: "病假工时",
			annual_leave_hours: "特休工时", work_injury_hours: "工伤工时", rest_arrangement_hours: "排休工时", absence_hours: "旷工工时",
			clock_in_missing_count: "上班漏打卡次数", clock_out_missing_count: "下班漏打卡次数", source_row_count: "来源明细行数",
			eligible_for_downstream: "计入下游", include_in_downstream: "计入下游",
			housing_allowance: "住房补贴", full_attendance_award: "全勤奖", special_hours: "特殊工时", special_hours_days: "特殊工时明细",
			day: "日期", hours: "工时",
			"工号": "工号", "姓名": "姓名", "部门": "部门", "苹果类型": "苹果类型", "有效苹果数": "有效苹果数",
		};
		return labels[fieldName] || __("其他调整字段");
	}

	format_processing_value(value) {
		if (value === null || value === undefined || value === "") return "--";
		if (Array.isArray(value)) return value.map((item) => this.format_processing_value(item)).join("；");
		if (typeof value !== "object") return String(value);
		return Object.entries(value)
			.map(([field, item]) => `${this.processing_field_label(field)}：${this.format_processing_value(item)}`)
			.join("；");
	}

	exception_label_text(row) {
		const labels = Array.isArray(row.exception_labels) ? row.exception_labels : [];
		return labels.filter(Boolean).join("、") || __("待人工确认");
	}

	review_guidance_text(row) {
		const guidance = Array.isArray(row.review_guidance) ? row.review_guidance : [];
		return guidance.filter(Boolean).join(" ");
	}

	attendance_draft_columns() {
		return [
			["department", "部门"], ["employee_name", "姓名"], ["employee_code", "工号"], ["standard_hours", "标准工时"],
			["actual_attendance_hours", "实际出勤"], ["workday_overtime_hours", "工作日加班"], ["restday_overtime_hours", "休息日加班"],
			["holiday_overtime_hours", "节假日加班"], ["large_night_shifts", "大夜班"], ["small_night_shifts", "小夜班"],
			["personal_leave_hours", "事假"], ["sick_leave_hours", "病假"], ["annual_leave_hours", "特休"], ["work_injury_hours", "工伤"],
			["rest_arrangement_hours", "排休"], ["absence_hours", "旷工"], ["clock_in_missing_count", "上班漏打卡"], ["clock_out_missing_count", "下班漏打卡"],
		];
	}

	apple_tree_columns() {
		return [
			["数据ID", "数据ID"], ["审批编号", "审批编号"], ["奖惩日期", "奖惩日期"], ["创建时间", "创建时间"],
			["部门", "部门"], ["姓名", "姓名"], ["工号", "工号"], ["苹果类型", "苹果类型"],
			["有效苹果数", "有效苹果数"], ["项目", "项目"], ["备注", "备注"], ["创建人", "创建人"],
			["审批结果", "审批结果"], ["审批状态", "审批状态"],
		];
	}

	missed_punch_columns() {
		return [
			["employee_code", "工号"], ["employee_name", "姓名"], ["department", "部门"], ["created_at", "创建时间"],
			["punch_time", "补卡时间"], ["punch_type", "补卡类型"], ["reason", "补卡理由"], ["approval_result", "审批结果"],
			["approval_status", "审批状态"], ["included", "是否计入"], ["red_apples", "红苹果"], ["amount", "红苹果金额"],
		];
	}

	monthly_support_columns(sourceType) {
		const shared = [["department", "部门"], ["employee_name", "姓名"], ["employee_code", "工号"]];
		if (sourceType === "housing_allowance") return shared.concat([["housing_allowance", "住房补贴"]]);
		if (sourceType === "full_attendance") return shared.concat([["full_attendance_award", "全勤奖"]]);
		return shared.concat([["special_hours", "特殊工时"], ["special_hours_days", "按日明细"]]);
	}

	format_special_hours_days(value) {
		if (!Array.isArray(value) || !value.length) return "--";
		return value.map((item) => `${item.day}日：${item.hours}`).join("；");
	}

	processing_values(row) {
		return row.confirmed_value || row.proposed_value || row.processed_value || {};
	}

	effective_missed_punch_values(row) {
		const values = { ...this.processing_values(row) };
		values.included = Boolean(row.eligible_for_downstream);
		if (!values.included) {
			values.red_apples = 0;
			values.amount = 0;
		}
		["employee_code", "employee_name", "department"].forEach((field) => {
			if (row[field] !== undefined && row[field] !== null && row[field] !== "") values[field] = row[field];
		});
		return values;
	}

	render_processing_results(rows = [], loading = false, meta = {}) {
		const slot = this.processing_batch?.slots?.find((item) => item.source_type === this.selected_source_type);
		const supportCheck = (this.processing_batch?.finalization_inputs || []).find((item) => item.source_type === this.selected_source_type);
		const isMonthlySupport = this.monthly_support_sources.some((source) => source.key === this.selected_source_type);
		const sourceConfirmed = slot?.status === "已确认" || supportCheck?.status === "已就绪" || supportCheck?.status === "已确认" || meta.status === "已确认";
		const pendingExceptionCount = Number(meta.pending_exception_count || 0);
		const canConfirm = !sourceConfirmed && !pendingExceptionCount && Boolean(isMonthlySupport ? supportCheck?.can_confirm : (meta.can_confirm ?? slot?.can_confirm ?? slot?.status === "待确认"));
		const confirmLabel = sourceConfirmed ? __("本类结果已确认") : pendingExceptionCount ? __("请先处理异常") : __("确认本类结果（可进入下游）");
		const isAttendanceDraft = this.selected_source_type === "attendance_draft";
		const isAppleTree = this.selected_source_type === "apple_tree";
		const isMissedPunch = this.selected_source_type === "missing_card";
		const supportColumns = this.monthly_support_columns(this.selected_source_type);
		const processedResult = meta.processed_result || slot?.processed_result;
		const canDownload = Boolean(processedResult?.file_url || rows.length);
		const headers = isAttendanceDraft
			? ["序号"].concat(this.attendance_draft_columns().map(([, label]) => label), ["异常说明", "审核状态"])
			: isAppleTree
				? ["序号"].concat(this.apple_tree_columns().map(([, label]) => label), ["异常说明", "审核状态", "来源追溯"])
				: isMissedPunch
					? ["序号"].concat(this.missed_punch_columns().map(([, label]) => label), ["异常", "审核状态", "来源追溯"])
					: isMonthlySupport
						? ["序号"].concat(supportColumns.map(([, label]) => label), ["异常", "审核状态", "来源追溯"])
						: ["工号", "姓名", "部门", "加工结果", "异常", "审核状态", "来源追溯"];
		const renderRow = isAttendanceDraft
			? (row, index) => this.render_attendance_draft_result_row(row, index)
			: isAppleTree
				? (row, index) => this.render_apple_tree_result_row(row, index)
				: isMissedPunch
					? (row, index) => this.render_missed_punch_result_row(row, index)
					: isMonthlySupport
						? (row, index) => this.render_monthly_support_result_row(row, index, supportColumns)
						: (row) => this.render_processing_result_row(row);
		const resultTitle = isAttendanceDraft ? __("考勤初稿加工结果（完整汇总）") : isAppleTree ? __("苹果树加工结果（完整明细）") : isMissedPunch ? __("忘打卡加工结果（完整明细）") : isMonthlySupport ? __("{0}加工结果", [this.processing_source_label(this.selected_source_type)]) : __("加工结果");
		const resultDescription = isAttendanceDraft
			? __("按员工一行展示已可采用的钉钉明确数据。待处理异常请先在“异常处理”完成审核；处理结果会随人工审核同步更新。")
			: isAppleTree
				? __("每条苹果树记录保留奖惩、审批与来源字段；姓名＋部门唯一匹配时自动补全工号。这里只显示无异常或已经审核的记录。")
				: isMissedPunch
					? __("每笔补卡审批完整展示；不能确定的记录需先在异常队列审核，审核完成后会保留审计记录并同步到本页。")
					: isMonthlySupport
						? __("显示系统识别后的金额或逐日工时。数据异常必须先在“异常处理”审核，确认后才会进入月度终稿。")
						: __("每个来源只有一份加工结果；本页只展示无异常或已经处理的记录，人工修改统一在“异常处理”完成并留痕。");
		return `
			<div class="hrms-attendance-section">
				<div class="hrms-attendance-list-head"><div><h3>${this.escape(resultTitle)}</h3><small>${this.escape(resultDescription)}</small></div><div><button class="btn btn-default btn-sm" data-download-processing-result ${canDownload ? "" : "disabled"}>${this.escape(__("下载最新加工结果"))}</button> <button class="btn ${sourceConfirmed ? "btn-default" : "btn-primary"} btn-sm" data-confirm-source ${canConfirm ? "" : "disabled"}>${this.escape(confirmLabel)}</button></div></div>
				<div class="hrms-attendance-result-controls">${this.render_processing_source_tabs()}</div>
				${meta.error ? `<div class="hrms-attendance-api-notice"><strong>${this.escape(__("接口未就绪"))}</strong><span>${this.escape(meta.error)}</span></div>` : ""}
				${!loading && pendingExceptionCount ? `<div class="hrms-attendance-api-notice"><strong>${this.escape(__("仍有待处理异常"))}</strong><span>${this.escape(__("当前来源有 {0} 条异常待处理；请先到“异常处理”完成审核，再确认和下载本类加工结果。", [pendingExceptionCount]))}</span></div>` : ""}
				<div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table"><thead><tr>${headers.map((header) => `<th>${this.escape(__(header))}</th>`).join("")}</tr></thead><tbody>${loading ? `<tr><td colspan="${headers.length}" class="text-muted">${this.escape(__("正在读取加工结果..."))}</td></tr>` : rows.length ? rows.map(renderRow).join("") : `<tr><td colspan="${headers.length}" class="text-muted">${this.escape(pendingExceptionCount ? __("请先处理当前来源的异常。") : __("暂无加工结果；尚未完成加工时不会生成模拟数据。"))}</td></tr>`}</tbody></table></div>
			</div>
		`;
	}

	render_processing_selection_cell(row) {
		const recordId = row.record_id || row.name || row.source_id || "";
		const selectable = Boolean(recordId && row.exception_codes?.length && row.review_status === "待审核");
		return `<td><input type="checkbox" data-processing-record-select="${this.escape(recordId)}" ${selectable ? "" : "disabled"} title="${this.escape(selectable ? __("选择后可批量处理") : __("仅待处理异常可批量处理；已处理记录保留追溯"))}"></td>`;
	}

	processing_record_action_label(row) {
		if (row.review_status === "待审核") return __("处理异常");
		if (row.exception_codes?.length) return __("查看/更正记录");
		return __("查看/调整");
	}

	render_attendance_draft_result_row(row, index) {
		const values = this.processing_values(row);
		const exception = row.exception_codes?.length ? this.exception_label_text(row) : "无";
		const detail = row.exception_detail && row.exception_codes?.length ? `<br><small>${this.escape(row.exception_detail)}</small>` : "";
		return `<tr><td>${this.escape(index + 1)}</td>${this.attendance_draft_columns().map(([field]) => `<td>${this.escape(values[field] ?? "")}</td>`).join("")}<td><strong>${this.escape(exception)}</strong>${detail}</td><td>${this.review_status_badge(row.review_status || "待审核")}</td></tr>`;
	}

	render_apple_tree_result_row(row, index) {
		const values = row.processed_value || {};
		const exception = row.exception_codes?.length ? `${this.exception_label_text(row)}${row.exception_message ? `：${row.exception_message}` : ""}` : "无";
		const trace = [row.source_file, row.source_sheet, row.source_row, row.source_id, row.approval_no].filter((value) => value !== undefined && value !== null && value !== "").join(" · ") || "--";
		return `<tr><td>${this.escape(index + 1)}</td>${this.apple_tree_columns().map(([field]) => `<td class="${["项目", "备注"].includes(field) ? "hrms-attendance-long-cell" : ""}">${this.escape(values[field] ?? row[field] ?? "")}</td>`).join("")}<td class="hrms-attendance-long-cell">${this.escape(exception)}</td><td>${this.review_status_badge(row.review_status || "待审核")}</td><td class="hrms-attendance-trace" title="${this.escape(trace)}">${this.escape(trace)}</td></tr>`;
	}

	render_missed_punch_result_row(row, index) {
		const values = this.effective_missed_punch_values(row);
		const exception = row.exception_codes?.length ? `${this.exception_label_text(row)}${row.exception_message ? `：${row.exception_message}` : ""}` : "无";
		const trace = [row.source_file, row.source_sheet, row.source_row, row.source_id, row.approval_no].filter((value) => value !== undefined && value !== null && value !== "").join(" · ") || "--";
		const displayValue = (field) => field === "included" ? (values[field] ? "是" : "否") : (values[field] ?? row[field] ?? "");
		return `<tr><td>${this.escape(index + 1)}</td>${this.missed_punch_columns().map(([field]) => `<td class="${field === "reason" ? "hrms-attendance-long-cell" : ""}">${this.escape(displayValue(field))}</td>`).join("")}<td class="hrms-attendance-long-cell">${this.escape(exception)}</td><td>${this.review_status_badge(row.review_status || "待审核")}</td><td class="hrms-attendance-trace" title="${this.escape(trace)}">${this.escape(trace)}</td></tr>`;
	}

	render_monthly_support_result_row(row, index, columns) {
		const values = this.processing_values(row);
		const exception = row.exception_codes?.length ? `${this.exception_label_text(row)}${row.exception_message ? `：${row.exception_message}` : ""}` : "无";
		const trace = [row.source_file, row.source_sheet, row.source_row, row.source_id].filter((value) => value !== undefined && value !== null && value !== "").join(" · ") || "--";
		const valueFor = (field) => field === "special_hours_days" ? this.format_special_hours_days(values[field]) : (values[field] ?? row[field] ?? "");
		return `<tr><td>${this.escape(index + 1)}</td>${columns.map(([field]) => `<td class="${field === "special_hours_days" ? "hrms-attendance-long-cell" : ""}">${this.escape(valueFor(field))}</td>`).join("")}<td class="hrms-attendance-long-cell">${this.escape(exception)}</td><td>${this.review_status_badge(row.review_status || "待审核")}</td><td class="hrms-attendance-trace" title="${this.escape(trace)}">${this.escape(trace)}</td></tr>`;
	}

	render_processing_result_row(row) {
		const resultValue = row.confirmed_value ?? row.proposed_value ?? row.result_summary ?? row.processed_value ?? row.value ?? "--";
		const resultText = this.format_processing_value(resultValue);
		const exceptionLabels = row.exception_codes?.length ? this.exception_label_text(row) : "--";
		const trace = [row.source_file, row.source_sheet, row.source_row, row.source_id, row.approval_no].filter((value) => value !== undefined && value !== null && value !== "").join(" · ") || "--";
		return `<tr><td>${this.escape(row.employee_code || row.employee_id || "--")}</td><td>${this.escape(row.employee_name || "--")}</td><td>${this.escape(row.department || "--")}</td><td class="hrms-attendance-long-cell">${this.escape(resultText)}</td><td><strong>${this.escape(exceptionLabels)}</strong><br><small>${this.escape(row.exception_message || "")}</small></td><td>${this.review_status_badge(row.review_status || "待审核")}</td><td class="hrms-attendance-trace" title="${this.escape(trace)}">${this.escape(trace)}</td></tr>`;
	}

	bind_processing_result_events() {
		const body = this.body();
		body.querySelectorAll("[data-result-source]").forEach((button) => button.addEventListener("click", () => {
			this.selected_source_type = button.dataset.resultSource;
			this.load_processing_results();
		}));
		body.querySelector("[data-confirm-source]")?.addEventListener("click", () => (this.monthly_support_sources.some((source) => source.key === this.selected_source_type) ? this.confirm_monthly_support_file(this.selected_source_type) : this.confirm_source_result(this.selected_source_type)));
		body.querySelector("[data-download-processing-result]")?.addEventListener("click", () => this.download_processing_result(this.selected_source_type));
	}

	show_bulk_processing_dialog(sourceType) {
		const recordIds = [...this.selected_exception_record_ids];
		if (!sourceType) {
			frappe.msgprint(__("请先选择一个来源，再批量处理该来源的异常。"));
			return;
		}
		if (!recordIds.length) {
			frappe.msgprint(__("请先勾选需要处理的异常记录。"));
			return;
		}
		const decisions = [
			{ label: __("批量确认当前数据（通过）"), review_status: "已通过" },
			{ label: __("批量标记为不计入下游（驳回）"), review_status: "已驳回" },
			{ label: __("批量保留待审核"), review_status: "待审核" },
		];
		const statusForLabel = (label) => decisions.find((item) => item.label === label)?.review_status;
		const dialog = new frappe.ui.Dialog({
			title: __("批量处理 {0} 条异常", [recordIds.length]),
			fields: [
				{ fieldtype: "HTML", options: `<div class="hrms-attendance-dialog-note">${this.escape(__("请只勾选已核实、可采用同一决定的记录。系统不会擅自修改加工数据；本次决定、原因、操作人和时间会逐条留痕。已通过的记录可进入下游，已驳回的记录保留但不计入下游。"))}</div>` },
				{ fieldtype: "Select", fieldname: "decision", label: __("批量处理方式"), options: decisions.map((item) => item.label).join("\n"), default: decisions[0].label, reqd: 1 },
				{ fieldtype: "Small Text", fieldname: "reason", label: __("处理原因"), reqd: 1 },
			],
			primary_action_label: __("提交批量处理并留痕"),
			primary_action: (values) => {
				const reviewStatus = statusForLabel(values.decision);
				if (!reviewStatus) {
					frappe.msgprint(__("请选择批量处理方式。"));
					return;
				}
				this.call_processing_api(
					"bulk_update_processing_records",
					{
						company: this.company,
						attendance_month: this.attendance_month,
						source_type: sourceType,
						record_ids: JSON.stringify(recordIds),
						review_status: reviewStatus,
						reason: values.reason,
					},
					{
						freeze: true,
						freeze_message: __("正在逐条记录批量处理决定..."),
						on_success: (data) => {
							dialog.hide();
							this.selected_exception_record_ids.clear();
							frappe.show_alert({ message: __("已批量处理 {0} 条记录。", [data.updated_rows || recordIds.length]), indicator: "green" });
							this.load_processing_batch({ rerender_active: false, on_loaded: () => this.load_processing_exceptions() });
						},
						on_error: (message) => frappe.msgprint(message),
					},
				);
			},
		});
		dialog.show();
	}

	download_processing_result(sourceType) {
		this.call_processing_api(
			"export_processing_result",
			{ company: this.company, attendance_month: this.attendance_month, source_type: sourceType },
			{
				freeze: true,
				freeze_message: __("正在生成最新加工结果..."),
				on_success: (data) => {
					const fileUrl = data?.processed_result?.file_url;
					if (fileUrl) window.open(fileUrl, "_blank");
					else frappe.msgprint(__("未能生成下载文件。"));
				},
				on_error: (message) => frappe.msgprint(message),
			},
		);
	}

	open_processing_record_editor(recordId, sourceType = "") {
		this.call_processing_api(
			"get_processing_record",
			{ company: this.company, attendance_month: this.attendance_month, source_type: sourceType || this.selected_source_type, record_id: recordId },
			{
				on_success: (record) => this.show_processing_record_dialog(record),
				on_error: (message) => frappe.msgprint(message),
			},
		);
	}

	show_processing_record_dialog(record) {
		const resolvedRecord = record.review_status && record.review_status !== "待审核";
		const editableFields = (record.editable_fields || []).map((field) => typeof field === "string" ? { fieldname: field, label: field, value: record[field] } : field);
		if (!editableFields.length) {
			editableFields.push(
				{ fieldname: "proposed_value", label: __("建议值"), value: record.proposed_value },
				{ fieldname: "confirmed_value", label: __("确认值"), value: record.confirmed_value },
			);
		}
		const fieldOptions = editableFields.map((field) => field.label || field.fieldname);
		const fieldForLabel = (label) => editableFields.find((field) => (field.label || field.fieldname) === label);
		const reviewOptions = record.review_options || [];
		const reviewOptionForLabel = (label) => reviewOptions.find((option) => option.label === label);
		const dialog = new frappe.ui.Dialog({
			title: __(resolvedRecord ? "查看/更正记录：{0} {1}" : "处理异常：{0} {1}", [record.employee_code || "", record.employee_name || ""]),
			fields: [
				{ fieldtype: "HTML", fieldname: "trace", options: `<div class="hrms-attendance-dialog-note"><strong>${this.escape(this.exception_label_text(record))}</strong><br>${this.escape(record.exception_detail || record.exception_message || "")}<br><br>${resolvedRecord ? this.escape(__("该记录已处理；如需更正，请选择具体字段并填写原因，系统会新增审计记录。")) + "<br><br>" : ""}${this.escape(__("来源：{0} / {1} / 第 {2} 行 / {3}", [record.source_file || "--", record.source_sheet || "--", record.source_row || "--", record.source_id || record.name || "--"]))}</div>` },
				{ fieldtype: "Select", fieldname: "review_solution", label: __("处理方案"), options: [__("请选择处理方案")].concat(reviewOptions.map((option) => option.label)).join("\n"), onchange: () => {
					const option = reviewOptionForLabel(dialog.get_value("review_solution"));
					if (!option) return;
					dialog.set_value("target_field", __("仅记录处理决定（不改数值）"));
					dialog.set_value("new_value", "");
					dialog.set_value("review_status", option.review_status);
					dialog.set_value("reason", option.reason);
				} },
				{ fieldtype: "Select", fieldname: "target_field", label: __("调整字段"), options: fieldOptions.join("\n"), reqd: 1 },
				{ fieldtype: "Data", fieldname: "new_value", label: __("新值（仅调整数据时填写）") },
				{ fieldtype: "Select", fieldname: "review_status", label: __("审核决定"), options: [__("待审核"), __("已通过"), __("已驳回")].join("\n"), default: record.review_status || __("待审核"), reqd: 1 },
				{ fieldtype: "Small Text", fieldname: "reason", label: __("调整原因"), reqd: 1 },
			],
			primary_action_label: __("提交调整并留痕"),
			primary_action: (values) => {
				const field = fieldForLabel(values.target_field);
				if (!field) {
					frappe.msgprint(__("请选择处理方式或调整字段。"));
					return;
				}
				if (field.fieldname !== "__review_decision__" && (values.new_value === undefined || values.new_value === "")) {
					frappe.msgprint(__("调整数据时必须填写新值。"));
					return;
				}
				this.call_processing_api(
					"update_processing_record",
					{ company: this.company, attendance_month: this.attendance_month, source_type: record.source_type || this.selected_source_type, record_id: record.record_id || record.name, field_name: field.fieldname, original_value: field.value, new_value: values.new_value, review_status: values.review_status, reason: values.reason },
					{
						freeze: true,
						freeze_message: __("正在记录原值、新值和调整原因..."),
						on_success: () => { dialog.hide(); this.load_processing_results(); },
						on_error: (message) => frappe.msgprint(message),
					},
				);
			},
		});
		dialog.show();
	}

	confirm_source_result(sourceType) {
		this.call_processing_api(
			"confirm_source_result",
			{ company: this.company, attendance_month: this.attendance_month, source_type: sourceType },
			{
				freeze: true,
				freeze_message: __("正在确认加工结果..."),
				on_success: (data) => { frappe.show_alert({ message: __("本类结果已确认；{0} 条未处理异常已排除在下游计算之外。", [data.pending_review_rows ?? data.pending_rows ?? 0]), indicator: "green" }); this.load_processing_batch({ rerender_active: false, on_loaded: () => this.load_processing_results() }); },
				on_error: (message) => frappe.msgprint(message),
			},
		);
	}

	load_processing_exceptions() {
		const body = this.body();
		this.selected_exception_record_ids.clear();
		body.innerHTML = this.render_processing_exceptions([], true);
		if (!this.ensure_company()) return;
		const args = { company: this.company, attendance_month: this.attendance_month };
		if (this.exception_source_filter) args.source_type = this.exception_source_filter;
		this.call_processing_api(
			"list_processing_exceptions",
			args,
			{
					on_success: (data) => { body.innerHTML = this.render_processing_exceptions(data.review_rows || [], false, "", data); this.bind_processing_exception_events(); },
				on_error: (message) => { body.innerHTML = this.render_processing_exceptions([], false, message); this.bind_processing_exception_events(); },
			},
		);
	}

	render_exception_source_filter() {
		return `<div class="hrms-attendance-result-tabs"><button class="btn btn-default btn-sm ${!this.exception_source_filter ? "active" : ""}" data-exception-source="">${this.escape(__("全部来源"))}</button>${this.exception_sources.map((source) => `<button class="btn btn-default btn-sm ${source.key === this.exception_source_filter ? "active" : ""}" data-exception-source="${this.escape(source.key)}">${this.escape(__(source.label))}</button>`).join("")}</div>`;
	}

	render_processing_exceptions(rows = [], loading = false, error = "", summary = {}) {
		const canBulkProcess = Boolean(this.exception_source_filter);
		const selectedCount = this.selected_exception_record_ids.size;
		const selectedSourceLabel = this.exception_source_filter ? this.processing_source_label(this.exception_source_filter) : __("全部来源");
		const totalPending = Number(summary.total_pending_count || 0);
		const currentPending = Number(summary.filtered_pending_count ?? rows.length);
		const scopeSummary = loading ? __("正在读取异常数量...") : __("当前筛选：{0}，待处理 {1} 条；全部来源共 {2} 条。", [selectedSourceLabel, currentPending, totalPending]);
		const filterNotice = !loading && this.exception_source_filter && !currentPending && totalPending
			? `<div class="hrms-attendance-api-notice"><strong>${this.escape(__("当前来源没有异常"))}</strong><span>${this.escape(__("其他来源仍有 {0} 条待处理异常；点击“全部来源”即可查看。", [totalPending]))}</span></div>`
			: "";
		const renderRow = (row) => {
			const recordId = row.record_id || row.source_id || row.name || "";
			return `<tr>
				<td><input type="checkbox" data-exception-record-select="${this.escape(recordId)}" ${canBulkProcess && recordId ? "" : "disabled"} title="${this.escape(canBulkProcess ? __("选择后可批量处理") : __("请先按来源筛选，再进行批量处理"))}"></td>
				<td>${this.escape(`${row.employee_code || "--"} ${row.employee_name || ""}`)}</td>
				<td>${this.escape(row.source_label || this.processing_source_label(row.source_type))}</td>
				<td class="hrms-attendance-long-cell">${this.escape(this.format_processing_value(row.confirmed_value ?? row.proposed_value))}</td>
				<td><strong>${this.escape(this.exception_label_text(row))}</strong><br><small>${this.escape(row.exception_detail || row.exception_message || "")}</small></td>
				<td>${this.review_status_badge(row.review_status || "待审核")}<br><small>${this.escape(`${row.reviewer || "--"} ${row.reviewed_on || ""}`)}</small><br><small>${this.escape(row.review_note || "")}</small></td>
				<td><button class="btn btn-default btn-xs" data-edit-exception="${this.escape(row.record_id || row.source_id || row.name || "")}" data-exception-source-type="${this.escape(row.source_type || "")}">${this.escape(__("处理异常"))}</button></td>
			</tr>`;
		};
		return `<div class="hrms-attendance-section"><div class="hrms-attendance-list-head"><div><h3>${this.escape(__("异常处理"))}</h3><small>${this.escape(__("这里只显示待处理异常：未匹配或内容冲突的记录不计入下游。请按来源筛选后批量处理；处理完成后会从此队列移除，仍保留在加工结果和人工调整记录中。"))}</small></div><div><strong>${this.escape(scopeSummary)}</strong><br><button class="btn btn-default btn-sm" data-bulk-exception-process ${canBulkProcess && selectedCount ? "" : "disabled"}>${this.escape(__("批量处理（{0}）", [selectedCount]))}</button></div></div><div class="hrms-attendance-result-controls">${this.render_exception_source_filter()}${!canBulkProcess ? `<small class="text-muted">${this.escape(__("请选择一个来源后，可勾选并批量处理异常。"))}</small>` : ""}</div>${filterNotice}${error ? `<div class="hrms-attendance-api-notice"><strong>${this.escape(__("接口未就绪"))}</strong><span>${this.escape(error)}</span></div>` : ""}<div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table"><thead><tr><th><input type="checkbox" data-select-exception-all ${canBulkProcess && rows.length ? "" : "disabled"} title="${this.escape(__("选择当前来源的全部异常"))}"></th><th>${this.escape(__("员工"))}</th><th>${this.escape(__("来源"))}</th><th>${this.escape(__("加工数据"))}</th><th>${this.escape(__("异常说明"))}</th><th>${this.escape(__("审核"))}</th><th>${this.escape(__("操作"))}</th></tr></thead><tbody>${loading ? `<tr><td colspan="7" class="text-muted">${this.escape(__("正在读取统一异常队列..."))}</td></tr>` : rows.length ? rows.map(renderRow).join("") : `<tr><td colspan="7" class="text-muted">${this.escape(__("当前筛选下没有待处理异常；已处理记录可在加工结果和人工调整记录中查看。"))}</td></tr>`}</tbody></table></div></div>`;
	}

	bind_processing_exception_events() {
		const body = this.body();
		body.querySelectorAll("[data-exception-source]").forEach((button) => button.addEventListener("click", () => { this.exception_source_filter = button.dataset.exceptionSource; this.selected_exception_record_ids.clear(); this.load_processing_exceptions(); }));
		const selectableInputs = [...body.querySelectorAll("[data-exception-record-select]")].filter((input) => !input.disabled);
		const updateSelection = () => {
			const selectedCount = this.selected_exception_record_ids.size;
			const bulkButton = body.querySelector("[data-bulk-exception-process]");
			if (bulkButton) {
				bulkButton.disabled = !this.exception_source_filter || !selectedCount;
				bulkButton.textContent = __("批量处理（{0}）", [selectedCount]);
			}
			const selectAll = body.querySelector("[data-select-exception-all]");
			if (selectAll) {
				selectAll.checked = Boolean(selectableInputs.length) && selectableInputs.every((input) => input.checked);
				selectAll.indeterminate = selectableInputs.some((input) => input.checked) && !selectAll.checked;
			}
		};
		body.querySelector("[data-select-exception-all]")?.addEventListener("change", (event) => {
			selectableInputs.forEach((input) => {
				input.checked = event.target.checked;
				if (input.checked) this.selected_exception_record_ids.add(input.dataset.exceptionRecordSelect);
				else this.selected_exception_record_ids.delete(input.dataset.exceptionRecordSelect);
			});
			updateSelection();
		});
		selectableInputs.forEach((input) => input.addEventListener("change", () => {
			if (input.checked) this.selected_exception_record_ids.add(input.dataset.exceptionRecordSelect);
			else this.selected_exception_record_ids.delete(input.dataset.exceptionRecordSelect);
			updateSelection();
		}));
		body.querySelector("[data-bulk-exception-process]")?.addEventListener("click", () => this.show_bulk_processing_dialog(this.exception_source_filter));
		body.querySelectorAll("[data-edit-exception]").forEach((button) => button.addEventListener("click", () => this.open_processing_record_editor(button.dataset.editException, button.dataset.exceptionSourceType)));
	}

	load_processing_ledger(kind) {
		const body = this.body();
		const method = kind === "batches" ? "list_processing_batches" : "list_manual_adjustments";
		body.innerHTML = this.render_processing_ledger(kind, [], true);
		if (!this.ensure_company()) return;
		this.call_processing_api(method, { company: this.company, attendance_month: this.attendance_month }, {
			on_success: (data) => { body.innerHTML = this.render_processing_ledger(kind, data.rows || data.items || [], false); },
			on_error: (message) => { body.innerHTML = this.render_processing_ledger(kind, [], false, message); },
		});
	}

	render_processing_ledger(kind, rows = [], loading = false, error = "") {
		const isBatch = kind === "batches";
		const title = isBatch ? "导入批次" : "人工调整记录";
		const headers = isBatch ? ["批次", "月份", "考勤初稿", "苹果树", "忘打卡", "创建时间"] : ["员工", "来源", "字段", "原值", "新值", "原因", "操作人", "时间"];
		const renderRow = (row) => isBatch
			? `<tr><td>${this.escape(row.batch_id || row.name || "--")}</td><td>${this.escape(row.attendance_month || "--")}</td><td>${this.escape(row.attendance_draft_status || "--")}</td><td>${this.escape(row.apple_tree_status || "--")}</td><td>${this.escape(row.missing_card_status || "--")}</td><td>${this.escape(row.created_at || row.creation || "--")}</td></tr>`
			: `<tr><td>${this.escape(`${row.employee_code || "--"} ${row.employee_name || ""}`)}</td><td>${this.escape(this.processing_source_label(row.source_type))}</td><td>${this.escape(row.field_name === "__review_decision__" ? __("仅记录处理决定") : this.processing_field_label(row.field_name))}</td><td>${this.escape(this.format_processing_value(row.original_value))}</td><td>${this.escape(this.format_processing_value(row.new_value))}</td><td>${this.escape(row.reason || "--")}</td><td>${this.escape(row.modified_by || row.operator || "--")}</td><td>${this.escape(row.modified_at || row.creation || "--")}</td></tr>`;
		return `<div class="hrms-attendance-section"><div class="hrms-attendance-list-head"><div><h3>${this.escape(__(title))}</h3><small>${this.escape(__(isBatch ? "按月查看三个输入槽的独立状态。" : "人工改动保留原值、新值、原因、操作人和时间。"))}</small></div></div>${error ? `<div class="hrms-attendance-api-notice"><strong>${this.escape(__("接口未就绪"))}</strong><span>${this.escape(error)}</span></div>` : ""}<div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table"><thead><tr>${headers.map((header) => `<th>${this.escape(__(header))}</th>`).join("")}</tr></thead><tbody>${loading ? `<tr><td colspan="${headers.length}" class="text-muted">${this.escape(__("正在读取台账..."))}</td></tr>` : rows.length ? rows.map(renderRow).join("") : `<tr><td colspan="${headers.length}" class="text-muted">${this.escape(__("暂无台账记录。"))}</td></tr>`}</tbody></table></div></div>`;
	}

	load_processing_configuration() {
		const labels = { "field-mapping": "字段映射", "department-mapping": "部门映射", "processing-rules": "处理规则" };
		const body = this.body();
		const title = labels[this.active_view];
		body.innerHTML = this.render_processing_configuration(title, [], true);
		this.call_processing_api("get_processing_configuration", { company: this.company, configuration_type: this.active_view }, {
			on_success: (data) => { body.innerHTML = this.render_processing_configuration(title, data.rows || data.items || [], false); },
			on_error: (message) => { body.innerHTML = this.render_processing_configuration(title, [], false, message); },
		});
	}

	render_processing_configuration(title, rows = [], loading = false, error = "") {
		return `<div class="hrms-attendance-section"><div class="hrms-attendance-list-head"><div><h3>${this.escape(__(title))}</h3><small>${this.escape(__("规则配置由服务端保存版本并用于后续批次；本页不把展示值伪装成已生效规则。"))}</small></div></div>${error ? `<div class="hrms-attendance-api-notice"><strong>${this.escape(__("接口未就绪"))}</strong><span>${this.escape(error)}</span></div>` : ""}<div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table"><thead><tr><th>${this.escape(__("名称"))}</th><th>${this.escape(__("来源值"))}</th><th>${this.escape(__("目标值/规则"))}</th><th>${this.escape(__("状态"))}</th></tr></thead><tbody>${loading ? `<tr><td colspan="4" class="text-muted">${this.escape(__("正在读取配置..."))}</td></tr>` : rows.length ? rows.map((row) => `<tr><td>${this.escape(row.label || row.name || "--")}</td><td>${this.escape(row.source_value || "--")}</td><td>${this.escape(row.target_value || row.rule_expression || "--")}</td><td>${this.escape(row.status || "--")}</td></tr>`).join("") : `<tr><td colspan="4" class="text-muted">${this.escape(__("暂无已发布配置。"))}</td></tr>`}</tbody></table></div></div>`;
	}

	load_monthly_final() {
		this.render_monthly_final();
		this.load_processing_batch({ rerender_active: true });
	}

	get_final_source_checks(batch = {}) {
		const mainSlots = new Map((batch.slots || []).map((slot) => [slot.source_type, slot]));
		const supplied = new Map((batch.finalization_inputs || []).map((item) => [item.source_type || item.key, item]));
		return this.final_required_sources.map((source) => {
			const external = supplied.get(source.key);
			const slot = mainSlots.get(source.key);
			if (external) {
				return {
					...source,
					...external,
					ready: Boolean(external.ready ?? external.is_ready ?? external.status === "已就绪"),
					status: external.status || (external.ready ? "已就绪" : "未就绪"),
					snapshot_version: external.snapshot_version || external.locked_snapshot_version || "",
				};
			}
			if (slot) {
				return {
					...source,
					ready: slot.status === "已确认",
					status: slot.status,
					snapshot_version: slot.snapshot_version || slot.confirmed_snapshot_version || "",
				};
			}
			return { ...source, ready: false, status: "未就绪", snapshot_version: "" };
		});
	}

	render_monthly_support_imports(checks) {
		const supportByKey = new Map(checks.map((check) => [check.key, check]));
		return `
			<section class="hrms-attendance-monthly-support">
				<div class="hrms-attendance-list-head"><div><h3>${this.escape(__("月度补充来源"))}</h3><small>${this.escape(__("住房补贴、全勤奖、特殊工时各自上传并直接加工检查；异常统一进入“异常处理”。重新上传会形成新版本，不覆盖旧文件。"))}</small></div></div>
				<div class="hrms-attendance-monthly-support-grid">
					${this.monthly_support_sources.map((source) => {
						const check = supportByKey.get(source.key) || { ...source, status: "未就绪", record_count: 0 };
						const fileName = check.source_file_name || check.source_file || "--";
						const pendingExceptions = Number(check.pending_exception_count || 0);
						const processedRows = Number(check.processed_rows || 0);
						const detectionCompleted = processedRows > 0 || ["待处理异常", "待确认", "已确认", "已就绪"].includes(check.status);
						const exceptionDisplay = detectionCompleted ? pendingExceptions : __("待检测");
						const canProcess = Boolean(check.can_process) || Boolean(check.source_file && !processedRows && ["待加工", "需补做加工检查"].includes(check.status));
						return `<article class="hrms-attendance-source-card"><div class="hrms-attendance-source-card__head"><div><strong>${this.escape(__(source.label))}</strong><small>${this.escape(__(check.description || source.description))}</small></div>${this.status_badge(check.status)}</div><dl><div><dt>${this.escape(__("文件"))}</dt><dd title="${this.escape(fileName)}">${this.escape(fileName)}</dd></div><div><dt>${this.escape(__("识别记录"))}</dt><dd>${this.escape(check.record_count || "--")}</dd></div><div><dt>${this.escape(__("待处理异常"))}</dt><dd>${this.escape(exceptionDisplay)}</dd></div><div><dt>${this.escape(__("加工记录"))}</dt><dd>${this.escape(processedRows || "--")}</dd></div></dl><div class="hrms-attendance-source-card__actions"><button class="btn btn-default btn-xs" data-monthly-support-upload="${this.escape(source.key)}">${this.escape(__(check.source_file ? "重新上传" : "上传文件"))}</button><button class="btn btn-default btn-xs" data-monthly-support-process="${this.escape(source.key)}" ${canProcess ? "" : "disabled"}>${this.escape(__("加工并检查"))}</button><button class="btn btn-default btn-xs" data-monthly-support-exceptions="${this.escape(source.key)}" ${pendingExceptions ? "" : "disabled"}>${this.escape(__("处理异常"))}</button><button class="btn btn-primary btn-xs" data-monthly-support-confirm="${this.escape(source.key)}" ${check.can_confirm ? "" : "disabled"}>${this.escape(__("确认来源"))}</button><button class="btn btn-default btn-xs" data-monthly-support-results="${this.escape(source.key)}" ${processedRows ? "" : "disabled"}>${this.escape(__("查看加工结果"))}</button></div></article>`;
					}).join("")}
				</div>
			</section>
		`;
	}

	render_monthly_final_markup(batch = this.processing_batch) {
		const checks = this.get_final_source_checks(batch || {});
		const lockedSnapshot = batch?.locked_snapshot_version || batch?.final_outputs?.locked_snapshot_version || "";
		const sourcesReady = checks.length > 0 && checks.every((check) => check.ready);
		const ready = sourcesReady && Boolean(batch?.snapshot_ready ?? true);
		const outputs = batch?.final_outputs || {};
		return `<div class="hrms-attendance-section"><div class="hrms-attendance-list-head"><div><h3>${this.escape(__("月度终稿"))}</h3><small>${this.escape(__("六类来源全部确认后，系统将在生成时自动锁定同一快照并输出两份终稿。"))}</small></div><button class="btn btn-primary btn-sm" data-generate-final ${ready ? "" : "disabled"}>${this.escape(__("锁定并生成终稿"))}</button></div>${this.render_processing_notice()}<section class="hrms-attendance-final-checklist"><div class="hrms-attendance-final-checklist__head"><strong>${this.escape(__("来源完备性 / 锁定快照"))}</strong><span>${this.escape(sourcesReady ? __("来源已就绪；生成时将创建锁定快照") : __("请完成所有来源确认与异常处理后再生成终稿"))}</span></div><div class="hrms-attendance-final-readiness">${checks.map((check) => `<div><strong>${this.escape(__(check.label))}</strong><small>${this.escape(__(check.kind))}</small>${this.status_badge(check.status)}<em>${this.escape(lockedSnapshot ? __("锁定快照：{0}", [lockedSnapshot]) : __("生成时锁定"))}</em></div>`).join("")}</div></section>${this.render_monthly_support_imports(checks)}<div class="hrms-attendance-final-grid"><article><strong>${this.escape(__("员工签字版"))}</strong><p>${this.escape(__("保留完整核算列，供员工核对、备注与签字。"))}</p><button class="btn btn-default btn-sm" data-preview-final="signed" ${outputs.signed_file_url ? "" : "disabled"}>${this.escape(__("网页查看"))}</button> <button class="btn btn-default btn-sm" data-download-final="signed" ${outputs.signed_file_url ? "" : "disabled"}>${this.escape(__("下载员工签字版"))}</button></article><article><strong>${this.escape(__("财务版"))}</strong><p>${this.escape(__("只保留薪资计算所需字段；生成后可先在网页核对。"))}</p><button class="btn btn-default btn-sm" data-preview-final="finance" ${outputs.finance_file_url ? "" : "disabled"}>${this.escape(__("网页查看"))}</button> <button class="btn btn-default btn-sm" data-download-final="finance" ${outputs.finance_file_url ? "" : "disabled"}>${this.escape(__("下载财务版"))}</button></article></div><div class="hrms-attendance-process-footnote">${this.escape(__(outputs.locked_version ? `当前锁定版本：${outputs.locked_version}；两个文件来自同一已锁定数据。` : "尚未生成锁定版本。"))}</div></div>`;
	}

	bind_monthly_final_events(body) {
		body.querySelector("[data-generate-final]")?.addEventListener("click", () => this.generate_monthly_final_files());
		body.querySelectorAll("[data-download-final]").forEach((button) => button.addEventListener("click", () => this.download_final_file(button.dataset.downloadFinal)));
		body.querySelectorAll("[data-preview-final]").forEach((button) => button.addEventListener("click", () => this.open_monthly_final_preview(button.dataset.previewFinal)));
		body.querySelectorAll("[data-monthly-support-upload]").forEach((button) => button.addEventListener("click", () => this.open_monthly_support_uploader(button.dataset.monthlySupportUpload)));
		body.querySelectorAll("[data-monthly-support-process]").forEach((button) => button.addEventListener("click", () => this.process_monthly_support_file(button.dataset.monthlySupportProcess)));
		body.querySelectorAll("[data-monthly-support-exceptions]").forEach((button) => button.addEventListener("click", () => { this.exception_source_filter = button.dataset.monthlySupportExceptions; this.set_view("exceptions"); }));
		body.querySelectorAll("[data-monthly-support-confirm]").forEach((button) => button.addEventListener("click", () => this.confirm_monthly_support_file(button.dataset.monthlySupportConfirm)));
		body.querySelectorAll("[data-monthly-support-results]").forEach((button) => button.addEventListener("click", () => { this.selected_source_type = button.dataset.monthlySupportResults; this.set_view("processing-results"); }));
	}

	render_monthly_final() {
		const body = this.body();
		if (!body) return;
		body.innerHTML = this.render_monthly_final_markup(this.processing_batch);
		this.bind_monthly_final_events(body);
	}

	open_monthly_support_uploader(sourceType) {
		if (!this.ensure_company()) return;
		new frappe.ui.FileUploader({
			folder: "Home/Attachments",
			restrictions: { allowed_file_types: [".xlsx"] },
			on_success: (file) => this.call_processing_api("register_monthly_support_file", {
				company: this.company, attendance_month: this.attendance_month, source_type: sourceType, file_url: file.file_url,
			}, {
				freeze: true,
				freeze_message: __("正在登记月度补充来源文件..."),
				on_success: () => { frappe.show_alert({ message: __("文件已上传，请直接加工并检查。"), indicator: "green" }); this.load_monthly_final(); },
				on_error: (message) => frappe.msgprint(message),
			}),
		});
	}

	process_monthly_support_file(sourceType) {
		this.call_processing_api("process_monthly_support_file", {
			company: this.company, attendance_month: this.attendance_month, source_type: sourceType,
		}, {
			freeze: true,
			freeze_message: __("正在加工月度补充来源并检查异常..."),
			on_success: (data) => { frappe.show_alert({ message: data.metrics?.exception_rows ? __("已发现 {0} 条异常，请前往异常处理。", [data.metrics.exception_rows]) : __("加工检查完成，可确认来源。"), indicator: data.metrics?.exception_rows ? "orange" : "green" }); this.load_monthly_final(); },
			on_error: (message) => frappe.msgprint(message),
		});
	}

	confirm_monthly_support_file(sourceType) {
		this.call_processing_api("confirm_monthly_support_file", {
			company: this.company, attendance_month: this.attendance_month, source_type: sourceType,
		}, {
			freeze: true,
			freeze_message: __("正在确认月度补充来源..."),
			on_success: () => { frappe.show_alert({ message: __("月度补充来源已确认。"), indicator: "green" }); this.load_monthly_final(); },
			on_error: (message) => frappe.msgprint(message),
		});
	}

	generate_monthly_final_files() {
		this.call_processing_api(
			"generate_monthly_final_files",
			{ company: this.company, attendance_month: this.attendance_month, snapshot_version: this.processing_batch?.locked_snapshot_version || this.processing_batch?.final_outputs?.locked_snapshot_version || "" },
			{
				freeze: true,
				freeze_message: __("正在锁定同源数据并生成两个终稿版本..."),
			on_success: (data) => {
				if (data?.blocked) {
					frappe.msgprint({ title: __("终稿尚不能生成"), indicator: "orange", message: this.escape(data.reason || __("来源未完备或锁定快照不一致。")) });
					this.load_monthly_final();
					return;
				}
				frappe.show_alert({ message: __("终稿已从同一锁定版本生成。"), indicator: "green" });
				this.load_monthly_final();
			},
				on_error: (message) => frappe.msgprint(message),
			},
		);
	}

	download_final_file(kind) {
		const outputs = this.processing_batch?.final_outputs || {};
		const fileUrl = kind === "signed" ? outputs.signed_file_url : outputs.finance_file_url;
		if (!fileUrl) return frappe.msgprint(__("该终稿文件尚未生成。"));
		window.open(fileUrl, "_blank");
	}

	open_monthly_final_preview(kind) {
		this.call_processing_api("get_monthly_final_preview", {
			company: this.company, attendance_month: this.attendance_month, kind,
		}, {
			freeze: true,
			freeze_message: __("正在读取锁定终稿..."),
			on_success: (data) => {
				if (!data?.available) {
					frappe.msgprint({ title: __("暂不能查看终稿"), indicator: "orange", message: this.escape(data?.reason || __("请先生成终稿。")) });
					return;
				}
				const columns = data.columns || [];
				const rows = data.rows || [];
				const table = `<div class="hrms-attendance-table-wrap"><table class="table table-bordered hrms-attendance-table"><thead><tr>${columns.map((column) => `<th>${this.escape(__(column.label))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${this.escape(row[column.field] ?? "")}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length || 1}" class="text-muted">${this.escape(__("当前锁定版本没有可展示的数据。"))}</td></tr>`}</tbody></table></div>`;
				const dialog = new frappe.ui.Dialog({
					title: __("{0}网页查看", [data.title || __("月度终稿")]),
					fields: [{ fieldtype: "HTML", fieldname: "final_preview", options: `<div class="hrms-attendance-dialog-note">${this.escape(__("锁定快照：{0}；此表与下载文件使用相同数据。", [data.locked_snapshot_version]))}</div>${table}` }],
					size: "extra-large",
				});
				dialog.show();
			},
			on_error: (message) => frappe.msgprint(message),
		});
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
