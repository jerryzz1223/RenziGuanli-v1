frappe.pages["employee-detail"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("员工档案详情"),
		single_column: true,
	});

	wrapper.employee_detail = new EmployeeDetailPage(page);
	wrapper.employee_detail.show();
};

frappe.pages["employee-detail"].on_page_show = function (wrapper) {
	wrapper.employee_detail?.refresh_from_route();
};

class EmployeeDetailPage {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.employee = "";
		this.detail = null;
		this.navigation = {};
		this.load_request_id = 0;
		this.loading_employee = "";
		this.load_promise = null;
		this.last_loaded_at = 0;
		this.cache_ttl = 30_000;
		this.active_tab = "概览";
		this.expanded_related = {};
		this.tabs = ["概览", "在职信息", "个人信息", "联系信息", "工资社保", "合同信息", "材料附件", "背景调查"];
		this.section_alias = {
			在职信息: "在职信息",
			个人信息: "个人信息",
			联系信息: "联系信息",
			工资社保: "工资社保",
			合同信息: "合同保险",
			材料附件: "附件",
			背景调查: "背景调查",
		};
	}

	show() {
		document.body.classList.add("hrms-employee-detail-view");
		this.page.set_secondary_action(__("返回花名册"), () => frappe.set_route("List", "Employee"));
		this.bind_personnel_status_updates();
		this.refresh_from_route();
	}

	bind_personnel_status_updates() {
		if (this.personnel_status_updates_bound || !frappe.realtime?.on) return;
		this.personnel_status_updates_bound = true;
		frappe.realtime.on("hrms_employee_personnel_status_updated", (payload = {}) => {
			if (!payload.employee || payload.employee !== this.employee) return;
			this.last_loaded_at = 0;
			this.load(this.employee);
		});
	}

	refresh_from_route() {
		const route_employee = String(frappe.get_route()[1] || "").trim();
		const invalid_route_employee = /^(undefined|null)$/i.test(route_employee);
		if (invalid_route_employee) {
			frappe.set_route("List", "Employee");
			return Promise.resolve();
		}
		const employee = route_employee;
		const employee_changed = employee !== this.employee;
		if (employee_changed) {
			this.employee = employee;
			this.detail = null;
			this.navigation = {};
			this.last_loaded_at = 0;
			this.active_tab = "概览";
			this.expanded_related = {};
		}

		// on_page_load and on_page_show can run back-to-back. Reuse the active
		// request and keep a recently loaded cached page responsive.
		if (this.loading_employee === employee && this.load_promise) {
			return this.load_promise;
		}
		if (!employee_changed && this.detail && Date.now() - this.last_loaded_at < this.cache_ttl) {
			return Promise.resolve(this.detail);
		}

		return this.load(employee);
	}

	load(employee = this.employee) {
		const request_id = ++this.load_request_id;
		if (!employee) {
			this.loading_employee = "";
			this.load_promise = null;
			this.detail = null;
			this.navigation = {};
			this.page.set_title(__("员工档案详情"));
			this.wrapper.innerHTML = `<div class="text-muted">${__("请选择员工")}</div>`;
			return Promise.resolve();
		}

		this.loading_employee = employee;
		this.page.set_title(__("员工档案详情"));
		this.wrapper.innerHTML = `<div class="text-muted hrms-employee-detail-loading">${__("正在加载员工档案...")}</div>`;

		const detail_request = frappe.call({
			method: "hrms.api.employee_field_template.get_employee_detail",
			args: { employee },
		});
		const navigation_request = frappe.call({
			method: "hrms.api.employee_field_template.get_employee_detail_navigation",
			args: {
				employee,
				filters: JSON.stringify({
					company:
						window.hrmsCompanyContext?.getCurrentCompany?.() ||
						frappe.defaults?.get_user_default?.("Company") ||
						"",
				}),
			},
		});

		this.load_promise = Promise.all([detail_request, navigation_request])
			.then(([detail_response, navigation_response]) => {
				if (!this.is_current_request(request_id, employee)) return;
				this.detail = detail_response.message || {};
				this.navigation = navigation_response.message || {};
				this.last_loaded_at = Date.now();
				this.render();
			})
			.catch(() => {
				if (!this.is_current_request(request_id, employee)) return;
				this.detail = null;
				this.navigation = {};
				this.last_loaded_at = 0;
				this.page.set_title(__("员工档案详情"));
				this.wrapper.innerHTML = `<div class="text-muted">${__("员工档案加载失败，请重试。")}</div>`;
			})
			.finally(() => {
				if (!this.is_current_request(request_id, employee)) return;
				this.loading_employee = "";
				this.load_promise = null;
			});

		return this.load_promise;
	}

	is_current_request(request_id, employee) {
		return request_id === this.load_request_id && employee === this.employee;
	}

	render() {
		const header = this.detail?.header || {};
		this.page.set_title(header.employee_name || __("员工档案详情"));
		this.wrapper.innerHTML = `
			${this.render_styles()}
			<div class="hrms-employee-detail hrms-employee-detail-shell">
				${this.render_header(header)}
				${this.render_tabs()}
				<div class="hrms-employee-detail-body">${this.render_active_tab()}</div>
				${this.render_bottom_navigation()}
			</div>
		`;
		this.bind_events();
	}

	render_styles() {
		return `
			<style>
				.hrms-employee-detail {
					max-width: 1160px;
					margin: 0 auto;
					padding: 14px 0 76px;
					color: var(--text-color, #1f2933);
				}
				body.hrms-employee-detail-view .hrms-employee-detail-shell {
					--hrms-accent: #10b981;
					--hrms-accent-soft: #ecfdf5;
					--hrms-border: #e6edf3;
					--hrms-muted: #687385;
					--hrms-bg: #f7f9fb;
				}
				.hrms-employee-detail-shell {
					font-size: 13px;
				}
				.hrms-employee-detail-card-panel,
				.hrms-employee-detail-section,
				.hrms-employee-detail-side-card {
					background: #fff;
					border: 1px solid var(--hrms-border);
					border-radius: 6px;
				}
				.hrms-employee-detail-profile-card {
					box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
				}
				.hrms-employee-detail-header {
					padding: 24px 28px 18px;
				}
				.hrms-employee-detail-profile {
					display: grid;
					grid-template-columns: 64px minmax(0, 1fr) auto;
					gap: 18px;
					align-items: start;
				}
				.hrms-employee-detail-avatar {
					position: relative;
					width: 64px;
					height: 64px;
					border-radius: 50%;
					background: #eef3f7;
					overflow: hidden;
					display: flex;
					align-items: center;
					justify-content: center;
				}
				.hrms-employee-detail-avatar img {
					width: 100%;
					height: 100%;
					object-fit: cover;
				}
				.hrms-employee-detail-avatar-upload {
					position: absolute;
					inset: 0;
					display: flex;
					align-items: center;
					justify-content: center;
					padding: 6px;
					border: 0;
					border-radius: 50%;
					background: rgba(15, 23, 42, 0.64);
					color: #fff;
					font-size: 12px;
					line-height: 1.25;
					text-align: center;
					opacity: 0;
					transition: opacity 0.16s ease;
				}
				.hrms-employee-detail-avatar:hover .hrms-employee-detail-avatar-upload,
				.hrms-employee-detail-avatar:focus-within .hrms-employee-detail-avatar-upload {
					opacity: 1;
				}
				.hrms-employee-detail-title {
					display: flex;
					align-items: center;
					gap: 8px;
					margin-bottom: 8px;
				}
				.hrms-employee-detail-title h2 {
					margin: 0;
					font-size: 22px;
					font-weight: 600;
				}
				.hrms-employee-detail-tag {
					display: inline-flex;
					align-items: center;
					height: 22px;
					padding: 0 8px;
					border-radius: 4px;
					background: #f3f5f7;
					color: #4b5563;
					font-size: 12px;
				}
				.hrms-employee-detail-meta {
					display: flex;
					flex-wrap: wrap;
					gap: 6px 12px;
					color: var(--hrms-muted);
					font-size: 13px;
					line-height: 1.7;
				}
				.hrms-employee-detail-actions {
					display: flex;
					gap: 8px;
					align-items: center;
					flex-wrap: wrap;
					justify-content: flex-end;
					max-width: 390px;
				}
				.hrms-employee-detail-section-tools {
					display: flex;
					align-items: center;
					gap: 8px;
				}
				.hrms-employee-detail-action-strip .btn-primary {
					background-color: var(--hrms-accent);
					border-color: var(--hrms-accent);
				}
				.hrms-employee-detail-tabs {
					display: flex;
					justify-content: center;
					gap: 22px;
					background: #fff;
					border: 1px solid var(--hrms-border);
					border-top: 0;
					border-radius: 0 0 6px 6px;
					margin-bottom: 14px;
					padding: 0 24px;
				}
				.hrms-employee-detail-sticky-tabs {
					position: sticky;
					top: 0;
					z-index: 4;
				}
				.hrms-employee-detail-tab {
					border: 0;
					background: transparent;
					height: 52px;
					padding: 0 2px;
					color: #4b5563;
					border-bottom: 2px solid transparent;
				}
				.hrms-employee-detail-tab.is-active {
					color: var(--hrms-accent);
					border-bottom-color: var(--hrms-accent);
					font-weight: 600;
				}
				.hrms-employee-detail-overview {
					display: grid;
					grid-template-columns: minmax(0, 1fr) 286px;
					gap: 14px;
				}
				.hrms-employee-detail-main-stack,
				.hrms-employee-detail-side-panel {
					display: grid;
					gap: 14px;
				}
				.hrms-employee-detail-section {
					padding: 18px 22px 22px;
				}
				.hrms-employee-detail-section-card {
					box-shadow: 0 1px 2px rgba(15, 23, 42, 0.025);
				}
				.hrms-employee-detail-section__header {
					display: flex;
					align-items: center;
					justify-content: space-between;
					margin-bottom: 18px;
				}
				.hrms-employee-detail-section__header h3 {
					margin: 0;
					font-size: 15px;
					font-weight: 600;
				}
				.hrms-employee-detail-info-grid {
					display: grid;
					grid-template-columns: repeat(2, minmax(0, 1fr));
					column-gap: 32px;
					row-gap: 12px;
					padding: 0 8px;
				}
				.hrms-employee-detail-field {
					display: grid;
					grid-template-columns: 118px minmax(0, 1fr);
					gap: 12px;
					min-height: 22px;
					align-items: start;
					font-size: 13px;
				}
				.hrms-employee-detail-field span {
					color: var(--hrms-muted);
					text-align: right;
				}
				.hrms-employee-detail-field strong {
					font-weight: 500;
					color: #26323f;
					word-break: break-word;
				}
				.hrms-employee-detail-field-value {
					display: block;
					min-height: 24px;
					padding: 3px 8px;
					border-radius: 4px;
					background: #f7f8fa;
				}
				.hrms-employee-detail-summary-line {
					display: flex;
					flex-wrap: wrap;
					gap: 24px;
					padding: 12px 36px 8px;
					font-size: 14px;
				}
				.hrms-employee-detail-growth-timeline {
					padding: 6px 32px 10px;
				}
				.hrms-employee-detail-kpi-grid {
					display: grid;
					grid-template-columns: repeat(4, minmax(0, 1fr));
					gap: 10px;
					margin-top: 14px;
				}
				.hrms-employee-detail-kpi {
					padding: 12px;
					border: 1px solid var(--hrms-border);
					border-radius: 6px;
					background: #fbfcfd;
				}
				.hrms-employee-detail-kpi strong {
					display: block;
					font-size: 16px;
					margin-bottom: 4px;
				}
				.hrms-employee-detail-timeline-item {
					display: grid;
					grid-template-columns: 96px 18px minmax(0, 1fr);
					gap: 14px;
					align-items: stretch;
				}
				.hrms-employee-detail-timeline-date {
					text-align: right;
					color: #4b5563;
					font-weight: 600;
					padding-top: 10px;
				}
				.hrms-employee-detail-timeline-line {
					position: relative;
				}
				.hrms-employee-detail-timeline-line:before {
					content: "";
					position: absolute;
					left: 8px;
					top: 0;
					bottom: 0;
					width: 4px;
					background: #60a5fa;
					border-radius: 4px;
				}
				.hrms-employee-detail-timeline-card {
					margin-bottom: 10px;
					padding: 13px 16px;
					background: #f6f8fa;
					border-left: 3px solid #10b981;
					border-radius: 4px;
					min-height: 48px;
				}
				.hrms-employee-detail-side-card {
					padding: 18px 20px;
					min-height: 148px;
				}
				.hrms-employee-detail-side-card h4 {
					margin: 0 0 14px;
					font-size: 15px;
					font-weight: 600;
				}
				.hrms-employee-detail-empty {
					display: flex;
					min-height: 84px;
					align-items: center;
					justify-content: center;
					color: #9aa4b2;
					font-size: 13px;
				}
				.hrms-employee-detail-related {
					margin-top: 14px;
					border: 1px solid #eef1f4;
					border-radius: 6px;
					overflow: hidden;
				}
				.hrms-employee-detail-related-row {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding: 13px 16px;
					background: #fff;
					border-top: 1px solid #f3f5f7;
					font-size: 13px;
					cursor: pointer;
				}
				.hrms-employee-material-intro {
					margin-bottom: 16px;
					padding: 12px 14px;
					border: 1px solid #dbeafe;
					border-radius: 6px;
					background: #f8fbff;
					color: var(--hrms-muted);
					line-height: 1.6;
				}
				.hrms-employee-material-groups {
					display: grid;
					gap: 14px;
				}
				.hrms-employee-material-group {
					border: 1px solid var(--hrms-border);
					border-radius: 6px;
					overflow: hidden;
				}
				.hrms-employee-material-group__header {
					display: flex;
					justify-content: space-between;
					gap: 16px;
					align-items: center;
					padding: 12px 16px;
					background: #fbfcfd;
					border-bottom: 1px solid var(--hrms-border);
				}
				.hrms-employee-material-group__header strong { font-size: 14px; }
				.hrms-employee-material-type-list { display: grid; }
				.hrms-employee-material-type {
					display: grid;
					grid-template-columns: 148px minmax(0, 1fr) auto;
					gap: 14px;
					align-items: center;
					padding: 12px 16px;
					border-top: 1px solid #eef1f4;
				}
				.hrms-employee-material-type:first-child { border-top: 0; }
				.hrms-employee-material-type__name { font-weight: 600; color: #26323f; }
				.hrms-employee-material-files { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
				.hrms-employee-material-file {
					display: inline-flex;
					align-items: center;
					gap: 7px;
					max-width: 260px;
					padding: 4px 8px 4px 4px;
					border: 1px solid #e6edf3;
					border-radius: 5px;
					background: #fff;
					color: #2563eb;
				}
				.hrms-employee-material-file__image,
				.hrms-employee-material-file__placeholder {
					width: 30px;
					height: 30px;
					border-radius: 4px;
					object-fit: cover;
					background: #eef2f7;
				}
				.hrms-employee-material-file__placeholder { display: inline-flex; align-items: center; justify-content: center; color: #667085; font-size: 10px; font-weight: 600; }
				.hrms-employee-material-file__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				@media (max-width: 767px) {
					.hrms-employee-material-type { grid-template-columns: 1fr; gap: 8px; }
				}
				.hrms-employee-detail-collapse-row {
					min-height: 46px;
				}
				.hrms-employee-detail-related-row:hover {
					background: #fbfcfd;
				}
				.hrms-employee-detail-related-title {
					display: flex;
					align-items: center;
					gap: 8px;
				}
				.hrms-employee-detail-related-actions {
					display: flex;
					align-items: center;
					gap: 12px;
					color: var(--hrms-muted);
				}
				.hrms-employee-detail-related-detail {
					padding: 14px 18px 16px 38px;
					background: #fbfcfd;
					border-top: 1px solid #eef1f4;
				}
				.hrms-employee-detail-related-detail h4 {
					margin: 0 0 8px;
					font-size: 13px;
					font-weight: 600;
				}
				.hrms-employee-detail-related-description {
					margin-bottom: 12px;
					color: var(--hrms-muted);
					line-height: 1.7;
				}
				.hrms-employee-detail-related-fields {
					display: flex;
					flex-wrap: wrap;
					gap: 8px;
					margin-bottom: 12px;
				}
				.hrms-employee-detail-related-field-chip {
					padding: 4px 8px;
					border: 1px solid var(--hrms-border);
					border-radius: 4px;
					background: #fff;
					color: #4b5563;
				}
				.hrms-employee-detail-related-item {
					display: grid;
					grid-template-columns: repeat(3, minmax(0, 1fr));
					gap: 8px 16px;
					padding: 10px 12px;
					border: 1px solid var(--hrms-border);
					border-radius: 6px;
					background: #fff;
					margin-bottom: 8px;
				}
				.hrms-employee-detail-related-item span {
					color: var(--hrms-muted);
				}
				.hrms-employee-detail-related-item strong {
					display: block;
					font-weight: 500;
					color: #26323f;
				}
				.hrms-employee-detail-related-footer {
					display: flex;
					justify-content: space-between;
					align-items: center;
					margin-top: 10px;
				}
				.hrms-employee-detail-related-row:first-child {
					border-top: 0;
				}
				.hrms-employee-detail-add-field {
					display: flex;
					justify-content: space-between;
					align-items: center;
					margin-top: 14px;
					padding: 12px 16px;
					background: #fff;
					border: 1px solid #eef1f4;
					border-radius: 6px;
					font-size: 13px;
				}
				.hrms-employee-detail-bottom-nav {
					position: fixed;
					left: 50%;
					bottom: 20px;
					transform: translateX(-50%);
					display: flex;
					align-items: center;
					background: #fff;
					box-shadow: 0 4px 14px rgba(15, 23, 42, 0.13);
					border: 1px solid var(--hrms-border);
					border-radius: 22px;
					overflow: hidden;
					z-index: 5;
				}
				.hrms-employee-detail-bottom-nav button,
				.hrms-employee-detail-bottom-nav span {
					border: 0;
					background: transparent;
					padding: 12px 24px;
					min-width: 116px;
					text-align: center;
					color: #6b7280;
				}
				.hrms-employee-detail-bottom-nav button:not(:disabled) {
					color: #10b981;
				}
				@media (max-width: 991px) {
					.hrms-employee-detail-profile,
					.hrms-employee-detail-overview,
					.hrms-employee-detail-info-grid {
						grid-template-columns: 1fr;
					}
					.hrms-employee-detail-info-grid {
						padding: 0;
						row-gap: 12px;
					}
					.hrms-employee-detail-field {
						grid-template-columns: 110px minmax(0, 1fr);
					}
					.hrms-employee-detail-tabs {
						justify-content: flex-start;
						overflow-x: auto;
					}
				}
			</style>
		`;
	}

	render_header(header) {
		const department_display = this.get_department_display(header);
		const personnel_status = header.custom_personnel_status || "";
		const meta = [
			this.get_personnel_status_display(personnel_status),
			header.custom_employee_code ? `${__("工号")}：${header.custom_employee_code}` : "",
			header.cell_number,
		].filter(Boolean);
		return `
			<div class="hrms-employee-detail-card-panel hrms-employee-detail-header hrms-employee-detail-profile-card">
				<div class="hrms-employee-detail-profile">
					<div class="hrms-employee-detail-avatar" title="${frappe.utils.escape_html(__("员工头像"))}">
						${header.image ? `<img src="${frappe.utils.escape_html(header.image)}" alt="">` : `<span class="avatar avatar-large"><span class="avatar-frame standard-image"></span></span>`}
						${this.can_edit_employee_detail() ? `<button type="button" class="hrms-employee-detail-avatar-upload" data-action="upload-photo" aria-label="${frappe.utils.escape_html(__("上传照片"))}">${__("上传照片")}</button>` : ""}
					</div>
					<div>
						<div class="hrms-employee-detail-title">
							<h2>${frappe.utils.escape_html(header.employee_name || __("未命名员工"))}</h2>
							<span class="hrms-employee-detail-tag">${frappe.utils.escape_html(__("员工"))}</span>
						</div>
						<div class="hrms-employee-detail-meta">
							${meta.map((item) => `<span>${frappe.utils.escape_html(item)}</span>`).join("")}
						</div>
						<div class="hrms-employee-detail-meta">
							${department_display ? `<span>${__("部门")}：${frappe.utils.escape_html(department_display)}</span>` : ""}
							${header.designation ? `<span>${__("岗位")}：${frappe.utils.escape_html(header.designation)}</span>` : ""}
						</div>
					</div>
					<div class="hrms-employee-detail-actions hrms-employee-detail-action-strip">
						${this.can_edit_employee_detail() ? `<button class="btn btn-default btn-sm" data-action="upload-photo">${__("上传照片")}</button>` : ""}
						${this.can_edit_employee_detail() ? `<button class="btn btn-default btn-sm" data-action="edit-employee">${__("编辑资料")}</button>` : ""}
						<button class="btn btn-default btn-sm" data-action="compare">${__("员工对比")}</button>
						<button class="btn btn-primary btn-sm" data-action="transfer">${__("办理人事异动")}</button>
						${personnel_status === "试用期" ? `<button class="btn btn-default btn-sm" data-action="promotion">${__("转正面谈")}</button>` : ""}
						<button class="btn btn-default btn-sm" data-action="separation">${__("离职")}</button>
						<button class="btn btn-default btn-sm" data-action="contract">${__("合同记录")}</button>
					</div>
				</div>
			</div>
		`;
	}

	get_personnel_status_display(personnel_status) {
		return {
			"在职": __("在职 · 正式"),
			"试用期": __("在职 · 试用期"),
			"已离职": __("离职"),
		}[personnel_status] || personnel_status;
	}

	render_tabs() {
		return `
			<div class="hrms-employee-detail-tabs hrms-employee-detail-sticky-tabs">
				${this.tabs
					.map(
						(tab) => `
						<button class="hrms-employee-detail-tab ${this.active_tab === tab ? "is-active" : ""}" data-tab="${frappe.utils.escape_html(tab)}">
							${frappe.utils.escape_html(__(tab))}
						</button>`,
					)
					.join("")}
			</div>
		`;
	}

	render_active_tab() {
		if (this.active_tab === "概览") {
			return this.render_overview();
		}
		if (this.active_tab === "材料附件") {
			return this.render_material_attachments();
		}
		return this.render_section_tab(this.active_tab);
	}

	render_overview() {
		const header = this.detail?.header || {};
		const department_display = this.get_department_display(header);
		return `
			<div class="hrms-employee-detail-overview">
				<div class="hrms-employee-detail-main-stack">
					<div class="hrms-employee-detail-section hrms-employee-detail-section-card">
						<div class="hrms-employee-detail-section__header">
							<h3>${__("员工概况")}</h3>
						</div>
						<div class="hrms-employee-detail-summary-line">
							<span>${__("概况")}：${frappe.utils.escape_html(this.join_values([header.gender, header.age, department_display, header.designation]))}</span>
							<span>${__("司龄")}：${frappe.utils.escape_html(header.service_years || this.calculate_service_years(header.date_of_joining))}</span>
						</div>
						<div class="hrms-employee-detail-kpi-grid">
							${this.render_kpi("部门", department_display || "未设置")}
							${this.render_kpi("岗位", header.designation || "未设置")}
							${this.render_kpi("入职日期", header.date_of_joining || "未设置")}
							${this.render_kpi("工作性质", this.get_personnel_status_display(header.custom_personnel_status || "未设置"))}
						</div>
					</div>
					<div class="hrms-employee-detail-section hrms-employee-detail-section-card">
						<div class="hrms-employee-detail-section__header">
							<h3>${__("成长记录")}</h3>
						</div>
						<div class="hrms-employee-detail-growth-timeline">
							${this.render_growth_timeline()}
						</div>
					</div>
				</div>
				<div class="hrms-employee-detail-side-panel">
					${this.render_side_card("本月考勤", [["打卡天数/应出勤/天", "0/0"], ["请假", "0小时"], ["迟到", "0次"], ["加班", "0小时"]])}
					${this.render_side_card("培训学习", [])}
					${this.render_side_card("绩效考核", [])}
				</div>
			</div>
		`;
	}

	render_side_card(title, rows) {
		return `
			<div class="hrms-employee-detail-side-card">
				<h4>${frappe.utils.escape_html(__(title))}</h4>
				${
					rows.length
						? rows
								.map(
									([label, value]) => `
									<div class="hrms-employee-detail-field">
										<span>${frappe.utils.escape_html(__(label))}</span>
										<strong>${frappe.utils.escape_html(value)}</strong>
									</div>`,
								)
								.join("")
						: `<div class="hrms-employee-detail-empty">${__("暂无数据")}</div>`
				}
			</div>
		`;
	}

	render_kpi(label, value) {
		return `
			<div class="hrms-employee-detail-kpi">
				<strong>${frappe.utils.escape_html(this.format_value(value))}</strong>
				<span class="text-muted">${frappe.utils.escape_html(__(label))}</span>
			</div>
		`;
	}

	render_growth_timeline() {
		const header = this.detail?.header || {};
		const department_display = this.get_department_display(header);
		const items = [
			{
				date: header.date_of_joining || __("入职"),
				title: __("入职"),
				description: this.join_values([department_display, header.designation]) || __("员工入职"),
			},
			{
				date: __("至今"),
				title: __("当前任职"),
				description: this.join_values([department_display, header.designation, this.get_personnel_status_display(header.custom_personnel_status)]),
			},
		];
		return items
			.map(
				(item) => `
				<div class="hrms-employee-detail-timeline-item">
					<div class="hrms-employee-detail-timeline-date">${frappe.utils.escape_html(this.format_value(item.date))}</div>
					<div class="hrms-employee-detail-timeline-line"></div>
					<div class="hrms-employee-detail-timeline-card">
						<strong>${frappe.utils.escape_html(item.title)}</strong>
						<div class="text-muted">${frappe.utils.escape_html(item.description || "")}</div>
					</div>
				</div>`,
			)
			.join("");
	}

	render_section_tab(tab_label) {
		const category = this.section_alias[tab_label] || tab_label;
		const section = (this.detail?.sections || []).find((item) => item.label === category);
		const fields = section?.fields || [];
		return `
			<div class="hrms-employee-detail-section hrms-employee-detail-section-card">
				<div class="hrms-employee-detail-section__header">
					<h3>${frappe.utils.escape_html(__(tab_label))}</h3>
					<div class="hrms-employee-detail-section-tools">
						<span class="text-muted">${__("只读")}</span>
						${this.can_edit_employee_detail() ? `<button class="btn btn-default btn-xs" data-action="edit-employee">${__("编辑资料")}</button>` : ""}
					</div>
				</div>
				${
					fields.length
						? `<div class="hrms-employee-detail-info-grid">
							${fields.map((field) => this.render_readonly_field(field)).join("")}
						</div>`
						: `<div class="hrms-employee-detail-empty">${__("当前区块没有已启用字段")}</div>`
				}
				${this.render_related_blocks(tab_label)}
				${this.render_add_field_hint()}
			</div>
		`;
	}

	render_readonly_field(field) {
		const value = field.fieldname === "custom_personnel_status"
			? this.get_personnel_status_display(field.value)
			: field.value;
		return `
			<div class="hrms-employee-detail-field">
				<span>${frappe.utils.escape_html(field.field_label || field.fieldname)}</span>
				<strong class="hrms-employee-detail-field-value">${frappe.utils.escape_html(this.format_value(value))}</strong>
			</div>
		`;
	}

	render_material_attachments() {
		const groups = this.detail?.materials || [];
		return `
			<div class="hrms-employee-detail-section hrms-employee-detail-section-card">
				<div class="hrms-employee-detail-section__header">
					<h3>${__("材料附件")}</h3>
					<div class="hrms-employee-detail-section-tools">
						<span class="text-muted">${this.can_edit_employee_detail() ? __("可拍照或上传") : __("只读")}</span>
					</div>
				</div>
				<div class="hrms-employee-material-intro">${__("每份材料都会归档到当前员工名下。可从设备选择文件，也可直接调用摄像头拍照；支持 JPG、PNG、WebP 和 PDF。")}</div>
				<div class="hrms-employee-material-groups">
					${groups.map((group) => this.render_material_group(group)).join("")}
				</div>
			</div>
		`;
	}

	render_material_group(group) {
		return `
			<div class="hrms-employee-material-group">
				<div class="hrms-employee-material-group__header">
					<strong>${frappe.utils.escape_html(__(group.label))}</strong>
					<span class="text-muted">${frappe.utils.escape_html(group.description || "")}</span>
				</div>
				<div class="hrms-employee-material-type-list">
					${(group.types || []).map((material) => this.render_material_type(material)).join("")}
				</div>
			</div>
		`;
	}

	render_material_type(material) {
		const files = material.files || [];
		return `
			<div class="hrms-employee-material-type">
				<div class="hrms-employee-material-type__name">${frappe.utils.escape_html(__(material.label))}</div>
				<div class="hrms-employee-material-files">
					${files.length ? files.map((file) => this.render_material_file(file)).join("") : `<span class="text-muted">${__("未上传")}</span>`}
				</div>
				${this.can_edit_employee_detail() ? `<button class="btn btn-default btn-xs" data-action="upload-material" data-material-type="${frappe.utils.escape_html(material.key)}">${__("拍照/上传")}</button>` : ""}
			</div>
		`;
	}

	render_material_file(file) {
		const name = frappe.utils.escape_html(file.file_name || __("未命名材料"));
		const url = frappe.utils.escape_html(file.file_url || "");
		const image = /\.(?:jpe?g|png|webp)(?:\?.*)?$/i.test(file.file_url || "");
		return `<a class="hrms-employee-material-file" href="${url}" target="_blank" rel="noopener" title="${name}">${image ? `<img class="hrms-employee-material-file__image" src="${url}" alt="">` : `<span class="hrms-employee-material-file__placeholder">PDF</span>`}<span class="hrms-employee-material-file__name">${name}</span></a>`;
	}

	render_related_blocks(tab_label) {
		const rows = (this.detail?.related_records || {})[tab_label] || [];
		if (!rows.length) return "";
		return `
			<div class="hrms-employee-detail-related">
				${rows
					.map((row, index) => this.render_related_block(row, tab_label, index))
					.join("")}
			</div>
		`;
	}

	render_related_block(row, tab_label, index) {
		const key = `${tab_label}-${row.label}-${index}`;
		const expanded = Boolean(this.expanded_related[key]);
		const count = Number(row.count || 0);
		return `
			<div class="hrms-employee-detail-related-row hrms-employee-detail-collapse-row" data-related-key="${frappe.utils.escape_html(key)}">
				<div class="hrms-employee-detail-related-title">
					<strong>${frappe.utils.escape_html(__(row.label))}</strong>
					<span class="text-muted">（${__("已有{0}条记录", [count])}）</span>
				</div>
				<div class="hrms-employee-detail-related-actions">
					<span>${count ? __("查看更多") : __("暂无数据")}</span>
					<span>${expanded ? "⌃" : "⌄"}</span>
				</div>
			</div>
			${expanded ? this.render_related_detail(row) : ""}
		`;
	}

	render_related_detail(row) {
		const items = row.items || [];
		return `
			<div class="hrms-employee-detail-related-detail">
				<h4>${__("记录说明")}</h4>
				<div class="hrms-employee-detail-related-description">${frappe.utils.escape_html(row.description || "")}</div>
				<h4>${__("字段信息")}</h4>
				<div class="hrms-employee-detail-related-fields">
					${(row.fields || [])
						.map((field) => `<span class="hrms-employee-detail-related-field-chip">${frappe.utils.escape_html(__(field))}</span>`)
						.join("")}
				</div>
				${items.length ? this.render_related_items(items) : `<div class="text-muted">${__("当前没有记录，下面的字段是后续维护该资料时应填写的信息。")}</div>`}
				<div class="hrms-employee-detail-related-footer">
					<span class="text-muted">${__("办理入口")}</span>
					${
						row.action_doctype || row.action_route
							? `<button class="btn btn-default btn-xs" data-related-action="${frappe.utils.escape_html(row.action_doctype || "")}" data-related-route="${frappe.utils.escape_html(row.action_route || "")}">${frappe.utils.escape_html(__(row.action_label || "新增记录"))}</button>`
							: `<span class="text-muted">${__("暂无办理入口")}</span>`
					}
				</div>
			</div>
		`;
	}

	render_related_items(items) {
		return items
			.map(
				(item) => `
				<div class="hrms-employee-detail-related-item">
					${(item.fields || [])
						.map(
							(field) => `
							<div>
								<span>${frappe.utils.escape_html(__(field.label))}</span>
								<strong>${frappe.utils.escape_html(this.format_value(field.value))}</strong>
							</div>`,
						)
						.join("")}
				</div>`,
			)
			.join("");
	}

	render_add_field_hint() {
		return `
			<div class="hrms-employee-detail-add-field">
				<span>${__("没有找到想要的员工字段?")}</span>
				<a href="#" data-action="field-settings">${__("添加更多员工档案字段")}</a>
			</div>
		`;
	}

	render_bottom_navigation() {
		return `
			<div class="hrms-employee-detail-bottom-nav">
				<button data-nav-employee="${frappe.utils.escape_html(this.navigation.previous || "")}" ${this.navigation.previous ? "" : "disabled"}>${this.navigation.previous ? __("上一个员工") : __("没有了")}</button>
				<span>${__("在职员工")}</span>
				<button data-nav-employee="${frappe.utils.escape_html(this.navigation.next || "")}" ${this.navigation.next ? "" : "disabled"}>${this.navigation.next ? __("下一个员工") : __("没有了")}</button>
			</div>
		`;
	}

	bind_events() {
		this.wrapper.querySelectorAll("[data-tab]").forEach((button) => {
			button.addEventListener("click", () => {
				this.active_tab = button.dataset.tab;
				this.render();
			});
		});
		this.wrapper.querySelectorAll("[data-nav-employee]").forEach((button) => {
			button.addEventListener("click", () => {
				if (!button.dataset.navEmployee) return;
				frappe.set_route("employee-detail", button.dataset.navEmployee);
			});
		});
		this.wrapper.querySelectorAll("[data-related-key]").forEach((row) => {
			row.addEventListener("click", () => this.toggle_related_block(row.dataset.relatedKey));
		});
		this.wrapper.querySelectorAll("[data-related-action], [data-related-route]").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.stopPropagation();
				const doctype = button.dataset.relatedAction;
				const route = button.dataset.relatedRoute;
				if (doctype) {
					frappe.new_doc(doctype, { employee: this.employee });
					return;
				}
				if (route) {
					frappe.set_route(route);
				}
			});
		});
		this.wrapper.querySelectorAll("[data-action='transfer']").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				const header = this.detail?.header || {};
				frappe.new_doc("Employee Transfer", {
					employee: this.employee,
					employee_code_display: header.custom_employee_code,
					employee_name: header.employee_name,
					company: header.company,
					department: header.department,
					transfer_date: frappe.datetime.get_today(),
				});
			});
		});
		this.wrapper.querySelectorAll("[data-action='field-settings']").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				frappe.set_route("staff-attribute-settings");
			});
		});
		this.wrapper.querySelectorAll("[data-action='edit-employee']").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				if (!this.can_edit_employee_detail()) {
					frappe.msgprint(__("只有管理员可以编辑员工资料。"));
					return;
				}
				if (window.hrmsEmployeeNavigation?.openEmployeeFormForEdit) {
					window.hrmsEmployeeNavigation.openEmployeeFormForEdit(this.employee);
					return;
				}
				frappe.route_options = { hrms_allow_employee_form: 1 };
				frappe.set_route("Form", "Employee", this.employee);
			});
		});
		this.wrapper.querySelectorAll("[data-action='upload-photo']").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				this.upload_employee_photo();
			});
		});
		this.wrapper.querySelectorAll("[data-action='upload-material']").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				this.upload_employee_material(button.dataset.materialType);
			});
		});
		this.wrapper.querySelectorAll("[data-action='promotion']").forEach((button) => {
			button.addEventListener("click", () => {
				if (this.detail?.header?.custom_personnel_status !== "试用期") return;
				const interview_date = frappe.datetime.get_today();
				frappe.new_doc("Employee Promotion", {
					employee: this.employee,
					promotion_date: interview_date,
					custom_is_confirmation_interview: 1,
					custom_confirmation_interview_date: interview_date,
					promotion_details: [
						{
							property: __("是否转正"),
							fieldname: "custom_is_confirmed",
							current: this.detail?.header?.custom_is_confirmed || "否",
							new: "是",
						},
						{
							property: __("转正日期"),
							fieldname: "final_confirmation_date",
							current: this.detail?.header?.final_confirmation_date || "",
							new: interview_date,
						},
					],
				});
			});
		});
		this.wrapper.querySelectorAll("[data-action='separation']").forEach((button) => {
			button.addEventListener("click", () => {
				const header = this.detail?.header || {};
				frappe.new_doc("Employee Separation", {
					employee: this.employee,
					employee_code_display: header.custom_employee_code || "",
					employee_name: header.employee_name || "",
				});
			});
		});
		this.wrapper.querySelectorAll("[data-action='contract']").forEach((button) => {
			button.addEventListener("click", () => {
				this.active_tab = "合同信息";
				this.render();
			});
		});
		const compare_button = this.wrapper.querySelector("[data-action='compare']");
		if (compare_button) {
			compare_button.addEventListener("click", () => frappe.show_alert(__("员工对比功能将在后续阶段接入")));
		}
	}

	upload_employee_photo() {
		if (!this.can_edit_employee_detail()) {
			frappe.msgprint(__("只有管理员可以上传员工照片。"));
			return;
		}

		new frappe.ui.FileUploader({
			doctype: "Employee",
			docname: this.employee,
			fieldname: "image",
			allow_multiple: false,
			restrictions: {
				allowed_file_types: [".jpg", ".jpeg", ".png", ".webp"],
				max_file_size: 5 * 1024 * 1024,
			},
			on_success: (file) => {
				frappe
					.call({
						method: "hrms.api.employee_field_template.update_employee_photo",
						args: { employee: this.employee, file_url: file.file_url },
						freeze: true,
						freeze_message: __("正在保存员工照片…"),
					})
					.then((response) => {
						const image = response.message?.image || file.file_url;
						if (this.detail?.header) this.detail.header.image = image;
						this.render();
						frappe.show_alert({ message: __("员工照片已更新"), indicator: "green" });
					});
			},
		});
	}

	upload_employee_material(material_type) {
		if (!this.can_edit_employee_detail()) {
			frappe.msgprint(__("只有管理员可以上传员工档案材料。"));
			return;
		}
		new frappe.ui.FileUploader({
			doctype: "Employee",
			docname: this.employee,
			allow_multiple: false,
			allow_take_photo: true,
			allow_web_link: false,
			disable_file_browser: true,
			restrictions: {
				allowed_file_types: [".jpg", ".jpeg", ".png", ".webp", ".pdf"],
				max_file_size: 10 * 1024 * 1024,
			},
			on_success: (file, response) => {
				const file_url = file?.file_url || response?.message?.file_url;
				if (!file_url) return;
				frappe.call({
					method: "hrms.api.employee_field_template.upload_employee_material",
					args: { employee: this.employee, material_type, file_url },
					freeze: true,
					freeze_message: __("正在归档员工材料…"),
				}).then((result) => {
					if (this.detail) this.detail.materials = result.message?.materials || this.detail.materials;
					this.render();
					frappe.show_alert({ message: __("员工材料已归档"), indicator: "green" });
				});
			},
		});
	}

	toggle_related_block(key) {
		this.expanded_related[key] = !this.expanded_related[key];
		this.render();
	}

	format_value(value) {
		if (value === null || value === undefined || value === "") {
			return "";
		}
		return String(value);
	}

	get_department_display(header) {
		return header.department_display || header.department || "";
	}

	join_values(values) {
		return values.filter((value) => value !== null && value !== undefined && value !== "").join(" / ");
	}

	can_edit_employee_detail() {
		const serverPermission = this.detail?.permissions?.can_edit_employee_detail;
		if (serverPermission !== undefined) {
			return Boolean(serverPermission);
		}
		const user = frappe.session?.user || "";
		const roles = frappe.boot?.user?.roles || [];
		return user === "Administrator" || roles.includes("System Manager");
	}

	calculate_service_years(date_of_joining) {
		if (!date_of_joining) return "";
		const days = frappe.datetime.get_diff(frappe.datetime.get_today(), date_of_joining);
		if (days < 365) {
			return `${Math.max(days, 0)}${__("天")}`;
		}
		return `${Math.floor(days / 365)}${__("年")}${Math.floor((days % 365) / 30)}${__("个月")}`;
	}
}
