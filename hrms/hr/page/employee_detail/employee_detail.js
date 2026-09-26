frappe.pages["employee-detail"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("员工花名册 / 员工档案"),
		single_column: true,
	});

	wrapper.employee_detail = new EmployeeDetailPage(page);
	wrapper.employee_detail.show();
};

frappe.pages["employee-detail"].on_page_show = function (wrapper) {
	wrapper.employee_detail?.set_breadcrumb();
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
		this.apple_tree_summary = null;
		this.apple_tree_request_id = 0;
		this.tab_load_promises = {};
		this.loaded_tab_groups = new Set(["overview"]);
		this.trainingSearch = "";
		this.trainingType = "";
		this.tabs = ["概览", "在职信息", "个人信息", "联系信息", "培训记录", "工资社保", "合同信息", "材料附件", "背景调查"];
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
		this.page.set_secondary_action(__("返回员工花名册"), () => this.return_to_roster());
		this.set_breadcrumb();
		this.refresh_from_route();
	}

	set_breadcrumb() {
		const header = this.detail?.header || {};
		const employee_label = String(header.employee_name || header.employee_code || header.custom_employee_code || "").trim();
		// The global shell reapplies contextual breadcrumbs after route changes.
		// Keep the loaded employee name available so that delayed shell refreshes
		// cannot collapse this page back to the generic roster label.
		window.hrmsEmployeeDetailBreadcrumbLabel = employee_label || __("员工档案");
		if (window.hrmsApplyContextualBreadcrumbs) {
			window.hrmsApplyContextualBreadcrumbs(window.hrmsEmployeeDetailBreadcrumbLabel);
			return;
		}
		const breadcrumbs = frappe.breadcrumbs;
		if (!breadcrumbs?.add || !breadcrumbs?.append_breadcrumb_element) return;
		breadcrumbs.add({
			type: "Custom",
			route: "/desk/employee",
			label: __("员工花名册"),
		});

		// Frappe rebuilds breadcrumbs while a page route is being shown. Append
		// the current page in the next frame so that rebuild cannot remove it.
		const append_current_page = () => {
			if (breadcrumbs.$breadcrumbs?.find?.(".hrms-employee-detail-current").length) return;
			breadcrumbs.append_breadcrumb_element(
				"",
				window.hrmsEmployeeDetailBreadcrumbLabel || __("员工档案"),
				"hrms-employee-detail-current",
			);
			breadcrumbs.$breadcrumbs?.find?.("li").last().addClass("disabled");
		};
		if (window.requestAnimationFrame) window.requestAnimationFrame(append_current_page);
		else append_current_page();
	}

	set_page_title() {
		// The detail screen is always opened from the roster. Keep that parent
		// visible in the page header instead of leaving users at “主页 / 详情”.
		this.page.set_title(__("员工花名册 / 员工档案"));
	}

	return_to_roster() {
		frappe.set_route("List", "Employee");
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
			this.trainingSearch = "";
			this.trainingType = "";
			this.apple_tree_summary = null;
			this.tab_load_promises = {};
			this.loaded_tab_groups = new Set(["overview"]);
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
			this.set_page_title();
			this.wrapper.innerHTML = `<div class="text-muted">${__("请选择员工")}</div>`;
			return Promise.resolve();
		}

		this.loading_employee = employee;
		this.set_page_title();
		this.wrapper.innerHTML = `<div class="text-muted hrms-employee-detail-loading">${__("正在加载员工档案...")}</div>`;

		const detail_request = frappe.call({
			method: "hrms.api.employee_field_template.get_employee_detail",
			args: { employee, scope: "overview" },
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
				this.load_apple_tree_summary(employee, this.detail?.header?.company || "", request_id);
			})
			.catch(() => {
				if (!this.is_current_request(request_id, employee)) return;
				this.detail = null;
				this.navigation = {};
				this.last_loaded_at = 0;
				this.set_page_title();
				this.wrapper.innerHTML = `<div class="text-muted">${__("员工档案加载失败，请重试。")}</div>`;
			})
			.finally(() => {
				if (!this.is_current_request(request_id, employee)) return;
				this.loading_employee = "";
				this.load_promise = null;
			});

		return this.load_promise;
	}

	tab_group(tab) {
		if (tab === "概览") return "overview";
		if (tab === "培训记录") return "training";
		if (tab === "材料附件") return "materials";
		return `profile:${tab}`;
	}

	open_tab(tab) {
		this.active_tab = tab;
		const group = this.tab_group(tab);
		if (this.loaded_tab_groups.has(group)) {
			this.render();
			return Promise.resolve();
		}
		this.render_tab_loading();
		if (this.tab_load_promises[group]) return this.tab_load_promises[group];
		const employee = this.employee;
		this.tab_load_promises[group] = frappe.call({
			method: "hrms.api.employee_field_template.get_employee_detail_tab",
			args: { employee, tab },
		}).then(({ message }) => {
			if (employee !== this.employee) return;
			Object.assign(this.detail, message || {});
			this.loaded_tab_groups.add(group);
			if (group === this.tab_group(this.active_tab)) this.render();
		}).catch(() => {
			if (employee !== this.employee || group !== this.tab_group(this.active_tab)) return;
			this.render_tab_error(tab);
		}).finally(() => {
			delete this.tab_load_promises[group];
		});
		return this.tab_load_promises[group];
	}

	render_tab_loading() {
		const body = this.wrapper.querySelector(".hrms-employee-detail-body");
		if (!body) return;
		body.innerHTML = `<div class="hrms-employee-detail-section hrms-employee-detail-section-card text-muted">${__("正在读取当前标签页…")}</div>`;
	}

	render_tab_error(tab) {
		const body = this.wrapper.querySelector(".hrms-employee-detail-body");
		if (!body) return;
		body.innerHTML = `<div class="hrms-employee-detail-section hrms-employee-detail-section-card"><span class="text-muted">${__("当前标签页加载失败。")}</span> <button class="btn btn-default btn-xs" data-retry-tab>${__("重试")}</button></div>`;
		body.querySelector("[data-retry-tab]")?.addEventListener("click", () => this.open_tab(tab));
	}

	load_apple_tree_summary(employee, company, detail_request_id) {
		const apple_tree_request_id = ++this.apple_tree_request_id;
		return frappe.call({
			method: "hrms.hr.page.apple_tree_center.apple_tree_center.get_employee_summary",
			args: { employee, year: String(new Date().getFullYear()), company },
		}).then((response) => {
			if (!this.is_current_request(detail_request_id, employee) || apple_tree_request_id !== this.apple_tree_request_id) return;
			this.apple_tree_summary = response.message || { available: false, reason: __("苹果树汇总暂时无法读取。") };
			this.render();
		}).catch(() => {
			if (!this.is_current_request(detail_request_id, employee) || apple_tree_request_id !== this.apple_tree_request_id) return;
			this.apple_tree_summary = { available: false, reason: __("苹果树汇总暂时无法读取。") };
			this.render();
		});
	}

	is_current_request(request_id, employee) {
		return request_id === this.load_request_id && employee === this.employee;
	}

	render() {
		const header = this.detail?.header || {};
		this.set_page_title();
		this.set_breadcrumb();
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
				/* Employee records are read-only here, but every displayed value must
				 * remain selectable for the normal Copy command/context menu. */
				.hrms-employee-detail-shell,
				.hrms-employee-detail-shell * {
					user-select: text !important;
					-webkit-user-select: text !important;
				}
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
				.hrms-employee-standing-summary {
					display: grid;
					grid-template-columns: repeat(3, minmax(0, 1fr));
					gap: 12px;
					margin-bottom: 18px;
				}
				.hrms-employee-standing-card {
					display: grid;
					gap: 5px;
					padding: 14px 16px;
					border: 1px solid var(--hrms-border);
					border-radius: 7px;
					background: #fbfcfd;
					color: inherit;
					text-align: left;
					transition: border-color 0.15s ease, box-shadow 0.15s ease;
				}
				.hrms-employee-standing-card:hover,
				.hrms-employee-standing-card:focus-visible {
					border-color: #93c5fd;
					box-shadow: 0 2px 8px rgba(37, 99, 235, 0.08);
				}
				.hrms-employee-standing-card > span,
				.hrms-employee-standing-card > small {
					color: var(--hrms-muted);
				}
				.hrms-employee-standing-card > strong {
					font-size: 18px;
					font-weight: 600;
				}
				.hrms-employee-standing-card > em {
					color: #2563eb;
					font-size: 12px;
					font-style: normal;
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
				.hrms-employee-detail-relationship-list { display: grid; gap: 8px; }
				.hrms-employee-detail-relationship-link {
					display: flex; align-items: center; justify-content: space-between; gap: 10px;
					width: 100%; padding: 7px 0; border: 0; border-bottom: 1px solid #f0f2f5;
					background: transparent; text-align: left; cursor: pointer;
				}
				.hrms-employee-detail-relationship-link:last-child { border-bottom: 0; }
				.hrms-employee-detail-relationship-link:hover strong { color: #2563eb; }
				.hrms-employee-detail-relationship-person { min-width: 0; display: grid; gap: 2px; }
				.hrms-employee-detail-relationship-person strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
				.hrms-employee-detail-relationship-person small { color: var(--hrms-muted); }
				.hrms-employee-detail-relationship-label { flex: 0 0 auto; max-width: 112px; color: #52657a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				.hrms-employee-detail-relationship-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #eef1f4; }
				.hrms-employee-training-summary { width: 100%; border: 1px solid var(--hrms-border); background: #fff; text-align: left; color: inherit; }
				.hrms-employee-training-summary:hover { border-color: #93c5fd; background: #fbfdff; }
				.hrms-employee-training-summary__heading { display: flex; justify-content: space-between; align-items: center; }
				.hrms-employee-training-summary__metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px; }
				.hrms-employee-training-summary__metrics div { display: grid; gap: 2px; }
				.hrms-employee-training-summary__metrics strong { font-size: 17px; }
				.hrms-employee-training-summary__metrics span, .hrms-employee-training-summary small { color: var(--hrms-muted); font-size: 11px; }
				.hrms-employee-training-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
				.hrms-employee-training-code { padding: 5px 9px; border-radius: 4px; background: #f3f5f7; color: #52657a; }
				.hrms-employee-training-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) 180px auto auto auto; gap: 8px; align-items: center; margin-bottom: 12px; }
				.hrms-employee-training-table-wrap { overflow: auto; border: 1px solid var(--hrms-border); border-radius: 6px; }
				.hrms-employee-training-table { min-width: 1040px; margin: 0; }
				.hrms-employee-training-table thead th { position: sticky; top: 0; z-index: 1; padding: 10px 12px; border: 0; background: #f4f7fb; color: #52657a; font-weight: 600; white-space: nowrap; }
				.hrms-employee-training-table tbody td { padding: 11px 12px; border-top: 1px solid #eef1f4; vertical-align: top; }
				.hrms-employee-training-table td > strong, .hrms-employee-training-table td > small { display: block; }
				.hrms-employee-training-table td > small { margin-top: 3px; color: var(--hrms-muted); font-size: 11px; }
				.hrms-employee-training-status { display: inline-flex; padding: 3px 7px; border-radius: 12px; font-size: 11px; white-space: nowrap; }
				.hrms-employee-training-status.is-confirmed { background: #e9f8ef; color: #16794b; }
				.hrms-employee-training-status.is-pending { background: #fff4dd; color: #9a6700; }
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
				.hrms-employee-upload-history-summary {
					display: flex;
					align-items: center;
					justify-content: space-between;
					gap: 16px;
					padding: 14px 16px;
					margin-bottom: 16px;
					border: 1px solid #dfe7ef;
					border-radius: 8px;
					background: #fff;
				}
				.hrms-employee-upload-history-summary__copy { display: grid; gap: 3px; }
				.hrms-employee-upload-history-summary__copy strong { color: #26323f; }
				.hrms-employee-material-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
				.hrms-employee-upload-history-dialog .modal-dialog { width: min(860px, calc(100vw - 48px)); max-width: none; }
				.hrms-employee-upload-history-list { display: grid; gap: 10px; max-height: 65vh; overflow: auto; }
				.hrms-employee-upload-history-item {
					display: grid;
					grid-template-columns: 72px minmax(0, 1fr) auto;
					align-items: center;
					gap: 12px;
					padding: 10px;
					border: 1px solid #e5eaf0;
					border-radius: 8px;
				}
				.hrms-employee-upload-history-item__preview { width: 72px; height: 56px; border: 0; padding: 0; border-radius: 6px; overflow: hidden; background: #f4f6f8; }
				.hrms-employee-upload-history-item__preview img { width: 100%; height: 100%; object-fit: cover; }
				.hrms-employee-upload-history-item__meta { display: grid; gap: 3px; min-width: 0; }
				.hrms-employee-upload-history-item__meta strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				.hrms-employee-upload-history-item__status { color: #667085; white-space: nowrap; }
				.hrms-employee-upload-history-item__status.is-current { color: #12a77a; font-weight: 600; }
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
		.hrms-employee-material-file__preview {
				display: inline-flex;
				min-width: 0;
				align-items: center;
					gap: 7px;
					padding: 0;
					border: 0;
					background: transparent;
					color: inherit;
					text-align: left;
				cursor: zoom-in;
			}
			.hrms-employee-material-file__content { display: grid; gap: 2px; min-width: 0; }
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
			.hrms-employee-material-file__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: #26323f; }
			.hrms-employee-material-file__meta { color: #667085; font-size: 11px; line-height: 1.35; white-space: normal; }
				.hrms-employee-material-file__delete {
					padding: 0 0 0 2px;
					border: 0;
					background: transparent;
					color: #b42318;
					font-size: 12px;
					cursor: pointer;
				}
				.hrms-employee-material-preview img {
					display: block;
					max-width: 100%;
					max-height: calc(100vh - 164px);
					margin: 0 auto;
					object-fit: contain;
				}
				.hrms-employee-material-preview-dialog .modal-dialog {
					width: calc(100vw - 48px);
					max-width: none;
					margin: 24px auto;
				}
				.hrms-employee-material-preview-dialog .modal-content {
					height: calc(100vh - 48px);
					display: flex;
					flex-direction: column;
				}
				.hrms-employee-material-preview-dialog .modal-body {
					flex: 1;
					overflow: hidden;
				}
				.hrms-employee-material-preview-dialog .hrms-employee-material-preview {
					width: 100%;
				}
				.hrms-employee-material-preview__toolbar {
					display: flex;
					justify-content: center;
					align-items: center;
					gap: 8px;
					padding: 0 0 12px;
				}
				.hrms-employee-material-preview__zoom-level { min-width: 42px; text-align: center; color: #667085; }
				.hrms-employee-material-preview__canvas {
					height: calc(100vh - 220px);
					display: flex;
					align-items: center;
					justify-content: center;
					overflow: auto;
				}
				.hrms-employee-material-preview__canvas img { cursor: zoom-in; }
				.hrms-employee-material-preview__canvas img.is-zoomed { max-width: none; max-height: none; cursor: zoom-out; }
				@media (max-width: 767px) {
					.hrms-employee-upload-history-summary { align-items: stretch; flex-direction: column; }
					.hrms-employee-upload-history-item { grid-template-columns: 56px minmax(0, 1fr); }
					.hrms-employee-upload-history-item__preview { width: 56px; height: 48px; }
					.hrms-employee-upload-history-item__status { grid-column: 2; }
					.hrms-employee-material-type { grid-template-columns: 1fr; gap: 8px; }
					.hrms-employee-material-actions { justify-content: flex-start; flex-wrap: wrap; }
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
					.hrms-employee-standing-summary {
						grid-template-columns: 1fr;
					}
					.hrms-employee-detail-field {
						grid-template-columns: 110px minmax(0, 1fr);
					}
					.hrms-employee-detail-tabs {
						justify-content: flex-start;
						overflow-x: auto;
					}
					.hrms-employee-training-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
					.hrms-employee-training-toolbar { grid-template-columns: 1fr; }
				}
			</style>
		`;
	}

	render_header(header) {
		const department_display = this.get_department_display(header);
		const previous_employment = header.previous_employment;
		const current_employment = header.current_employment;
		const meta = [
			this.get_employment_type_display(header),
			header.custom_employee_code ? `${__("工号")}：${header.custom_employee_code}` : "",
			this.format_employee_field_value("cell_number", header.cell_number),
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
						${previous_employment?.name ? `<button class="btn btn-default btn-sm" data-action="open-previous-employment" data-previous-employee="${frappe.utils.escape_html(previous_employment.name)}">${frappe.utils.escape_html(__("查看前次任职档案"))}</button>` : ""}
						${current_employment?.name ? `<button class="btn btn-default btn-sm" data-action="open-current-employment" data-current-employee="${frappe.utils.escape_html(current_employment.name)}">${frappe.utils.escape_html(__("查看当前任职档案"))}</button>` : ""}
						${this.can_edit_employee_detail() ? `<button class="btn btn-default btn-sm" data-action="upload-photo">${__("上传照片")}</button>` : ""}
						${this.can_edit_employee_detail() ? `<button class="btn btn-default btn-sm" data-action="edit-employee">${__("编辑资料")}</button>` : ""}
						<button class="btn btn-default btn-sm" data-action="compare">${__("员工对比")}</button>
						<button class="btn btn-primary btn-sm" data-action="transfer">${__("办理人事异动")}</button>
						${this.is_probation_work_nature(header) ? `<button class="btn btn-default btn-sm" data-action="promotion">${__("转正面谈")}</button>` : ""}
						<button class="btn btn-default btn-sm" data-action="separation">${__("离职")}</button>
						<button class="btn btn-default btn-sm" data-action="contract">${__("合同记录")}</button>
					</div>
				</div>
			</div>
		`;
	}

	is_probation_work_nature(header = {}) {
		if (header.custom_work_nature) return header.custom_work_nature === "在职·试用期";
		if (header.employment_type === "Probation" || header.custom_is_confirmed === "否") return true;
		if (header.custom_is_confirmed === "是") return false;

		// 未填写“是否转正”时按转正日期判断；日期当天已是正式员工。
		const confirmation_date = String(header.final_confirmation_date || "").slice(0, 10);
		return Boolean(confirmation_date && confirmation_date > frappe.datetime.get_today());
	}

	get_employment_type_display(header = {}) {
		if (header.custom_work_nature) return header.custom_work_nature;
		if (header.status === "Left") return __("离职");
		if (header.status === "Inactive") return __("待离职");
		if (header.employment_type === "Retainer") return __("退休返聘");
		if (this.is_probation_work_nature(header)) return __("在职 · 试用期");
		if (header.employment_type) return __("在职 · 正式");
		return __("未设置");
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
		if (this.active_tab === "培训记录") {
			return this.render_training_history();
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
							<span>${__("概况")}：${frappe.utils.escape_html(this.join_values([this.format_employee_field_value("gender", header.gender), header.age, department_display, header.designation]))}</span>
							<span>${__("司龄")}：${frappe.utils.escape_html(header.service_years || this.calculate_service_years(header.date_of_joining))}</span>
						</div>
						<div class="hrms-employee-detail-kpi-grid">
							${this.render_kpi("部门", department_display || "未设置")}
							${this.render_kpi("岗位", header.designation || "未设置")}
							${this.render_kpi("入职日期", header.date_of_joining || "未设置")}
							${this.render_kpi("工作性质", this.get_employment_type_display(header))}
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
					${this.render_training_summary_card()}
					${this.render_side_card("绩效考核", [])}
					${this.render_employee_relationship_card()}
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

	render_training_summary_card() {
		const summary = this.detail?.training_history?.summary || {};
		const count = Number(summary.record_count || 0);
		return `
			<button type="button" class="hrms-employee-detail-side-card hrms-employee-training-summary" data-action="open-training-history">
				<div class="hrms-employee-training-summary__heading"><h4>${__("培训学习")}</h4><span>→</span></div>
				${count ? `<div class="hrms-employee-training-summary__metrics">
					<div><strong>${count}</strong><span>${__("参训记录")}</span></div>
					<div><strong>${Number(summary.course_count || 0)}</strong><span>${__("课程")}</span></div>
					<div><strong>${this.format_training_number(summary.study_hours)}</strong><span>${__("学时")}</span></div>
				</div><small>${__("最近培训")}：${frappe.utils.escape_html(this.format_training_date(summary.latest_date))}</small>` : `<div class="hrms-employee-detail-empty">${__("暂无培训记录")}</div>`}
			</button>
		`;
	}

	training_records() {
		const records = this.detail?.training_history?.records || [];
		const search = String(this.trainingSearch || "").trim().toLowerCase();
		return records.filter((record) => {
			if (this.trainingType && String(record.course_type || "") !== this.trainingType) return false;
			if (!search) return true;
			return [record.course, record.course_type, record.owner_department, record.trainer, record.location, record.actual_dates]
				.some((value) => String(value || "").toLowerCase().includes(search));
		});
	}

	render_training_history() {
		const history = this.detail?.training_history || {};
		const summary = history.summary || {};
		const records = this.training_records();
		const types = [...new Set((history.records || []).map((record) => String(record.course_type || "").trim()).filter(Boolean))].sort();
		return `
			<div class="hrms-employee-detail-section hrms-employee-detail-section-card hrms-employee-training-history">
				<div class="hrms-employee-detail-section__header">
					<div><h3>${__("培训记录")}</h3><div class="text-muted">${__("数据来自教育训练登记表，并按公司工号绑定当前员工。")}</div></div>
					<span class="hrms-employee-training-code">${__("公司工号")}：${frappe.utils.escape_html(history.employee_code || __("未设置"))}</span>
				</div>
				<div class="hrms-employee-training-kpis">
					${this.render_kpi("参训记录", Number(summary.record_count || 0))}
					${this.render_kpi("课程数", Number(summary.course_count || 0))}
					${this.render_kpi("累计学时", this.format_training_number(summary.study_hours))}
					${this.render_kpi("最近培训", this.format_training_date(summary.latest_date))}
				</div>
				<div class="hrms-employee-training-toolbar">
					<input class="form-control input-sm" data-training-search value="${frappe.utils.escape_html(this.trainingSearch)}" placeholder="${__("搜索课程、讲师、部门或地点")}">
					<select class="form-control input-sm" data-training-type><option value="">${__("全部课程类型")}</option>${types.map((type) => `<option value="${frappe.utils.escape_html(type)}" ${this.trainingType === type ? "selected" : ""}>${frappe.utils.escape_html(type)}</option>`).join("")}</select>
					<button type="button" class="btn btn-default btn-sm" data-action="apply-training-filter">${__("查询")}</button>
					<button type="button" class="btn btn-link btn-sm" data-action="clear-training-filter">${__("清除")}</button>
					<span class="text-muted">${__("显示 {0} 条", [records.length])}</span>
				</div>
				<div class="hrms-employee-training-table-wrap">
					<table class="table hrms-employee-training-table">
						<thead><tr><th>${__("上课日期")}</th><th>${__("培训课程")}</th><th>${__("课程类型")}</th><th>${__("归属部门")}</th><th>${__("授课人 / 地点")}</th><th>${__("课时 / 学时")}</th><th>${__("记录状态")}</th></tr></thead>
						<tbody>${records.length ? records.map((record) => this.render_training_row(record)).join("") : `<tr><td colspan="7"><div class="hrms-employee-detail-empty">${__("没有符合条件的培训记录")}</div></td></tr>`}</tbody>
					</table>
				</div>
			</div>
		`;
	}

	render_training_row(record) {
		const date = this.format_training_date(record.training_date);
		const actualDates = String(record.actual_dates || "").trim();
		const scoreNumber = Number(record.score || 0);
		const score = record.grade
			? `${__("成绩")}：${record.grade}`
			: scoreNumber !== 0
				? `${__("成绩")}：${this.format_training_number(scoreNumber)}`
				: "";
		return `<tr>
			<td><strong>${frappe.utils.escape_html(date)}</strong>${actualDates && actualDates !== date ? `<small>${frappe.utils.escape_html(actualDates)}</small>` : ""}</td>
			<td><strong>${frappe.utils.escape_html(record.course || __("未命名课程"))}</strong><small>${frappe.utils.escape_html([record.training_mode, record.target].filter(Boolean).join(" · "))}</small></td>
			<td>${frappe.utils.escape_html(record.course_type || "—")}</td>
			<td>${frappe.utils.escape_html(record.owner_department || "—")}</td>
			<td>${frappe.utils.escape_html([record.trainer, record.location].filter(Boolean).join(" / ") || "—")}</td>
			<td>${this.format_training_number(record.hours)} / ${this.format_training_number(record.study_hours)}</td>
			<td><span class="hrms-employee-training-status ${record.review_status === "已确认" ? "is-confirmed" : "is-pending"}">${frappe.utils.escape_html(record.review_status || __("待复核"))}</span>${score ? `<small>${frappe.utils.escape_html(score)}</small>` : ""}${record.needs_retraining ? `<small class="text-danger">${__("需要补训")}</small>` : ""}</td>
		</tr>`;
	}

	format_training_date(value) {
		if (!value) return "—";
		return String(value).slice(0, 10);
	}

	format_training_number(value) {
		const number = Number(value || 0);
		return Number.isInteger(number) ? String(number) : number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
	}

	render_employee_relationship_card() {
		const data = this.detail?.relationship_records || {};
		const items = data.items || [];
		return `
			<div class="hrms-employee-detail-side-card">
				<h4>${__("员工关系")} <span class="text-muted" style="font-size:12px;font-weight:400">（${Number(data.count || 0)}）</span></h4>
				${items.length ? `<div class="hrms-employee-detail-relationship-list">${items.map((item) => `
					<button type="button" class="hrms-employee-detail-relationship-link" data-employee-relationship-route="${frappe.utils.escape_html(item.employee || "")}">
						<span class="hrms-employee-detail-relationship-person"><strong>${frappe.utils.escape_html(item.employee_name || item.employee || "")}</strong>${item.employee_code ? `<small>${frappe.utils.escape_html(item.employee_code)}</small>` : ""}</span>
						<span class="hrms-employee-detail-relationship-label">${frappe.utils.escape_html(item.relationship || "")}</span>
					</button>`).join("")}</div>` : `<div class="hrms-employee-detail-empty">${__("暂无员工关系")}</div>`}
				<div class="hrms-employee-detail-relationship-footer">
					<button type="button" class="btn btn-link btn-xs" data-action="manage-employee-relationships">${__("管理员工关系")}</button>
					${data.has_more ? `<button type="button" class="btn btn-default btn-xs" data-action="view-all-employee-relationships">${__("查看更多")}</button>` : ""}
				</div>
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
		const items = (this.detail?.growth_records || []).map((record) => ({
			date: record.date,
			title: record.title || __("员工记录"),
			description: record.description || [record.from_value, record.to_value].filter(Boolean).join(" → "),
		}));
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
				${tab_label === "工资社保" ? this.render_standing_pay_summary() : ""}
				${
					fields.length
						? `<div class="hrms-employee-detail-info-grid">
							${fields.map((field) => this.render_readonly_field(field)).join("")}
						</div>`
						: `<div class="hrms-employee-detail-empty">${__("当前区块没有已启用字段")}</div>`
				}
				${this.render_related_blocks(tab_label)}
				${tab_label === "在职信息" ? this.render_apple_tree_summary() : ""}
				${tab_label === "工资社保" ? "" : this.render_add_field_hint()}
			</div>
		`;
	}

	render_standing_pay_summary() {
		const summary = this.detail?.standing_pay_summary || {};
		if (!summary.visible) return "";
		const money = (value) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		const cards = [
			{ type: "定薪", label: "当前定薪", value: summary.salary },
			{ type: "社保", label: "当前社保", value: summary.social },
			{ type: "公积金", label: "当前公积金", value: summary.housing },
		];
		return `
			<div class="hrms-employee-standing-summary" aria-label="${__("当前工资社保标准")}">
				${cards.map((card) => {
					const value = card.value;
					const stopped = card.type !== "定薪" && value && !value.enabled;
					const primary = !value
						? __("尚未设置")
						: stopped
							? __("已停缴")
							: card.type === "定薪"
								? `${money(value.amount)} ${__("元")}`
								: `${__("个人")} ${money(value.personal_amount)} ${__("元")}`;
					const secondary = !value
						? __("暂无已生效标准")
						: card.type === "定薪" || stopped
							? `${value.effective_date || "-"} ${__("起")}`
							: `${__("公司")} ${money(value.company_amount)} ${__("元")} · ${value.effective_date || "-"} ${__("起")}`;
					return `<button type="button" class="hrms-employee-standing-card" data-standing-pay-history="${frappe.utils.escape_html(card.type)}"><span>${frappe.utils.escape_html(__(card.label))}</span><strong>${frappe.utils.escape_html(primary)}</strong><small>${frappe.utils.escape_html(secondary)}</small><em>${__("查看变化记录")} →</em></button>`;
				}).join("")}
			</div>
		`;
	}

	render_apple_tree_summary() {
		const data = this.apple_tree_summary;
		const year = data?.year || new Date().getFullYear();
		const person_key = data?.person_key || "";
		const key = "在职信息-苹果树汇总";
		const expanded = Boolean(this.expanded_related[key]);
		const person = data?.person || {};
		const count = data?.available ? Number(person.record_count || 0) : 0;
		const detail_button = person_key ? `<button class="btn btn-default btn-xs" data-action="open-apple-tree-detail" data-apple-person="${frappe.utils.escape_html(person_key)}" data-apple-year="${frappe.utils.escape_html(String(year))}">${__("查看详细信息")}</button>` : "";
		const fields = [["统计年度", `${year}${__("年")}`], ["绿苹果", person.green_apples], ["红苹果", person.red_apples], ["净苹果", person.net_apples], ["记录数", person.record_count], ["苹果金额", person.reward_amount]];
		const detail = data?.available
			? `<div class="hrms-employee-detail-related-detail">${this.render_related_items([{ fields: fields.map(([label, value]) => ({ label, value })) }])}<div class="hrms-employee-detail-related-footer"><span class="text-muted">${__("办理入口")}</span>${detail_button}</div></div>`
			: `<div class="hrms-employee-detail-related-detail"><div class="text-muted">${frappe.utils.escape_html(data ? (data.reason || __("暂无苹果树记录。")) : __("正在读取..."))}</div></div>`;
		return `<div class="hrms-employee-detail-related-row hrms-employee-detail-collapse-row" data-related-key="${key}"><div class="hrms-employee-detail-related-title"><strong>${__("苹果树汇总")}</strong><span class="text-muted">（${__("已有{0}条记录", [count])}）</span></div><div class="hrms-employee-detail-related-actions"><span>${count ? __("查看更多") : __("暂无数据")}</span><span>${expanded ? "⌃" : "⌄"}</span></div></div>${expanded ? detail : ""}`;
	}

	render_readonly_field(field) {
		const value = field.fieldname === "custom_work_nature"
			? this.get_employment_type_display({ ...this.detail?.header, custom_work_nature: field.value })
			: this.format_employee_field_value(field.fieldname, field.value);
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
				${this.render_photo_history_summary()}
				<div class="hrms-employee-material-groups">
					${groups.map((group) => this.render_material_group(group)).join("")}
				</div>
			</div>
		`;
	}

	render_photo_history_summary() {
		const photo_history = this.detail?.photo_history || {};
		const history_count = (photo_history.history_files || []).length;
		return `
			<div class="hrms-employee-upload-history-summary">
				<div class="hrms-employee-upload-history-summary__copy">
					<strong>${__("头像历史记录")}</strong>
					<span class="text-muted">${__("花名册和员工档案主页只显示当前头像，过往上传保留在此。")}</span>
				</div>
				<button class="btn btn-default btn-sm" data-action="view-photo-history">${__("查看历史（{0}）", [history_count])}</button>
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
		const current_file = material.current_file || (material.files || [])[0];
		const history_files = material.history_files || (material.files || []).slice(1);
		return `
			<div class="hrms-employee-material-type">
				<div class="hrms-employee-material-type__name">${frappe.utils.escape_html(__(material.label))}</div>
				<div class="hrms-employee-material-files">
					${current_file ? this.render_material_file(current_file) : `<span class="text-muted">${__("未上传")}</span>`}
				</div>
				<div class="hrms-employee-material-actions">
					<button class="btn btn-default btn-xs" data-action="view-material-history" data-material-type="${frappe.utils.escape_html(material.key)}">${__("历史记录（{0}）", [history_files.length])}</button>
					${this.can_edit_employee_detail() ? `<button class="btn btn-default btn-xs" data-action="upload-material" data-material-type="${frappe.utils.escape_html(material.key)}">${__("拍照/上传")}</button>` : ""}
				</div>
			</div>
		`;
	}

	render_material_file(file) {
		const name = frappe.utils.escape_html(file.file_name || __("未命名材料"));
		const title = frappe.utils.escape_html(file.title || "");
		const url = frappe.utils.escape_html(file.file_url || "");
		const submitted_by = frappe.utils.escape_html(file.submitted_by_name || file.submitted_by || __("未记录"));
		const submitted_at = frappe.utils.escape_html(frappe.datetime.str_to_user(file.creation || file.modified || "") || "-");
		const meta = `<span class="hrms-employee-material-file__meta">${__("提交人")}：${submitted_by} · ${__("提交时间")}：${submitted_at}</span>`;
		const content = `<span class="hrms-employee-material-file__content">${title ? `<span class="hrms-employee-material-file__title">${title}</span><span class="hrms-employee-material-file__name">${__("文件")}：${name}</span>` : `<span class="hrms-employee-material-file__name">${name}</span>`}${meta}</span>`;
		const image = /\.(?:jpe?g|png|webp)(?:\?.*)?$/i.test(file.file_url || "");
		if (!image) {
			return `<a class="hrms-employee-material-file" href="${url}" target="_blank" rel="noopener" title="${title || name}"><span class="hrms-employee-material-file__placeholder">PDF</span>${content}</a>`;
		}
		return `<div class="hrms-employee-material-file"><button class="hrms-employee-material-file__preview" type="button" data-action="preview-material-image" data-file-url="${url}" data-file-name="${title || name}" title="${__("点击放大查看")}"><img class="hrms-employee-material-file__image" src="${url}" alt="">${content}</button>${this.can_edit_employee_detail() ? `<button class="hrms-employee-material-file__delete" type="button" data-action="delete-material" data-file-name="${frappe.utils.escape_html(file.name || "")}" data-display-name="${title || name}">${__("删除")}</button>` : ""}</div>`;
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
		if (row.compact) {
			return `
				<div class="hrms-employee-detail-related-detail">
					${items.length ? this.render_related_items(items) : `<div class="text-muted">${__("暂未录入薪资社保数据")}</div>`}
				</div>
			`;
		}
		return `
			<div class="hrms-employee-detail-related-detail">
				${items.length ? this.render_related_items(items) : `<div class="text-muted">${__("暂无记录")}</div>`}
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
				this.open_tab(button.dataset.tab);
			});
		});
		this.wrapper.querySelectorAll("[data-action='open-training-history']").forEach((button) => {
			button.addEventListener("click", () => {
				this.open_tab("培训记录");
			});
		});
		this.wrapper.querySelectorAll("[data-action='apply-training-filter']").forEach((button) => {
			button.addEventListener("click", () => {
				this.trainingSearch = this.wrapper.querySelector("[data-training-search]")?.value || "";
				this.trainingType = this.wrapper.querySelector("[data-training-type]")?.value || "";
				this.render();
			});
		});
		this.wrapper.querySelectorAll("[data-action='clear-training-filter']").forEach((button) => {
			button.addEventListener("click", () => {
				this.trainingSearch = "";
				this.trainingType = "";
				this.render();
			});
		});
		this.wrapper.querySelectorAll("[data-training-search]").forEach((input) => {
			input.addEventListener("keydown", (event) => {
				if (event.key !== "Enter") return;
				this.trainingSearch = input.value || "";
				this.trainingType = this.wrapper.querySelector("[data-training-type]")?.value || "";
				this.render();
			});
		});
		this.wrapper.querySelectorAll("[data-nav-employee]").forEach((button) => {
			button.addEventListener("click", () => {
				if (!button.dataset.navEmployee) return;
				frappe.set_route("employee-detail", button.dataset.navEmployee);
			});
		});
		this.wrapper.querySelectorAll("[data-employee-relationship-route]").forEach((button) => {
			button.addEventListener("click", () => {
				if (button.dataset.employeeRelationshipRoute) frappe.set_route("employee-detail", button.dataset.employeeRelationshipRoute);
			});
		});
		this.wrapper.querySelectorAll("[data-action='manage-employee-relationships'], [data-action='view-all-employee-relationships']").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				frappe.set_route("employee-relationship", this.employee);
			});
		});
		this.wrapper.querySelectorAll("[data-related-key]").forEach((row) => {
			row.addEventListener("click", () => {
				// A mouseup after selecting a field also emits click. Do not collapse
				// the record and discard the selection before the user can copy it.
				if (this.has_text_selection(row)) return;
				this.toggle_related_block(row.dataset.relatedKey);
			});
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
		this.wrapper.querySelectorAll("[data-standing-pay-history]").forEach((button) => {
			button.addEventListener("click", () => {
				frappe.set_route("payroll-input-center", "salary-register", this.employee, button.dataset.standingPayHistory, "employee-detail");
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
		this.wrapper.querySelectorAll("[data-action='open-previous-employment']").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				if (button.dataset.previousEmployee) frappe.set_route("employee-detail", button.dataset.previousEmployee);
			});
		});
		this.wrapper.querySelectorAll("[data-action='open-current-employment']").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				if (button.dataset.currentEmployee) frappe.set_route("employee-detail", button.dataset.currentEmployee);
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
		this.wrapper.querySelectorAll("[data-action='view-photo-history']").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				const history = this.detail?.photo_history || {};
				this.show_upload_history(__("头像历史记录"), history.current_file, history.history_files || []);
			});
		});
		this.wrapper.querySelectorAll("[data-action='view-material-history']").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				const material = this.find_material_type(button.dataset.materialType);
				if (!material) return;
				this.show_upload_history(__("{0}·历史记录", [__(material.label)]), material.current_file, material.history_files || []);
			});
		});
		this.wrapper.querySelectorAll("[data-action='preview-material-image']").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				this.preview_employee_material_image(button.dataset.fileUrl, button.dataset.fileName);
			});
		});
		this.wrapper.querySelectorAll("[data-action='delete-material']").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				this.delete_employee_material(button.dataset.fileName, button.dataset.displayName);
			});
		});
		this.wrapper.querySelectorAll("[data-action='promotion']").forEach((button) => {
			button.addEventListener("click", () => {
				if (!this.is_probation_work_nature(this.detail?.header)) return;
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
							current: this.detail?.header?.custom_is_confirmed || "",
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
			button.addEventListener("click", (event) => {
				event.preventDefault();
				this.open_separation_reason_picker();
			});
		});
		this.wrapper.querySelectorAll("[data-action='contract']").forEach((button) => {
			button.addEventListener("click", () => {
				this.open_tab("合同信息");
			});
		});
		this.wrapper.querySelectorAll("[data-action='open-apple-tree-detail']").forEach((button) => {
			button.addEventListener("click", () => frappe.set_route("apple-tree-center", "person", button.dataset.applePerson, button.dataset.appleYear));
		});
		const compare_button = this.wrapper.querySelector("[data-action='compare']");
		if (compare_button) {
			compare_button.addEventListener("click", () => frappe.show_alert(__("员工对比功能将在后续阶段接入")));
		}
	}

	open_separation_reason_picker() {
		const reason_groups = [
			{
				type: "主动离职",
				label: __("主动原因"),
				reasons: ["家庭原因", "个人原因", "发展原因", "合同到期不续签", "其他"],
			},
			{
				type: "被动离职",
				label: __("被动原因"),
				reasons: ["协议解除", "无法胜任工作", "经济性裁员", "严重违法违纪", "其他"],
			},
		];
		const escape = frappe.utils.escape_html;
		const group_html = reason_groups
			.map(
				(group) => `
					<section class="hrms-separation-reason-group">
						<div class="hrms-separation-reason-group__title">${escape(group.label)}</div>
						<div class="hrms-separation-reason-options">
							${group.reasons
								.map(
									(reason) => `<label class="hrms-separation-reason-option"><input type="radio" name="hrms-separation-reason" data-reason-type="${escape(group.type)}" value="${escape(reason)}"><span>${escape(__(reason))}</span></label>`,
								)
								.join("")}
						</div>
					</section>`,
			)
			.join("");
		const picker_html = `
			<style>
				.hrms-separation-reason-picker { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
				.hrms-separation-reason-group { margin: 0; padding: 0 16px 14px; }
				.hrms-separation-reason-group + .hrms-separation-reason-group { border-top: 1px solid #eef0f2; }
				.hrms-separation-reason-group__title { margin: 0 -16px 12px; padding: 10px 16px; background: #f7f7f8; color: #1f2937; font-weight: 600; }
				.hrms-separation-reason-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 22px; }
				.hrms-separation-reason-option { display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 400; cursor: pointer; }
				.hrms-separation-reason-option input { margin: 0; }
				.hrms-separation-custom { padding: 14px 16px 16px; border-top: 1px solid #eef0f2; }
				.hrms-separation-custom textarea { display: none; margin-top: 10px; resize: vertical; }
				.hrms-separation-custom.is-selected textarea { display: block; }
				.hrms-separation-detail { padding: 14px 16px 16px; border-top: 1px solid #eef0f2; }
				.hrms-separation-detail label { display: block; margin-bottom: 8px; color: #374151; font-weight: 600; }
				.hrms-separation-detail textarea { resize: vertical; }
				@media (max-width: 575px) { .hrms-separation-reason-options { grid-template-columns: 1fr; } }
			</style>
			<div class="hrms-separation-reason-picker">
				${group_html}
				<section class="hrms-separation-custom">
					<label class="hrms-separation-reason-option"><input type="radio" name="hrms-separation-reason" data-reason-type="自定义" value="自定义"><span>${escape(__("自定义离职原因"))}</span></label>
					<textarea class="form-control hrms-separation-custom-reason" rows="3" maxlength="500" placeholder="${escape(__("请输入具体离职原因"))}"></textarea>
				</section>
				<section class="hrms-separation-detail">
					<label for="hrms-separation-reason-detail">${escape(__("详细原因（选填）"))}</label>
					<textarea id="hrms-separation-reason-detail" class="form-control hrms-separation-reason-detail" rows="3" maxlength="1000" placeholder="${escape(__("可补充离职背景、具体情况等，不填写也可以"))}"></textarea>
				</section>
			</div>`;

		const dialog = new frappe.ui.Dialog({
			title: __("选择离职原因"),
			fields: [{ fieldtype: "HTML", fieldname: "separation_reason_picker", options: picker_html }],
			primary_action_label: __("确定"),
			primary_action: () => {
				const selected = dialog.$wrapper.find('input[name="hrms-separation-reason"]:checked');
				if (!selected.length) {
					frappe.msgprint(__("请选择离职原因。"));
					return;
				}
				const reason_type = selected.attr("data-reason-type");
				const custom_reason = String(dialog.$wrapper.find(".hrms-separation-custom-reason").val() || "").trim();
				const reason_detail = String(dialog.$wrapper.find(".hrms-separation-reason-detail").val() || "").trim();
				if (reason_type === "自定义" && !custom_reason) {
					frappe.msgprint(__("请输入自定义离职原因。"));
					return;
				}

				const header = this.detail?.header || {};
				dialog.hide();
				frappe.new_doc("Employee Separation", {
					employee: this.employee,
					employee_code_display: header.custom_employee_code || "",
					employee_name: header.employee_name || "",
					separation_reason_type: reason_type,
					separation_reason: reason_type === "自定义" ? "" : selected.val(),
					custom_separation_reason: reason_type === "自定义" ? custom_reason : "",
					separation_reason_detail: reason_detail,
				});
			},
		});
		dialog.show();
		dialog.$wrapper.find('input[name="hrms-separation-reason"]').on("change", (event) => {
			const custom_selected = event.currentTarget.dataset.reasonType === "自定义";
			dialog.$wrapper.find(".hrms-separation-custom").toggleClass("is-selected", custom_selected);
			if (custom_selected) dialog.$wrapper.find(".hrms-separation-custom-reason").trigger("focus");
		});
	}

	has_text_selection(container) {
		const selection = window.getSelection?.();
		if (!selection || !String(selection).trim()) return false;
		if (!container) return true;
		return [selection.anchorNode, selection.focusNode].some((node) => {
			const element = node?.nodeType === 1 ? node : node?.parentElement;
			return Boolean(element && container.contains(element));
		});
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
						if (this.detail) this.detail.photo_history = response.message?.photo_history || this.detail.photo_history;
						this.render();
						frappe.show_alert({ message: __("员工照片已更新"), indicator: "green" });
					});
			},
		});
	}

	find_material_type(material_type) {
		for (const group of this.detail?.materials || []) {
			const material = (group.types || []).find((row) => row.key === material_type);
			if (material) return material;
		}
		return null;
	}

	show_upload_history(title, current_file, history_files) {
		const files = [
			...(current_file ? [{ ...current_file, is_current: true }] : []),
			...(history_files || []).map((file) => ({ ...file, is_current: false })),
		];
		const rows = files.length
			? files.map((file) => this.render_upload_history_file(file)).join("")
			: `<div class="text-muted">${__("暂无上传记录")}</div>`;
		const dialog = new frappe.ui.Dialog({
			title,
			fields: [{ fieldtype: "HTML", fieldname: "upload_history", options: `<div class="hrms-employee-upload-history-list">${rows}</div>` }],
			primary_action_label: __("关闭"),
			primary_action: () => dialog.hide(),
		});
		dialog.show();
		dialog.$wrapper.addClass("hrms-employee-upload-history-dialog");
		dialog.$wrapper.find("[data-action='preview-history-image']").on("click", (event) => {
			const button = event.currentTarget;
			this.preview_employee_material_image(button.dataset.fileUrl, button.dataset.fileName);
		});
	}

	render_upload_history_file(file) {
		const name = frappe.utils.escape_html(file.file_name || __("未命名文件"));
		const title = frappe.utils.escape_html(file.title || "");
		const url = frappe.utils.escape_html(file.file_url || "");
		const image = /\.(?:jpe?g|png|webp)(?:\?.*)?$/i.test(file.file_url || "");
		const preview = image
			? `<button class="hrms-employee-upload-history-item__preview" type="button" data-action="preview-history-image" data-file-url="${url}" data-file-name="${name}"><img src="${url}" alt=""></button>`
			: `<a class="hrms-employee-upload-history-item__preview hrms-employee-material-file__placeholder" href="${url}" target="_blank" rel="noopener">PDF</a>`;
		const timestamp = frappe.datetime.str_to_user(file.creation || file.modified || "");
		const submitted_by = frappe.utils.escape_html(file.submitted_by_name || file.submitted_by || __("未记录"));
		return `<div class="hrms-employee-upload-history-item">${preview}<div class="hrms-employee-upload-history-item__meta"><strong title="${title || name}">${title || name}</strong>${title ? `<span class="text-muted">${__("文件")}：${name}</span>` : ""}<span class="text-muted">${__("提交人")}：${submitted_by}</span><span class="text-muted">${__("提交时间")}：${frappe.utils.escape_html(timestamp || "-")}</span></div><span class="hrms-employee-upload-history-item__status${file.is_current ? " is-current" : ""}">${file.is_current ? __("当前使用") : __("历史版本")}</span></div>`;
	}

	get_material_title_label(material_type) {
		return {
			employee_talk_form: "谈话标题",
			employee_transfer_application: "调动标题",
			reward_punishment_report: "奖惩标题",
		}[material_type] || "";
	}

	upload_employee_material(material_type) {
		if (!this.can_edit_employee_detail()) {
			frappe.msgprint(__("只有管理员可以上传员工档案材料。"));
			return;
		}
		const title_label = this.get_material_title_label(material_type);
		if (title_label) {
			const title_dialog = new frappe.ui.Dialog({
				title: __("填写材料标题"),
				fields: [{ fieldtype: "Data", fieldname: "title", label: __(title_label), reqd: 1, length: 140, description: __("标题会与本次照片/文件绑定，并显示在录入记录和员工档案中。") }],
				primary_action_label: __("继续拍照/上传"),
				primary_action: (values) => {
					const title = String(values?.title || "").trim();
					if (!title) {
						frappe.msgprint(__("请输入{0}", [title_label]));
						return;
					}
					title_dialog.hide();
					this.start_employee_material_upload(material_type, title);
				},
			});
			title_dialog.show();
			return;
		}
		this.start_employee_material_upload(material_type, "");
	}

	start_employee_material_upload(material_type, title) {
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
					args: { employee: this.employee, material_type, file_url, title },
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

	preview_employee_material_image(file_url, file_name) {
		if (!file_url) return;
		const dialog = new frappe.ui.Dialog({
			title: file_name || __("材料图片"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "image_preview",
					options: `<div class="hrms-employee-material-preview"><div class="hrms-employee-material-preview__toolbar"><button class="btn btn-default btn-xs" type="button" data-action="material-image-zoom-out">${__("缩小")}</button><span class="hrms-employee-material-preview__zoom-level" data-role="material-image-zoom-level">${__("适应")}</span><button class="btn btn-default btn-xs" type="button" data-action="material-image-zoom-in">${__("放大")}</button><button class="btn btn-default btn-xs" type="button" data-action="material-image-zoom-reset">${__("适应窗口")}</button></div><div class="hrms-employee-material-preview__canvas"><img src="${frappe.utils.escape_html(file_url)}" alt="${frappe.utils.escape_html(file_name || "")}"></div></div>`,
				},
			],
			primary_action_label: __("关闭"),
			primary_action: () => dialog.hide(),
		});
		dialog.show();
		dialog.$wrapper.addClass("hrms-employee-material-preview-dialog");
		const image = dialog.$wrapper.find(".hrms-employee-material-preview__canvas img")[0];
		const zoom_level = dialog.$wrapper.find("[data-role='material-image-zoom-level']");
		let zoom = 1;
		const set_zoom = (next_zoom) => {
			zoom = Math.max(0.5, Math.min(4, next_zoom));
			if (zoom === 1 || !image?.naturalWidth) {
				image.style.width = "";
				image.style.height = "";
				image.classList.remove("is-zoomed");
				zoom_level.text(__("适应"));
				return;
			}
			image.style.width = `${Math.round(image.naturalWidth * zoom)}px`;
			image.style.height = `${Math.round(image.naturalHeight * zoom)}px`;
			image.classList.add("is-zoomed");
			zoom_level.text(`${Math.round(zoom * 100)}%`);
		};
		dialog.$wrapper.find("[data-action='material-image-zoom-in']").on("click", () => set_zoom(zoom + 0.25));
		dialog.$wrapper.find("[data-action='material-image-zoom-out']").on("click", () => set_zoom(zoom - 0.25));
		dialog.$wrapper.find("[data-action='material-image-zoom-reset']").on("click", () => set_zoom(1));
		image?.addEventListener("dblclick", () => set_zoom(zoom === 1 ? 2 : 1));
	}

	delete_employee_material(file_name, display_name) {
		if (!this.can_edit_employee_detail() || !file_name) return;
		frappe.confirm(
			__("确定删除“{0}”吗？删除后无法恢复。", [display_name || __("这份材料")]),
			() => {
				frappe.call({
					method: "hrms.api.employee_field_template.delete_employee_material",
					args: { employee: this.employee, file_name },
					freeze: true,
					freeze_message: __("正在删除员工材料…"),
				}).then((result) => {
					if (this.detail) this.detail.materials = result.message?.materials || this.detail.materials;
					this.render();
					frappe.show_alert({ message: __("员工材料已删除"), indicator: "green" });
				});
			},
		);
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

	format_employee_field_value(fieldname, value) {
		if (value === null || value === undefined || value === "") return "";
		if (fieldname === "gender") {
			const gender_labels = {
				Male: "男",
				Female: "女",
				Other: "其他",
			};
			return gender_labels[String(value)] || value;
		}
		if (["cell_number", "emergency_phone_number"].includes(fieldname)) {
			return String(value).replace(/^\+86[\s-]?/, "");
		}
		return value;
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
