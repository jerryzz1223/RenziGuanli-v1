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
	wrapper.payroll_input_center?.activate();
};

frappe.pages["payroll-input-center"].on_page_hide = function (wrapper) {
	wrapper.payroll_input_center?.deactivate();
};

// 考勤终稿已有独立的签字版导出；提案改善按提案流程确认，不在此生成签字表。
const PAYROLL_SIGNATURE_SOURCE_CODES = new Set([
	"certificate_skill", "continuing_service", "dormitory", "reward_punishment",
	"education", "social_insurance", "housing_fund",
]);

class PayrollInputCenter {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.file_url = "";
		this.salary_structure_file_url = "";
		this.employee_salary_change_file_url = "";
		this.employee_salary_change_import_preview = null;
		this.salaryChangeImportBatches = [];
		this.data_closure_file_url = "";
		this.company = this.get_context_company();
		this.payroll_month = this.get_saved_payroll_month(this.company);
		this.attendance_lock_version = "";
		this.attendance_dependency = null;
		this.attendance_final_preview = null;
		this.attendance_final_preview_loading_scope = "";
		this.payroll_participation_preview = null;
		this.payroll_participation_preview_loading_scope = "";
		this.variable_source_catalog = [];
		this.variable_import_batches = [];
		this.variable_source_catalog_target = null;
		this.variable_import_preview = null;
		this.bulk_variable_import_queue = Promise.resolve();
		this.bulk_variable_import_results = [];
		// 明细始终在对应的来源卡片内展开，避免用户误以为要到下方批次档案操作。
		this.open_source_card_code = "";
		this.editing_source_card_code = "";
		this.can_edit_payroll_rules = false;
		this.show_all_settlement_details = false;
		this.pending_config_anchor = "";
		this.payroll_configuration_items = [];
		this.payroll_rule_rows = [];
		this.payroll_mapping_rows = [];
		this.assignableSalaryGrades = [];
		this.process_readiness = {};
		this.payroll_workflow = null;
		this.month_runbook = null;
		this.tabs = [
			{ key: "monthly-workbench", label: "本月算薪" },
			{ key: "employee-salary", label: "员工薪资" },
			{ key: "monthly-payroll", label: "月工资表" },
			{ key: "payroll-disbursement", label: "工资发放" },
			{ key: "salary-rules", label: "薪资规则" },
			{ key: "attendance-pay-rules", label: "考勤计薪规则" },
			{ key: "salary-templates", label: "工资表模板" },
			{ key: "salary-assignments", label: "员工分配" },
			{ key: "variables", label: "变量导入" },
			{ key: "inputs", label: "薪资输入表" },
			{ key: "settlements", label: "薪资结算表" },
			{ key: "payroll-reports", label: "薪酬报表" },
			{ key: "payroll-analysis", label: "薪酬分析" },
			{ key: "annual-bonus", label: "年终奖计算" },
			{ key: "salary-slips", label: "发送工资条" },
		];
		this.workspace_areas = [
			{ key: "master", label: "人员范围", route: "employee-salary", description: "查看当月在职、正式、试用及待补资料人数" },
			{ key: "salary", label: "员工定薪", route: "salary-assignments", description: "维护有变化或缺失的员工固定薪资" },
			{ key: "sources", label: "月度增减项", route: "variables", description: "导入奖金、补贴、扣款、社保与公积金" },
			{ key: "calculation", label: "薪资试算", route: "monthly-workbench", description: "条件满足时生成并复核本月工资" },
			{ key: "delivery", label: "确认与发放", route: "payroll-reports", description: "确认结算、导出报表和发放工资条" },
		];
		this.active_tab = this.resolve_tab(frappe.get_route()[1] || "monthly-workbench");
		this.active_process_step = this.process_step_for(this.active_tab);
		this.last_route_refresh_at = 0;
		this.cache_ttl = 30_000;
		// Keep this shared, lightweight dependency outside the rendered page.
		// Otherwise a late response recreates a large editable table and flashes.
		this.attendance_dependency_cache = new Map();
		this.attendance_dependency_requests = new Map();
	}

	show() {
		this.page.clear_inner_toolbar?.();
		this.activate(true);
		this.render();
		this.load_active_tab();
		this.last_route_refresh_at = Date.now();
		this.refresh_company_context_when_ready();
	}

	is_active() {
		const container = this.wrapper.closest(".page-container");
		return !container || container.classList.contains("active");
	}

	activate(initial = false) {
		this.bind_route_events();
		this.bind_company_context();
		this.bind_table_controls();
		this.bind_viewport_fit();
		if (!initial) this.refresh_from_route("", true);
	}

	deactivate() {
		if (this.viewport_fit_bound) {
			window.removeEventListener("resize", this.handle_viewport_resize);
			this.viewport_fit_bound = false;
		}
		if (this.company_context_bound) {
			window.removeEventListener("hrms:company-context-changed", this.handle_company_context_change);
			this.company_context_bound = false;
		}
		if (this.route_events_bound) {
			window.removeEventListener("hrms:route-change", this.handle_hrms_route_change);
			this.route_events_bound = false;
		}
		if (this.table_controls_bound) {
			this.wrapper.removeEventListener("click", this.handle_table_control_click);
			this.wrapper.removeEventListener("input", this.handle_table_control_input);
			this.table_control_observer?.disconnect();
			this.table_controls_bound = false;
		}
	}

	bind_viewport_fit() {
		if (this.viewport_fit_bound) return;
		this.viewport_fit_bound = true;
		this.handle_viewport_resize = () => this.schedule_calculation_table_fit();
		window.addEventListener("resize", this.handle_viewport_resize);
	}

	schedule_calculation_table_fit() {
		window.cancelAnimationFrame(this.calculation_table_fit_frame);
		this.calculation_table_fit_frame = window.requestAnimationFrame(() => this.fit_calculation_table_to_viewport());
	}

	fit_calculation_table_to_viewport() {
		const table_wrap = this.wrapper.querySelector(".hrms-payroll-table-wrap--viewport");
		if (!table_wrap) return;

		const zoom = Number.parseFloat(window.getComputedStyle(document.documentElement).zoom) || 1;
		const viewport_height = window.visualViewport?.height || window.innerHeight;
		const available_height = viewport_height - table_wrap.getBoundingClientRect().top - 12;
		// The root Desk shell is compacted using CSS zoom. Convert the visible
		// viewport back to the table's layout coordinate system before sizing it.
		table_wrap.style.minHeight = `${Math.max(260, Math.floor(available_height / zoom))}px`;
	}

	bind_table_controls() {
		if (this.table_controls_bound) return;
		this.table_controls_bound = true;
		this.handle_table_control_click = (event) => {
			const paginationButton = event.target.closest("[data-payroll-table-page]");
			if (paginationButton && this.wrapper.contains(paginationButton)) {
				const pagination = paginationButton.closest("[data-payroll-table-pagination]");
				const table = [...this.wrapper.querySelectorAll("table.table")].find((candidate) => candidate.payrollPaginationElement === pagination);
				if (table) this.update_table_pagination(table, Number(paginationButton.dataset.payrollTablePage));
				return;
			}
			const button = event.target.closest("[data-table-sort]");
			if (!button || !this.wrapper.contains(button)) return;
			const table = button.closest("table");
			if (!table) return;
			const column = Number(button.dataset.tableSort);
			const direction = table.dataset.sortColumn === String(column) && table.dataset.sortDirection === "asc" ? "desc" : "asc";
			this.sort_table_rows(table, column, direction);
		};
		this.handle_table_control_input = (event) => {
			const input = event.target.closest("[data-table-column-search]");
			if (!input || !this.wrapper.contains(input)) return;
			this.filter_table_rows(input.closest("table"));
		};
		this.wrapper.addEventListener("click", this.handle_table_control_click);
		this.wrapper.addEventListener("input", this.handle_table_control_input);
		this.table_control_observer = new MutationObserver(() => this.decorate_table_controls());
		this.table_control_observer.observe(this.wrapper, { childList: true, subtree: true });
		this.decorate_table_controls();
	}

	decorate_table_controls() {
		this.wrapper.querySelectorAll("table.table").forEach((table) => {
			if (!table.dataset.tableControlsReady && table.tHead?.rows.length) {
				Array.from(table.tHead.rows[0].cells).forEach((header, index) => {
					const label = header.textContent.trim();
					if (!label || [__("操作"), __("选择")].includes(label)) return;
					header.innerHTML = `<div class="hrms-payroll-table-column-head"><button class="btn btn-link btn-xs" type="button" data-table-sort="${index}" title="${this.escape(__("按{0}排序", [label]))}"><span>${this.escape(label)}</span><i aria-hidden="true">↕</i></button><input class="form-control input-xs" type="search" data-table-column-search="${index}" placeholder="${this.escape(__("搜索"))}" aria-label="${this.escape(__("搜索{0}", [label]))}"></div>`;
				});
				table.dataset.tableControlsReady = "1";
				this.prioritize_table_rows(table);
			}
			this.decorate_table_pagination(table);
		});
	}

	table_data_rows(table) {
		if (!table?.tBodies.length) return [];
		return Array.from(table.tBodies[0].rows).filter((row) => !row.querySelector("td[colspan]"));
	}

	decorate_table_pagination(table) {
		const rows = this.table_data_rows(table);
		if (!rows.length || table.dataset.tablePaginationReady) return;
		const pagination = document.createElement("nav");
		pagination.className = "hrms-payroll-table-pagination";
		pagination.dataset.payrollTablePagination = "1";
		pagination.setAttribute("aria-label", __("表格分页"));
		const tableWrap = table.closest(".hrms-payroll-table-wrap, .table-responsive");
		const viewportFooter = tableWrap?.querySelector(".hrms-payroll-table-viewport-footer");
		if (tableWrap?.classList.contains("hrms-payroll-table-wrap--viewport") && viewportFooter) {
			tableWrap.insertBefore(pagination, viewportFooter);
		} else {
			(tableWrap || table).insertAdjacentElement("afterend", pagination);
		}
		table.payrollPaginationElement = pagination;
		table.dataset.tablePaginationReady = "1";
		table.dataset.tablePageSize ||= "20";
		this.update_table_pagination(table, 1);
	}

	update_table_pagination(table, requestedPage = Number(table?.dataset.tablePage || 1)) {
		if (!table?.dataset.tablePaginationReady) return;
		const rows = this.table_data_rows(table);
		const visibleRows = rows.filter((row) => row.dataset.tableFilterMatch !== "0");
		const pageSize = Number(table.dataset.tablePageSize || 20);
		const pageCount = Math.max(1, Math.ceil(visibleRows.length / pageSize));
		const page = Math.min(Math.max(1, requestedPage || 1), pageCount);
		table.dataset.tablePage = String(page);
		const start = (page - 1) * pageSize;
		rows.forEach((row) => {
			const index = visibleRows.indexOf(row);
			row.hidden = index < 0 || index < start || index >= start + pageSize;
		});
		const pagination = table.payrollPaginationElement;
		if (!pagination) return;
		if (visibleRows.length <= pageSize) {
			pagination.hidden = true;
			return;
		}
		pagination.hidden = false;
		const pageNumbers = Array.from({ length: pageCount }, (_item, index) => index + 1)
			.filter((number) => number === 1 || number === pageCount || Math.abs(number - page) <= 1);
		const buttons = [];
		pageNumbers.forEach((number, index) => {
			if (index && number - pageNumbers[index - 1] > 1) buttons.push(`<span class="hrms-payroll-table-pagination-ellipsis">…</span>`);
			buttons.push(`<button class="btn btn-default btn-xs ${number === page ? "is-active" : ""}" type="button" data-payroll-table-page="${number}" ${number === page ? "aria-current=\"page\"" : ""}>${number}</button>`);
		});
		pagination.innerHTML = `<span>${this.escape(__("共 {0} 条，第 {1} / {2} 页", [visibleRows.length, page, pageCount]))}</span><div><button class="btn btn-default btn-xs" type="button" data-payroll-table-page="${page - 1}" ${page === 1 ? "disabled" : ""}>${this.escape(__("上一页"))}</button>${buttons.join("")}<button class="btn btn-default btn-xs" type="button" data-payroll-table-page="${page + 1}" ${page === pageCount ? "disabled" : ""}>${this.escape(__("下一页"))}</button></div>`;
	}

	prioritize_table_rows(table) {
		if (!table?.tBodies.length || table.dataset.tablePriorityApplied) return;
		const priority = (row) => {
			const value = row.innerText || "";
			if (/错误|异常|未匹配/.test(value)) return 0;
			if (/待修改|待纠错/.test(value)) return 1;
			if (/警告/.test(value)) return 2;
			if (/待审核|待确认/.test(value)) return 3;
			if (/已确认/.test(value)) return 5;
			return 4;
		};
		const rows = Array.from(table.tBodies[0].rows).map((row, index) => ({ row, index }));
		rows.sort((left, right) => priority(left.row) - priority(right.row) || left.index - right.index);
		rows.forEach(({ row }) => table.tBodies[0].appendChild(row));
		table.dataset.tablePriorityApplied = "1";
	}

	sort_table_rows(table, column, direction) {
		if (!table?.tBodies.length) return;
		const rows = Array.from(table.tBodies[0].rows).filter((row) => row.cells.length > column);
		const numeric = (value) => Number(String(value || "").replace(/[￥,，\s]/g, ""));
		rows.sort((left, right) => {
			const leftValue = left.cells[column]?.innerText.trim() || "";
			const rightValue = right.cells[column]?.innerText.trim() || "";
			const leftNumber = numeric(leftValue);
			const rightNumber = numeric(rightValue);
			const result = leftValue && rightValue && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
				? leftNumber - rightNumber
				: leftValue.localeCompare(rightValue, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
			return direction === "asc" ? result : -result;
		});
		rows.forEach((row) => table.tBodies[0].appendChild(row));
		table.dataset.sortColumn = String(column);
		table.dataset.sortDirection = direction;
		table.querySelectorAll("[data-table-sort]").forEach((button) => {
			const active = Number(button.dataset.tableSort) === column;
			button.classList.toggle("is-sorted", active);
			button.querySelector("i").textContent = active ? (direction === "asc" ? "↑" : "↓") : "↕";
		});
		this.update_table_pagination(table, 1);
	}

	filter_table_rows(table) {
		if (!table?.tBodies.length) return;
		const filters = Array.from(table.querySelectorAll("[data-table-column-search]")).map((input) => ({ column: Number(input.dataset.tableColumnSearch), value: input.value.trim().toLocaleLowerCase() })).filter((item) => item.value);
		Array.from(table.tBodies[0].rows).forEach((row) => {
			if (!row.cells.length) return;
			row.dataset.tableFilterMatch = filters.every((filter) => (row.cells[filter.column]?.innerText || "").toLocaleLowerCase().includes(filter.value)) ? "1" : "0";
		});
		this.update_table_pagination(table, 1);
	}

	get_context_company() {
		return (
			window.hrmsCompanyContext?.getCurrentCompany?.() ||
			(frappe.defaults && frappe.defaults.get_user_default && frappe.defaults.get_user_default("Company")) ||
			""
		);
	}

	default_payroll_month() {
		return frappe.datetime.str_to_obj(frappe.datetime.get_today()).toISOString().slice(0, 7);
	}

	payroll_month_storage_key(company = this.company) {
		return `hrms.payroll-input-center.month.${company || "default"}`;
	}

	get_saved_payroll_month(company = this.company) {
		try {
			const month = window.localStorage?.getItem(this.payroll_month_storage_key(company));
			if (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ""))) return month;
		} catch (_ignore) {
			// Private browsing or a browser policy can disable local storage; use the
			// current month without preventing the payroll page from opening.
		}
		return this.default_payroll_month();
	}

	remember_payroll_month(month = this.payroll_month, company = this.company) {
		try {
			window.localStorage?.setItem(this.payroll_month_storage_key(company), month);
		} catch (_ignore) {
			// The selected month remains available for the current page session.
		}
	}

	escape(value) {
		return frappe.utils.escape_html(String(value ?? ""));
	}

	format_payroll_month(month = this.payroll_month) {
		const [year, value] = String(month || "").split("-");
		const monthNumber = Number(value);
		return Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12 ? `${year}年${monthNumber}月` : "--";
	}

	set_payroll_month(month) {
		if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || "")) || month === this.payroll_month) return;
		if (!this.confirm_salary_changes_saved()) return false;
		this.payroll_month = month;
		this.remember_payroll_month(month);
		this.attendance_lock_version = "";
		this.attendance_dependency = null;
		this.process_readiness = {};
		this.payroll_workflow = null;
		this.month_runbook = null;
		this.render();
		this.load_active_tab();
		return true;
	}

	has_unsaved_salary_changes() {
		return Boolean(this.wrapper.querySelector('[data-salary-change-row][data-salary-change-dirty="1"]'));
	}

	confirm_salary_changes_saved() {
		if (!this.has_unsaved_salary_changes()) return true;
		frappe.show_alert({ message: __("员工定薪存在未提交的修改，请先点击该行“保存并提交”"), indicator: "orange" });
		return false;
	}

	shift_payroll_month(offset) {
		const [year, month] = this.payroll_month.split("-").map(Number);
		const date = new Date(year, month - 1 + Number(offset || 0), 1);
		const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
		this.set_payroll_month(next);
	}

	render_month_control() {
		return `
			<div class="hrms-payroll-month-control" aria-label="${this.escape(__("处理月份"))}">
				<div class="hrms-payroll-month-switcher">
					<button class="btn btn-default btn-sm" type="button" data-month-shift="-1" title="${this.escape(__("上一个月"))}" aria-label="${this.escape(__("上一个月"))}">‹</button>
					<button class="btn btn-default btn-sm hrms-payroll-month-current" type="button" data-open-month-picker title="${this.escape(__("选择处理月份"))}">${this.escape(this.format_payroll_month())}</button>
					<button class="btn btn-default btn-sm" type="button" data-month-shift="1" title="${this.escape(__("下一个月"))}" aria-label="${this.escape(__("下一个月"))}">›</button>
				</div>
			</div>
		`;
	}

	bind_month_control() {
		this.wrapper.querySelectorAll("[data-month-shift]").forEach((button) => {
			button.addEventListener("click", () => this.shift_payroll_month(Number(button.dataset.monthShift)));
		});
		this.wrapper.querySelector("[data-open-month-picker]")?.addEventListener("click", () => this.open_month_picker());
	}

	open_month_picker() {
		let pickerYear = Number(this.payroll_month.slice(0, 4)) || new Date().getFullYear();
		const months = Array.from({ length: 12 }, (_unused, index) => index + 1);
		const dialog = new frappe.ui.Dialog({
			title: __("选择处理月份"),
			fields: [{ fieldname: "month_picker", fieldtype: "HTML" }],
		});
		const renderPicker = () => {
			const activeMonth = this.payroll_month;
			dialog.fields_dict.month_picker.$wrapper.html(`
				<div class="hrms-payroll-month-picker">
					<div class="hrms-payroll-month-picker__year">
						<button class="btn btn-default btn-sm" type="button" data-picker-year="-1" aria-label="${this.escape(__("上一年"))}">‹</button>
						<strong>${this.escape(String(pickerYear))}${this.escape(__("年"))}</strong>
						<button class="btn btn-default btn-sm" type="button" data-picker-year="1" aria-label="${this.escape(__("下一年"))}">›</button>
					</div>
					<div class="hrms-payroll-month-picker__months">
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
				if (this.set_payroll_month(event.currentTarget.dataset.pickerMonth)) dialog.hide();
			});
			dialog.$wrapper.find("[data-picker-current]").on("click", () => {
				const today = frappe.datetime.str_to_obj(frappe.datetime.get_today());
				if (this.set_payroll_month(today.toISOString().slice(0, 7))) dialog.hide();
			});
		};
		dialog.show();
		renderPicker();
	}

	bind_company_context() {
		if (this.company_context_bound) return;
		this.company_context_bound = true;
		this.handle_company_context_change = (event) => {
			if (!this.is_active()) return;
			const company = event?.detail?.company || this.get_context_company();
			if (!company || company === this.company) return;
			if (!this.confirm_salary_changes_saved()) return;
			this.company = company;
			this.payroll_month = this.get_saved_payroll_month(company);
			this.attendance_lock_version = "";
			this.attendance_dependency = null;
			this.process_readiness = {};
			this.payroll_workflow = null;
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
			if (!this.is_active()) return;
			if (!company || company === this.company) return;
			if (!this.confirm_salary_changes_saved()) return;
			this.company = company;
			this.payroll_month = this.get_saved_payroll_month(company);
			this.attendance_lock_version = "";
			this.attendance_dependency = null;
			this.process_readiness = {};
			this.payroll_workflow = null;
			this.month_runbook = null;
			this.render();
			this.load_active_tab();
		});
	}

	bind_route_events() {
		if (this.route_events_bound) return;
		this.route_events_bound = true;
		this.handle_hrms_route_change = (event) => {
			if (!this.is_active()) return;
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

	refresh_from_route(tab = "", force = false) {
		const next_tab = this.resolve_tab(tab || this.tab_from_current_route());
		const has_body = Boolean(this.body());
		if (next_tab !== this.active_tab && !this.confirm_salary_changes_saved()) {
			frappe.set_route("payroll-input-center", this.active_tab);
			return;
		}
		if (next_tab === this.active_tab && has_body) {
			if (!force || Date.now() - this.last_route_refresh_at < this.cache_ttl) return;
			this.last_route_refresh_at = Date.now();
			this.load_attendance_dependency();
			this.load_active_tab();
			return;
		}
		this.active_tab = next_tab;
		this.active_process_step = this.process_step_for(next_tab);
		this.render();
		this.load_active_tab();
		this.last_route_refresh_at = Date.now();
	}

	resolve_tab(tab) {
		if (tab === "data-closure") return "variables";
		if (tab === "salary-master") return "salary-assignments";
		if (tab === "welfare-sources") return "variables";
		return this.tabs.some((item) => item.key === tab) ? tab : "monthly-workbench";
	}

	process_step_for(tab) {
		if (tab === "employee-salary") return "master";
		if (["salary-assignments", "salary-rules", "salary-templates"].includes(tab)) return "salary";
		if (tab === "attendance-pay-rules") return "calculation";
		if (["welfare-sources", "variables"].includes(tab)) return "sources";
		if (["monthly-workbench", "monthly-payroll", "inputs", "settlements"].includes(tab)) return "calculation";
		return "delivery";
	}

	render_workspace_navigation() {
		return `
			<div class="hrms-payroll-area-navigation" aria-label="本月薪资数据状态">
				<div class="hrms-payroll-area-caption">
					<strong>${frappe.utils.escape_html(__("本月数据状态"))}</strong>
					<span>${frappe.utils.escape_html(__("各区域可按需进入；试算时系统统一检查必要条件。"))}</span>
				</div>
				<div class="hrms-payroll-area-grid">
					${this.workspace_areas
						.map((area) => {
							const state = this.process_state_for(area.key);
							return `<button class="hrms-payroll-area-card is-${state.state} ${area.key === this.active_process_step ? "is-selected" : ""}" data-area-key="${frappe.utils.escape_html(area.key)}" data-area-route="${frappe.utils.escape_html(area.route)}" title="${frappe.utils.escape_html(state.detail || __(area.description))}" aria-current="${area.key === this.active_process_step ? "page" : "false"}">
								<span class="hrms-payroll-area-indicator" aria-hidden="true"></span>
								<span><strong>${frappe.utils.escape_html(__(area.label))}</strong><small data-area-state>${frappe.utils.escape_html(state.label)}</small></span>
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
		return { state: "pending", label: __("查看数据"), detail: "" };
	}

	update_process_guide_status(statuses = {}) {
		this.process_readiness = Object.assign({}, this.process_readiness || {}, statuses);
		this.wrapper.querySelectorAll("[data-area-key]").forEach((button) => {
			const state = this.process_state_for(button.dataset.areaKey);
			button.className = `hrms-payroll-area-card is-${state.state} ${button.dataset.areaKey === this.active_process_step ? "is-selected" : ""}`;
			button.title = state.detail || button.title || "";
			const label = button.querySelector("[data-area-state]");
			if (label) label.textContent = state.label;
		});
	}

	process_status_from_runbook(runbook = {}) {
		const byKey = {};
		(runbook.readiness_areas || runbook.process_steps || []).forEach((step) => {
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
			<div class="hrms-payroll-input-center hrms-payroll-calculation-only">
				<section class="hrms-payroll-global-scope" aria-label="${this.escape(__("薪资核算范围"))}">
					${this.render_month_control()}
				</section>
				<div data-payroll-body></div>
			</div>
		`;
		this.bind_month_control();
		this.load_attendance_dependency();
	}

	render_attendance_dependency() {
		const target = this.wrapper.querySelector("[data-attendance-dependency]");
		if (!target) return;
		const dependency = this.attendance_dependency;
		if (!dependency) {
			target.className = "hrms-payroll-attendance-dependency is-loading";
			target.textContent = __("正在自动读取考勤假期终稿…");
			return;
		}
		target.className = `hrms-payroll-attendance-dependency ${dependency.ready ? "is-ready" : "is-missing"}`;
		target.innerHTML = dependency.ready
			? `<strong>${frappe.utils.escape_html(__("考勤终稿已自动继承"))}</strong><span>${frappe.utils.escape_html(__("{0} 人 · {1}", [dependency.summary_count || 0, dependency.locked_on || dependency.status || "-"]))}</span>`
			: `<strong>${frappe.utils.escape_html(__("缺少考勤终稿"))}</strong><span>${frappe.utils.escape_html(dependency.message || __("请先在考勤假期完成并锁定本月考勤终稿"))}</span>`;
	}

	attendance_dependency_key(company = this.company, payroll_month = this.payroll_month) {
		return `${company || ""}::${payroll_month || ""}`;
	}

	apply_attendance_dependency(dependency, company = this.company, payroll_month = this.payroll_month) {
		// Ignore a request that completed after the user switched its calculation
		// scope; stale locks must never overwrite the current company/month.
		if (company !== this.company || payroll_month !== this.payroll_month) return;
		this.attendance_dependency = dependency || { ready: false };
		this.attendance_lock_version = this.attendance_dependency.attendance_lock_version || "";
		this.render_attendance_dependency();
		this.update_attendance_dependent_controls();
		if (this.active_tab === "employee-salary") {
			this.load_payroll_participation_preview(this.body()?.querySelector("[data-payroll-participation-preview]"));
		}
	}

	update_attendance_dependent_controls() {
		const available = Boolean(this.attendance_lock_version);
		this.wrapper.querySelectorAll("[data-requires-attendance-lock]").forEach((button) => {
			button.disabled = !available;
			button.title = available
				? button.dataset.attendanceReadyTitle || ""
				: __("请先在考勤假期完成并锁定本月考勤终稿");
		});
	}

	load_attendance_dependency({ force = false } = {}) {
		if (!this.company || !this.payroll_month) return Promise.resolve(null);
		const company = this.company;
		const payroll_month = this.payroll_month;
		const key = this.attendance_dependency_key(company, payroll_month);
		const cached = this.attendance_dependency_cache.get(key);
		if (!force && cached && Date.now() - cached.loaded_at < this.cache_ttl) {
			this.apply_attendance_dependency(cached.value, company, payroll_month);
			return Promise.resolve(cached.value);
		}
		const pending = this.attendance_dependency_requests.get(key);
		if (pending) return pending;

		const request = frappe
			.call({
				method: "hrms.api.payroll_input.get_payroll_attendance_dependency",
				args: { company, payroll_month },
			})
			.then((response) => {
				const dependency = response.message || { ready: false };
				this.attendance_dependency_cache.set(key, { value: dependency, loaded_at: Date.now() });
				this.apply_attendance_dependency(dependency, company, payroll_month);
				return dependency;
			});
		const clear_request = () => this.attendance_dependency_requests.delete(key);
		// Frappe's request wrapper is thenable but some supported versions do not
		// implement Promise.prototype.finally.  Use the two-argument form of then
		// so page initialization stays compatible with both implementations.
		const settled_request = request.then(
			(value) => {
				clear_request();
				return value;
			},
			(error) => {
				clear_request();
				throw error;
			},
		);
		this.attendance_dependency_requests.set(key, settled_request);
		return settled_request;
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
		// Background refreshes (for example, the attendance dependency response)
		// must not rebuild this editable table over a user's pending changes.
		if (this.has_unsaved_salary_changes()) return;
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
		if (this.active_tab === "salary-rules") {
			this.load_salary_rules();
			return;
		}
		if (this.active_tab === "attendance-pay-rules") {
			this.load_attendance_pay_rules();
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
		if (!this.selected_payroll_source?.source_code) {
			frappe.msgprint(__("请先在数据来源标签中点击对应来源的“上传”，再选择一张 Excel。"));
			return;
		}
		new frappe.ui.FileUploader({
			folder: "Home/Attachments",
			allow_multiple: false,
			restrictions: { allowed_file_types: [".xlsx"] },
			on_success: (file) => {
				this.file_url = file.file_url;
				this.variable_import_preview = null;
				this.preview_payroll_variable_workbook();
			},
		});
	}

	open_bulk_variable_uploader() {
		if (!this.variable_source_catalog?.length) {
			frappe.msgprint(__("来源配置尚未加载完成，请稍后再试。"));
			return;
		}
		this.bulk_variable_import_queue = Promise.resolve();
		this.bulk_variable_import_results = [];
		frappe.show_alert({
			message: __("可一次选择多张 Excel；系统会逐张识别来源并依次导入。薪资异动、全勤奖和住房补贴会自动跳过。"),
			indicator: "blue",
		});
		new frappe.ui.FileUploader({
			folder: "Home/Attachments",
			allow_multiple: true,
			restrictions: { allowed_file_types: [".xlsx"] },
			on_success: (file) => {
				this.bulk_variable_import_queue = this.bulk_variable_import_queue
					.then(() => this.import_bulk_variable_file(file))
					.catch((error) => {
						const label = file.file_name || file.name || __("未命名文件");
						this.bulk_variable_import_results.push({ file: label, status: "failed" });
						frappe.show_alert({
							message: __("{0} 未导入。请在对应来源卡使用单项上传检查表头和数据。", [label]),
							indicator: "red",
						});
						console.error("Bulk payroll-variable import failed", error);
					});
			},
		});
	}

	import_bulk_variable_file(file) {
		const fileUrl = file.file_url;
		const fileLabel = file.file_name || file.name || fileUrl;
		return frappe
			.call({
				method: "hrms.api.payroll_input.preview_payroll_variable_workbook",
				args: { file_url: fileUrl, company: this.company, payroll_month: this.payroll_month },
				freeze: true,
				freeze_message: __("正在识别 {0}...", [fileLabel]),
			})
			.then((response) => {
				const preview = response.message || {};
				const sourceKinds = [...new Set((preview.sheets || []).map((sheet) => sheet.source_kind).filter(Boolean))];
				const blockedKinds = sourceKinds.filter((kind) => ["salary_change", "attendance_bonus", "housing_allowance", "housing_allowance_base"].includes(kind));
				const importKinds = sourceKinds.filter((kind) => !["salary_change", "attendance_bonus", "housing_allowance", "housing_allowance_base"].includes(kind));
				if (preview.blocked || blockedKinds.length || !importKinds.length) {
					const reason = blockedKinds.includes("salary_change")
						? __("薪资异动应在员工定薪处理")
						: blockedKinds.some((kind) => ["housing_allowance", "housing_allowance_base"].includes(kind))
							? __("住房补贴由考勤终稿自动继承")
							: __("全勤奖由考勤终稿自动继承");
					this.bulk_variable_import_results.push({ file: fileLabel, status: "skipped", reason });
					frappe.show_alert({ message: __("已跳过 {0}：{1}。", [fileLabel, reason]), indicator: "orange" });
					return null;
				}
				if (importKinds.length !== 1) {
					this.bulk_variable_import_results.push({ file: fileLabel, status: "skipped", reason: "ambiguous" });
					frappe.show_alert({ message: __("已跳过 {0}：一个文件只能对应一个月度来源。", [fileLabel]), indicator: "orange" });
					return null;
				}
				const sourceCode = importKinds[0] === "housing_allowance_base" ? "housing_allowance" : importKinds[0];
				const source = (this.variable_source_catalog || []).find((item) => (item.source_code || item.name) === sourceCode && item.target_area === "月度增减项");
				if (!source) {
					this.bulk_variable_import_results.push({ file: fileLabel, status: "skipped", reason: "unconfigured" });
					frappe.show_alert({ message: __("已跳过 {0}：未找到对应的启用来源配置。", [fileLabel]), indicator: "orange" });
					return null;
				}
				return frappe.call({
					method: "hrms.api.payroll_input.import_payroll_variable_workbook",
					args: this.scope_args({ file_url: fileUrl, source_type: sourceCode }),
					freeze: true,
					freeze_message: __("正在导入 {0}...", [fileLabel]),
				});
			})
			.then((response) => {
				if (!response) return;
				const result = response.message || {};
				this.bulk_variable_import_results.push({ file: fileLabel, status: "imported", batch: result.batch });
				frappe.show_alert({
					message: __("已导入 {0}，请在对应来源卡预览、纠错并确认。", [fileLabel]),
					indicator: "orange",
				});
				this.load_import_batches();
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
		this.route_to_tab("variables");
	}

	handle_payroll_import_choice(choice) {
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
		if (!this.variable_source_catalog.length) {
			frappe.call({
				method: "hrms.api.payroll_input.list_payroll_variable_source_types",
				callback: (response) => {
					this.variable_source_catalog = response.message || [];
					this.open_source_form_import_selector();
				},
			});
			return;
		}
		const sourceOptions = this.variable_source_catalog.filter((item) => item.enabled && item.target_area === "月度增减项");
		const labels = sourceOptions.map((item) => item.source_name || item.source_code || item.name);
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
				const source = sourceOptions.find((item) => (item.source_name || item.source_code || item.name) === values.source_label);
				dialog.hide();
				if (!source) return;
				this.selected_payroll_source = { ...source, label: source.source_name, source_code: source.source_code || source.name };
				this.file_url = "";
				this.route_to_tab("variables");
				frappe.show_alert({ message: __("请上传 {0} 原表；系统会先识别字段并预览，再写入薪资变量。", [source.source_name || source.source_code]), indicator: "blue" });
				this.open_uploader();
			},
		});
		dialog.show();
	}

	route_to_tab(tab) {
		if (this.resolve_tab(tab) !== this.active_tab && !this.confirm_salary_changes_saved()) return false;
		this.active_tab = this.resolve_tab(tab);
		this.active_process_step = this.process_step_for(this.active_tab);
		frappe.set_route("payroll-input-center", this.active_tab);
		this.render();
		this.load_active_tab();
		return true;
	}

	load_monthly_workbench() {
		this.body().innerHTML = `
			<section class="hrms-payroll-dashboard" aria-label="${this.escape(__("本月薪资概览"))}">
				<div class="hrms-payroll-dashboard-head">
					<div>
						<span class="hrms-payroll-step-kicker">${this.escape(__("薪资总览"))}</span>
						<h3>${this.escape(__("{0}薪资概览", [this.format_payroll_month()]))}</h3>
						<p>${this.escape(__("用已生成的薪资结算数据查看环比、成本构成和部门占比。"))}</p>
					</div>
					<button class="btn btn-default btn-sm" type="button" data-refresh-payroll-dashboard>${this.escape(__("刷新数据"))}</button>
				</div>
				<div data-payroll-dashboard-content><div class="hrms-payroll-dashboard-loading">${this.escape(__("正在汇总本月薪资数据…"))}</div></div>
			</section>
			<div data-payroll-calculation-table></div>
		`;
		this.body().querySelector("[data-refresh-payroll-dashboard]")?.addEventListener("click", () => this.load_monthly_workbench());
		frappe.call({
			method: "hrms.api.payroll_input.get_payroll_home_dashboard",
			args: this.scope_args(),
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-payroll-dashboard-content]");
				if (target) target.innerHTML = this.render_payroll_home_dashboard(response.message || {});
			},
		});
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_settlement_records",
			args: this.scope_args({ page_length: 500 }),
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-payroll-calculation-table]");
				if (!target) return;
				this.render_monthly_calculation_table(target, response.message || []);
			},
		});
	}

	format_dashboard_money(value) {
		const amount = Number(value);
		return Number.isFinite(amount) ? `¥${this.format_money(amount)}` : "--";
	}

	format_dashboard_percent(value) {
		const percent = Number(value);
		return Number.isFinite(percent) ? `${percent.toFixed(1)}%` : "--";
	}

	render_dashboard_change(metric = {}) {
		if (!metric.comparison_available) return `<span class="is-neutral">${this.escape(__("暂无上月结算数据"))}</span>`;
		const change = Number(metric.change_percent || 0);
		const tone = change > 0.05 ? "is-up" : change < -0.05 ? "is-down" : "is-neutral";
		const arrow = change > 0.05 ? "↑" : change < -0.05 ? "↓" : "—";
		return `<span class="${tone}">${arrow} ${this.escape(__("较上月 {0}", [`${Math.abs(change).toFixed(1)}%`]))}</span>`;
	}

	render_payroll_home_dashboard(data = {}) {
		const summary = data.summary || {};
		const metrics = data.metrics || {};
		const hasData = Boolean(summary.headcount);
		if (!hasData) {
			return `<div class="hrms-payroll-dashboard-empty"><strong>${this.escape(__("暂未生成本月薪资结算"))}</strong><span>${this.escape(__("完成薪资试算后，这里会自动展示薪资环比、成本构成、部门占比与发放进度。"))}</span></div>`;
		}
		const metricCards = [
			{ label: "实发工资", icon: "¥", value: this.format_dashboard_money(summary.net_pay), change: metrics.net_pay, detail: `${this.format_number(summary.headcount)} 人` },
			{ label: "人均实发", icon: "人", value: this.format_dashboard_money(summary.average_net_pay), change: metrics.average_net_pay, detail: "按本月结算人数计算" },
			{ label: "公司实际成本", icon: "成", value: this.format_dashboard_money(summary.company_cost_total), change: metrics.company_cost_total, detail: "含公司社保、公积金" },
			{ label: "发放准备度", icon: "✓", value: this.format_dashboard_percent(summary.confirmation_rate), change: null, detail: `${this.format_number(summary.confirmed_count)} / ${this.format_number(summary.headcount)} 人已确认` },
		];
		const composition = data.composition || [];
		const departments = data.departments || [];
		const compositionMax = Math.max(...composition.map((item) => Number(item.amount) || 0), 1);
		const departmentGradient = departments.length
			? departments.map((item) => `${item.color || "#6b7280"} ${Number(item.start_percent || 0).toFixed(2)}% ${Number(item.end_percent || 0).toFixed(2)}%`).join(", ")
			: "#e5e7eb 0 100%";
		return `
			<div class="hrms-payroll-dashboard-metrics">
				${metricCards.map((card) => `<article class="hrms-payroll-dashboard-metric">
					<div class="hrms-payroll-dashboard-metric__top"><span class="hrms-payroll-dashboard-icon" aria-hidden="true">${this.escape(card.icon)}</span><span>${this.escape(__(card.label))}</span></div>
					<strong>${this.escape(card.value)}</strong>
					<div class="hrms-payroll-dashboard-metric__foot">${card.change ? this.render_dashboard_change(card.change) : `<span class="is-neutral">${this.escape(card.detail)}</span>`}</div>
				</article>`).join("")}
			</div>
			<div class="hrms-payroll-dashboard-charts">
				<article class="hrms-payroll-dashboard-panel">
					<div class="hrms-payroll-dashboard-panel__head"><div><h4>${this.escape(__("薪资成本构成"))}</h4><p>${this.escape(__("各项金额占本月公司实际成本的比例"))}</p></div><strong>${this.escape(this.format_dashboard_money(summary.company_cost_total))}</strong></div>
					<div class="hrms-payroll-composition-list">
						${composition.map((item) => `<div class="hrms-payroll-composition-item"><div><span>${this.escape(__(item.label || ""))}</span><b>${this.escape(this.format_dashboard_money(item.amount))}</b></div><div class="hrms-payroll-composition-track"><i style="width:${Math.max(3, Math.min(100, ((Number(item.amount) || 0) / compositionMax) * 100)).toFixed(1)}%; background:${this.escape(item.color || "#168a5b")}"></i></div><small>${this.escape(this.format_dashboard_percent(item.percent))}</small></div>`).join("")}
					</div>
				</article>
				<article class="hrms-payroll-dashboard-panel hrms-payroll-department-panel">
					<div class="hrms-payroll-dashboard-panel__head"><div><h4>${this.escape(__("部门成本占比"))}</h4><p>${this.escape(__("按部门公司实际成本统计，显示前五个部门"))}</p></div></div>
					<div class="hrms-payroll-department-chart">
						<div class="hrms-payroll-donut" style="background:conic-gradient(${this.escape(departmentGradient)})"><div><strong>${this.escape(this.format_dashboard_money(summary.company_cost_total))}</strong><span>${this.escape(__("本月成本"))}</span></div></div>
						<div class="hrms-payroll-department-legend">${departments.map((item) => `<div><i style="background:${this.escape(item.color || "#6b7280")}"></i><span>${this.escape(item.department || "")}</span><b>${this.escape(this.format_dashboard_percent(item.percent))}</b><small>${this.escape(this.format_number(item.headcount))}${this.escape(__(" 人"))}</small></div>`).join("")}</div>
					</div>
				</article>
			</div>
			<div class="hrms-payroll-dashboard-insight"><span aria-hidden="true">◆</span><div><strong>${this.escape(__("本月提示"))}</strong><p>${this.escape(data.insight || "")}</p></div></div>
		`;
	}

	calculation_column_storage_key() {
		return `hrms.payroll-input-center.calculation-columns.${this.company || "default"}`;
	}

	default_calculation_column_fields() {
		return [...this.fixed_calculation_column_fields(), ...this.settlement_columns(false).map((column) => column.field)];
	}

	fixed_calculation_column_fields() {
		return ["employee_name", "employee_code", "department"];
	}

	selected_calculation_column_fields(columns) {
		const available = new Set(columns.map((column) => column.field));
		const fixed = this.fixed_calculation_column_fields().filter((field) => available.has(field));
		try {
			const saved = JSON.parse(window.localStorage?.getItem(this.calculation_column_storage_key()) || "null");
			if (Array.isArray(saved)) return [...new Set([...fixed, ...saved.filter((field) => available.has(field))])];
		} catch (_ignore) {
			// The table remains usable when browser storage is unavailable.
		}
		return [...new Set([...fixed, ...this.default_calculation_column_fields().filter((field) => available.has(field))])];
	}

	remember_calculation_column_fields(fields) {
		try {
			window.localStorage?.setItem(this.calculation_column_storage_key(), JSON.stringify(fields));
		} catch (_ignore) {
			// Keep the selection for the current render even if storage is disabled.
		}
	}

	render_monthly_calculation_table(target, rows) {
		const allColumns = this.settlement_columns(true);
		const selectedFields = this.selected_calculation_column_fields(allColumns);
		const selectedFieldSet = new Set(selectedFields);
		const columns = allColumns.filter((column) => selectedFieldSet.has(column.field));
		target.innerHTML = `
			<div class="hrms-payroll-input-list-head hrms-payroll-calculation-toolbar">
				<div class="text-muted">${frappe.utils.escape_html(__("已显示 {0} / {1} 个项目；选择会自动保存，并在下月及刷新后继续使用。", [columns.length, allColumns.length]))}</div>
				<div class="hrms-payroll-action-group">
					<button class="btn btn-default btn-sm" data-select-calculation-columns>${frappe.utils.escape_html(__("选择项目"))}</button>
					<button class="btn btn-default btn-sm" data-select-all-calculation-columns>${frappe.utils.escape_html(__("全选"))}</button>
					<button class="btn btn-default btn-sm" data-clear-calculation-columns>${frappe.utils.escape_html(__("清除"))}</button>
					<button class="btn btn-primary btn-sm" data-export-calculation-excel ${columns.length ? "" : "disabled"}>${frappe.utils.escape_html(__("导出 Excel"))}</button>
				</div>
			</div>
			<div data-calculation-table-content>${columns.length
				? this.render_table("薪资计算表", columns.map((column) => column.label), rows, (row) => columns.map((column) => this.format_settlement_cell(row, column)), { fill_viewport: true })
				: `<div class="text-muted hrms-payroll-empty-selection">${frappe.utils.escape_html(__("尚未选择显示项目。请点击“选择项目”或“全选”。"))}</div>`}</div>
		`;
		this.schedule_calculation_table_fit();
		target.querySelector("[data-select-calculation-columns]")?.addEventListener("click", () => this.open_calculation_column_selector(target, rows, allColumns));
		target.querySelector("[data-select-all-calculation-columns]")?.addEventListener("click", () => {
			this.remember_calculation_column_fields(allColumns.map((column) => column.field));
			this.render_monthly_calculation_table(target, rows);
		});
		target.querySelector("[data-clear-calculation-columns]")?.addEventListener("click", () => {
			this.remember_calculation_column_fields(this.fixed_calculation_column_fields());
			this.render_monthly_calculation_table(target, rows);
		});
		target.querySelector("[data-export-calculation-excel]")?.addEventListener("click", () => this.export_calculation_excel(rows, columns));
	}

	open_calculation_column_selector(target, rows, columns) {
		const selected = new Set(this.selected_calculation_column_fields(columns));
		const fixed = new Set(this.fixed_calculation_column_fields());
		const dialog = new frappe.ui.Dialog({
			title: __("选择薪资计算显示项目"),
			fields: [{ fieldname: "columns", fieldtype: "HTML" }],
			primary_action_label: __("保存显示项目"),
			primary_action: () => {
				const fields = [...fixed, ...Array.from(dialog.$wrapper.find("[data-calculation-column]:checked")).map((input) => input.dataset.calculationColumn)];
				this.remember_calculation_column_fields(fields);
				dialog.hide();
				this.render_monthly_calculation_table(target, rows);
			},
		});
		dialog.show();
		dialog.fields_dict.columns.$wrapper.html(`
			<div class="hrms-payroll-column-selector-actions">
				<button class="btn btn-default btn-sm" type="button" data-selector-select-all>${frappe.utils.escape_html(__("全选"))}</button>
				<button class="btn btn-default btn-sm" type="button" data-selector-clear>${frappe.utils.escape_html(__("清除"))}</button>
			</div>
			<div class="hrms-payroll-column-selector">${columns.map((column) => `<label><input type="checkbox" data-calculation-column="${frappe.utils.escape_html(column.field)}" ${selected.has(column.field) ? "checked" : ""} ${fixed.has(column.field) ? "disabled" : ""}> ${frappe.utils.escape_html(__(column.label))}${fixed.has(column.field) ? ` <small>${frappe.utils.escape_html(__("固定"))}</small>` : ""}</label>`).join("")}</div>
		`);
		dialog.$wrapper.find("[data-selector-select-all]").on("click", () => dialog.$wrapper.find("[data-calculation-column]:not(:disabled)").prop("checked", true));
		dialog.$wrapper.find("[data-selector-clear]").on("click", () => dialog.$wrapper.find("[data-calculation-column]:not(:disabled)").prop("checked", false));
	}

	export_calculation_excel(rows, columns) {
		if (!columns.length) return;
		const cell = (value) => {
			const text = String(value ?? "");
			const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
			return `<td>${frappe.utils.escape_html(safe)}</td>`;
		};
		const workbook = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table><thead><tr>${columns.map((column) => `<th>${frappe.utils.escape_html(__(column.label))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => cell(this.format_settlement_cell(row, column))).join("")}</tr>`).join("")}</tbody></table></body></html>`;
		const blob = new Blob(["\ufeff", workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
		const link = document.createElement("a");
		link.href = URL.createObjectURL(blob);
		link.download = `${__("薪资计算表")}_${this.payroll_month || ""}.xls`;
		link.style.display = "none";
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(link.href), 0);
	}

	download_generated_file(fileUrl, fileName = "") {
		if (!fileUrl) return;
		// Generated files arrive after an async request. Use a download link rather
		// than window.open(), which Safari treats as a blocked popup in that case.
		const link = document.createElement("a");
		link.href = fileUrl;
		link.download = fileName;
		link.style.display = "none";
		document.body.appendChild(link);
		link.click();
		link.remove();
	}

	render_project_map_items() {
		const projects = [
			["固定薪资", "底薪、职能/职务、证书、多能工、全薪", "员工薪资调整表 + 薪资架构", "salary-assignments"],
			["奖金补贴", "苹果树、全勤、学历、提案改善、生产奖", "已确认入账的月度增减项与考勤终稿继承", "variables"],
			["扣款与公司成本", "宿舍水电、社保/公积金、个税、已发福利、继续服务奖", "已确认入账的月度增减项", "variables"],
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
		if (action === "import") return this.route_to_tab("variables");
		if (action === "rules") return this.route_to_tab("salary-rules");
		if (action === "generate-input") return this.generate_payroll_input_records(() => this.refresh_monthly_workbench());
		if (action === "generate-settlement") return this.generate_payroll_settlement_records(() => this.refresh_monthly_workbench());
	}

	refresh_monthly_workbench() {
		if (!this.attendance_lock_version) {
			this.month_runbook = null;
			this.update_process_guide_status({
				master: { state: "pending", label: __("查看人数"), detail: __("人员范围只显示统计，无需每月确认。") },
				salary: { state: "pending", label: __("按需维护"), detail: __("只需处理本月变动或缺失的定薪。") },
				sources: { state: "pending", label: __("查看数据"), detail: __("奖金、补贴与扣款可按需导入。") },
				calculation: { state: "blocked", label: __("不可试算"), detail: __("请先在考勤假期完成并锁定本月考勤终稿") },
				delivery: { state: "pending", label: __("尚未确认"), detail: __("试算并确认后才能发放。") },
			});
			const cardsTarget = this.wrapper.querySelector("[data-workbench-cards]");
			const runbookTarget = this.wrapper.querySelector("[data-workbench-runbook]");
			if (cardsTarget) cardsTarget.innerHTML = "";
			if (runbookTarget) runbookTarget.innerHTML = `<div class="hrms-payroll-input-panel hrms-payroll-blocker">
				<span>${frappe.utils.escape_html(__("请先在考勤假期完成并锁定本月考勤终稿"))}</span>
			</div>`;
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
				(stage) => `
					<div class="hrms-payroll-runbook-step is-${frappe.utils.escape_html(stage.tone || "pending")}">
						<div class="hrms-payroll-runbook-status" aria-hidden="true"></div>
						<div class="hrms-payroll-runbook-copy"><strong>${frappe.utils.escape_html(__(stage.title))}</strong><span>${frappe.utils.escape_html(__(stage.summary))}</span></div>
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
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("本月处理决定"))}</span><h3>${frappe.utils.escape_html(__("人员范围"))}</h3><p>${frappe.utils.escape_html(__("薪资计算仅取本月已锁定考勤终稿中的人员。可在下表为离职或异常人员选择离职结算、不参与或待审核；审核决定会随本月锁定版本留痕。"))}</p></div>
				<div class="hrms-payroll-action-group"><button class="btn btn-default btn-sm" data-reload-payroll-population>${frappe.utils.escape_html(__("重新加载人员范围"))}</button><button class="btn btn-default btn-sm" data-open-personnel-master>${frappe.utils.escape_html(__("打开员工花名册"))}</button></div>
			</div>
			<div data-employee-salary-cards></div>
			<div class="hrms-payroll-personnel-summary" data-employee-summary></div>
			<div class="hrms-payroll-participation-preview" data-payroll-participation-preview><div class="hrms-payroll-source-empty-detail text-muted">${frappe.utils.escape_html(__("正在读取本月锁定考勤终稿…"))}</div></div>
		`;
		this.body().querySelector("[data-open-personnel-master]").addEventListener("click", () => frappe.set_route("List", "Employee"));
		this.body().querySelector("[data-reload-payroll-population]").addEventListener("click", () => this.reload_payroll_participation_population());
		this.load_payroll_participation_preview(this.body().querySelector("[data-payroll-participation-preview]"));
		frappe.call({
			method: "hrms.api.payroll_input.list_employee_salary_profiles",
			args: this.scope_args({ page_length: 5000 }),
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
				const summaryTarget = this.wrapper.querySelector("[data-employee-summary]");
				if (summaryTarget) {
					summaryTarget.classList.toggle("has-warning", Boolean(missingRows.length));
					summaryTarget.innerHTML = missingRows.length
						? `<strong>${frappe.utils.escape_html(__("有 {0} 人的花名册资料待补全。", [missingRows.length]))}</strong><span>${frappe.utils.escape_html(__("花名册资料仍在员工花名册维护；本月是否参与计算请在下方锁定考勤名单中决定。"))}</span>`
						: `<strong>${frappe.utils.escape_html(__("花名册资料正常"))}</strong><span>${frappe.utils.escape_html(__("本月是否参与、离职结算及异常审核请在下方锁定考勤名单中决定。"))}</span>`;
				}
			},
		});
	}

	reload_payroll_participation_population() {
		frappe.confirm(
			__("将重新读取当前已锁定的考勤终稿，更新薪酬侧人员名单，并删除该锁定版本尚未确认的薪资输入和试算结果。已确认工资不会被删除。是否继续？"),
			() => {
				frappe.call({
					method: "hrms.api.payroll_input.reload_payroll_participation_population",
					args: { company: this.company, payroll_month: this.payroll_month },
					freeze: true,
					freeze_message: __("正在重新加载人员范围…"),
					callback: (response) => {
						const result = response.message || {};
						const key = this.attendance_dependency_key();
						this.attendance_dependency_cache.delete(key);
						this.payroll_participation_preview = null;
						this.apply_attendance_dependency(result, this.company, this.payroll_month);
						frappe.show_alert({ message: __("人员范围已重新加载；已清除未确认薪资输入 {0} 条、试算结果 {1} 条。", [result.invalidation?.deleted_inputs || 0, result.invalidation?.deleted_settlements || 0]), indicator: "green" });
						this.load_employee_salary_profiles();
					},
				});
			},
		);
	}

	render_payroll_participation_preview(preview) {
		if (!preview?.available) return `<div class="hrms-payroll-source-empty-detail text-muted">${frappe.utils.escape_html(preview?.reason || __("当前没有可预览的参与人员。"))}</div>`;
		const columns = preview.columns || [];
		const rows = preview.rows || [];
		const counts = preview.counts || {};
		const detail = (row, field) => {
			const value = row[field] ?? "";
			if (field === "decision" && (row.decision_reason || row.settlement_basis)) return `${frappe.utils.escape_html(value)}<small class="d-block text-muted">${frappe.utils.escape_html([row.decision_reason, row.settlement_basis ? __("结算依据：{0}", [row.settlement_basis]) : ""].filter(Boolean).join("；"))}</small>`;
			if (field === "review_status" && row.approval_note) return `${frappe.utils.escape_html(value)}<small class="d-block text-muted">${frappe.utils.escape_html(row.approval_note)}</small>`;
			if (field === "calculation_status") return `<strong>${frappe.utils.escape_html(value)}</strong>`;
			return frappe.utils.escape_html(value);
		};
		return `<div class="hrms-payroll-preview-summary"><strong>${frappe.utils.escape_html(__("本月人员范围与处理决定"))}</strong><span class="is-valid">${frappe.utils.escape_html(__("锁定名单 {0} 人", [rows.length]))}</span><span>${frappe.utils.escape_html(__("正常 {0}", [counts.normal || 0]))}</span><span>${frappe.utils.escape_html(__("离职结算 {0}", [counts.termination || 0]))}</span><span>${frappe.utils.escape_html(__("不参与 {0}", [counts.excluded || 0]))}</span><span class="is-warning">${frappe.utils.escape_html(__("待决定 {0}", [counts.pending || 0]))}</span><span>${frappe.utils.escape_html(__("锁定版本：{0}", [preview.attendance_lock_version || "-"]))}</span>${preview.locked_on ? `<span>${frappe.utils.escape_html(__("锁定时间：{0}", [preview.locked_on]))}</span>` : ""}</div><p class="hrms-payroll-participation-note">${frappe.utils.escape_html(__("离职人员必须选择“离职结算”或“不参与计算”；异常待审核不会绕过校验。审核通过后，本表会显示处理结论并决定是否进入试算。"))}</p><div class="hrms-payroll-table-wrap"><table class="table table-bordered hrms-payroll-input-table"><thead><tr>${columns.map((column) => `<th>${frappe.utils.escape_html(__(column.label || column.field))}</th>`).join("")}<th>${frappe.utils.escape_html(__("操作"))}</th></tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${detail(row, column.field)}</td>`).join("")}<td><button class="btn btn-default btn-xs" data-payroll-participation-decision="${frappe.utils.escape_html(row.employee)}">${frappe.utils.escape_html(row.decision === "异常待审核" || row.decision === "待处理" ? __("处理 / 审核") : __("调整处理"))}</button></td></tr>`).join("")}</tbody></table></div>`;
	}

	bind_payroll_participation_actions(target) {
		target?.querySelectorAll("[data-payroll-participation-decision]").forEach((button) => {
			button.addEventListener("click", () => {
				const row = (this.payroll_participation_preview?.rows || []).find((item) => item.employee === button.dataset.payrollParticipationDecision);
				if (row) this.open_payroll_participation_decision_dialog(row);
			});
		});
	}

	open_payroll_participation_decision_dialog(row) {
		const escape = (value) => frappe.utils.escape_html(String(value ?? ""));
		const defaultDecision = ["正常计薪", "离职结算", "不参与计算", "异常待审核"].includes(row.decision) ? row.decision : "离职结算";
		const dialog = new frappe.ui.Dialog({
			title: __("本月人员处理：{0}", [row.employee_name || row.employee_code]),
			fields: [
				{ fieldtype: "HTML", fieldname: "employee", options: `<div class="alert alert-info"><strong>${escape(row.employee_name || "-")}</strong> / ${escape(row.employee_code || "-")}<br>${escape(__("花名册状态：{0}；当前定薪：{1}", [row.employee_status || "-", row.salary_status || "-"]))}</div>` },
				{ fieldtype: "Select", fieldname: "decision", label: __("本月处理方式"), options: `${__("正常计薪")}\n${__("离职结算")}\n${__("不参与计算")}\n${__("异常待审核")}`, default: defaultDecision, reqd: 1 },
				{ fieldtype: "Small Text", fieldname: "decision_reason", label: __("处理或异常说明"), default: row.decision_reason || "", description: __("离职结算、不参与计算和异常待审核必须填写。") },
				{ fieldtype: "Small Text", fieldname: "settlement_basis", label: __("离职结算依据"), default: row.settlement_basis || "", description: __("离职结算必须填写，例如离职审批单、结算单或已批准标准。") },
				{ fieldtype: "Check", fieldname: "approved", label: __("我已审核通过并确认本月处理结论"), default: row.review_status === "审核通过" ? 1 : 0 },
				{ fieldtype: "Small Text", fieldname: "approval_note", label: __("审核意见"), default: row.approval_note || "" },
			],
			primary_action_label: __("保存本月处理决定"),
			primary_action: (values) => {
				frappe.call({
					method: "hrms.api.payroll_input.save_monthly_payroll_participation_decision",
					args: { company: this.company, payroll_month: this.payroll_month, attendance_lock_version: this.attendance_lock_version, employee: row.employee, ...values },
					freeze: true,
					freeze_message: __("正在保存本月处理决定…"),
					callback: () => {
						dialog.hide();
						this.payroll_participation_preview = null;
						this.process_readiness = {};
						frappe.show_alert({ message: __("本月人员处理决定已保存"), indicator: "green" });
						this.load_employee_salary_profiles();
					},
					});
			},
		});
		dialog.show();
	}

	load_payroll_participation_preview(target) {
		if (!target) return;
		const scope = `${this.attendance_dependency_key()}::${this.attendance_lock_version || ""}`;
		if (this.payroll_participation_preview?._scope === scope) {
			target.innerHTML = this.render_payroll_participation_preview(this.payroll_participation_preview);
			this.bind_payroll_participation_actions(target);
			return;
		}
		target.innerHTML = `<div class="hrms-payroll-source-empty-detail text-muted">${frappe.utils.escape_html(__("正在读取本月锁定考勤终稿…"))}</div>`;
		this.payroll_participation_preview_loading_scope = scope;
		frappe.call({
			method: "hrms.api.payroll_input.get_payroll_participation_preview",
			args: this.scope_args(),
			callback: (response) => {
				if (this.payroll_participation_preview_loading_scope !== scope) return;
				this.payroll_participation_preview_loading_scope = "";
				this.payroll_participation_preview = { ...(response.message || { available: false, reason: __("未取得参与人员预览。") }), _scope: scope };
				if (target.isConnected) {
					target.innerHTML = this.render_payroll_participation_preview(this.payroll_participation_preview);
					this.bind_payroll_participation_actions(target);
				}
			},
			error: () => {
				if (this.payroll_participation_preview_loading_scope !== scope) return;
				this.payroll_participation_preview_loading_scope = "";
				this.payroll_participation_preview = { available: false, reason: __("读取参与人员预览失败，请刷新后重试。"), _scope: scope };
				if (target.isConnected) target.innerHTML = this.render_payroll_participation_preview(this.payroll_participation_preview);
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
					<button class="btn btn-primary btn-sm" data-generate-monthly data-requires-attendance-lock data-attendance-ready-title="${frappe.utils.escape_html(__("生成薪资结算表"))}" ${hasLockedAttendance ? "" : "disabled"} title="${frappe.utils.escape_html(hasLockedAttendance ? __("生成薪资结算表") : __("请先在考勤假期完成并锁定本月考勤终稿"))}">${frappe.utils.escape_html(__("生成薪资结算表"))}</button>
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
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("本月资料"))}</span><h3>${frappe.utils.escape_html(__("考勤与月度来源"))}</h3><p>${frappe.utils.escape_html(__("只处理当月考勤终稿和已确认的奖金、补贴、扣款等变量。"))}</p></div>
				<div>
					<button class="btn btn-default btn-sm" data-download-data-template>${frappe.utils.escape_html(__("下载模板"))}</button>
					<button class="btn btn-default btn-sm" data-upload-data-closure>${frappe.utils.escape_html(__("上传闭环数据"))}</button>
					${preview ? `<button class="btn btn-primary btn-sm" data-import-data-closure>${frappe.utils.escape_html(__("导入闭环数据"))}</button>` : ""}
				</div>
			</div>
			<div class="hrms-payroll-step-purpose">
				<div><strong>${frappe.utils.escape_html(__("必须满足"))}</strong><span>${frappe.utils.escape_html(__("考勤必须同公司、同月份且已锁定；变量与福利扣款必须已确认或已批准零申报。"))}</span></div>
				<div><strong>${frappe.utils.escape_html(__("边界"))}</strong><span>${frappe.utils.escape_html(__("不修改员工主档、定薪或计算公式；完整薪资结算表仅供预览核对，不会直接覆盖系统结算。"))}</span></div>
			</div>
			<div data-data-closure-preview>${preview ? this.render_data_closure_preview(preview) : ""}</div>
			<details class="hrms-payroll-advanced"><summary>${frappe.utils.escape_html(__("需要排查导入时展开：Excel 字段与系统字段"))}</summary><div data-import-template-table></div><div data-settlement-field-table></div></details>
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
				this.download_generated_file(file_url, response.message?.file_name);
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
				frappe.show_alert({ message: __("闭环数据导入完成"), indicator: "green" });
				this.load_data_closure_import_plan();
			},
		});
	}

	load_salary_rules() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head hrms-payroll-step-head">
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("设置 · 按需维护"))}</span><h3>${frappe.utils.escape_html(__("薪资核算规则"))}</h3><p>${frappe.utils.escape_html(__("在口径调整时维护固定薪资、当月变量、应发应扣和公司成本的计算规则。"))}</p></div>
				<div class="hrms-payroll-action-group">
					<button class="btn btn-default btn-sm" data-open-payroll-components>${frappe.utils.escape_html(__("打开标准工资项"))}</button>
					<button class="btn btn-default btn-sm" data-download-formulas>${frappe.utils.escape_html(__("下载公式模板"))}</button>
					<button class="btn btn-default btn-sm" data-import-formulas>${frappe.utils.escape_html(__("导入公式"))}</button>
					<button class="btn btn-primary btn-sm" data-new-formula>${frappe.utils.escape_html(__("新增/修改公式"))}</button>
				</div>
			</div>
			<div class="hrms-payroll-step-purpose"><div><strong>${frappe.utils.escape_html(__("你需要确认什么"))}</strong><span>${frappe.utils.escape_html(__("员工定薪是否进入固定薪资，奖金/补贴/扣款如何汇总，应发、实发与公司成本如何组成。"))}</span></div><div><strong>${frappe.utils.escape_html(__("日常是否需要逐项查看"))}</strong><span>${frappe.utils.escape_html(__("不需要。系统会在试算时自动校验公式和工资方案；只有调整口径时才展开下方专业设置。"))}</span></div></div>
			<div class="hrms-payroll-rule-summary"><div><strong>${frappe.utils.escape_html(__("固定薪资"))}</strong><span>${frappe.utils.escape_html(__("底薪、职能津贴、证书及多能工津贴"))}</span></div><div><strong>${frappe.utils.escape_html(__("月度变量"))}</strong><span>${frappe.utils.escape_html(__("奖金、补贴、社保公积金、税费与其他扣款"))}</span></div><div><strong>${frappe.utils.escape_html(__("结算结果"))}</strong><span>${frappe.utils.escape_html(__("应发、应扣、实发与公司实际负担"))}</span></div></div>
			<details class="hrms-payroll-advanced" id="payroll-rule-editor" open><summary>${frappe.utils.escape_html(__("核算流程：先确认基础值，再设置计算结果"))}</summary><section class="hrms-payroll-config-section hrms-payroll-calculation-template" id="payroll-input-template">
				<div class="hrms-payroll-project-map-head">
					<div><h3>${frappe.utils.escape_html(__("必需输入（只读）· 工资计算模板"))}</h3><p>${frappe.utils.escape_html(__("先确认三类输入，再点击下方计算结果维护公式；输入数据在对应步骤维护。"))}</p></div>
					<span class="hrms-payroll-template-status">${frappe.utils.escape_html(__("公司级模板"))}</span>
				</div>
				<div class="hrms-payroll-source-groups" data-payroll-input-groups></div>
			</section><section class="hrms-payroll-config-section" id="payroll-formulas">
				<div class="hrms-payroll-project-map-head">
					<div><h3>${frappe.utils.escape_html(__("设置计算结果"))}</h3><p>${frappe.utils.escape_html(__("按核算阶段设置；每次进入一个结果项，选择字段、运算符后校验保存。"))}</p></div>
					<div class="hrms-payroll-action-group"><input class="form-control input-sm" data-formula-search placeholder="${frappe.utils.escape_html(__("搜索计算结果"))}"><button class="btn btn-default btn-sm" data-reset-formulas>${frappe.utils.escape_html(__("初始化公司公式"))}</button></div>
				</div>
				<div data-payroll-formula-table></div>
			</section></details>
		`;
		this.body().querySelector("[data-open-payroll-components]").addEventListener("click", () => frappe.set_route("List", "Salary Component"));
		this.body().querySelector("[data-new-formula]").addEventListener("click", () => this.edit_payroll_formula());
		this.body().querySelector("[data-download-formulas]").addEventListener("click", () => this.download_payroll_formula_template());
		this.body().querySelector("[data-import-formulas]").addEventListener("click", () => this.open_payroll_formula_import());
		this.body().querySelector("[data-reset-formulas]").addEventListener("click", () => this.ensure_default_payroll_formulas());
		this.body().querySelector("[data-formula-search]").addEventListener("input", (event) => this.filter_payroll_formulas(event.target.value));
		this.load_rule_permission();
		this.load_payroll_formula_catalog();
	}

	format_attendance_rule_parameters(rule = {}) {
		const parameters = rule.parameters || {};
		if (rule.rule_code === "ATTENDANCE_FULL_ATTENDANCE_BONUS") {
			return `${__("迟到每次扣 {0} 元", [parameters.late_deduction || 0])}；${(parameters.thresholds || []).map((item) => __("缺勤不超过 {0} 小时：{1} 元", [item[0], item[1]])).join("；")}`;
		}
		if (rule.rule_code === "PAYROLL_SETTLEMENT_ABSENCE_DEDUCTION") return __("标准计薪工时：{0} 小时 · 旷工按 {1} 倍扣款", [parameters.standard_hours_divisor || "-", parameters.absenteeism_multiplier || "-"]);
		if (rule.rule_code === "ATTENDANCE_MISSED_PUNCH") return __("每次 {0} 颗红苹果 · 每颗 {1} 元", [parameters.red_apples_per_record ?? "-", parameters.amount_per_apple ?? "-"]);
		if (rule.rule_code === "PAYROLL_SETTLEMENT_OVERTIME_PAY") return __("平日 {0} 倍 · 周末 {1} 倍 · 节假日 {2} 倍 · 基准 {3} 小时", [parameters.weekday || "-", parameters.weekend || "-", parameters.holiday || "-", parameters.standard_hours_divisor || "-"]);
		if (rule.rule_code === "PAYROLL_SETTLEMENT_NIGHT_SHIFT") return __("深夜班 {0} 元/次（{1}–{2}）· 大夜班 {3} 元/次（{4}）· 小夜班 {5} 元/次（{6}）", [parameters.deep_night_shift || "-", parameters.deep_night_shift_start || "20:00", parameters.deep_night_shift_end || "08:00", parameters.large_night_shift || "-", parameters.large_night_shift_start && parameters.large_night_shift_end ? `${parameters.large_night_shift_start}–${parameters.large_night_shift_end}` : "沿用终稿次数", parameters.small_night_shift || "-", parameters.small_night_shift_start && parameters.small_night_shift_end ? `${parameters.small_night_shift_start}–${parameters.small_night_shift_end}` : "沿用终稿次数"]);
		return __("已设置");
	}

	render_attendance_rule_editor(rule = {}) {
		const parameters = rule.parameters || {};
		const input = (label, field, value, suffix = "", type = "number", help = "") => `<label class="hrms-payroll-rule-field"><span>${frappe.utils.escape_html(__(label))}</span><div><input class="form-control" type="${type}" data-attendance-setting="${field}" value="${frappe.utils.escape_html(String(value ?? ""))}" ${type === "number" ? 'step="0.01" min="0"' : ""}><em>${frappe.utils.escape_html(__(suffix))}</em></div>${help ? `<small>${frappe.utils.escape_html(__(help))}</small>` : ""}</label>`;
		let fields = "";
		if (rule.rule_code === "ATTENDANCE_FULL_ATTENDANCE_BONUS") {
			const thresholds = parameters.thresholds || [];
			fields = `<div class="hrms-payroll-threshold-list">${thresholds.map((item, index) => `<div><span>${frappe.utils.escape_html(__("缺勤不超过"))}</span><input class="form-control" type="number" step="0.01" min="0" data-full-threshold-limit="${index}" value="${frappe.utils.escape_html(String(item[0] ?? ""))}"><span>${frappe.utils.escape_html(__("小时，发"))}</span><input class="form-control" type="number" step="0.01" min="0" data-full-threshold-amount="${index}" value="${frappe.utils.escape_html(String(item[1] ?? ""))}"><span>${frappe.utils.escape_html(__("元全勤奖"))}</span></div>`).join("")}</div>${input("迟到一次扣减", "late_deduction", parameters.late_deduction || 0, "元")}`;
		} else if (rule.rule_code === "PAYROLL_SETTLEMENT_ABSENCE_DEDUCTION") {
			fields = `<div class="hrms-payroll-rule-fields">${input("标准计薪工时", "standard_hours_divisor", parameters.standard_hours_divisor, "小时", "number", "缺勤扣款以薪资小计除以此工时计算。")}${input("旷工扣款倍率", "absenteeism_multiplier", parameters.absenteeism_multiplier ?? 3, "倍", "number", "工作日旷工和无请假凭据的早退时长均按此倍率扣款。")}</div>`;
		} else if (rule.rule_code === "ATTENDANCE_MISSED_PUNCH") {
			fields = `<div class="hrms-payroll-rule-fields">${input("每次忘打卡红苹果", "red_apples_per_record", parameters.red_apples_per_record ?? 2, "颗", "number", "仅对纳入的“忘打卡”来源记录生效，不读取原始考勤的缺卡标记。")}${input("红苹果每颗金额", "amount_per_apple", parameters.amount_per_apple ?? 5, "元/颗", "number", "金额会按“颗数 × 单价”写入忘打卡来源。")}</div>`;
		} else if (rule.rule_code === "PAYROLL_SETTLEMENT_OVERTIME_PAY") {
			fields = `<div class="hrms-payroll-rule-fields">${input("标准计薪工时", "standard_hours_divisor", parameters.standard_hours_divisor, "小时")}${input("平日加班", "weekday", parameters.weekday, "倍")}${input("周末加班", "weekend", parameters.weekend, "倍")}${input("法定节假日加班", "holiday", parameters.holiday, "倍")}</div>`;
		} else if (rule.rule_code === "PAYROLL_SETTLEMENT_NIGHT_SHIFT") {
			fields = `<div class="hrms-payroll-rule-fields">${input("深夜班每次津贴", "deep_night_shift", parameters.deep_night_shift || 55, "元/次")}${input("深夜班上班时间", "deep_night_shift_start", parameters.deep_night_shift_start || "20:00", "", "time")}${input("深夜班下班时间（次日）", "deep_night_shift_end", parameters.deep_night_shift_end || "08:00", "", "time")}${input("大夜班每次津贴", "large_night_shift", parameters.large_night_shift || 45, "元/次")}${input("大夜班上班时间（可选）", "large_night_shift_start", parameters.large_night_shift_start || "", "", "time", "填写上下班时间后启用大夜班时段匹配；留空则沿用终稿次数。")}${input("大夜班下班时间（可选）", "large_night_shift_end", parameters.large_night_shift_end || "", "", "time")}${input("小夜班每次津贴", "small_night_shift", parameters.small_night_shift || 24, "元/次")}${input("小夜班上班时间（可选）", "small_night_shift_start", parameters.small_night_shift_start || "", "", "time", "填写上下班时间后启用小夜班时段匹配；留空则沿用终稿次数。")}${input("小夜班下班时间（可选）", "small_night_shift_end", parameters.small_night_shift_end || "", "", "time")}</div><p class="hrms-payroll-rule-guide">${frappe.utils.escape_html(__("深夜班是时间段规则：上班时间落在 20:00、下班时间落在次日 08:00 内，即定义为深夜班。大夜班、小夜班可按需要填写完整上下班时间来启用同样的时段匹配；只填写其中一个时间会提示补齐。已启用的时段不能重叠，同一条完整打卡记录只会命中一个档位；未启用时段匹配的档位继续使用考勤终稿次数。"))}</p>`;
		}
		return `<section class="hrms-payroll-inline-rule-editor" data-attendance-rule-editor data-rule-code="${frappe.utils.escape_html(rule.rule_code || "")}"><div class="hrms-payroll-project-map-head"><div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("正在设置"))}</span><h3>${frappe.utils.escape_html(__(rule.title || rule.rule_name || ""))}</h3><p>${frappe.utils.escape_html(__(rule.description || ""))}</p></div><button class="btn btn-default btn-sm" data-close-attendance-editor>${frappe.utils.escape_html(__("收起"))}</button></div><div class="hrms-payroll-inline-rule-body">${fields}</div><div class="hrms-payroll-action-group"><button class="btn btn-primary btn-sm" data-save-attendance-rule>${frappe.utils.escape_html(__("保存本项设置"))}</button><span>${frappe.utils.escape_html(__("保存后仅影响之后重新处理或重新试算的月份。"))}</span></div></section>`;
	}

	open_attendance_rule_editor(rule) {
		if (!this.can_edit_payroll_rules) {
			frappe.msgprint(__("当前账号只能查看考勤计薪规则"));
			return;
		}
		const target = this.wrapper.querySelector("[data-attendance-rule-editor-area]");
		if (!target) return;
		target.innerHTML = this.render_attendance_rule_editor(rule);
		target.scrollIntoView({ behavior: "smooth", block: "start" });
		target.querySelector("[data-close-attendance-editor]")?.addEventListener("click", () => { target.innerHTML = ""; });
		target.querySelector("[data-save-attendance-rule]")?.addEventListener("click", () => this.save_attendance_rule_editor(rule, target));
	}

	save_attendance_rule_editor(rule, target) {
		const settings = {};
		target.querySelectorAll("[data-attendance-setting]").forEach((field) => { settings[field.dataset.attendanceSetting] = field.value; });
		if (rule.rule_code === "ATTENDANCE_FULL_ATTENDANCE_BONUS") {
			settings.thresholds = Array.from(target.querySelectorAll("[data-full-threshold-limit]")).map((field) => [field.value, target.querySelector(`[data-full-threshold-amount="${field.dataset.fullThresholdLimit}"]`)?.value || 0]);
		}
		frappe.call({
			method: "hrms.api.payroll_input.save_attendance_pay_rule",
			args: { company: this.company, payroll_month: this.payroll_month, rule_code: rule.rule_code, settings },
			freeze: true,
			freeze_message: __("正在保存考勤计薪设置..."),
			callback: () => {
				frappe.show_alert({ message: __("{0}已保存", [rule.title || rule.rule_name]), indicator: "green" });
				this.payroll_workflow = null;
				this.load_attendance_pay_rules();
				this.process_readiness = {};
			},
		});
	}

	load_attendance_pay_rules() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head hrms-payroll-step-head">
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("设置 · 按需维护"))}</span><h3>${frappe.utils.escape_html(__("考勤计薪规则"))}</h3><p>${frappe.utils.escape_html(__("考勤终稿提供工时和次数，这些规则负责转换成缺勤扣款、加班费、夜班津贴和全勤奖。"))}</p></div>
				<button class="btn btn-default btn-sm" data-open-attendance-center>${frappe.utils.escape_html(__("前往考勤终稿"))}</button>
			</div>
			<div class="hrms-payroll-step-purpose"><div><strong>${frappe.utils.escape_html(__("考勤事实"))}</strong><span>${frappe.utils.escape_html(__("考勤中心导入并锁定标准工时、出勤、缺勤、加班、夜班等本月事实。"))}</span></div><div><strong>${frappe.utils.escape_html(__("计算口径"))}</strong><span>${frappe.utils.escape_html(__("只在制度变更时调整分母、倍率、每次津贴和全勤奖门槛；日常算薪无需重复确认。"))}</span></div></div>
			<div data-attendance-pay-rule-cards></div>
			<details class="hrms-payroll-advanced"><summary>${frappe.utils.escape_html(__("如何验证规则是真正生效的"))}</summary><div class="hrms-payroll-rule-verification"><p>${frappe.utils.escape_html(__("系统会从当前公司和月份读取参数，并将实际使用的规则快照写入薪资输入表的来源追溯数据。"))}</p><ol><li>${frappe.utils.escape_html(__("在测试月份修改规则参数。"))}</li><li>${frappe.utils.escape_html(__("重新试算该月工资。"))}</li><li>${frappe.utils.escape_html(__("在结算表对比缺勤扣款、加班费、夜班津贴或全勤奖变化。"))}</li></ol></div></details>
		`;
		this.body().querySelector("[data-open-attendance-center]").addEventListener("click", () => frappe.set_route("attendance-import-center"));
		this.load_rule_permission();
		frappe.call({
			method: "hrms.api.payroll_input.get_payroll_attendance_rule_overview",
			args: { company: this.company, payroll_month: this.payroll_month },
			callback: (response) => {
				const result = response.message || {};
				const target = this.wrapper.querySelector("[data-attendance-pay-rule-cards]");
				if (!target) return;
				if (!result.valid) {
					target.innerHTML = `<div class="hrms-payroll-salary-alert"><strong>${frappe.utils.escape_html(__("考勤计薪规则未通过"))}</strong>${(result.blockers || []).map((message) => `<span>${frappe.utils.escape_html(__(message))}</span>`).join("")}</div>`;
					return;
				}
				this.attendance_pay_rule_rows = result.rules || [];
				target.innerHTML = `<div class="hrms-payroll-attendance-rule-grid">${this.attendance_pay_rule_rows.map((rule) => `<article><div><span>${frappe.utils.escape_html(__(rule.effect || ""))}</span><h4>${frappe.utils.escape_html(__(rule.title || rule.rule_name || ""))}</h4><p>${frappe.utils.escape_html(__(rule.description || ""))}</p></div><strong>${frappe.utils.escape_html(this.format_attendance_rule_parameters(rule))}</strong><small>${frappe.utils.escape_html(__("当前设置来自：{0}", [rule.source || "-"]))}</small><button class="btn btn-default btn-sm" data-edit-attendance-rule="${frappe.utils.escape_html(rule.rule_code)}">${frappe.utils.escape_html(__("点击设置"))}</button></article>`).join("")}</div><div data-attendance-rule-editor-area></div>`;
				target.querySelectorAll("[data-edit-attendance-rule]").forEach((button) => {
					button.addEventListener("click", () => {
						const rule = this.attendance_pay_rule_rows.find((item) => item.rule_code === button.dataset.editAttendanceRule) || {};
						this.open_attendance_rule_editor(rule);
					});
				});
			},
		});
	}

	load_salary_template_step() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head hrms-payroll-step-head">
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("设置 · 按需维护"))}</span><h3>${frappe.utils.escape_html(__("组合工资表模板"))}</h3><p>${frappe.utils.escape_html(__("把应发、应扣和公司承担项组合成可复用模板。"))}</p></div>
				<button class="btn btn-primary btn-sm" data-open-salary-templates>${frappe.utils.escape_html(__("打开工资表模板"))}</button>
			</div>
			<div class="hrms-payroll-step-purpose">
				<div><strong>${frappe.utils.escape_html(__("这里保存什么"))}</strong><span>${frappe.utils.escape_html(__("模板只保存工资项组合、计算顺序与计薪周期，不保存某个员工的实际金额。"))}</span></div>
				<div><strong>${frappe.utils.escape_html(__("使用方式"))}</strong><span>${frappe.utils.escape_html(__("模板启用后可分配给员工，并维护生效日与已提交定薪。"))}</span></div>
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
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("当月定薪维护"))}</span><h3>${frappe.utils.escape_html(__("员工定薪"))}</h3><p>${frappe.utils.escape_html(__("维护本月固定薪资与缴纳选项；保存后立即生效并参与算薪。"))}</p></div>
				<div class="hrms-payroll-action-group"><button class="btn btn-default btn-sm" data-open-published-architecture>${frappe.utils.escape_html(__("查看已发布薪资架构"))}</button><button class="btn btn-default btn-sm" data-download-salary-change-template>${frappe.utils.escape_html(__("下载模板"))}</button><button class="btn btn-default btn-sm" data-import-salary-change>${frappe.utils.escape_html(__("导入 Excel"))}</button></div>
			</div>
			<div class="hrms-payroll-scope-note">${frappe.utils.escape_html(__("员工定薪只引用独立“薪资架构”中已发布且当前生效的版本，并允许按员工覆盖；架构版本、梯队、等级和标签不在本页维护。"))}</div>
			<div data-salary-change-import-preview></div>
			<div data-salary-change-import-batches></div>
			<div data-salary-changes></div>
		`;
		this.body().querySelector("[data-download-salary-change-template]").addEventListener("click", () => { if (this.confirm_salary_changes_saved()) this.download_employee_salary_change_template(); });
		this.body().querySelector("[data-import-salary-change]").addEventListener("click", () => { if (this.confirm_salary_changes_saved()) this.open_employee_salary_change_import(); });
		this.body().querySelector("[data-open-published-architecture]").addEventListener("click", () => { if (this.confirm_salary_changes_saved()) frappe.set_route("salary-architecture"); });
		frappe.call({
			method: "hrms.api.payroll_input.get_salary_architecture_workbench",
			args: { company: this.company, payroll_month: this.payroll_month },
			callback: (response) => {
				const result = response.message || {};
				this.update_process_guide_status(this.process_status_from_salary_architecture(result));
			},
		});
		this.load_assignable_salary_grades().then(() => this.load_employee_salary_changes());
		this.render_employee_salary_change_import_preview();
		this.load_employee_salary_change_import_batches();
	}

	load_assignable_salary_grades() {
		return frappe.call({
			method: "hrms.api.payroll_input.list_assignable_salary_grades",
			args: { payroll_month: this.payroll_month },
		}).then((response) => {
			this.assignableSalaryGrades = response.message || [];
		});
	}

	exclude_employee_from_payroll(employee, row = null) {
		if (row && !this.confirm_salary_changes_saved()) return;
		frappe.confirm(__("确认该员工本月不参与薪资计算？此操作不会删除原有定薪，恢复参与后会继续使用此前已提交的定薪。"), () => {
		frappe.call({ method: "hrms.api.payroll_input.set_employee_payroll_participation", args: { employee, company: this.company, payroll_month: this.payroll_month, participates: 0 }, freeze: true, freeze_message: __("正在更新本月参与范围..."), callback: () => { frappe.show_alert({ message: __("已标记为本月不参与计算"), indicator: "green" }); this.process_readiness = {}; this.load_salary_assignment_step(); } });
		});
	}

	restore_employee_payroll_participation(employee) {
		frappe.call({ method: "hrms.api.payroll_input.set_employee_payroll_participation", args: { employee, company: this.company, payroll_month: this.payroll_month, participates: 1 }, freeze: true, freeze_message: __("正在恢复本月参与范围..."), callback: () => { frappe.show_alert({ message: __("已恢复参与本月计算，请补齐定薪后再试算"), indicator: "blue" }); this.process_readiness = {}; this.load_salary_assignment_step(); } });
	}

	load_payroll_formula_catalog() {
		frappe.call({
			method: "hrms.api.payroll_input.get_payroll_formula_catalog",
			args: { company: this.company, payroll_month: this.payroll_month },
			callback: (response) => {
				this.payroll_formula_catalog = response.message || {};
				this.render_payroll_input_groups();
				this.render_payroll_formula_table();
				this.load_payroll_calculation_audit();
			},
		});
	}

	load_payroll_calculation_audit() {
		const target = this.wrapper.querySelector("[data-payroll-calculation-audit]");
		if (!target) return;
		target.innerHTML = `<div class="text-muted small">${frappe.utils.escape_html(__("正在核查公式参与、字段映射与已有结算记录..."))}</div>`;
		frappe.call({
			method: "hrms.api.payroll_input.get_payroll_calculation_audit",
			args: { company: this.company, payroll_month: this.payroll_month },
			callback: (response) => this.render_payroll_calculation_audit(response.message || {}),
		});
	}

	render_payroll_calculation_audit(audit = {}) {
		const target = this.wrapper.querySelector("[data-payroll-calculation-audit]");
		if (!target) return;
		const summary = audit.summary || {};
		const issues = [...(audit.blockers || []), ...(audit.warnings || [])];
		const formulaRows = audit.formulas || [];
		const mappingRows = audit.mappings || [];
		const actual = audit.actual_execution || {};
		target.innerHTML = `<section class="hrms-payroll-calculation-audit ${audit.valid ? "is-valid" : "has-issues"}">
			<div class="hrms-payroll-calculation-audit__head"><div><strong>${frappe.utils.escape_html(__("参与计算与字段映射核查"))}</strong><p>${frappe.utils.escape_html(audit.valid ? __("公式、结算字段与映射配置已通过结构核查") : __("发现需要处理的公式或字段映射问题"))}</p></div><button class="btn btn-default btn-sm" data-refresh-payroll-audit>${frappe.utils.escape_html(__("重新核查"))}</button></div>
			<div class="hrms-payroll-calculation-audit__metrics"><span><b>${frappe.utils.escape_html(String(summary.formula_valid || 0))}/${frappe.utils.escape_html(String(summary.formula_total || 0))}</b>${frappe.utils.escape_html(__(" 个公式可执行"))}</span><span><b>${frappe.utils.escape_html(String(summary.formula_participating || 0))}/${frappe.utils.escape_html(String(summary.formula_total || 0))}</b>${frappe.utils.escape_html(__(" 个结果写入结算"))}</span><span><b>${frappe.utils.escape_html(String(summary.mapping_valid || 0))}/${frappe.utils.escape_html(String(summary.mapping_total || 0))}</b>${frappe.utils.escape_html(__(" 个字段映射有效"))}</span></div>
			${issues.length ? `<div class="hrms-payroll-calculation-audit__issues">${issues.map((item) => `<span>${frappe.utils.escape_html(__(item))}</span>`).join("")}</div>` : ""}
			<details><summary>${frappe.utils.escape_html(__("查看公式参与明细"))}</summary><div class="hrms-payroll-calculation-audit__table">${formulaRows.map((row) => `<div><strong>${frappe.utils.escape_html(row.output_label || row.output_field || "-")}</strong><span>${frappe.utils.escape_html(row.expression || "-")}</span><em class="${row.valid && row.participates_in_settlement ? "is-ok" : "is-error"}">${frappe.utils.escape_html(row.valid && row.participates_in_settlement ? __("已参与结算") : (row.message || __("待处理")))}</em></div>`).join("")}</div></details>
			<details><summary>${frappe.utils.escape_html(__("查看字段映射明细"))}</summary><div class="hrms-payroll-calculation-audit__table">${mappingRows.map((row) => `<div><strong>${frappe.utils.escape_html(row.excel_label || row.mapping_code || "-")}</strong><span>${frappe.utils.escape_html(row.system_field || "-")} · ${frappe.utils.escape_html(row.source_module || "-")}</span><em class="${row.valid ? "is-ok" : "is-error"}">${frappe.utils.escape_html(row.valid ? __("映射有效") : (row.message || __("待处理")))}</em></div>`).join("")}</div></details>
			<p class="hrms-payroll-calculation-audit__actual">${frappe.utils.escape_html(actual.message || __("尚无本月结算记录；当前为配置结构核查。"))}</p>
		</section>`;
		target.querySelector("[data-refresh-payroll-audit]")?.addEventListener("click", () => this.load_payroll_calculation_audit());
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
		const stages = [
			["固定薪资", "先确认每位员工的固定薪资构成"],
			["考勤结算", "用已锁定考勤计算缺勤与加班"],
			["奖金补贴", "汇总本月已确认的奖金和补贴"],
			["扣款税费", "汇总旷工、迟到和其他扣款"],
			["应付与实发", "形成应付、计税和实发工资"],
			["公司成本", "计算公司承担的社保、公积金和总成本"],
		];
		const card = (formula, index) => {
			const dependencyCount = (formula.dependencies || []).length;
			const editing = this.inline_formula_editor_index === index;
			return `<article class="hrms-payroll-formula-process-card" data-formula-row="${index}" data-formula-search="${frappe.utils.escape_html([formula.output_label, formula.expression, ...(formula.dependencies || [])].join(" ").toLowerCase())}">
				<div class="hrms-payroll-formula-process-card__head"><div><i>${frappe.utils.escape_html(String(formula.order))}</i><strong>${frappe.utils.escape_html(formula.output_label)}</strong></div><span>${frappe.utils.escape_html(__((formula.status || "已启用") === "已启用" ? "已配置" : formula.status || "待配置"))}</span></div>
				<div class="hrms-payroll-formula-process-card__expression"><b>${frappe.utils.escape_html(formula.output_label)}</b><em>＝</em>${this.render_formula_cards(formula.expression || "")}</div>
				${editing ? this.render_inline_formula_editor(formula, index) : ""}
				<div class="hrms-payroll-formula-process-card__foot"><small>${frappe.utils.escape_html(dependencyCount ? __("使用 {0} 项基础值", [dependencyCount]) : __("固定值或独立公式"))} · v${frappe.utils.escape_html(String(formula.version || 1))}</small><button class="btn btn-default btn-sm" data-open-formula="${index}">${frappe.utils.escape_html(editing ? __("收起编辑") : __("直接编辑"))}</button></div>
			</article>`;
		};
		target.innerHTML = `<div class="hrms-payroll-formula-flow-guide"><span>1</span><div><strong>${frappe.utils.escape_html(__("按核算流程逐项设置"))}</strong><small>${frappe.utils.escape_html(__("直接在结果卡片中编辑；先点插入位置，再选字段或运算符。"))}</small></div><span>2</span><div><strong>${frappe.utils.escape_html(__("先基础值，后结算结果"))}</strong><small>${frappe.utils.escape_html(__("已锁定的考勤、员工定薪和月度变量是公式的基础值。"))}</small></div><span>3</span><div><strong>${frappe.utils.escape_html(__("校验并保存"))}</strong><small>${frappe.utils.escape_html(__("保存后的公式在下一次试算中生效。"))}</small></div></div><div data-payroll-calculation-audit></div><div class="hrms-payroll-formula-list">${stages.map(([stage, description], stageIndex) => {
			const stageFormulas = formulas.map((formula, index) => ({ formula, index })).filter(({ formula }) => formula.category === stage);
			if (!stageFormulas.length) return "";
			return `<section class="hrms-payroll-formula-stage"><div class="hrms-payroll-formula-stage__head"><span>${stageIndex + 1}</span><div><strong>${frappe.utils.escape_html(__(stage))}</strong><small>${frappe.utils.escape_html(__(description))}</small></div><em>${frappe.utils.escape_html(__("{0} 项", [stageFormulas.length]))}</em></div><div class="hrms-payroll-formula-stage__grid">${stageFormulas.map(({ formula, index }) => card(formula, index)).join("")}</div></section>`;
		}).join("")}</div>`;
		target.querySelectorAll("[data-open-formula]").forEach((button) => button.addEventListener("click", () => this.toggle_inline_formula_editor(formulas[Number(button.dataset.openFormula)], Number(button.dataset.openFormula))));
		if (this.inline_formula_editor_index !== undefined) this.setup_inline_formula_editor(formulas[this.inline_formula_editor_index], this.inline_formula_editor_index);
	}

	formula_builder_tokens(expression = "") {
		return String(expression || "").match(/\[[^\[\]]+\]|>=|<=|<>|==|!=|[A-Za-z_]+|\d+(?:\.\d+)?|[()+\-*/%,<>]/g) || [];
	}

	formula_builder_token_type(token) {
		if (/^\[[^\[\]]+\]$/.test(token)) return "field";
		if (/^[A-Za-z_]+$/.test(token)) return "function";
		if (/^\d/.test(token)) return "number";
		return "operator";
	}

	formula_builder_token_label(token) {
		const labels = { "+": "＋", "-": "−", "*": "×", "/": "÷", ">=": "≥", "<=": "≤", "==": "＝", "!=": "≠", "<>": "≠", ",": "，" };
		return labels[token] || token.replace(/^\[|\]$/g, "");
	}

	render_formula_cards(expression = "", options = false) {
		const interactive = typeof options === "object" ? Boolean(options.interactive) : Boolean(options);
		const insertAt = typeof options === "object" ? Number(options.insertAt || 0) : 0;
		const tokens = Array.isArray(expression) ? expression : this.formula_builder_tokens(expression);
		if (!interactive) return `<div class="hrms-payroll-formula-cards">${tokens.map((token) => `<span class="is-${this.formula_builder_token_type(token)}">${frappe.utils.escape_html(this.formula_builder_token_label(token))}</span>`).join("") || `<span class="hrms-payroll-formula-empty">${frappe.utils.escape_html(__("请选择字段和运算符"))}</span>`}</div>`;
		return `<div class="hrms-payroll-formula-cards is-editing" data-formula-builder-cards>${tokens.map((token, index) => `<span class="hrms-payroll-formula-edit-token is-${this.formula_builder_token_type(token)} ${insertAt === index ? "is-insertion-target" : ""}" draggable="true" data-formula-builder-drag="${index}" title="${frappe.utils.escape_html(__("拖拽调整顺序；点击后，新内容将插入在此卡片前"))}"><button type="button" data-formula-builder-select="${index}">${frappe.utils.escape_html(this.formula_builder_token_label(token))}</button><button type="button" data-formula-builder-remove="${index}" aria-label="${frappe.utils.escape_html(__("删除"))}">×</button></span>`).join("") || `<span class="hrms-payroll-formula-empty">${frappe.utils.escape_html(__("请选择字段和运算符"))}</span>`}</div>`;
	}

	render_formula_builder(formula = {}) {
		const catalog = this.payroll_formula_catalog || {};
		return `<div class="hrms-payroll-formula-builder" data-formula-builder>
			<div class="hrms-payroll-formula-hint">${frappe.utils.escape_html(__("拖拽卡片到目标卡片前或后即可调整顺序；点击卡片后，新字段、运算符或函数会插入在它前面；× 可删除卡片。"))}</div>
			<div data-formula-builder-canvas></div>
			<section><strong>${frappe.utils.escape_html(__("选择字段"))}</strong><div class="hrms-payroll-formula-choice-list">${(catalog.fields || []).filter((field) => field.group !== "计算结果" || field.fieldname !== formula.output_field).map((field) => `<button type="button" data-formula-builder-add="[${frappe.utils.escape_html(field.label)}]">${frappe.utils.escape_html(field.label)}</button>`).join("")}</div></section>
			<section><strong>${frappe.utils.escape_html(__("运算符"))}</strong><div class="hrms-payroll-formula-choice-list is-operators">${["+", "-", "*", "/", "(", ")", ",", ">", "<", ">=", "<=", "=="].map((token) => `<button type="button" data-formula-builder-add="${token}">${frappe.utils.escape_html(this.formula_builder_token_label(token))}</button>`).join("")}</div></section>
			<section><strong>${frappe.utils.escape_html(__("函数与常用数值"))}</strong><div class="hrms-payroll-formula-choice-list">${(catalog.functions || []).map((item) => `<button type="button" data-formula-builder-add="${frappe.utils.escape_html(item.name)}">${frappe.utils.escape_html(item.name)}</button>`).join("")}${["0", "1", "1.5", "2", "3", "24", "45", "174"].map((token) => `<button type="button" data-formula-builder-add="${token}">${token}</button>`).join("")}<button type="button" class="is-clear" data-formula-builder-clear>${frappe.utils.escape_html(__("清空"))}</button></div></section>
		</div>`;
	}

	render_inline_formula_editor(formula, index) {
		return `<section class="hrms-payroll-inline-formula-editor" data-inline-formula-editor="${index}"><div><strong>${frappe.utils.escape_html(__("直接编辑：{0}", [formula.output_label]))}</strong><small>${frappe.utils.escape_html(__("可直接拖拽公式卡片调整先后；不属于公式的辅助符号不会显示。"))}</small></div>${this.render_formula_builder(formula)}<label><span>${frappe.utils.escape_html(__("规则说明"))}</span><input class="form-control input-sm" data-inline-formula-description value="${frappe.utils.escape_html(formula.description || "")}"></label><div class="hrms-payroll-action-group"><button class="btn btn-primary btn-sm" data-save-inline-formula>${frappe.utils.escape_html(__("校验并保存"))}</button><button class="btn btn-default btn-sm" data-cancel-inline-formula>${frappe.utils.escape_html(__("取消"))}</button></div></section>`;
	}

	toggle_inline_formula_editor(formula, index) {
		if (this.inline_formula_editor_index === index) { this.inline_formula_editor_index = undefined; this.render_payroll_formula_table(); return; }
		if (!this.can_edit_payroll_rules) {
			frappe.call({ method: "hrms.api.payroll_input.can_edit_payroll_rules", callback: (response) => { this.can_edit_payroll_rules = Boolean(response.message); if (this.can_edit_payroll_rules) this.toggle_inline_formula_editor(formula, index); else frappe.msgprint(__("您没有维护薪资公式的权限")); } });
			return;
		}
		this.inline_formula_editor_index = index;
		this.render_payroll_formula_table();
	}

	setup_inline_formula_editor(formula, index) {
		const root = this.wrapper.querySelector(`[data-inline-formula-editor="${index}"]`);
		if (!root) return;
		this.setup_formula_card_builder(root, formula.expression || "", {
			onChange: (expression) => { root.dataset.formulaExpression = expression; },
		});
		root.querySelector("[data-cancel-inline-formula]")?.addEventListener("click", () => { this.inline_formula_editor_index = undefined; this.render_payroll_formula_table(); });
		root.querySelector("[data-save-inline-formula]")?.addEventListener("click", () => {
			const expression = root.dataset.formulaExpression || "";
			frappe.call({ method: "hrms.api.payroll_input.validate_payroll_formula", args: { company: this.company, output_field: formula.output_field, expression }, callback: (response) => {
				const result = response.message || {};
				if (!result.valid) { frappe.msgprint({ title: __("公式无法保存"), indicator: "red", message: result.message || __("公式无效") }); return; }
				frappe.call({ method: "hrms.api.payroll_input.upsert_payroll_formula", args: { company: this.company, output_field: formula.output_field, formula_expression: expression, rule_text: root.querySelector("[data-inline-formula-description]")?.value || "" }, freeze: true, freeze_message: __("正在保存公式..."), callback: () => { this.inline_formula_editor_index = undefined; frappe.show_alert({ message: __("公式已保存并进入下一次试算"), indicator: "green" }); this.load_payroll_formula_catalog(); } });
			} });
		});
	}

	filter_payroll_formulas(query = "") {
		const value = String(query || "").trim().toLowerCase();
		this.wrapper.querySelectorAll("[data-formula-row]").forEach((row) => { row.hidden = Boolean(value && !(row.dataset.formulaSearch || "").includes(value)); });
	}

	edit_payroll_formula(formula = {}, permissionChecked = false) {
		if (!this.can_edit_payroll_rules && !permissionChecked) {
			frappe.call({ method: "hrms.api.payroll_input.can_edit_payroll_rules", callback: (response) => {
				this.can_edit_payroll_rules = Boolean(response.message);
				if (this.can_edit_payroll_rules) return this.edit_payroll_formula(formula, true);
				frappe.msgprint(__("您没有维护薪资公式的权限"));
			} });
			return;
		}
		if (!this.can_edit_payroll_rules) { frappe.msgprint(__("您没有维护薪资公式的权限")); return; }
		const catalog = this.payroll_formula_catalog || {};
		const outputOptions = (catalog.fields || []).filter((field) => field.group === "计算结果").map((field) => ({ label: field.label, value: field.fieldname }));
		const builderHtml = this.render_formula_builder(formula);
		const dialog = new frappe.ui.Dialog({
			title: formula.output_label ? __("设置：{0}", [formula.output_label]) : __("新增/修改计算公式"),
			size: "large",
			fields: [
				{ fieldname: "output_field", fieldtype: "Select", label: __("计算结果"), options: outputOptions, reqd: 1, default: formula.output_field || outputOptions[0]?.value },
				{ fieldname: "formula_expression", fieldtype: "Data", hidden: 1, reqd: 1, default: formula.expression || "" },
				{ fieldname: "builder", fieldtype: "HTML", options: builderHtml },
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
		this.setup_formula_card_builder(dialog.$wrapper[0], formula.expression || "", { onChange: (expression) => dialog.get_field("formula_expression").set_value(expression) });
	}

	setup_formula_card_builder(root, expression = "", options = {}) {
		let tokens = this.formula_builder_tokens(expression);
		let insertAt = tokens.length;
		let draggedIndex = null;
		const canvas = root.querySelector("[data-formula-builder-canvas]");
		const render = () => {
			const current = tokens.join("");
			options.onChange?.(current);
			canvas.innerHTML = this.render_formula_cards(tokens, { interactive: true, insertAt });
			canvas.querySelectorAll("[data-formula-builder-select]").forEach((card) => card.addEventListener("click", () => { insertAt = Number(card.dataset.formulaBuilderSelect); render(); }));
			canvas.querySelectorAll("[data-formula-builder-remove]").forEach((card) => card.addEventListener("click", () => { tokens.splice(Number(card.dataset.formulaBuilderRemove), 1); insertAt = Math.min(insertAt, tokens.length); render(); }));
			canvas.querySelectorAll("[data-formula-builder-drag]").forEach((card) => {
				card.addEventListener("dragstart", (event) => { draggedIndex = Number(card.dataset.formulaBuilderDrag); event.dataTransfer.effectAllowed = "move"; card.classList.add("is-dragging"); });
				card.addEventListener("dragend", () => { draggedIndex = null; card.classList.remove("is-dragging"); });
				card.addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; card.classList.add("is-drag-over"); });
				card.addEventListener("dragleave", () => card.classList.remove("is-drag-over"));
				card.addEventListener("drop", (event) => {
					event.preventDefault();
					card.classList.remove("is-drag-over");
					const targetIndex = Number(card.dataset.formulaBuilderDrag);
					if (draggedIndex === null || draggedIndex === targetIndex) return;
					const bounds = card.getBoundingClientRect();
					let targetPosition = event.clientX > bounds.left + bounds.width / 2 ? targetIndex + 1 : targetIndex;
					const [token] = tokens.splice(draggedIndex, 1);
					if (draggedIndex < targetPosition) targetPosition -= 1;
					tokens.splice(targetPosition, 0, token);
					insertAt = targetPosition;
					render();
				});
			});
		};
		root.querySelectorAll("[data-formula-builder-add]").forEach((button) => button.addEventListener("click", () => {
			tokens.splice(insertAt, 0, button.dataset.formulaBuilderAdd);
			insertAt += 1;
			render();
		}));
		root.querySelector("[data-formula-builder-clear]")?.addEventListener("click", () => { tokens = []; insertAt = 0; render(); });
		render();
	}

	ensure_default_payroll_formulas() {
		frappe.call({ method: "hrms.api.payroll_input.ensure_default_payroll_formulas", args: { company: this.company }, freeze: true, freeze_message: __("正在初始化公司公式..."), callback: () => { frappe.show_alert({ message: __("公司公式已初始化"), indicator: "green" }); this.load_payroll_formula_catalog(); } });
	}

	download_payroll_formula_template() {
		frappe.call({ method: "hrms.api.payroll_input.create_payroll_formula_template_file", args: { company: this.company }, freeze: true, freeze_message: __("正在生成公式模板..."), callback: (response) => this.download_generated_file(response.message?.file_url, response.message?.file_name) });
	}

	open_payroll_formula_import() {
		new frappe.ui.FileUploader({ folder: "Home/Attachments", restrictions: { allowed_file_types: [".xlsx"] }, on_success: (file) => this.preview_payroll_formula_import(file.file_url) });
	}

	preview_payroll_formula_import(fileUrl) {
		frappe.call({ method: "hrms.api.payroll_input.preview_payroll_formula_source_workbook", args: { file_url: fileUrl, company: this.company }, freeze: true, freeze_message: __("正在识别 Excel 公式..."), callback: (response) => {
			const result = response.message || {};
			const previewHtml = `<div class="hrms-payroll-import-formula-note">${frappe.utils.escape_html(result.source_type === "Excel薪资结算表" ? __("已将 Excel 单元格引用转换为系统业务字段；确认后会写入本公司的公式版本。") : __("已识别为系统公式模板。"))}</div>${this.render_table("", ["结果项目", "Excel 公式", "系统公式", "状态"], result.rows || [], (row) => [row["结果项目"], row["Excel公式"] || "-", row["计算公式"], row.valid ? __("通过") : row.message])}`;
			const dialog = new frappe.ui.Dialog({ title: __("Excel 公式导入预览"), fields: [{ fieldname: "preview", fieldtype: "HTML", options: previewHtml }], primary_action_label: __("确认导入"), primary_action: () => {
				frappe.call({ method: "hrms.api.payroll_input.import_payroll_formula_source_workbook", args: { file_url: fileUrl, company: this.company }, freeze: true, freeze_message: __("正在录入系统公式..."), callback: () => { dialog.hide(); frappe.show_alert({ message: __("Excel 公式已录入系统"), indicator: "green" }); this.load_payroll_formula_catalog(); } });
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
					options: `<div class="hrms-payroll-guide-dialog"><p>${frappe.utils.escape_html(__("各数据区域可按需进入；试算时系统会统一检查必要条件。"))}</p>${this.workspace_areas
						.map((area) => `<button data-guide-route="${frappe.utils.escape_html(area.route)}" class="${area.key === currentKey ? "is-current" : ""}"><span class="hrms-payroll-guide-indicator"></span><div><strong>${frappe.utils.escape_html(__(area.label))}</strong><small>${frappe.utils.escape_html(__(area.description))}</small></div>${area.key === currentKey ? `<em>${frappe.utils.escape_html(__("当前区域"))}</em>` : ""}</button>`)
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
		this.set_process_step_state("salary");
		target.scrollIntoView({ behavior: "smooth", block: "start" });
	}

	set_process_step_state(activeKey) {
		if (!this.workspace_areas.some((area) => area.key === activeKey)) return;
		this.active_process_step = activeKey;
		this.wrapper.querySelectorAll("[data-area-key]").forEach((button) => {
			const selected = button.dataset.areaKey === activeKey;
			button.classList.toggle("is-selected", selected);
			button.setAttribute("aria-current", selected ? "page" : "false");
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
			args: { company: this.company, payroll_month: this.payroll_month },
			callback: (response) => {
				this.payroll_rule_rows = response.message || [];
				const target = this.wrapper.querySelector("[data-salary-rule-table]");
				if (!target) return;
				target.innerHTML = `<section class="hrms-payroll-rule-picker"><label>${frappe.utils.escape_html(__("选择要调整的项目"))}</label><small>${frappe.utils.escape_html(__("当前查看 {0} 的生效版本；保存会从该月第一天开始生效。", [this.payroll_month]))}</small><select class="form-control" data-payroll-rule-picker><option value="">${frappe.utils.escape_html(__("请选择"))}</option>${this.payroll_rule_rows.map((row, index) => `<option value="${index}">${frappe.utils.escape_html(`${__(row.rule_name || "")} · ${__(row.version_label || "")}`)}</option>`).join("")}</select><div data-payroll-rule-quick-editor></div></section>`;
				target.querySelector("[data-payroll-rule-picker]")?.addEventListener("change", (event) => {
					const rule = this.payroll_rule_rows[Number(event.target.value)];
					const editor = target.querySelector("[data-payroll-rule-quick-editor]");
					if (editor) this.render_payroll_rule_quick_editor(editor, rule);
				});
				const pending = this.pending_quick_rule_code;
				if (pending) {
					const index = this.payroll_rule_rows.findIndex((row) => row.rule_code === pending);
					if (index >= 0) {
						target.querySelector("[data-payroll-rule-picker]").value = String(index);
						this.render_payroll_rule_quick_editor(target.querySelector("[data-payroll-rule-quick-editor]"), this.payroll_rule_rows[index]);
					}
					this.pending_quick_rule_code = "";
				}
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
				target.innerHTML = `<div class="hrms-payroll-input-panel"><strong>${frappe.utils.escape_html(result.valid ? __("关键规则校验通过") : __("关键规则需要检查"))}</strong><div class="text-muted">${frappe.utils.escape_html(__("试算月份：{0}", [result.payroll_month || this.payroll_month]))}</div><div class="hrms-payroll-rule-checks">${rows.map((row) => `<span class="${row.valid ? "is-ready" : "is-blocker"}">${frappe.utils.escape_html(row.message || "")}</span>`).join("")}</div></div>`;
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

	payroll_rule_quick_fields(rule = {}) {
		const parameters = rule.parameters || {};
		const field = (key, label, suffix = "元", type = "number") => ({ key, label, suffix, value: parameters[key] ?? "", type });
		if (rule.rule_code === "PERFORMANCE_APPLE_REWARD") return [field("amount_per_apple", "每个苹果金额")];
		if (rule.rule_code === "WELFARE_EDUCATION_SUBSIDY") return [field("non_full_time_college", "非全日制大专"), field("full_time_college_or_non_full_time_bachelor", "全日制大专/非全日制本科"), field("full_time_bachelor_or_above", "全日制本科及以上"), field("months", "补贴月数", "个月")];
		if (rule.rule_code === "WELFARE_RENTAL_SUBSIDY") return [field("before_or_on_day_10", "10日及以前入职"), field("day_11_to_20", "11日至20日入职"), field("after_or_on_day_21", "21日及以后入职"), field("resignation_full_attendance", "离职当月满勤")];
		if (rule.rule_code === "WELFARE_DORMITORY_FEE") return [field("manager_dorm", "管理宿舍"), field("attic_manager_dorm", "阁楼管理宿舍"), field("line_leader_single_dorm", "线长单人宿舍"), field("group_dorm", "集体宿舍"), field("water_per_ton", "水费", "元/吨"), field("electricity_per_kwh", "电费", "元/度")];
		if (rule.rule_code === "PAYROLL_TERMINATION_SETTLEMENT") return [field("trial_under_seven_days_daily_amount", "试用期未满七天日薪"), field("one_day_departure_amount", "工作一天离职金额")];
		const labels = {
			workday_multiplier: "工作日加班倍率", weekend_multiplier: "休息日加班倍率", holiday_multiplier: "节假日加班倍率",
			base_salary: "底薪字段", function_allowance: "职能津贴字段", bonus_total: "奖金小计组成", punishment_total: "惩处小计组成",
			paid_welfare: "已发福利字段", confirmed_source_required: "必须有已确认来源", confirmed_policy_required: "必须有确认口径",
			manual_import: "由财务确认导入", manual_override: "允许人工金额优先", default_company_equals_personal: "公司公积金默认等于个人",
			locked_attendance_required: "必须使用锁定考勤", confirmed_legal_source_required: "必须有确认的法定来源", enforcement: "差异处理方式",
		};
		return Object.entries(parameters).map(([key, value]) => {
			const type = Array.isArray(value) || (value && typeof value === "object") ? "json" : typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "text";
			return field(key, labels[key] || key, "", type);
		});
	}

	render_payroll_rule_quick_editor(target, rule = {}) {
		if (!target) return;
		if (!rule?.rule_code) { target.innerHTML = ""; return; }
		if (["ATTENDANCE_FULL_ATTENDANCE_BONUS", "PAYROLL_SETTLEMENT_ABSENCE_DEDUCTION", "ATTENDANCE_MISSED_PUNCH", "PAYROLL_SETTLEMENT_OVERTIME_PAY", "PAYROLL_SETTLEMENT_NIGHT_SHIFT"].includes(rule.rule_code)) {
			target.innerHTML = `<div class="hrms-payroll-quick-rule"><strong>${frappe.utils.escape_html(__("此项在“考勤计薪规则”中设置"))}</strong><button class="btn btn-default btn-sm" data-open-attendance-rule>${frappe.utils.escape_html(__("前往设置"))}</button></div>`;
			target.querySelector("[data-open-attendance-rule]")?.addEventListener("click", () => this.route_to_tab("attendance-pay-rules"));
			return;
		}
		const fields = this.payroll_rule_quick_fields(rule);
		const renderField = (item) => {
			if (item.type === "boolean") return `<label class="hrms-payroll-rule-field"><span>${frappe.utils.escape_html(__(item.label))}</span><select class="form-control" data-quick-rule-field="${frappe.utils.escape_html(item.key)}" data-value-type="boolean"><option value="1" ${item.value ? "selected" : ""}>${frappe.utils.escape_html(__("是"))}</option><option value="0" ${!item.value ? "selected" : ""}>${frappe.utils.escape_html(__("否"))}</option></select></label>`;
			if (item.type === "json") return `<label class="hrms-payroll-rule-field"><span>${frappe.utils.escape_html(__(item.label))}</span><textarea class="form-control" rows="3" data-quick-rule-field="${frappe.utils.escape_html(item.key)}" data-value-type="json">${frappe.utils.escape_html(JSON.stringify(item.value))}</textarea><small>${frappe.utils.escape_html(__("按当前数组/对象结构填写；保存前会校验。"))}</small></label>`;
			return `<label class="hrms-payroll-rule-field"><span>${frappe.utils.escape_html(__(item.label))}</span><div><input class="form-control" type="${item.type === "number" ? "number" : "text"}" ${item.type === "number" ? 'min="0" step="0.01"' : ""} data-quick-rule-field="${frappe.utils.escape_html(item.key)}" data-value-type="${item.type}" value="${frappe.utils.escape_html(String(item.value))}"><em>${frappe.utils.escape_html(__(item.suffix))}</em></div></label>`;
		};
		target.innerHTML = `<section class="hrms-payroll-quick-rule" data-quick-rule-code="${frappe.utils.escape_html(rule.rule_code)}"><div><strong>${frappe.utils.escape_html(__(rule.rule_name || ""))}</strong><span>${frappe.utils.escape_html(__("本次保存从 {0} 起生效；已锁定月份不会重算。", [this.payroll_month]))}</span></div>${fields.length ? `<div class="hrms-payroll-rule-fields">${fields.map(renderField).join("")}</div>` : `<p>${frappe.utils.escape_html(__("此项没有可维护参数，按已确认来源资料计算。"))}</p>`}<label class="hrms-payroll-quick-status"><span>${frappe.utils.escape_html(__("是否参与本月计算"))}</span><select class="form-control" data-quick-rule-status><option value="已启用" ${rule.status !== "已停用" ? "selected" : ""}>${frappe.utils.escape_html(__("参与"))}</option><option value="已停用" ${rule.status === "已停用" ? "selected" : ""}>${frappe.utils.escape_html(__("不参与"))}</option></select></label><button class="btn btn-primary btn-sm" data-save-quick-rule>${frappe.utils.escape_html(__("保存为本月起版本"))}</button></section>`;
		target.querySelector("[data-save-quick-rule]")?.addEventListener("click", () => this.save_payroll_rule_quick_editor(rule, target));
	}

	save_payroll_rule_quick_editor(rule, target) {
		const parameters = { ...(rule.parameters || {}) };
		try {
			target.querySelectorAll("[data-quick-rule-field]").forEach((field) => {
				const type = field.dataset.valueType || "number";
				parameters[field.dataset.quickRuleField] = type === "json" ? JSON.parse(field.value || "null") : type === "boolean" ? field.value === "1" : field.value;
			});
		} catch (error) { frappe.msgprint(__("数组/对象设置不是有效 JSON，请修正后再保存。")); return; }
		frappe.call({ method: "hrms.api.payroll_input.save_payroll_rule_version", args: { company: this.company, payroll_month: this.payroll_month, rule_code: rule.rule_code, parameters_json: JSON.stringify(parameters), status: target.querySelector("[data-quick-rule-status]")?.value || "已启用" }, freeze: true, freeze_message: __("正在保存本月起规则版本..."), callback: () => { frappe.show_alert({ message: __("规则版本已保存"), indicator: "green" }); this.load_payroll_rules(); this.load_payroll_configuration_items(); } });
	}

	edit_payroll_rule(rule = {}) {
		if (!this.can_edit_payroll_rules) { frappe.msgprint(__("您没有维护薪资规则的权限")); return; }
		this.pending_quick_rule_code = rule.rule_code || "";
		if (this.wrapper.querySelector("[data-salary-rule-table]")) { this.load_payroll_rules(); return; }
		this.route_to_tab("salary-rules");
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
					<p>${frappe.utils.escape_html(__("先维护薪资架构和薪资档位，再为每位员工建立已提交的定薪记录；只有该记录、已锁定考勤终稿和已确认福利扣款共同满足时，才能进入正式薪资试算。"))}</p>
				</div>
				<div class="hrms-payroll-action-group">
					<button class="btn btn-default btn-sm" data-download-salary-change-template>${frappe.utils.escape_html(__("下载员工定薪模板"))}</button>
					<button class="btn btn-default btn-sm" data-import-salary-change>${frappe.utils.escape_html(__("导入员工定薪"))}</button>
					<button class="btn btn-primary btn-sm" data-upload-salary-structure>${frappe.utils.escape_html(__("导入薪资架构"))}</button>
				</div>
			</div>
			<div class="hrms-payroll-scope-notice">
				<strong>${frappe.utils.escape_html(__("薪资主数据范围"))}</strong>
				<span>${frappe.utils.escape_html(this.company || __("未选择公司"))} / ${frappe.utils.escape_html(this.payroll_month || __("未选择月份"))}</span>
				<small>${frappe.utils.escape_html(__("试运营、测试或未批准的薪资记录会明确提示，不能作为正式工资发放依据。"))}</small>
			</div>
			<div data-salary-architecture-overview></div>
			<div data-salary-change-import-preview></div>
			<div data-salary-structure-preview>${preview ? this.render_salary_structure_preview(preview) : ""}</div>
			<div data-salary-versions></div>
			<div data-salary-grades></div>
			<div data-salary-changes></div>
		`;
		this.body().querySelector("[data-upload-salary-structure]").addEventListener("click", () => this.open_salary_structure_uploader());
		this.body().querySelector("[data-download-salary-change-template]").addEventListener("click", () => this.download_employee_salary_change_template());
		this.body().querySelector("[data-import-salary-change]").addEventListener("click", () => this.open_employee_salary_change_import());
		const importButton = this.body().querySelector("[data-import-salary-structure]");
		if (importButton) importButton.addEventListener("click", () => this.import_salary_structure_workbook());
		this.load_salary_architecture_overview();
		this.load_salary_structure_versions();
		this.load_salary_grades();
		this.load_employee_salary_changes();
		this.render_employee_salary_change_import_preview();
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
		const stages = result.stages || [];
		const stageByKey = {};
		stages.forEach((stage) => {
			stageByKey[stage.key] = stage;
		});
		const employeeReady = (coverage.active_employee_count || 0) > 0;
		const rulesReady = stageByKey.rules?.tone === "ready";
		const profileReady = stageByKey.profile?.tone === "ready" && stageByKey.trial?.tone !== "blocked";
		return {
			master: {
				state: employeeReady ? "complete" : "blocked",
				label: employeeReady ? __("已满足") : __("缺员工资料"),
				detail: __("员工基础资料必须先维护公司、工号、姓名、部门、岗位、状态和入职信息。"),
			},
			salary: {
				state: profileReady ? "complete" : "blocked",
				label: profileReady ? __("已满足") : __("缺员工定薪"),
				detail: __("每位在职员工必须有当月有效、已提交且非测试值的定薪记录。"),
			},
			rules: {
				state: rulesReady ? "complete" : "blocked",
				label: rulesReady ? __("已满足") : __("缺核算规则"),
				detail: __("应发、应扣、公司承担和导出公式及字段映射必须通过校验。"),
			},
		};
	}

	render_salary_architecture_overview(result) {
		const coverage = result.coverage || {};
		const stages = result.stages || [];
		const missing = result.missing_profiles || [];
		const trial = result.trial_profiles || [];
		return `
			<div class="hrms-payroll-metric-grid">
				<div class="hrms-payroll-metric"><div class="text-muted">${frappe.utils.escape_html(__("在职员工"))}</div><strong>${frappe.utils.escape_html(String(coverage.active_employee_count || 0))}</strong></div>
				<div class="hrms-payroll-metric"><div class="text-muted">${frappe.utils.escape_html(__("已提交定薪覆盖"))}</div><strong>${frappe.utils.escape_html(`${coverage.approved_profile_count || 0} / ${coverage.active_employee_count || 0}`)}</strong></div>
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
				missing.length || trial.length
					? `<div class="hrms-payroll-salary-alert">
						<strong>${frappe.utils.escape_html(__("需要处理的薪资主数据"))}</strong>
						${missing.length ? `<span>${frappe.utils.escape_html(__("缺少已提交定薪：{0} 人", [missing.length]))}${missing.length ? `（${frappe.utils.escape_html(missing.slice(0, 5).map((row) => row.employee_name || row.employee_code).join("、"))}${missing.length > 5 ? "…" : ""}）` : ""}</span>` : ""}
						${trial.length ? `<span>${frappe.utils.escape_html(__("试运营测试定薪：{0} 人，必须替换后才可正式发薪", [trial.length]))}</span>` : ""}
						<button class="btn btn-default btn-sm" data-salary-master-route="employee-salary">${frappe.utils.escape_html(__("查看员工薪资"))}</button>
					</div>`
					: `<div class="hrms-payroll-salary-ready">${frappe.utils.escape_html(__("薪资架构和员工定薪已满足当前月份的基础检查；可按需处理考勤终稿、福利扣款与薪资变量。"))}<button class="btn btn-default btn-sm" data-salary-master-route="monthly-workbench">${frappe.utils.escape_html(__("进入本月算薪"))}</button></div>`
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
				this.download_generated_file(fileUrl, response.message?.file_name);
			},
		});
	}

	open_employee_salary_change_import() {
		new frappe.ui.FileUploader({
			folder: "Home/Attachments",
			restrictions: { allowed_file_types: [".xlsx"] },
			on_success: (file) => {
				this.employee_salary_change_file_url = file.file_url;
				frappe.call({
					method: "hrms.api.payroll_input.preview_employee_salary_change_workbook",
					args: { file_url: file.file_url, company: this.company, payroll_month: this.payroll_month },
					freeze: true,
					freeze_message: __("正在识别人员薪资调整表..."),
					callback: (response) => {
						this.employee_salary_change_import_preview = response.message || {};
						this.render_employee_salary_change_import_preview();
					},
				});
			},
		});
	}

	render_employee_salary_change_import_preview() {
		const target = this.wrapper.querySelector("[data-salary-change-import-preview]");
		const preview = this.employee_salary_change_import_preview;
		if (!target) return;
		if (!preview) {
			target.innerHTML = `<div class="hrms-payroll-import-tip"><strong>${frappe.utils.escape_html(__("从 Excel 导入"))}</strong><span>${frappe.utils.escape_html(__("支持原有《人员薪资调整模板（月）》及本页下载模板；上传后先校验工号、姓名和调整后薪资。"))}</span></div>`;
			return;
		}
		if (!preview.found) {
			target.innerHTML = `<div class="hrms-payroll-salary-alert"><strong>${frappe.utils.escape_html(__("未识别到员工薪资调整表"))}</strong><span>${frappe.utils.escape_html(preview.message || __("请上传《人员薪资调整模板（月）》或下载本页模板后填写。"))}</span></div>`;
			return;
		}
		const rows = preview.rows || [];
		const failedRows = Number(preview.failed_rows || 0);
		const validRows = Number(preview.valid_rows || 0);
		const importHint = failedRows
			? __("确认后将导入 {0} 条通过记录；{1} 条异常记录不会导入，原因已置顶显示。未匹配员工请先维护花名册，其他记录可在下方员工定薪表继续调整。", [validRows, failedRows])
			: __("确认后将按工号和生效日期生成或更新员工定薪。已匹配的行以薪资架构金额为准，并可在下方员工定薪表继续调整。");
		target.innerHTML = `<section class="hrms-payroll-salary-import-preview"><div class="hrms-payroll-project-map-head"><div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("Excel 导入预览"))}</span><h3>${frappe.utils.escape_html(preview.sheet_name || "")}</h3><p>${frappe.utils.escape_html(preview.message || "")}</p></div><button class="btn btn-default btn-sm" data-clear-salary-change-preview>${frappe.utils.escape_html(__("取消本次导入"))}</button></div><div class="hrms-payroll-metric-grid"><div class="hrms-payroll-metric"><div>${frappe.utils.escape_html(__("读取行数"))}</div><strong>${frappe.utils.escape_html(String(preview.total_rows || 0))}</strong></div><div class="hrms-payroll-metric"><div>${frappe.utils.escape_html(__("可导入"))}</div><strong>${frappe.utils.escape_html(String(preview.valid_rows || 0))}</strong></div><div class="hrms-payroll-metric"><div>${frappe.utils.escape_html(__("需处理"))}</div><strong>${frappe.utils.escape_html(String(preview.failed_rows || 0))}</strong></div></div><div class="table-responsive"><table class="table table-bordered table-sm"><thead><tr><th>${frappe.utils.escape_html(__("行"))}</th><th>${frappe.utils.escape_html(__("工号"))}</th><th>${frappe.utils.escape_html(__("姓名"))}</th><th>${frappe.utils.escape_html(__("版本"))}</th><th>${frappe.utils.escape_html(__("序号"))}</th><th>${frappe.utils.escape_html(__("匹配结果"))}</th><th>${frappe.utils.escape_html(__("生效日期"))}</th><th>${frappe.utils.escape_html(__("底薪"))}</th><th>${frappe.utils.escape_html(__("职能津贴"))}</th><th>${frappe.utils.escape_html(__("全薪"))}</th><th>${frappe.utils.escape_html(__("校验"))}</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${frappe.utils.escape_html(String(row.row_number || ""))}</td><td>${frappe.utils.escape_html(row.employee_code || "")}</td><td>${frappe.utils.escape_html(row.employee_name || "")}</td><td>${frappe.utils.escape_html(row.structure_version || "—")}</td><td>${frappe.utils.escape_html(String(row.salary_level || "—"))}</td><td>${frappe.utils.escape_html(row.match_status || "—")}</td><td>${frappe.utils.escape_html(row.effective_date || "")}</td><td>${frappe.utils.escape_html(String(row.base_salary || 0))}</td><td>${frappe.utils.escape_html(String(row.function_allowance || 0))}</td><td>${frappe.utils.escape_html(String(row.full_salary || 0))}</td><td>${row.errors?.length ? `<span class="text-danger">${frappe.utils.escape_html(__("异常："))}${frappe.utils.escape_html(row.errors.join("；"))}</span>` : `<span class="text-success">${frappe.utils.escape_html(__("通过"))}</span>`}</td></tr>`).join("")}</tbody></table></div><div class="hrms-payroll-action-group"><button class="btn btn-primary btn-sm" data-confirm-salary-change-import ${validRows ? "" : "disabled"}>${frappe.utils.escape_html(__("确认导入员工定薪"))}</button><span>${frappe.utils.escape_html(importHint)}</span></div></section>`;
		target.querySelector("[data-clear-salary-change-preview]")?.addEventListener("click", () => {
			this.employee_salary_change_import_preview = null;
			this.employee_salary_change_file_url = "";
			this.render_employee_salary_change_import_preview();
		});
		target.querySelector("[data-confirm-salary-change-import]")?.addEventListener("click", () => this.import_employee_salary_change_workbook());
	}

	import_employee_salary_change_workbook() {
		if (!this.employee_salary_change_file_url) return;
		frappe.call({
			method: "hrms.api.payroll_input.import_employee_salary_change_workbook",
			args: { file_url: this.employee_salary_change_file_url, company: this.company, payroll_month: this.payroll_month },
			freeze: true,
			freeze_message: __("正在写入员工定薪..."),
			callback: (response) => {
				const result = response.message || {};
				const skippedRows = Number(result.skipped_rows || 0);
				frappe.show_alert({ message: skippedRows ? __("已导入 {0} 条员工定薪；{1} 条异常记录未导入", [result.imported_rows || 0, skippedRows]) : __("已导入 {0} 条员工定薪", [result.imported_rows || 0]), indicator: skippedRows ? "orange" : "green" });
				this.employee_salary_change_file_url = "";
				this.employee_salary_change_import_preview = null;
				this.process_readiness = {};
				this.load_active_tab();
			},
		});
	}

	load_employee_salary_change_import_batches() {
		return frappe.call({
			method: "hrms.api.payroll_input.list_employee_salary_change_import_batches",
			args: { company: this.company, page_length: 10 },
		}).then((response) => {
			this.salaryChangeImportBatches = response.message || [];
			this.render_employee_salary_change_import_batches();
		});
	}

	render_employee_salary_change_import_batches() {
		const target = this.wrapper.querySelector("[data-salary-change-import-batches]");
		if (!target) return;
		const escape = (value) => frappe.utils.escape_html(String(value ?? ""));
		const rows = this.salaryChangeImportBatches || [];
		if (!rows.length) {
			target.innerHTML = "";
			return;
		}
		target.innerHTML = `<section class="hrms-payroll-input-panel hrms-salary-import-batches"><div class="hrms-payroll-project-map-head"><div><h3>${escape(__("员工定薪导入记录"))}</h3><p>${escape(__("撤销会删除本批次新建的定薪，并恢复被覆盖记录的导入前数据；已被后续修改或已进入正式结算的数据不能撤销。"))}</p></div></div><div class="table-responsive"><table class="table table-bordered table-sm"><thead><tr><th>${escape(__("导入时间"))}</th><th>${escape(__("来源文件"))}</th><th>${escape(__("导入记录"))}</th><th>${escape(__("当前关联"))}</th><th>${escape(__("状态"))}</th><th>${escape(__("操作"))}</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escape(row.imported_on || row.modified || "-")}</td><td>${escape((row.source_file || "").split("/").pop() || "-")}</td><td>${escape(row.valid_rows || 0)}</td><td>${escape(row.affected_rows || 0)}</td><td>${escape(row.status || "-")}</td><td>${row.can_rollback ? `<button class="btn btn-danger btn-xs" data-rollback-salary-import="${escape(row.name)}">${escape(__("撤销本次导入"))}</button>` : `<span class="text-muted">${escape(__("不可撤销"))}</span>`}</td></tr>`).join("")}</tbody></table></div></section>`;
		target.querySelectorAll("[data-rollback-salary-import]").forEach((button) => button.addEventListener("click", () => this.request_salary_change_import_rollback(button.dataset.rollbackSalaryImport)));
	}

	request_salary_change_import_rollback(batchName) {
		frappe.prompt([{ fieldname: "reason", fieldtype: "Small Text", label: __("撤销原因"), reqd: 1 }], (values) => {
			frappe.confirm(__("确认撤销该批次吗？新建的员工定薪将被删除，原有记录将恢复到导入前。"), () => {
				frappe.call({
					method: "hrms.api.payroll_input.rollback_employee_salary_change_import_batch",
					args: { batch_name: batchName, company: this.company, reason: values.reason },
					freeze: true,
					freeze_message: __("正在撤销员工定薪导入..."),
					callback: (response) => {
						const result = response.message || {};
						frappe.show_alert({ message: __("已撤销：删除 {0} 条、恢复 {1} 条", [result.created_rows_removed || 0, result.updated_rows_restored || 0]), indicator: "orange" });
						this.process_readiness = {};
						this.load_active_tab();
					},
				});
			});
		}, __("撤销员工定薪导入"));
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
			args: { page_length: 100000 },
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
			args: { page_length: 100000 },
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
			method: "hrms.api.payroll_input.list_employee_salary_change_grid",
			args: { company: this.company, payroll_month: this.payroll_month, page_length: 1000 },
			callback: (response) => {
				const target = this.wrapper.querySelector("[data-salary-changes]");
				if (!target) return;
				this.render_employee_salary_change_grid(target, response.message?.rows || []);
			},
		});
	}

	render_employee_salary_change_grid(target, rows) {
		const escape = (value) => frappe.utils.escape_html(String(value ?? ""));
		const moneyInput = (field, value, { required = false } = {}) => {
			const isMissing = required && !Number(value);
			return `<div class="hrms-payroll-money-field"><input class="form-control input-sm ${isMissing ? "is-required" : ""}" type="number" min="0" step="0.01" data-salary-change-field="${field}" value="${isMissing ? "" : escape(value || 0)}" placeholder="${isMissing ? escape(__("请输入")) : ""}">${isMissing ? `<small class="hrms-payroll-required-hint">${escape(__("请输入"))}</small>` : ""}</div>`;
		};
		const contributionToggle = (field, enabled, hint) => `<label class="hrms-payroll-contribution-toggle" title="${escape(hint)}"><input type="checkbox" data-salary-change-field="${field}" ${Number(enabled) ? "checked" : ""}><span>${escape(field === "social_insurance_enabled" ? __("缴纳社保") : __("缴纳公积金"))}</span></label>`;
		const salaryGradeSelect = (selected, selectedLabel) => {
			const available = this.assignableSalaryGrades.some((grade) => grade.name === selected);
			const historicalOption = selected && !available
				? `<option value="${escape(selected)}" selected>${escape(selectedLabel || __("已绑定历史薪级"))}</option>`
				: "";
			return `<select class="form-control input-sm" data-salary-change-field="salary_grade"><option value="">${escape(__("手动定薪"))}</option>${historicalOption}${this.assignableSalaryGrades.map((grade) => `<option value="${escape(grade.name)}" ${grade.name === selected ? "selected" : ""}>${escape(grade.label)}</option>`).join("")}</select>`;
		};
		const salaryRows = [...rows].sort((left, right) => {
			const missingDifference = Number(!Number(left.base_salary)) - Number(!Number(right.base_salary));
			if (missingDifference) return -missingDifference;
			return String(left.employee_name || left.employee_code || "").localeCompare(String(right.employee_name || right.employee_code || ""), "zh-Hans-CN");
		});
		target.innerHTML = `<section class="hrms-payroll-salary-grid"><div class="hrms-payroll-project-map-head"><div><h3>${escape(__("员工定薪表"))}</h3><p>${escape(__("选择等级后自动带入薪资；Excel 导入始终按每行的版本 + 薪资序号精确匹配，不受薪资架构页面当前查看版本影响。证书和多能工津贴按月进入奖金，不参与加班、缺勤工时单价。"))}</p></div><span class="hrms-payroll-template-status">${escape(__("共 {0} 人", [salaryRows.length]))}</span></div><div class="hrms-payroll-filter-row"><input class="form-control input-sm" data-salary-change-search placeholder="${escape(__("搜索姓名、工号、部门或工作性质"))}"></div><div class="table-responsive"><table class="table table-bordered table-sm hrms-payroll-editable-table"><thead><tr><th>${escape(__("姓名 / 工号"))}</th><th>${escape(__("部门"))}</th><th>${escape(__("工作性质"))}</th><th>${escape(__("生效日期"))}</th><th>${escape(__("等级"))}</th><th>${escape(__("底薪"))}</th><th>${escape(__("职能津贴"))}</th><th>${escape(__("证书津贴"))}</th><th>${escape(__("多能工津贴"))}</th><th>${escape(__("社保"))}</th><th>${escape(__("公积金"))}</th><th>${escape(__("薪资小计"))}</th><th>${escape(__("操作"))}</th></tr></thead><tbody>${salaryRows.map((row) => {
			const participationAction = !Number(row.base_salary) ? `<button class="btn btn-default btn-xs" data-exclude-payroll="${escape(row.employee)}">${escape(__("本月不参与计算"))}</button>` : "";
			return `<tr data-salary-change-row data-search="${escape([row.employee_name, row.employee_code, row.department, row.employment_type].filter(Boolean).join(" ").toLowerCase())}" data-salary-change-name="${escape(row.name)}" data-salary-change-employee="${escape(row.employee)}"><td><strong>${escape(row.employee_name)}</strong><small>${escape(row.employee_code)}</small></td><td>${escape(row.department)}</td><td><span class="hrms-payroll-employment-stage">${escape(row.employment_type || "-")}</span></td><td><input class="form-control input-sm" type="date" data-salary-change-field="effective_date" value="${escape(row.effective_date)}"></td><td>${salaryGradeSelect(row.salary_grade, row.salary_grade_label)}</td><td>${moneyInput("base_salary", row.base_salary, { required: true })}</td><td>${moneyInput("function_allowance", row.function_allowance)}</td><td>${moneyInput("certificate_allowance", row.certificate_allowance)}</td><td>${moneyInput("multi_skill_allowance", row.multi_skill_allowance)}</td><td>${contributionToggle("social_insurance_enabled", row.social_insurance_enabled, row.contribution_default || "")}</td><td>${contributionToggle("housing_fund_enabled", row.housing_fund_enabled, row.contribution_default || "")}</td><td><output data-salary-change-total>${escape(row.full_salary || 0)}</output></td><td><button class="btn btn-primary btn-xs" data-save-salary-change>${escape(__("保存并提交"))}</button><small class="hrms-payroll-save-state" data-salary-change-save-state>${escape(__("已提交"))}</small>${participationAction}</td></tr>`;
		}).join("")}</tbody></table></div></section>`;
		target.querySelector("[data-salary-change-search]")?.addEventListener("input", (event) => {
			const query = String(event.target.value || "").trim().toLowerCase();
			target.querySelectorAll("[data-salary-change-row]").forEach((row) => {
				row.dataset.tableFilterMatch = query && !(row.dataset.search || "").includes(query) ? "0" : "1";
			});
			this.update_table_pagination(target.querySelector("table"), 1);
		});
		target.querySelectorAll("[data-salary-change-row]").forEach((row) => {
			const refreshTotal = () => {
				const total = ["base_salary", "function_allowance"].reduce((sum, field) => sum + Number(row.querySelector(`[data-salary-change-field="${field}"]`)?.value || 0), 0);
				row.querySelector("[data-salary-change-total]").textContent = total.toFixed(2).replace(/\.00$/, "");
			};
			row.querySelectorAll('[data-salary-change-field="base_salary"], [data-salary-change-field="function_allowance"], [data-salary-change-field="certificate_allowance"], [data-salary-change-field="multi_skill_allowance"]').forEach((field) => field.addEventListener("input", () => {
				field.classList.toggle("is-required", field.dataset.salaryChangeField === "base_salary" && !Number(field.value));
				field.closest(".hrms-payroll-money-field")?.querySelector(".hrms-payroll-required-hint")?.toggleAttribute("hidden", Number(field.value) > 0);
				refreshTotal();
				this.refresh_salary_change_dirty_state(row);
			}));
			row.querySelectorAll('[data-salary-change-field="effective_date"], [data-salary-change-field="social_insurance_enabled"], [data-salary-change-field="housing_fund_enabled"]').forEach((field) => field.addEventListener("change", () => this.refresh_salary_change_dirty_state(row)));
			row.querySelector('[data-salary-change-field="salary_grade"]')?.addEventListener("change", (event) => {
				const grade = this.assignableSalaryGrades.find((item) => item.name === event.target.value);
				if (grade) {
					row.querySelector('[data-salary-change-field="base_salary"]').value = grade.base_salary;
					row.querySelector('[data-salary-change-field="function_allowance"]').value = grade.function_allowance;
				}
				refreshTotal();
				this.refresh_salary_change_dirty_state(row);
			});
			row.querySelector("[data-save-salary-change]")?.addEventListener("click", () => this.save_employee_salary_change_row(row));
			row.dataset.salaryChangeSnapshot = JSON.stringify(this.salary_change_values(row));
			this.set_salary_change_dirty_state(row, false);
		});
		target.querySelectorAll("[data-exclude-payroll]").forEach((button) => button.addEventListener("click", () => this.exclude_employee_from_payroll(button.dataset.excludePayroll, button.closest("[data-salary-change-row]"))));
	}

	salary_change_values(row) {
		const values = {};
		row.querySelectorAll("[data-salary-change-field]").forEach((field) => {
			values[field.dataset.salaryChangeField] = field.type === "checkbox" ? Number(field.checked) : field.value;
		});
		return values;
	}

	set_salary_change_dirty_state(row, dirty, state = "") {
		row.dataset.salaryChangeDirty = dirty ? "1" : "0";
		row.classList.toggle("is-unsaved", dirty);
		const button = row.querySelector("[data-save-salary-change]");
		const indicator = row.querySelector("[data-salary-change-save-state]");
		if (state === "saving") {
			if (button) {
				button.disabled = true;
				button.textContent = __("提交中…");
			}
			if (indicator) indicator.textContent = __("提交中");
			return;
		}
		if (button) {
			button.disabled = false;
			button.textContent = __("保存并提交");
		}
		if (indicator) indicator.textContent = dirty ? __("未提交") : __("已提交");
	}

	refresh_salary_change_dirty_state(row) {
		this.set_salary_change_dirty_state(row, JSON.stringify(this.salary_change_values(row)) !== (row.dataset.salaryChangeSnapshot || ""));
	}

	salary_change_save_error_message(error) {
		const response = error?.responseJSON || error || {};
		const rawMessages = response._server_messages || response.message;
		const readMessage = (value) => {
			if (typeof value === "string") {
				try { return readMessage(JSON.parse(value)); } catch (_ignore) { return value; }
			}
			if (Array.isArray(value)) return value.map(readMessage).filter(Boolean).join("；");
			if (value && typeof value === "object") return value.message || value._message || "";
			return "";
		};
		return readMessage(rawMessages) || __("员工定薪提交失败，请检查必填项、权限或网络后重试");
	}

	save_employee_salary_change_row(row) {
		if (row.dataset.salaryChangeSaving === "1") return;
		const values = this.salary_change_values(row);
		if (!Number(values.base_salary)) {
			const baseSalary = row.querySelector('[data-salary-change-field="base_salary"]');
			baseSalary?.classList.add("is-required");
			baseSalary?.focus();
			frappe.show_alert({ message: __("请填写底薪后再保存"), indicator: "red" });
			return;
		}
		row.dataset.salaryChangeSaving = "1";
		this.set_salary_change_dirty_state(row, true, "saving");
		frappe.call({
			method: "hrms.api.payroll_input.update_employee_salary_change",
			args: { name: row.dataset.salaryChangeName, employee: row.dataset.salaryChangeEmployee, company: this.company, values: JSON.stringify(values) },
			callback: (response) => {
				const result = response.message || {};
				if (!result.name) {
					row.dataset.salaryChangeSaving = "";
					this.set_salary_change_dirty_state(row, true);
					frappe.show_alert({ message: __("提交未完成，请重试"), indicator: "red" });
					return;
				}
				row.dataset.salaryChangeName = result.name;
				row.querySelector("[data-salary-change-total]").textContent = result.full_salary ?? row.querySelector("[data-salary-change-total]").textContent;
				row.dataset.salaryChangeSnapshot = JSON.stringify(this.salary_change_values(row));
				row.dataset.salaryChangeSaving = "";
				this.set_salary_change_dirty_state(row, false);
				frappe.show_alert({ message: __("员工定薪已提交并生效"), indicator: "green" });
				this.process_readiness = {};
				this.load_salary_architecture_overview();
			},
			error: (error) => {
				row.dataset.salaryChangeSaving = "";
				this.set_salary_change_dirty_state(row, true);
				frappe.show_alert({ message: this.salary_change_save_error_message(error), indicator: "red" });
			},
		});
	}

	load_welfare_sources() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head">
				<h3>${frappe.utils.escape_html(__("福利扣款来源中心"))}</h3>
				<div>
					<button class="btn btn-default btn-sm" data-add-welfare-source>${frappe.utils.escape_html(__("新增来源"))}</button>
					<button class="btn btn-primary btn-sm" data-confirm-all-welfare-sources>${frappe.utils.escape_html(__("一键确认并同步"))}</button>
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
		this.body().querySelector("[data-confirm-all-welfare-sources]").addEventListener("click", () => this.confirm_all_welfare_sources());
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

	confirm_all_welfare_sources() {
		frappe.confirm(__("确认并同步本月全部福利/扣款来源？系统会先检查员工匹配，异常记录不会被确认。"), () => {
			frappe.call({
				method: "hrms.api.payroll_input.confirm_all_payroll_welfare_sources",
				args: this.scope_args(),
				freeze: true,
				freeze_message: __("正在确认并同步福利扣款来源…"),
				callback: (response) => {
					frappe.show_alert({ message: response.message?.message || __("福利扣款来源已确认并同步"), indicator: "green" });
					this.load_welfare_source_records();
				},
			});
		});
	}

	render_variable_import() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head hrms-payroll-step-head">
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("唯一补充数据入口"))}</span><h3>${frappe.utils.escape_html(__("月度增减项"))}</h3><p>${frappe.utils.escape_html(__("录入后系统自动显示异常；可直接更改或剔除异常记录，确认一次即可参与本月薪资计算。"))}</p></div>
			</div>
			<div class="hrms-payroll-input-panel">
				<div class="hrms-payroll-input-list-head"><div><h3>${frappe.utils.escape_html(__("本月导入批次"))}</h3><div class="text-muted">${frappe.utils.escape_html(__("可一键确认当前版本；已确认的错误版本可作废并保留追溯。"))}</div></div><div class="hrms-payroll-action-group"><button class="btn btn-default btn-sm" data-bulk-variable-upload>${frappe.utils.escape_html(__("批量导入表格"))}</button><button class="btn btn-default btn-sm" data-manage-import-batches>${frappe.utils.escape_html(__("批次管理"))}</button><button class="btn btn-danger btn-sm" data-test-monthly-reset>${frappe.utils.escape_html(__("测试清空本月全部薪酬"))}</button></div></div>
				<div class="hrms-payroll-variable-source-grid" data-variable-source-catalog><div class="text-muted">${frappe.utils.escape_html(__("正在读取来源配置…"))}</div></div>
			</div>
		`;
		// Keep the exact rendered node for the asynchronous catalog/batch callbacks.
		// On some Desk page refreshes the page body is replaced before a callback
		// resolves, so a broad wrapper query can miss the still-visible catalog.
		this.variable_source_catalog_target = this.body()?.querySelector("[data-variable-source-catalog]") || null;
		this.body().querySelector("[data-bulk-variable-upload]")?.addEventListener("click", () => this.open_bulk_variable_uploader());
		this.body().querySelector("[data-manage-import-batches]")?.addEventListener("click", () => this.open_import_batch_manager());
		this.body().querySelector("[data-test-monthly-reset]")?.addEventListener("click", () => this.open_test_monthly_reset_dialog());
		this.load_variable_source_catalog();
		this.load_import_batches();
	}

	get_variable_source_catalog_target() {
		if (this.variable_source_catalog_target?.isConnected) return this.variable_source_catalog_target;
		this.variable_source_catalog_target = this.body()?.querySelector("[data-variable-source-catalog]")
			|| this.wrapper.querySelector("[data-variable-source-catalog]")
			|| null;
		return this.variable_source_catalog_target;
	}

	calculate_monthly_payroll() {
		if (!this.ensure_payroll_generation_scope(__("薪资计算"))) return;
		frappe
			.call({
				method: "hrms.api.payroll_input.generate_payroll_input_records",
				args: this.scope_args(),
				freeze: true,
				freeze_message: __("正在生成薪资输入表..."),
			})
			.then(() => frappe.call({
				method: "hrms.api.payroll_input.generate_payroll_settlement_records",
				args: this.scope_args(),
				freeze: true,
				freeze_message: __("正在进行薪资计算..."),
			}))
			.then(() => {
				frappe.show_alert({ message: __("薪资计算完成"), indicator: "green" });
				this.route_to_tab("monthly-workbench");
			})
			.catch((error) => {
				console.error("Monthly payroll calculation failed", error);
			});
	}

	load_variable_source_catalog() {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_variable_source_types",
			callback: (response) => {
				this.variable_source_catalog = Array.isArray(response.message) ? response.message : [];
				const target = this.get_variable_source_catalog_target();
				if (target) this.render_variable_source_catalog(target);
			},
			error: (error) => {
				console.error("Payroll variable source catalog failed to load", error);
				const target = this.get_variable_source_catalog_target();
				if (!target) return;
				target.innerHTML = `<div class="alert alert-warning hrms-payroll-variable-source-load-error"><span>${frappe.utils.escape_html(__("来源配置加载失败，请重试。"))}</span><button class="btn btn-default btn-xs" type="button" data-retry-variable-source-catalog>${frappe.utils.escape_html(__("重新加载"))}</button></div>`;
				target.querySelector("[data-retry-variable-source-catalog]")?.addEventListener("click", () => this.load_variable_source_catalog());
			},
		});
	}

	render_variable_source_catalog(target) {
		try {
			this.render_variable_source_catalog_content(target);
		} catch (error) {
			console.error("Payroll variable source catalog failed to render", error);
			this.render_variable_source_catalog_recovery(target);
		}
	}

	render_variable_source_catalog_recovery(target) {
		const sources = Array.isArray(this.variable_source_catalog) ? this.variable_source_catalog : [];
		const sourceLabel = (source) => source.source_code === "attendance_final" ? __("考勤终稿") : (source.source_name || source.source_code || source.name);
		const openSourceCode = this.open_source_card_code;
		const openSource = sources.find((source) => (source.source_code || source.name) === openSourceCode);
		const openBatch = (this.variable_import_batches || []).find((batch) => batch.source_type === openSourceCode && Number(batch.is_selected));
		const batchState = (source, batch) => {
			if (batch) return batch.status === "已确认" ? __("已确认") : __("待确认 / 有异常可修改");
			if (source.target_area === "考勤继承") return __("自动继承");
			if (source.target_area === "员工定薪") return __("员工定薪");
			return __("未上传");
		};
		const detail = !openSource
			? ""
			: openSource.target_area === "考勤继承"
				? `<section class="hrms-payroll-source-detail-panel" data-recovery-attendance-preview><div class="hrms-payroll-source-empty-detail text-muted">${frappe.utils.escape_html(__("正在读取已锁定的考勤终稿预览…"))}</div></section>`
				: openBatch
					? `<section class="hrms-payroll-source-detail-panel"><div class="hrms-payroll-source-detail-toolbar"><div class="hrms-payroll-source-detail-summary">${frappe.utils.escape_html(`${sourceLabel(openSource)} · ${__("匹配 {0} · 待处理 {1}", [openBatch.matched_rows || 0, openBatch.unmatched_rows || 0])}`)}</div><div class="hrms-payroll-source-detail-actions"><button class="btn btn-default btn-sm" data-recovery-replace-source="${frappe.utils.escape_html(openSourceCode)}">${frappe.utils.escape_html(__("上传"))}</button>${["待确认", "待审核"].includes(openBatch.status) ? `<button class="btn btn-primary btn-sm" data-recovery-confirm-source="${frappe.utils.escape_html(openBatch.name)}" data-confirm-empty="${Number(openBatch.can_confirm_empty || 0)}" ${openBatch.can_confirm ? "" : "disabled"}>${frappe.utils.escape_html(openBatch.can_confirm_empty ? __("确认本月无数据") : __("确认入账"))}</button>` : ""}</div></div><div data-source-card-records="${frappe.utils.escape_html(openBatch.name)}" data-source-card-editable="${openBatch.status === "已确认" ? "0" : "1"}"><div class="text-muted">${frappe.utils.escape_html(__("正在加载本月版本明细…"))}</div></div></section>`
					: `<section class="hrms-payroll-source-detail-panel"><div class="hrms-payroll-source-empty-detail text-muted">${frappe.utils.escape_html(__("暂无本月明细，请上传对应来源文件。"))}</div></section>`;
		target.innerHTML = `<div class="hrms-payroll-variable-source-workspace ${detail ? "is-detail-open" : ""}"><div class="hrms-payroll-variable-source-grid">${
			sources.map((source) => {
				const code = source.source_code || source.name || "";
				const selectedBatch = (this.variable_import_batches || []).find((batch) => batch.source_type === code && Number(batch.is_selected));
				return `<button type="button" class="hrms-payroll-variable-source ${openSourceCode === code ? "is-active" : ""}" data-recover-variable-source="${frappe.utils.escape_html(code)}" aria-current="${openSourceCode === code ? "page" : "false"}" aria-expanded="${openSourceCode === code ? "true" : "false"}"><span class="hrms-payroll-variable-source-name">${frappe.utils.escape_html(sourceLabel(source))}</span><span class="hrms-payroll-variable-source-state">${frappe.utils.escape_html(batchState(source, selectedBatch))}</span></button>`;
			}).join("") || `<div class="text-muted">${frappe.utils.escape_html(__("暂无启用的来源类型，请由管理员维护。"))}</div>`
		}<div class="hrms-payroll-variable-source-actions"><button class="btn btn-primary btn-sm" data-calculate-monthly-payroll>${frappe.utils.escape_html(__("薪资计算"))}</button><button class="btn btn-default btn-sm" data-retry-variable-source-catalog>${frappe.utils.escape_html(__("重新加载"))}</button></div></div>${detail}</div>`;
		target.querySelector("[data-retry-variable-source-catalog]")?.addEventListener("click", () => this.load_variable_source_catalog());
		target.querySelector("[data-calculate-monthly-payroll]")?.addEventListener("click", () => this.calculate_monthly_payroll());
		target.querySelectorAll("[data-source-card-records]").forEach((details) => this.load_source_card_records(details.dataset.sourceCardRecords, details));
		target.querySelectorAll("[data-recovery-confirm-source]").forEach((button) => {
			button.addEventListener("click", () => this.confirm_import_batch(button.dataset.recoveryConfirmSource, Number(button.dataset.confirmEmpty || 0)));
		});
		target.querySelectorAll("[data-recovery-replace-source]").forEach((button) => {
			button.addEventListener("click", () => {
				const source = sources.find((item) => (item.source_code || item.name) === button.dataset.recoveryReplaceSource);
				this.selected_payroll_source = source ? { ...source, label: source.source_name, source_code: source.source_code || source.name } : null;
				this.open_uploader();
			});
		});
		target.querySelectorAll("[data-recover-variable-source]").forEach((button) => {
			button.addEventListener("click", () => {
				const source = sources.find((item) => (item.source_code || item.name) === button.dataset.recoverVariableSource);
				if (!source) return;
				if (source.target_area === "考勤继承") {
					this.open_source_card_code = source.source_code || source.name || "";
					this.render_variable_source_catalog_recovery(target);
					this.load_recovery_attendance_final_preview(target);
					return;
				}
				if (source.target_area === "员工定薪") {
					this.route_to_tab("salary-assignments");
					return;
				}
				this.selected_payroll_source = { ...source, label: source.source_name, source_code: source.source_code || source.name };
				const selectedBatch = (this.variable_import_batches || []).find((batch) => batch.source_type === this.selected_payroll_source.source_code && Number(batch.is_selected));
				if (selectedBatch) {
					this.open_source_card_code = this.selected_payroll_source.source_code;
					this.render_variable_source_catalog_recovery(target);
					return;
				}
				this.open_uploader();
			});
		});
	}

	load_recovery_attendance_final_preview(target) {
		const previewTarget = target.querySelector("[data-recovery-attendance-preview]");
		if (!previewTarget) return;
		previewTarget.hidden = false;
		previewTarget.innerHTML = `<div class="hrms-payroll-source-empty-detail text-muted">${frappe.utils.escape_html(__("正在读取已锁定的考勤终稿预览…"))}</div>`;
		frappe.call({
			method: "hrms.api.attendance_processing_center.get_monthly_final_preview",
			args: { company: this.company, attendance_month: this.payroll_month, kind: "finance" },
			callback: (response) => {
				const preview = response.message || { available: false, reason: __("未取得考勤终稿预览。") };
				if (previewTarget.isConnected) previewTarget.innerHTML = this.render_attendance_final_preview(preview);
			},
			error: () => {
				if (previewTarget.isConnected) previewTarget.innerHTML = `<div class="hrms-payroll-source-empty-detail text-danger">${frappe.utils.escape_html(__("读取考勤终稿预览失败，请重新加载后再试。"))}</div>`;
			},
		});
	}

	render_variable_source_catalog_content(target) {
		const sources = this.variable_source_catalog || [];
		const source_label = (source) => ((source.source_code || source.name) === "attendance_final" ? __("考勤终稿") : (source.source_name || source.source_code || source.name));
		const openSourceCode = this.open_source_card_code;
		const openSource = sources.find((item) => (item.source_code || item.name) === openSourceCode);
		const isAttendanceFinal = (openSource?.source_code || openSource?.name) === "attendance_final";
		const previewScope = this.attendance_dependency_key();
		const attendancePreview = isAttendanceFinal && this.attendance_final_preview?._scope === previewScope ? this.attendance_final_preview : null;
		const openBatch = (this.variable_import_batches || []).find((batch) => batch.source_type === openSourceCode && Number(batch.is_selected));
		const openPreview = this.variable_import_preview?._source_code === openSourceCode ? this.variable_import_preview : null;
		const openReviewPending = ["待确认", "待审核"].includes(openBatch?.status);
		const isEditingSource = Boolean(openBatch) && openBatch.status !== "已确认" && (this.editing_source_card_code === openSourceCode || openReviewPending);
		let openSourceActions = "";
		const sourceCards = sources.map((source) => {
			const code = source.source_code || source.name;
			const salaryTarget = source.target_area === "员工定薪";
			const inheritedTarget = source.target_area === "考勤继承";
			const selectedBatch = (this.variable_import_batches || []).find((batch) => batch.source_type === code && Number(batch.is_selected));
			const previewResult = this.variable_import_preview?._source_code === code ? this.variable_import_preview : null;
			const reviewPending = ["待确认", "待审核"].includes(selectedBatch?.status);
			const selectedState = selectedBatch?.status === "已确认" ? __("已确认") : reviewPending ? __("待确认 / 有异常可修改") : (selectedBatch?.status || __("未上传"));
			const actions = salaryTarget
				? `<button class="btn btn-default btn-xs" data-select-variable-source="${frappe.utils.escape_html(code)}" data-source-target="salary">${frappe.utils.escape_html(__("前往员工定薪"))}</button>`
				: inheritedTarget
					? `<button class="btn btn-default btn-xs" data-refresh-attendance-final-preview>${frappe.utils.escape_html(__("刷新考勤终稿"))}</button>`
					: selectedBatch
						? `<button class="btn btn-default btn-xs" data-upload-source-version="${frappe.utils.escape_html(code)}">${frappe.utils.escape_html(__("上传"))}</button>`
						: previewResult
							? `<button class="btn btn-default btn-xs" data-select-variable-source="${frappe.utils.escape_html(code)}" data-source-target="variables">${frappe.utils.escape_html(__("上传"))}</button>`
							: `<button class="btn btn-primary btn-xs" data-select-variable-source="${frappe.utils.escape_html(code)}" data-source-target="variables">${frappe.utils.escape_html(__("上传"))}</button>`;
			const signatureAction = selectedBatch && PAYROLL_SIGNATURE_SOURCE_CODES.has(code)
				? `<button class="btn btn-default btn-xs" data-download-source-signature-sheet="${frappe.utils.escape_html(selectedBatch.name)}" data-download-source-signature-source="${frappe.utils.escape_html(code)}">${frappe.utils.escape_html(__("导出"))}</button>`
				: "";
			const sourceActions = `${actions}${signatureAction}${code === "housing_allowance" ? `<button class="btn btn-default btn-xs" data-download-housing-base-template>${frappe.utils.escape_html(__("下载一阶模板"))}</button>` : ""}`;
			if (code === openSourceCode) {
				openSourceActions = sourceActions;
			}
			const compactStatus = selectedBatch
				? selectedState
				: salaryTarget
					? __("员工定薪")
					: inheritedTarget
						? (this.attendance_dependency?.ready ? __("已锁定") : __("待锁定"))
						: __("未上传");
			return `<button type="button" class="hrms-payroll-variable-source ${this.selected_payroll_source?.source_code === code ? "is-selected" : ""} ${openSourceCode === code ? "is-active" : ""}" data-open-source-card="${frappe.utils.escape_html(code)}" aria-current="${openSourceCode === code ? "page" : "false"}" aria-expanded="${openSourceCode === code ? "true" : "false"}" aria-label="${frappe.utils.escape_html(__("打开{0}明细", [source_label(source)]))}">
				<span class="hrms-payroll-variable-source-name">${frappe.utils.escape_html(source_label(source))}</span>
				<span class="hrms-payroll-variable-source-state ${source.required_for_payroll ? "is-required" : ""}">${frappe.utils.escape_html(compactStatus)}</span>
			</button>`;
		}).join("") || `<div class="text-muted">${frappe.utils.escape_html(__("暂无启用的来源类型，请由管理员维护。"))}</div>`;
		const sourceSummary = openBatch
			? `${source_label(openSource)} · ${__("匹配 {0} · 待处理 {1}", [openBatch.matched_rows || 0, openBatch.unmatched_rows || 0])}`
			: source_label(openSource);
		const detailPanel = openSource
			? `<section class="hrms-payroll-source-detail-panel" data-source-detail-panel>
				<div class="hrms-payroll-source-detail-toolbar"><div class="hrms-payroll-source-detail-summary">${frappe.utils.escape_html(sourceSummary)}</div><div class="hrms-payroll-source-detail-actions"><div class="hrms-payroll-action-group">${openSourceActions}</div>${openReviewPending ? `<button class="btn btn-primary btn-sm" data-confirm-source-card="${frappe.utils.escape_html(openBatch.name)}" data-confirm-empty="${Number(openBatch.can_confirm_empty || 0)}" ${openBatch.can_confirm ? "" : "disabled"}>${frappe.utils.escape_html(openBatch.can_confirm_empty ? __("确认本月无数据") : __("确认入账"))}</button>` : ""}</div></div>
				${openPreview ? `<div class="hrms-payroll-source-card-preview" data-source-card-preview>${this.render_preview(openPreview)}</div>` : isAttendanceFinal ? (attendancePreview ? this.render_attendance_final_preview(attendancePreview) : `<div class="hrms-payroll-source-empty-detail text-muted">${frappe.utils.escape_html(__("正在读取已锁定的考勤终稿预览…"))}</div>`) : openBatch ? `<div data-source-card-records="${frappe.utils.escape_html(openBatch.name)}" data-source-card-editable="${isEditingSource ? "1" : "0"}"><div class="text-muted">${frappe.utils.escape_html(__("正在加载本月版本明细…"))}</div></div>` : `<div class="hrms-payroll-source-empty-detail text-muted">${frappe.utils.escape_html(__("暂无本月明细。点击上方操作继续处理。"))}</div>`}
			</section>`
			: "";
		target.innerHTML = `<div class="hrms-payroll-variable-source-workspace ${detailPanel ? "is-detail-open" : ""}"><div class="hrms-payroll-variable-source-grid">${sourceCards}<div class="hrms-payroll-variable-source-actions"><button class="btn btn-primary btn-sm" data-calculate-monthly-payroll>${frappe.utils.escape_html(__("薪资计算"))}</button></div></div>${detailPanel}</div>`;
		target.querySelector("[data-calculate-monthly-payroll]")?.addEventListener("click", () => this.calculate_monthly_payroll());
		target.querySelectorAll("[data-select-variable-source]").forEach((button) => {
			button.addEventListener("click", () => {
				if (button.dataset.sourceTarget === "salary") {
					frappe.show_alert({ message: __("薪资异动在员工定薪区域审核，不会作为月度变量直接入账。"), indicator: "blue" });
					this.route_to_tab("salary-assignments");
					return;
				}
				if (button.dataset.sourceTarget === "attendance") {
					frappe.show_alert({ message: __("考勤终稿由考勤假期模块锁定后自动继承；全勤奖和住房补贴均在考勤补充来源中独立确认，无需在此上传。"), indicator: "blue" });
					return;
				}
				const source = this.variable_source_catalog.find((item) => (item.source_code || item.name) === button.dataset.selectVariableSource);
				this.selected_payroll_source = source ? { ...source, label: source.source_name, source_code: source.source_code || source.name } : null;
				this.variable_import_preview = null;
				this.open_source_card_code = button.dataset.selectVariableSource;
				this.editing_source_card_code = "";
				this.render_variable_source_catalog(target);
				const selectedBatch = (this.variable_import_batches || []).find((batch) => batch.source_type === this.selected_payroll_source?.source_code && Number(batch.is_selected));
				if (!selectedBatch) this.open_uploader();
			});
		});
		target.querySelectorAll("[data-refresh-attendance-final-preview]").forEach((button) => {
			button.addEventListener("click", () => this.load_attendance_final_preview(target, { force: true }));
		});
		target.querySelectorAll("[data-download-source-signature-sheet]").forEach((button) => {
			button.addEventListener("click", () => {
				const sourceCode = button.dataset.downloadSourceSignatureSource;
				const contributionCategory = sourceCode === "social_insurance" ? "社保" : sourceCode === "housing_fund" ? "公积金" : "";
				const exportView = contributionCategory ? this.contribution_view_by_category?.[contributionCategory] || "personal" : "personal";
				this.download_source_signature_sheet(button.dataset.downloadSourceSignatureSheet, exportView);
			});
		});
		target.querySelectorAll("[data-open-source-card]").forEach((card) => {
			const openCard = () => {
				const code = card.dataset.openSourceCard;
				const source = this.variable_source_catalog.find((item) => (item.source_code || item.name) === code);
				this.selected_payroll_source = source ? { ...source, label: source.source_name, source_code: source.source_code || source.name } : null;
				const closing = this.open_source_card_code === code;
				this.open_source_card_code = closing ? "" : code;
				if (closing) this.editing_source_card_code = "";
				this.render_variable_source_catalog(target);
			};
			card.addEventListener("click", openCard);
		});
		target.querySelectorAll("[data-upload-source-version]").forEach((button) => {
			button.addEventListener("click", () => {
				const source = this.variable_source_catalog.find((item) => (item.source_code || item.name) === button.dataset.uploadSourceVersion);
				this.selected_payroll_source = source ? { ...source, label: source.source_name, source_code: source.source_code || source.name } : null;
				this.variable_import_preview = null;
				this.open_source_card_code = "";
				this.editing_source_card_code = "";
				this.open_uploader();
			});
		});
		target.querySelectorAll("[data-confirm-source-card]").forEach((button) => {
			button.addEventListener("click", () => this.confirm_import_batch(button.dataset.confirmSourceCard, Number(button.dataset.confirmEmpty || 0)));
		});
		target.querySelectorAll("[data-revoke-source-confirmation]").forEach((button) => {
			button.addEventListener("click", () => this.void_import_batch(button.dataset.revokeSourceConfirmation, true));
		});
		target.querySelectorAll("[data-create-editable-source-card]").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.stopPropagation();
				this.create_editable_batch_version(button.dataset.createEditableSourceCard);
			});
		});
		target.querySelectorAll("[data-edit-source-card]").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.stopPropagation();
				if (button.dataset.createEditableSourceCard) return;
				this.open_source_card_code = button.dataset.editSourceCard;
				this.editing_source_card_code = button.dataset.editSourceCard;
				this.render_variable_source_catalog(target);
			});
		});
		target.querySelectorAll("[data-use-source-card-version]").forEach((button) => {
			button.addEventListener("click", () => {
				const selectedVersion = target.querySelector(`[data-source-card-version-select="${button.dataset.useSourceCardVersion}"]`)?.value;
				if (selectedVersion) this.select_import_batch_version(selectedVersion);
			});
		});
		target.querySelectorAll("[data-finish-source-edit]").forEach((button) => {
			button.addEventListener("click", () => {
				this.editing_source_card_code = "";
				this.render_variable_source_catalog(target);
			});
		});
		target.querySelectorAll("[data-download-housing-base-template]").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.stopPropagation();
				this.download_housing_allowance_base_template();
			});
		});
		target.querySelectorAll("[data-source-card-records]").forEach((details) => {
			this.load_source_card_records(details.dataset.sourceCardRecords, details);
		});
		if (isAttendanceFinal && !attendancePreview) this.load_attendance_final_preview(target);
		target.querySelectorAll("[data-import]").forEach((button) => {
			button.addEventListener("click", () => this.import_payroll_variable_workbook());
		});
	}

	render_attendance_final_preview(preview) {
		if (!preview.available) return `<div class="hrms-payroll-source-empty-detail text-muted">${frappe.utils.escape_html(preview.reason || __("当前没有可预览的锁定考勤终稿。"))}</div>`;
		const columns = preview.columns || [];
		const rows = preview.rows || [];
		return `<div class="hrms-payroll-source-card-preview"><div class="hrms-payroll-preview-summary"><strong>${frappe.utils.escape_html(__("锁定终稿预览"))}</strong><span class="is-valid">${frappe.utils.escape_html(__("共 {0} 人", [rows.length]))}</span><span>${frappe.utils.escape_html(__("锁定快照：{0}", [preview.locked_snapshot_version || "-"]))}</span></div><div class="hrms-payroll-table-wrap"><table class="table table-bordered hrms-payroll-input-table"><thead><tr>${columns.map((column) => `<th>${frappe.utils.escape_html(__(column.label || column.field))}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${columns.map((column) => `<td>${frappe.utils.escape_html(row[column.field] ?? "")}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${columns.length || 1}" class="text-muted">${frappe.utils.escape_html(__("当前锁定版本没有可展示的数据。"))}</td></tr>`}</tbody></table></div></div>`;
	}

	load_attendance_final_preview(target, { force = false } = {}) {
		const scope = this.attendance_dependency_key();
		if (!this.company || !this.payroll_month || (!force && this.attendance_final_preview?._scope === scope)) return;
		if (this.attendance_final_preview_loading_scope === scope) return;
		this.attendance_final_preview_loading_scope = scope;
		frappe.call({
			method: "hrms.api.attendance_processing_center.get_monthly_final_preview",
			args: { company: this.company, attendance_month: this.payroll_month, kind: "finance" },
			callback: (response) => {
				this.attendance_final_preview_loading_scope = "";
				this.attendance_final_preview = { ...(response.message || { available: false, reason: __("未取得考勤终稿预览。") }), _scope: scope };
				if (target?.isConnected && this.open_source_card_code === "attendance_final") this.render_variable_source_catalog(target);
			},
			error: () => {
				this.attendance_final_preview_loading_scope = "";
				this.attendance_final_preview = { available: false, reason: __("读取考勤终稿预览失败，请刷新后重试。"), _scope: scope };
				if (target?.isConnected && this.open_source_card_code === "attendance_final") this.render_variable_source_catalog(target);
			},
		});
	}

	download_housing_allowance_base_template() {
		frappe.call({
			method: "hrms.api.payroll_input.create_housing_allowance_base_data_template_file",
			args: { company: this.company, payroll_month: this.payroll_month },
			freeze: true,
			freeze_message: __("正在生成住房补贴一阶数据模板..."),
			callback: (response) => {
				const file_url = response.message?.file_url;
				this.download_generated_file(file_url, response.message?.file_name);
			},
		});
	}

	download_source_signature_sheet(batchName, exportView = "personal") {
		if (!batchName) return;
		frappe.call({
			method: "hrms.api.payroll_input.download_payroll_source_signature_sheet",
			args: { batch_name: batchName, company: this.company, payroll_month: this.payroll_month, export_view: exportView },
			freeze: true,
			freeze_message: __(exportView === "department" ? "正在生成部门汇总表..." : "正在生成员工签字表..."),
			callback: (response) => {
				const fileUrl = response.message?.file_url;
				this.download_generated_file(fileUrl, response.message?.file_name);
			},
		});
	}

	create_editable_batch_version(batch_name) {
		frappe.call({
			method: "hrms.api.payroll_input.create_editable_payroll_variable_batch_version",
			args: { batch_name, company: this.company, payroll_month: this.payroll_month },
			freeze: true,
			freeze_message: __("正在解锁当前数据…"),
			callback: (response) => {
				const sourceCode = response.message?.source_type || "";
				this.open_source_card_code = sourceCode;
				this.editing_source_card_code = sourceCode;
				frappe.show_alert({ message: response.message?.message || __("已创建可修改版本；完成修改后确认入账即可"), indicator: "green" });
				this.load_import_batches();
			},
		});
	}

	load_source_card_records(batch_name, target) {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_variable_records",
			args: this.scope_args({ import_batch: batch_name, page_length: 5000 }),
			callback: (response) => {
				if (target?.isConnected) this.render_variable_records(target, response.message || [], { editable: target.dataset.sourceCardEditable === "1" });
			},
		});
	}

	render_preview(result) {
		const rows = result.preview_rows || [];
		const housingRows = rows.filter((row) => ["housing_allowance", "housing_allowance_base"].includes(row.source_kind));
		const hasHousingBase = housingRows.some((row) => row.calculation_mode === "一阶数据系统计算");
		const hasHousingDirect = housingRows.some((row) => row.calculation_mode === "二阶金额直用");
		return `
			${result.blocked ? `<div class="alert alert-warning">${frappe.utils.escape_html(result.blocked_message || __("该文件不允许在月度增减项中导入"))}</div>` : ""}
			${hasHousingBase ? `<div class="alert alert-info"><strong>${frappe.utils.escape_html(__("已识别住房补贴一阶数据"))}</strong> ${frappe.utils.escape_html(__("系统会按当前租房补贴规则生成二阶应发金额；资格不符合者保留为不参与计算。"))}</div>` : ""}
			${hasHousingDirect ? `<div class="alert alert-info"><strong>${frappe.utils.escape_html(__("已识别住房补贴二阶数据"))}</strong> ${frappe.utils.escape_html(__("文件已含金额，系统只校验员工与金额；确认后直接参与薪资计算。"))}</div>` : ""}
			<div class="hrms-payroll-preview-summary"><strong>${frappe.utils.escape_html(__("解析预览"))}</strong><span class="is-valid">${frappe.utils.escape_html(__("通过 {0}", [result.valid_rows || 0]))}</span><span class="is-warning">${frappe.utils.escape_html(__("警告 {0}", [result.warning_rows || 0]))}</span><span class="is-error">${frappe.utils.escape_html(__("错误 {0}", [result.error_rows || 0]))}</span></div>
			<div class="hrms-payroll-table-wrap"><table class="table table-bordered hrms-payroll-input-table">
				<thead><tr><th>${frappe.utils.escape_html(__("工作表"))}</th><th>${frappe.utils.escape_html(__("工号/姓名"))}</th><th>${frappe.utils.escape_html(__("增减项目"))}</th><th>${frappe.utils.escape_html(__("金额"))}</th><th>${frappe.utils.escape_html(__("计算方式"))}</th><th>${frappe.utils.escape_html(__("校验 / 参与"))}</th><th>${frappe.utils.escape_html(__("原因"))}</th></tr></thead>
				<tbody>${rows.length ? rows.map((row) => `<tr class="is-${row.validation_status === "错误" ? "error" : row.validation_status === "警告" ? "warning" : "valid"}"><td>${frappe.utils.escape_html(row.sheet_name || "")}</td><td>${frappe.utils.escape_html(row.employee_code || row.employee_name || "")}</td><td>${frappe.utils.escape_html(row.variable_type || "")}</td><td>${frappe.utils.escape_html(this.format_money(row.amount))}</td><td>${frappe.utils.escape_html(row.calculation_mode || "-")}</td><td>${frappe.utils.escape_html(row.participation_status || row.validation_status || "")}</td><td>${frappe.utils.escape_html(row.calculation_reason || row.validation_message || "-")}</td></tr>`).join("") : `<tr><td colspan="7" class="text-muted">${frappe.utils.escape_html(__("没有解析出可导入记录"))}</td></tr>`}</tbody>
			</table></div>
			<div class="hrms-payroll-confirm-note">${frappe.utils.escape_html(__("导入后会自动标出异常；修正或剔除异常记录后，点击一次“确认入账”即可。"))}</div>
			<button class="btn btn-primary" data-import ${result.blocked ? "disabled" : ""}>${frappe.utils.escape_html(__("录入数据"))}</button>
		`;
	}

	preview_payroll_variable_workbook() {
		frappe
			.call({
				method: "hrms.api.payroll_input.preview_payroll_variable_workbook",
				args: { file_url: this.file_url, company: this.company, payroll_month: this.payroll_month },
				freeze: true,
				freeze_message: __("正在预览薪资变量..."),
			})
			.then((response) => {
				this.variable_import_preview = { ...(response.message || {}), _source_code: this.selected_payroll_source?.source_code || "" };
				this.open_source_card_code = this.selected_payroll_source?.source_code || "";
				const target = this.wrapper.querySelector("[data-variable-source-catalog]");
				if (target) this.render_variable_source_catalog(target);
			});
	}

	import_payroll_variable_workbook() {
		if (!this.file_url || !this.selected_payroll_source?.source_code) {
			frappe.msgprint(__("请从对应来源卡重新选择文件并完成预览。"));
			return;
		}
		frappe
			.call({
				method: "hrms.api.payroll_input.import_payroll_variable_workbook",
				args: this.scope_args({ file_url: this.file_url, source_type: this.selected_payroll_source?.source_code || "" }),
				freeze: true,
				freeze_message: __("正在导入薪资变量..."),
			})
			.then(() => {
				frappe.show_alert({ message: __("数据已录入；异常会置顶显示，可直接修改或剔除后确认入账。"), indicator: "orange" });
				this.file_url = "";
				this.variable_import_preview = null;
				// Keep the source open after import so the persisted batch, including
				// any validation error, is immediately visible instead of looking as
				// though the upload did not take effect.
				this.open_source_card_code = this.selected_payroll_source?.source_code || "";
				this.load_import_batches();
			});
	}

	load_import_batches() {
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_variable_import_batches",
			args: this.scope_args(),
			callback: (response) => {
				this.variable_import_batches = Array.isArray(response.message) ? response.message : [];
				const catalog = this.get_variable_source_catalog_target();
				if (catalog) this.render_variable_source_catalog(catalog);
			},
		});
	}

	open_import_batch_manager() {
		const dialog = new frappe.ui.Dialog({
			title: __("批次管理"),
			size: "large",
			fields: [{ fieldname: "batch_manager", fieldtype: "HTML" }],
		});
		const target = dialog.fields_dict.batch_manager.$wrapper.get(0);
		const refresh = () => this.load_import_batch_history(target, refresh);
		dialog.show();
		refresh();
	}

	open_test_monthly_reset_dialog() {
		const escape = (value) => frappe.utils.escape_html(String(value ?? ""));
		const dialog = new frappe.ui.Dialog({
			title: __("测试清空本月全部薪酬"),
			size: "large",
			fields: [
				{ fieldtype: "HTML", fieldname: "warning", options: `<div class="alert alert-danger"><strong>${escape(__("仅限测试数据"))}</strong><br>${escape(__("将清空本公司当前月份的全部薪酬数据，包括定薪、福利来源、月度增减项、薪资输入和结算结果；不会删除花名册、薪资架构或原始附件。"))}</div>` },
				{ fieldtype: "Data", fieldname: "payroll_month", label: __("月份"), default: this.payroll_month, read_only: 1 },
				{ fieldtype: "HTML", fieldname: "reset_preview", options: `<div class="text-muted">${escape(__("点击“预览影响”后查看全公司本月将删除的数据。"))}</div>` },
				{ fieldtype: "Check", fieldname: "test_mode", label: __("我确认这是测试数据，允许永久删除"), default: 0 },
				{ fieldtype: "Data", fieldname: "confirmation", label: __("确认语"), description: __("预览后将显示必须输入的确认语。") },
			],
		});
		const preview = () => {
			dialog.fields_dict.reset_preview.$wrapper.html(`<div class="text-muted">${escape(__("正在计算影响范围…"))}</div>`);
			frappe.call({
				method: "hrms.api.payroll_input.preview_test_monthly_data_reset",
				args: { company: this.company, payroll_month: this.payroll_month, department: "", area: "payroll" },
				freeze: true,
				freeze_message: __("正在预览测试清空影响…"),
			}).then((response) => {
				const result = response.message || {};
				dialog.__test_monthly_reset_preview = result;
				const rows = (result.records || []).map((row) => `<tr><td>${escape(row.doctype)}</td><td class="text-right">${escape(row.count)}</td></tr>`).join("");
				dialog.fields_dict.reset_preview.$wrapper.html(`<div class="alert alert-warning"><strong>${escape(__("将删除 {0} 条记录", [result.total_count || 0]))}</strong><table class="table table-bordered table-sm mt-2"><thead><tr><th>${escape(__("数据类型"))}</th><th>${escape(__("数量"))}</th></tr></thead><tbody>${rows || `<tr><td colspan="2" class="text-muted">${escape(__("没有找到可清空记录"))}</td></tr>`}</tbody></table><p>${(result.warnings || []).map((item) => escape(item)).join("<br>")}</p><p><strong>${escape(__("确认语："))}</strong>${escape(result.confirmation || "")}</p></div>`);
				dialog.set_primary_action(__("输入确认语后清空"), execute);
			});
		};
		const execute = () => {
			const values = dialog.get_values();
			const result = dialog.__test_monthly_reset_preview;
			if (!result) return preview();
			if (!values?.test_mode || values.confirmation !== result.confirmation) {
				frappe.msgprint({ title: __("确认不足"), indicator: "red", message: __("请勾选测试确认并完整输入预览中显示的确认语。") });
				return;
			}
			frappe.call({
				method: "hrms.api.payroll_input.reset_test_monthly_data",
				args: { company: this.company, payroll_month: this.payroll_month, department: "", area: result.area, confirmation: values.confirmation, test_mode: values.test_mode },
				freeze: true,
				freeze_message: __("正在清空测试月度数据…"),
				callback: (response) => {
					dialog.hide();
					frappe.show_alert({ message: response.message?.message || __("测试月度数据已清空"), indicator: "orange" });
					this.process_readiness = {};
					this.load_active_tab();
				},
			});
		};
		dialog.set_primary_action(__("预览影响"), preview);
		dialog.show();
	}

	load_import_batch_history(target, refresh) {
		if (!target?.isConnected) return;
		target.innerHTML = `<div class="text-muted">${frappe.utils.escape_html(__("正在读取导入记录…"))}</div>`;
		frappe.call({
			method: "hrms.api.payroll_input.list_payroll_variable_import_batches",
			args: { company: this.company, payroll_month: "", page_length: 200 },
			callback: (response) => {
				if (target?.isConnected) this.render_import_batch_manager(target, response.message || [], refresh);
			},
		});
	}

	render_import_batch_manager(target, rows, refresh) {
		const currentRows = rows.filter((row) => row.payroll_month === this.payroll_month);
		target.innerHTML = `
			<div class="hrms-payroll-batch-manager">
				<div class="hrms-payroll-batch-manager-head"><span>${frappe.utils.escape_html(__("当前月份 {0} 条 · 历史记录 {1} 条", [currentRows.length, Math.max(0, rows.length - currentRows.length)]))}</span><button class="btn btn-default btn-sm" type="button" data-refresh-import-batch-history>${frappe.utils.escape_html(__("刷新"))}</button></div>
				<div class="hrms-payroll-table-wrap hrms-payroll-batch-manager-table"><table class="table table-bordered hrms-payroll-input-table">
					<thead><tr><th>${frappe.utils.escape_html(__("月份"))}</th><th>${frappe.utils.escape_html(__("来源类型"))}</th><th>${frappe.utils.escape_html(__("来源文件"))}</th><th>${frappe.utils.escape_html(__("记录状态"))}</th><th>${frappe.utils.escape_html(__("导入追溯"))}</th><th>${frappe.utils.escape_html(__("状态"))}</th><th>${frappe.utils.escape_html(__("操作"))}</th></tr></thead>
					<tbody>${rows.length ? rows.map((row) => `<tr class="${row.payroll_month === this.payroll_month ? "is-current" : ""}"><td>${frappe.utils.escape_html(row.payroll_month || "-")}${row.payroll_month === this.payroll_month ? `<small class="d-block text-success">${frappe.utils.escape_html(__("当前月份"))}</small>` : ""}</td><td>${frappe.utils.escape_html(row.source_type_label || row.source_type || __("未分类"))}</td><td>${frappe.utils.escape_html(row.source_file_label || row.source_file || "-")}</td><td>${frappe.utils.escape_html(__("匹配 {0} · 待处理 {1}", [row.matched_rows || 0, row.unmatched_rows || 0]))}<small class="d-block text-muted">${frappe.utils.escape_html(__("共 {0} 条", [row.actual_variable_rows ?? row.variable_rows ?? 0]))}</small></td><td>${frappe.utils.escape_html(row.imported_by || "-")}<small class="d-block text-muted">${frappe.utils.escape_html(row.imported_on || "-")}</small></td><td><span class="hrms-payroll-status-pill is-${row.status === "已确认" ? "ready" : "pending"}">${frappe.utils.escape_html(row.status || "-")}</span></td><td><div class="hrms-payroll-action-group">${row.can_delete ? `<button class="btn btn-danger btn-xs" type="button" data-delete-history-batch="${frappe.utils.escape_html(row.name)}" data-batch-month="${frappe.utils.escape_html(row.payroll_month)}">${frappe.utils.escape_html(__("删除"))}</button>` : row.can_void ? `<button class="btn btn-danger btn-xs" type="button" data-void-history-batch="${frappe.utils.escape_html(row.name)}" data-batch-month="${frappe.utils.escape_html(row.payroll_month)}">${frappe.utils.escape_html(__("作废"))}</button>` : `<span class="text-muted">${frappe.utils.escape_html(__("保留追溯"))}</span>`}</div></td></tr>`).join("") : `<tr><td colspan="7" class="text-muted">${frappe.utils.escape_html(__("暂无导入记录"))}</td></tr>`}</tbody>
				</table></div>
			</div>`;
		target.querySelector("[data-refresh-import-batch-history]")?.addEventListener("click", refresh);
		target.querySelectorAll("[data-delete-history-batch]").forEach((button) => {
			button.addEventListener("click", () => this.delete_import_batches([button.dataset.deleteHistoryBatch], false, button.dataset.batchMonth, refresh));
		});
		target.querySelectorAll("[data-void-history-batch]").forEach((button) => {
			button.addEventListener("click", () => this.void_import_batch(button.dataset.voidHistoryBatch, false, button.dataset.batchMonth, refresh));
		});
	}

	render_import_batches(target, rows) {
		const deletableRows = rows.filter((row) => row.can_delete);
		const pendingSelectedRows = rows.filter((row) => Number(row.is_selected) && Number(row.is_pending_confirmation));
		const canConfirmAll = pendingSelectedRows.length > 0 && pendingSelectedRows.every((row) => row.can_confirm);
		target.innerHTML = `
			<div class="hrms-payroll-input-list-head hrms-payroll-batch-toolbar">
				<label class="checkbox-inline"><input type="checkbox" data-select-all-import-batches ${deletableRows.length ? "" : "disabled"}> ${frappe.utils.escape_html(__("全选未确认批次"))}</label>
				<div class="hrms-payroll-action-group">
					<span class="text-muted" data-selected-import-batch-count>${frappe.utils.escape_html(__("已选择 0 个"))}</span>
					<button class="btn btn-primary btn-sm" data-confirm-all-import-batches ${canConfirmAll ? "" : "disabled"} title="${frappe.utils.escape_html(canConfirmAll ? __("确认全部当前版本") : __("请先修正或剔除当前版本中的异常记录"))}">${frappe.utils.escape_html(__("一键确认全部"))}</button>
					<button class="btn btn-danger btn-sm" data-delete-selected-import-batches disabled>${frappe.utils.escape_html(__("删除所选批次"))}</button>
					<button class="btn btn-default btn-sm" data-clear-unconfirmed-import-batches ${deletableRows.length ? "" : "disabled"}>${frappe.utils.escape_html(__("清空本月未确认"))}</button>
				</div>
			</div>
			<div class="hrms-payroll-table-wrap">
				<table class="table table-bordered hrms-payroll-input-table">
					<thead>
						<tr>
							<th class="text-center" style="width:42px">${frappe.utils.escape_html(__("选择"))}</th>
							<th>${frappe.utils.escape_html(__("来源类型"))}</th>
							<th>${frappe.utils.escape_html(__("来源文件"))}</th>
							<th>${frappe.utils.escape_html(__("记录 / 匹配 / 异常"))}</th>
							<th>${frappe.utils.escape_html(__("导入追溯"))}</th>
							<th>${frappe.utils.escape_html(__("状态"))}</th>
							<th>${frappe.utils.escape_html(__("操作"))}</th>
						</tr>
					</thead>
					<tbody>
						${
							rows.length
								? rows.map((row) => `
									<tr>
										<td class="text-center"><input type="checkbox" data-select-import-batch="${frappe.utils.escape_html(row.name)}" ${row.can_delete ? "" : "disabled"} title="${frappe.utils.escape_html(row.can_delete ? __("选择待删除批次") : __("已确认批次必须保留追溯"))}"></td>
										<td>${frappe.utils.escape_html(row.source_type_label || row.source_type || __("未分类"))}</td>
										<td>${frappe.utils.escape_html(row.source_file_label || row.source_file || "")}</td>
										<td>
											<strong>${frappe.utils.escape_html(String(row.actual_variable_rows ?? row.variable_rows ?? 0))}</strong>
											<small class="d-block text-muted">${frappe.utils.escape_html(__("已匹配 {0} / 未匹配 {1} / 不参与 {2}", [row.matched_rows || 0, row.unmatched_rows || 0, row.excluded_rows || 0]))}</small>
											${row.unmatched_rows ? `<small class="d-block text-danger">${frappe.utils.escape_html(__("未匹配 {0} 条（{1} 人）", [row.unmatched_rows, row.unmatched_people || row.unmatched_rows]))}</small>` : ""}
											<small class="d-block text-muted">${frappe.utils.escape_html(__("错误 {0} / 警告 {1}", [row.error_rows || 0, row.warning_rows || 0]))}</small>
										</td>
										<td>${frappe.utils.escape_html(row.imported_by || "")}<small class="d-block text-muted">${frappe.utils.escape_html(row.imported_on || "")}</small>${row.confirmed_by ? `<small class="d-block">${frappe.utils.escape_html(__("确认：{0} · {1}", [row.confirmed_by, row.confirmed_on || ""]))}</small>` : ""}${row.voided_by ? `<small class="d-block text-danger">${frappe.utils.escape_html(__("作废：{0} · {1}", [row.voided_by, row.voided_on || ""]))}</small><small class="d-block text-muted">${frappe.utils.escape_html(row.void_reason || "")}</small>` : ""}</td>
										<td><span class="hrms-payroll-status-pill is-${row.status === "已确认" ? "ready" : "pending"}">${frappe.utils.escape_html(row.status || "")}</span></td>
										<td><div class="hrms-payroll-action-group">${row.is_selected ? `<span class="text-success">${frappe.utils.escape_html(__("当前版本"))}</span>` : ""}${row.can_delete || row.can_void ? `<button class="btn btn-danger btn-xs" data-remove-import-batch="${frappe.utils.escape_html(row.name)}" data-batch-status="${frappe.utils.escape_html(row.status || "")}">${frappe.utils.escape_html(row.can_void ? __("删除版本") : __("删除"))}</button>` : ""}</div></td>
									</tr>
								`).join("")
								: `<tr><td colspan="7" class="text-muted">${frappe.utils.escape_html(__("暂无导入批次"))}</td></tr>`
						}
					</tbody>
				</table>
			</div>
		`;
		target.querySelectorAll("[data-delete-import-batch]").forEach((button) => {
			button.addEventListener("click", () => this.delete_import_batch(button.dataset.deleteImportBatch));
		});
		target.querySelectorAll("[data-remove-import-batch]").forEach((button) => {
			button.addEventListener("click", () => {
				if (button.dataset.batchStatus === "已确认") this.void_import_batch(button.dataset.removeImportBatch);
				else this.delete_import_batch(button.dataset.removeImportBatch);
			});
		});
		const selectAll = target.querySelector("[data-select-all-import-batches]");
		selectAll?.addEventListener("change", () => {
			target.querySelectorAll("[data-select-import-batch]:not(:disabled)").forEach((checkbox) => { checkbox.checked = selectAll.checked; });
			this.update_import_batch_selection(target);
		});
		target.querySelectorAll("[data-select-import-batch]").forEach((checkbox) => {
			checkbox.addEventListener("change", () => this.update_import_batch_selection(target));
		});
		target.querySelector("[data-delete-selected-import-batches]")?.addEventListener("click", () => {
			this.delete_import_batches(this.selected_import_batch_names(target));
		});
		target.querySelector("[data-clear-unconfirmed-import-batches]")?.addEventListener("click", () => {
			this.delete_import_batches(deletableRows.map((row) => row.name), true);
		});
		target.querySelector("[data-confirm-all-import-batches]")?.addEventListener("click", () => this.confirm_all_import_batches());
	}

	selected_import_batch_names(target) {
		return Array.from(target.querySelectorAll("[data-select-import-batch]:checked")).map((checkbox) => checkbox.dataset.selectImportBatch);
	}

	update_import_batch_selection(target) {
		const selected = this.selected_import_batch_names(target);
		const selectable = Array.from(target.querySelectorAll("[data-select-import-batch]:not(:disabled)"));
		const selectAll = target.querySelector("[data-select-all-import-batches]");
		if (selectAll) {
			selectAll.checked = Boolean(selectable.length) && selected.length === selectable.length;
			selectAll.indeterminate = selected.length > 0 && selected.length < selectable.length;
		}
		const count = target.querySelector("[data-selected-import-batch-count]");
		if (count) count.textContent = __("已选择 {0} 个", [selected.length]);
		const button = target.querySelector("[data-delete-selected-import-batches]");
		if (button) button.disabled = !selected.length;
	}

	select_import_batch_version(batch_name) {
		frappe.call({
			method: "hrms.api.payroll_input.select_payroll_variable_import_batch",
			args: { batch_name, company: this.company, payroll_month: this.payroll_month },
			freeze: true,
			freeze_message: __("正在选择本月使用版本…"),
			callback: (response) => {
				const batch = (this.variable_import_batches || []).find((item) => item.name === batch_name);
				const source = this.variable_source_catalog.find((item) => (item.source_code || item.name) === batch?.source_type);
				if (source) {
					this.selected_payroll_source = { ...source, label: source.source_name, source_code: source.source_code || source.name };
					this.open_source_card_code = batch?.source_type || "";
				}
				frappe.show_alert({ message: response.message?.message || __("已选择本月使用版本"), indicator: "green" });
				this.load_import_batches();
			},
		});
	}

	confirm_import_batch(batch_name, confirm_empty = 0) {
		const prompt = confirm_empty
			? __("确认该来源本月无数据？系统会保留来源文件、录入人与确认时间作为追溯，但不会产生计薪记录。")
			: __("确认当前数据入账？确认后会参与下次薪资计算；如需调整，可新建修改版本留痕。");
		frappe.confirm(prompt, () => {
			frappe.call({
				method: "hrms.api.payroll_input.confirm_payroll_variable_import_batch",
				args: { batch_name, company: this.company, payroll_month: this.payroll_month, confirm_empty },
				freeze: true,
				freeze_message: __("正在确认入账…"),
				callback: (response) => {
					frappe.show_alert({ message: response.message?.message || __("月度增减项已确认入账"), indicator: "green" });
					this.load_import_batches();
				},
			});
		});
	}

	confirm_all_import_batches() {
		frappe.confirm(__("一键确认本月所有当前版本的数据？系统会先校验全部异常和重复项；任一批次有问题时不会确认任何批次。"), () => {
			frappe.call({
				method: "hrms.api.payroll_input.confirm_all_payroll_variable_import_batches",
				args: this.scope_args(),
				freeze: true,
				freeze_message: __("正在一键确认…"),
				callback: (response) => {
					frappe.show_alert({ message: response.message?.message || __("本月数据已一键确认"), indicator: "green" });
					this.load_import_batches();
				},
			});
		});
	}

	void_import_batch(batch_name, revoke_confirmation = false, payroll_month = this.payroll_month, after_action = null) {
		frappe.prompt(
			[{ fieldname: "reason", fieldtype: "Small Text", label: revoke_confirmation ? __("撤销原因") : __("作废原因"), reqd: 1 }],
			(values) => {
				frappe.call({
					method: "hrms.api.payroll_input.void_payroll_variable_import_batch",
					args: { batch_name, company: this.company, payroll_month, reason: values.reason },
					freeze: true,
					freeze_message: __("正在作废批次…"),
					callback: (response) => {
						frappe.show_alert({ message: response.message?.message || __("批次已留痕作废"), indicator: "orange" });
						this.load_import_batches();
						after_action?.();
					},
				});
			},
			revoke_confirmation ? __("撤销确认") : __("作废已确认批次"),
			revoke_confirmation ? __("确认撤销") : __("确认作废")
		);
	}

	delete_import_batch(batch_name) {
		this.delete_import_batches([batch_name]);
	}

	delete_import_batches(batch_names, clear_all = false, payroll_month = this.payroll_month, after_action = null) {
		if (!batch_names?.length) return;
		frappe.confirm(
			clear_all
				? __("确认清空本月全部未确认批次？已确认入账的批次会保留；旧薪资输入表和未确认试算将失效。")
				: __("确认删除所选 {0} 个未确认导入批次？已确认入账的批次会保留；旧薪资输入表和未确认试算将失效。", [batch_names.length]),
			() => {
				frappe.call({
					method: "hrms.api.payroll_input.delete_payroll_variable_import_batches",
					args: { company: this.company, payroll_month, batch_names: JSON.stringify(batch_names) },
					freeze: true,
					freeze_message: __("正在清理所选导入批次..."),
				}).then((response) => {
						const result = response.message || {};
						if (!result.deleted_batches?.length) {
							frappe.msgprint({ title: __("删除未完成"), indicator: "orange", message: __("系统未返回已删除批次，请刷新后确认状态。") });
							this.load_import_batches();
							after_action?.();
							return;
						}
						frappe.show_alert({
							message: result.message || __("导入批次已删除；旧薪资输入表和未确认试算已失效，请重新生成。"),
							indicator: "orange",
						});
						this.load_import_batches();
						after_action?.();
					}).catch((error) => {
						console.error("Delete payroll-variable batches failed", error);
						frappe.msgprint({
							title: __("删除失败"),
							indicator: "red",
							message: __("批次没有被删除。请确认它仍是“待确认”状态；若问题持续，请刷新页面后重试。"),
						});
						this.load_import_batches();
					});
			},
		);
	}

	render_variable_records(target, rows, options = {}) {
		if (this.is_contribution_records(rows)) {
			this.render_contribution_records(target, rows, options);
			return;
		}
		const editable = Boolean(options.editable);
		const readOnly = !editable;
		const inlineInput = (field, value, type = "text") => `<input class="form-control input-sm hrms-payroll-inline-input" type="${type}" data-inline-variable-field="${field}" value="${frappe.utils.escape_html(String(value ?? ""))}">`;
		const attention_priority = (row) => {
			if (row.excluded) return 5;
			if (!row.employee || row.validation_status === "错误") return 0;
			if (["待修改", "待纠错"].includes(row.review_status)) return 1;
			if (row.validation_status === "警告") return 2;
			if (row.review_status !== "已确认") return 3;
			return 4;
		};
		const orderedRows = rows
			.map((row, index) => ({ row, index }))
			.sort((left, right) => attention_priority(left.row) - attention_priority(right.row) || left.index - right.index)
			.map((item) => item.row);
		target.innerHTML = `
			<div class="hrms-payroll-table-wrap">
				<table class="table table-bordered hrms-payroll-input-table" data-table-page-size="15">
					<thead>
						<tr>
							<th>${frappe.utils.escape_html(__("姓名"))}</th>
							<th>${frappe.utils.escape_html(__("工号"))}</th>
							<th>${frappe.utils.escape_html(__("员工匹配"))}</th>
							<th>${frappe.utils.escape_html(__("变量类型"))}</th>
							<th>${frappe.utils.escape_html(__("金额"))}</th>
							<th>${frappe.utils.escape_html(__("备注"))}</th>
							<th>${frappe.utils.escape_html(__("校验 / 未匹配原因"))}</th>
							<th>${frappe.utils.escape_html(__("入账状态"))}</th>
							${readOnly ? "" : `<th>${frappe.utils.escape_html(__("操作"))}</th>`}
						</tr>
					</thead>
					<tbody>
						${
							rows.length
								? orderedRows.map((row) => `
									<tr class="hrms-payroll-variable-row is-priority-${attention_priority(row)}" ${editable ? `data-inline-variable-record="${frappe.utils.escape_html(row.name)}"` : ""}>
										<td>${frappe.utils.escape_html(row.employee_name || "")}</td>
										<td>${frappe.utils.escape_html(row.employee_code || "")}</td>
										<td>${row.employee ? `<span class="text-success">${frappe.utils.escape_html(__("已匹配"))}</span><small class="d-block text-muted">${frappe.utils.escape_html(row.employee)}</small>` : `<span class="text-danger">${frappe.utils.escape_html(__("未匹配"))}</span>`}</td>
										<td><span class="hrms-payroll-source-variable-type">${frappe.utils.escape_html(row.variable_type || "-")}</span></td>
										<td>${editable ? inlineInput("amount", row.amount, "number") : frappe.utils.escape_html(this.format_money(row.amount))}</td>
										<td>${frappe.utils.escape_html(row.remarks || "-")}</td>
										<td>${frappe.utils.escape_html(row.validation_status || "-")}<small class="d-block ${row.validation_status === "错误" ? "text-danger" : "text-muted"}">${frappe.utils.escape_html(row.validation_message || row.source_sheet || "-")}</small></td>
										<td>${frappe.utils.escape_html(row.excluded ? __("不参与计算") : (row.review_status === "待审核" ? __("待确认") : (row.review_status || __("待确认"))))}</td>
										${readOnly ? "" : `<td><div class="hrms-payroll-action-group"><span class="hrms-payroll-inline-save-state" data-inline-variable-save-state="${frappe.utils.escape_html(row.name)}">${frappe.utils.escape_html(__("等待修改"))}</span><button class="btn btn-default btn-xs" data-edit-variable-record="${frappe.utils.escape_html(row.name)}">${frappe.utils.escape_html(row.employee ? __("更正明细") : __("更正员工"))}</button>${row.review_status !== "已确认" ? `<button class="btn btn-default btn-xs" data-toggle-variable-record="${frappe.utils.escape_html(row.name)}" data-excluded="${row.excluded ? 0 : 1}">${frappe.utils.escape_html(row.excluded ? __("恢复参与计算") : __("不参与计算"))}</button>` : ""}</div></td>`}
									</tr>
								`).join("")
								: `<tr><td colspan="${readOnly ? 8 : 9}" class="text-muted">${frappe.utils.escape_html(__("薪资变量记录暂无数据"))}</td></tr>`
						}
					</tbody>
				</table>
			</div>
		`;
		if (readOnly) return;
		target.querySelectorAll("[data-inline-variable-record]").forEach((rowElement) => {
			const row = rows.find((item) => item.name === rowElement.dataset.inlineVariableRecord);
			rowElement.querySelectorAll("[data-inline-variable-field]").forEach((input) => {
				input.addEventListener("input", () => this.queue_inline_variable_save(row, rowElement));
				input.addEventListener("change", () => this.queue_inline_variable_save(row, rowElement));
			});
		});
		target.querySelectorAll("[data-toggle-variable-record]").forEach((button) => {
			button.addEventListener("click", () => this.toggle_variable_record(button.dataset.toggleVariableRecord, Number(button.dataset.excluded)));
		});
		target.querySelectorAll("[data-edit-variable-record]").forEach((button) => {
			button.addEventListener("click", () => this.edit_variable_record(rows.find((row) => row.name === button.dataset.editVariableRecord)));
		});
	}

	is_contribution_records(rows) {
		const contributionTypes = new Set(["社保个人", "社保公司", "公积金个人", "公积金公司"]);
		return rows.length > 0 && rows.every((row) => contributionTypes.has(row.variable_type));
	}

	contribution_record_groups(rows) {
		const grouped = new Map();
		rows.forEach((row) => {
			const category = row.variable_type.startsWith("社保") ? "社保" : "公积金";
			const identity = row.employee || row.employee_code || row.employee_name || row.name;
			const key = `${category}:${identity}`;
			// Do not use `company` here: spreading the primary variable row below
			// also contains its Company link and would overwrite the company-side
			// contribution record, leaving the rendered amount blank after import.
			if (!grouped.has(key)) grouped.set(key, { category, identity, rows: [], personal_record: null, company_record: null });
			const group = grouped.get(key);
			group.rows.push(row);
			group[row.variable_type.endsWith("个人") ? "personal_record" : "company_record"] = row;
		});
		return [...grouped.values()].map((group) => {
			const primary = group.personal_record || group.company_record;
			const statuses = group.rows.map((row) => row.validation_status || "-");
			const validation_status = statuses.includes("错误") ? "错误" : statuses.includes("警告") ? "警告" : statuses[0];
			const validation_message = [...new Set(group.rows.map((row) => row.validation_message || row.source_sheet).filter(Boolean))].join("；");
			const remarks = [...new Set(group.rows.map((row) => row.remarks || "").filter(Boolean))].join("；");
			return { ...group, ...primary, validation_status, validation_message, remarks };
		});
	}

	render_contribution_records(target, rows, options = {}) {
		const editable = Boolean(options.editable);
		const readOnly = !editable;
		const groups = this.contribution_record_groups(rows);
		const priority = (group) => {
			if (group.rows.every((row) => row.excluded)) return 5;
			if (!group.employee || group.validation_status === "错误") return 0;
			if (group.rows.some((row) => ["待修改", "待纠错"].includes(row.review_status))) return 1;
			if (group.validation_status === "警告") return 2;
			if (group.rows.some((row) => row.review_status !== "已确认")) return 3;
			return 4;
		};
		const orderedGroups = groups.slice().sort((left, right) => priority(left) - priority(right));
		const amountCell = (record) => {
			if (!record) return `<span class="text-muted">-</span>`;
			if (!editable) return frappe.utils.escape_html(this.format_money(record.amount));
			return `<div class="hrms-payroll-contribution-input"><input class="form-control input-sm hrms-payroll-inline-input" type="number" data-inline-contribution-record="${frappe.utils.escape_html(record.name)}" value="${frappe.utils.escape_html(String(record.amount ?? ""))}"><small class="hrms-payroll-inline-save-state" data-inline-contribution-save-state="${frappe.utils.escape_html(record.name)}">${frappe.utils.escape_html(__("等待修改"))}</small></div>`;
		};
		const employeeCell = (field, value) => {
			if (!editable) return frappe.utils.escape_html(value || "");
			return `<input class="form-control input-sm hrms-payroll-inline-input" type="text" data-inline-contribution-employee-field="${field}" value="${frappe.utils.escape_html(String(value || ""))}">`;
		};
		const reviewState = (group) => group.rows.every((row) => row.excluded) ? __("不参与计算") : group.rows.every((row) => row.review_status === "已确认") ? __("已确认") : __("待确认");
		const contributionKey = [...new Set(groups.map((group) => group.category))].sort().join("-") || "contribution";
		this.contribution_view_by_category ||= {};
		const contributionView = this.contribution_view_by_category[contributionKey] || "personal";
		const includedGroups = groups.filter((group) => !group.rows.every((row) => row.excluded));
		const total = (items, recordKey) => items.reduce((sum, group) => sum + (Number(group[recordKey]?.amount) || 0), 0);
		const personalTotal = total(includedGroups, "personal_record");
		const companyTotal = total(includedGroups, "company_record");
		const totalLabel = groups.every((group) => group.category === "社保") ? __("五险合计") : __("个人及公司合计");
		const departmentDisplay = (department) => String(department || __("未填写部门")).replace(/\s+-\s+[^-]+$/, "").trim();
		const departments = new Map();
		includedGroups.forEach((group) => {
			const department = departmentDisplay(group.department);
			const summary = departments.get(department) || { department, headcount: 0, personal: 0, company: 0 };
			summary.headcount += 1;
			summary.personal += Number(group.personal_record?.amount) || 0;
			summary.company += Number(group.company_record?.amount) || 0;
			departments.set(department, summary);
		});
		const departmentRows = [...departments.values()].sort((left, right) => left.department.localeCompare(right.department, "zh-CN"));
		const summaryBar = `<div class="hrms-payroll-contribution-summary"><span>${frappe.utils.escape_html(__("人数"))} <strong>${includedGroups.length}</strong></span><span>${frappe.utils.escape_html(__("公司"))} <strong>${frappe.utils.escape_html(this.format_money(companyTotal))}</strong></span><span>${frappe.utils.escape_html(__("个人"))} <strong>${frappe.utils.escape_html(this.format_money(personalTotal))}</strong></span><span>${frappe.utils.escape_html(totalLabel)} <strong>${frappe.utils.escape_html(this.format_money(companyTotal + personalTotal))}</strong></span></div>`;
		const personalTable = `<div class="hrms-payroll-table-wrap">
			<table class="table table-bordered hrms-payroll-input-table" data-table-page-size="15">
				<thead><tr>
					<th>${frappe.utils.escape_html(__("姓名"))}</th>
					<th>${frappe.utils.escape_html(__("工号"))}</th>
					<th>${frappe.utils.escape_html(__("员工匹配"))}</th>
					<th>${frappe.utils.escape_html(__("个人"))}</th>
					<th>${frappe.utils.escape_html(__("公司"))}</th>
					<th>${frappe.utils.escape_html(__("备注"))}</th>
					<th>${frappe.utils.escape_html(__("校验 / 未匹配原因"))}</th>
					<th>${frappe.utils.escape_html(__("入账状态"))}</th>
					${readOnly ? "" : `<th>${frappe.utils.escape_html(__("操作"))}</th>`}
				</tr></thead>
				<tbody>${orderedGroups.map((group, index) => `
					<tr class="hrms-payroll-variable-row is-priority-${priority(group)}" ${editable ? `data-inline-contribution-group-index="${index}"` : ""}>
						<td>${employeeCell("employee_name", group.employee_name)}</td>
						<td>${employeeCell("employee_code", group.employee_code)}</td>
						<td><span data-inline-contribution-match-state>${group.employee ? `<span class="text-success">${frappe.utils.escape_html(__("已匹配"))}</span><small class="d-block text-muted">${frappe.utils.escape_html(group.employee)}</small>` : `<span class="text-danger">${frappe.utils.escape_html(__("未匹配"))}</span>`}</span>${editable ? `<small class="hrms-payroll-inline-save-state" data-inline-contribution-employee-save-state>${frappe.utils.escape_html(__("修改姓名或工号后自动保存"))}</small>` : ""}</td>
						<td>${amountCell(group.personal_record)}</td>
						<td>${amountCell(group.company_record)}</td>
						<td>${frappe.utils.escape_html(group.remarks || "-")}</td>
						<td>${frappe.utils.escape_html(group.validation_status || "-")}<small class="d-block ${group.validation_status === "错误" ? "text-danger" : "text-muted"}">${frappe.utils.escape_html(group.validation_message || "-")}</small></td>
						<td>${frappe.utils.escape_html(reviewState(group))}</td>
						${readOnly ? "" : `<td><div class="hrms-payroll-action-group">${group.rows.some((row) => row.review_status !== "已确认" && !row.excluded) ? `<button class="btn btn-default btn-xs" data-toggle-contribution-records="${frappe.utils.escape_html(JSON.stringify(group.rows.filter((row) => row.review_status !== "已确认").map((row) => row.name)))}">${frappe.utils.escape_html(__("不参与计算"))}</button>` : "-"}</div></td>`}
					</tr>`).join("") || `<tr><td colspan="${readOnly ? 8 : 9}" class="text-muted">${frappe.utils.escape_html(__("薪资变量记录暂无数据"))}</td></tr>`}</tbody>
			</table>
		</div>`;
		const departmentTable = `<div class="hrms-payroll-contribution-note text-muted">${frappe.utils.escape_html(__("按当前未剔除明细汇总；待处理记录也保留在合计中，便于确认前与原表核对。"))}</div><div class="hrms-payroll-table-wrap"><table class="table table-bordered hrms-payroll-input-table"><thead><tr><th>${frappe.utils.escape_html(__("部门"))}</th><th>${frappe.utils.escape_html(__("人数"))}</th><th>${frappe.utils.escape_html(__("公司"))}</th><th>${frappe.utils.escape_html(__("个人"))}</th><th>${frappe.utils.escape_html(totalLabel)}</th></tr></thead><tbody>${departmentRows.map((row) => `<tr><td>${frappe.utils.escape_html(row.department)}</td><td>${row.headcount}</td><td>${frappe.utils.escape_html(this.format_money(row.company))}</td><td>${frappe.utils.escape_html(this.format_money(row.personal))}</td><td>${frappe.utils.escape_html(this.format_money(row.company + row.personal))}</td></tr>`).join("") || `<tr><td colspan="5" class="text-muted">${frappe.utils.escape_html(__("暂无可汇总部门数据"))}</td></tr>`}<tr class="hrms-payroll-contribution-total"><th>${frappe.utils.escape_html(__("合计"))}</th><th>${includedGroups.length}</th><th>${frappe.utils.escape_html(this.format_money(companyTotal))}</th><th>${frappe.utils.escape_html(this.format_money(personalTotal))}</th><th>${frappe.utils.escape_html(this.format_money(companyTotal + personalTotal))}</th></tr></tbody></table></div>`;
		target.innerHTML = `
			<div class="hrms-payroll-contribution-view-switch"><button class="btn btn-sm ${contributionView === "personal" ? "btn-primary" : "btn-default"}" data-contribution-view="personal">${frappe.utils.escape_html(__("个人明细"))}</button><button class="btn btn-sm ${contributionView === "department" ? "btn-primary" : "btn-default"}" data-contribution-view="department">${frappe.utils.escape_html(__("部门汇总"))}</button></div>${summaryBar}${contributionView === "department" ? departmentTable : personalTable}`;
		target.querySelectorAll("[data-contribution-view]").forEach((button) => {
			button.addEventListener("click", () => {
				this.contribution_view_by_category[contributionKey] = button.dataset.contributionView;
				this.render_contribution_records(target, rows, options);
			});
		});
		if (readOnly) return;
		target.querySelectorAll("[data-inline-contribution-group-index]").forEach((rowElement) => {
			const group = orderedGroups[Number(rowElement.dataset.inlineContributionGroupIndex)];
			rowElement.querySelectorAll("[data-inline-contribution-employee-field]").forEach((input) => {
				input.addEventListener("input", () => this.queue_contribution_employee_save(group, rowElement));
				input.addEventListener("change", () => this.queue_contribution_employee_save(group, rowElement));
			});
		});
		target.querySelectorAll("[data-inline-contribution-record]").forEach((input) => {
			const row = rows.find((item) => item.name === input.dataset.inlineContributionRecord);
			input.addEventListener("input", () => this.queue_contribution_amount_save(row, input));
			input.addEventListener("change", () => this.queue_contribution_amount_save(row, input));
		});
		target.querySelectorAll("[data-toggle-contribution-records]").forEach((button) => {
			button.addEventListener("click", () => {
				const recordNames = JSON.parse(button.dataset.toggleContributionRecords || "[]");
				this.toggle_contribution_records(recordNames);
			});
		});
	}

	toggle_contribution_records(recordNames) {
		const names = [...new Set(recordNames || [])].filter(Boolean);
		if (!names.length) return;
		let remaining = names.length;
		const finish = () => {
			remaining -= 1;
			if (!remaining) this.load_import_batches();
		};
		names.forEach((name) => {
			frappe.call({
				method: "hrms.api.payroll_input.set_payroll_variable_record_excluded",
				args: { name, excluded: 1 },
				callback: finish,
				error: finish,
			});
		});
	}

	queue_contribution_amount_save(row, input) {
		if (!row?.name || !input?.isConnected) return;
		this.inline_variable_save_timers ||= new Map();
		window.clearTimeout(this.inline_variable_save_timers.get(row.name));
		const saveState = input.parentElement?.querySelector(`[data-inline-contribution-save-state="${row.name}"]`);
		if (saveState) saveState.textContent = __("待保存");
		this.inline_variable_save_timers.set(row.name, window.setTimeout(() => this.save_contribution_amount(row, input), 550));
	}

	queue_contribution_employee_save(group, rowElement) {
		if (!group?.rows?.length || !rowElement?.isConnected) return;
		this.inline_contribution_employee_save_timers ||= new Map();
		const key = `${group.category}:${group.identity}`;
		window.clearTimeout(this.inline_contribution_employee_save_timers.get(key));
		const saveState = rowElement.querySelector("[data-inline-contribution-employee-save-state]");
		if (saveState) saveState.textContent = __("待保存");
		this.inline_contribution_employee_save_timers.set(key, window.setTimeout(() => this.save_contribution_employee(group, rowElement, key), 550));
	}

	save_contribution_employee(group, rowElement, key) {
		const employeeCode = rowElement.querySelector('[data-inline-contribution-employee-field="employee_code"]')?.value || "";
		const employeeName = rowElement.querySelector('[data-inline-contribution-employee-field="employee_name"]')?.value || "";
		const saveState = rowElement.querySelector("[data-inline-contribution-employee-save-state]");
		if (saveState) saveState.textContent = __("保存中…");
		Promise.all(group.rows.map((row) => new Promise((resolve, reject) => {
			frappe.call({
				method: "hrms.api.payroll_input.update_payroll_variable_record",
				args: { name: row.name, employee: "", employee_code: employeeCode, employee_name: employeeName, department: row.department || group.department || "", variable_type: row.variable_type, amount: row.amount, source_sheet: row.source_sheet || "", remarks: row.remarks || "" },
				callback: (response) => resolve({ row, value: response.message || {} }),
				error: reject,
			});
		}))).then((results) => {
			this.inline_contribution_employee_save_timers?.delete(key);
			results.forEach(({ row, value }) => Object.assign(row, value));
			const primary = group.personal_record || group.company_record || results[0]?.value || {};
			group.employee = primary.employee || results[0]?.value?.employee || "";
			group.employee_code = primary.employee_code || employeeCode;
			group.employee_name = primary.employee_name || employeeName;
			const matchState = rowElement.querySelector("[data-inline-contribution-match-state]");
			if (matchState?.isConnected) matchState.innerHTML = `<span class="text-success">${frappe.utils.escape_html(__("已匹配"))}</span><small class="d-block text-muted">${frappe.utils.escape_html(group.employee)}</small>`;
			if (saveState?.isConnected) { saveState.textContent = __("已保存"); saveState.classList.add("is-saved"); }
		}).catch(() => {
			this.inline_contribution_employee_save_timers?.delete(key);
			if (saveState?.isConnected) { saveState.textContent = __("保存失败"); saveState.classList.add("is-error"); }
		});
	}

	save_contribution_amount(row, input) {
		const saveState = input.parentElement?.querySelector(`[data-inline-contribution-save-state="${row.name}"]`);
		if (saveState) saveState.textContent = __("保存中…");
		frappe.call({
			method: "hrms.api.payroll_input.update_payroll_variable_record",
			args: { name: row.name, employee: "", employee_code: row.employee_code || "", employee_name: row.employee_name || "", department: row.department || "", variable_type: row.variable_type, amount: input.value, source_sheet: row.source_sheet || "", remarks: row.remarks || "" },
			callback: (response) => {
				this.inline_variable_save_timers?.delete(row.name);
				Object.assign(row, response.message || {});
				if (saveState?.isConnected) { saveState.textContent = __("已保存"); saveState.classList.add("is-saved"); }
			},
			error: () => {
				this.inline_variable_save_timers?.delete(row.name);
				if (saveState?.isConnected) { saveState.textContent = __("保存失败"); saveState.classList.add("is-error"); }
			},
		});
	}

	render_variable_type_options(selected) {
		return "全勤奖\n学历补贴\n宿舍扣款\n社保个人\n公积金个人\n其他奖金\n其他扣款\n底薪\n职能津贴\n职务津贴\n证书津贴\n多能工津贴\n证书及多能工津贴\n全薪\n薪资小计\n生产奖\n提案改善奖\n继续服务奖\n苹果树\n所得税\n年终奖所得税\n水电费及扣款\n社保公司\n公积金公司\n已发福利\n夜班津贴\n迟到金额+全勤奖扣款\n离职薪资结算"
			.split("\n")
			.map((value) => `<option value="${frappe.utils.escape_html(value)}" ${value === selected ? "selected" : ""}>${frappe.utils.escape_html(__(value))}</option>`)
			.join("");
	}

	queue_inline_variable_save(row, rowElement) {
		if (!row?.name || !rowElement?.isConnected) return;
		this.inline_variable_save_timers ||= new Map();
		window.clearTimeout(this.inline_variable_save_timers.get(row.name));
		const saveState = rowElement.querySelector(`[data-inline-variable-save-state="${row.name}"]`);
		if (saveState) saveState.textContent = __("待保存");
		this.inline_variable_save_timers.set(row.name, window.setTimeout(() => this.save_inline_variable_record(row, rowElement), 550));
	}

	save_inline_variable_record(row, rowElement) {
		const values = {};
		rowElement.querySelectorAll("[data-inline-variable-field]").forEach((input) => {
			values[input.dataset.inlineVariableField] = input.value;
		});
		const saveState = rowElement.querySelector(`[data-inline-variable-save-state="${row.name}"]`);
		if (saveState) saveState.textContent = __("保存中…");
		frappe.call({
			method: "hrms.api.payroll_input.update_payroll_variable_record",
			args: {
				name: row.name,
				employee: "",
				employee_code: row.employee_code || "",
				employee_name: row.employee_name || "",
				department: row.department || "",
				variable_type: values.variable_type || row.variable_type,
				amount: values.amount ?? row.amount,
				source_sheet: row.source_sheet || "",
				remarks: values.remarks ?? row.remarks ?? "",
			},
			callback: (response) => {
				this.inline_variable_save_timers?.delete(row.name);
				Object.assign(row, response.message || {});
				if (saveState?.isConnected) {
					saveState.textContent = __("已保存");
					saveState.classList.add("is-saved");
				}
			},
			error: () => {
				this.inline_variable_save_timers?.delete(row.name);
				if (saveState?.isConnected) {
					saveState.textContent = __("保存失败");
					saveState.classList.add("is-error");
				}
			},
		});
	}

	toggle_variable_record(name, excluded) {
		frappe.call({
			method: "hrms.api.payroll_input.set_payroll_variable_record_excluded",
			args: { name, excluded },
			callback: () => {
				this.load_import_batches();
			},
		});
	}

	edit_variable_record(row) {
		if (!row) return;
		if (row.review_status === "已确认") {
			frappe.msgprint(__("已确认入账的记录不可直接修改；如需调整，请通过新的导入批次留痕处理。"));
			return;
		}
		frappe.prompt(
			[
				{ fieldname: "employee", fieldtype: "Link", options: "Employee", label: __("员工"), default: row.employee },
				{ fieldname: "employee_code", fieldtype: "Data", label: __("工号"), default: row.employee_code },
				{ fieldname: "employee_name", fieldtype: "Data", label: __("姓名"), default: row.employee_name },
				{ fieldname: "department", fieldtype: "Link", options: "Department", label: __("部门"), default: row.department },
				row.import_batch
					? { fieldname: "variable_type", fieldtype: "Data", label: __("变量类型"), default: row.variable_type, read_only: 1 }
					: { fieldname: "variable_type", fieldtype: "Select", label: __("变量类型"), options: "全勤奖\n学历补贴\n宿舍扣款\n社保个人\n公积金个人\n其他奖金\n其他扣款\n底薪\n职能津贴\n职务津贴\n证书津贴\n多能工津贴\n证书及多能工津贴\n全薪\n薪资小计\n生产奖\n提案改善奖\n继续服务奖\n苹果树\n所得税\n年终奖所得税\n水电费及扣款\n社保公司\n公积金公司\n已发福利\n夜班津贴\n迟到金额+全勤奖扣款\n离职薪资结算", default: row.variable_type },
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
						this.load_import_batches();
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
					<div class="text-muted">${frappe.utils.escape_html(__("人员范围仅来自已锁定考勤终稿；再汇总定薪、工时和福利扣款来源，未被考勤识别的人员不会进入计算。"))}</div>
				</div>
				<button class="btn btn-primary btn-sm" data-generate data-requires-attendance-lock data-attendance-ready-title="${frappe.utils.escape_html(__("生成薪资输入表"))}" ${hasLockedAttendance ? "" : "disabled"} title="${frappe.utils.escape_html(hasLockedAttendance ? __("生成薪资输入表") : __("请先在考勤假期完成并锁定本月考勤终稿"))}">${frappe.utils.escape_html(__("生成薪资输入表"))}</button>
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
				frappe.show_alert({ message: __("薪资输入表已按锁定考勤人员及同范围变量生成"), indicator: "green" });
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
			{ label: "深夜班次数", field: "deep_night_shift_count", type: "number" },
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
						<li>${frappe.utils.escape_html(this.attendance_lock_version ? __("已自动继承本月锁定考勤终稿") : __("请先在考勤假期完成并锁定本月考勤终稿"))}</li>
					</ol>
					<p>${frappe.utils.escape_html(__("薪酬流程是：人员范围 → 员工定薪 → 月度增减项 → 薪资试算 → 确认与发放。考勤终稿由考勤假期自动提供，是试算的隐式前置依赖。"))}</p>
				</div>`,
			});
			this.update_process_guide_status({
				sources: { state: "pending", label: __("可先维护"), detail: __("月度增减项可先导入、纠错和审核。") },
				calculation: { state: "blocked", label: __("不可试算"), detail: __("请先在考勤假期完成并锁定本月考勤终稿") },
			});
			return false;
		}
		return true;
	}

	load_payroll_reports() {
		this.body().innerHTML = `
			<div class="hrms-payroll-input-list-head hrms-payroll-step-head">
				<div><span class="hrms-payroll-step-kicker">${frappe.utils.escape_html(__("已确认结果"))}</span><h3>${frappe.utils.escape_html(__("薪酬报表与发放"))}</h3><p>${frappe.utils.escape_html(__("仅使用已复核并确认的本月结算结果。"))}</p></div>
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

	render_table(title, columns, rows, mapRow, { fill_viewport = false } = {}) {
		return `
			<div class="hrms-payroll-table-wrap${fill_viewport ? " hrms-payroll-table-wrap--viewport" : ""}">
				<div class="hrms-payroll-table-scroll">
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
				${fill_viewport ? `<div class="hrms-payroll-table-viewport-footer">${frappe.utils.escape_html(__("已加载 {0} 条数据", [rows.length]))}</div>` : ""}
			</div>
		`;
	}
}
