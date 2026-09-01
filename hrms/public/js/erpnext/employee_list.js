(function () {
	const EMPLOYEE_DOCTYPE = "Employee";
	const ROSTER_ALL_EMPLOYEES_PAGE_LENGTH = 500;
	const ROSTER_COLUMN_FILTER_STORAGE_KEY = "hrms_roster_column_filter";
	const roster_phase_one_markers = {
		column_filter_mode: "表头联想筛选",
		department_label: "部门筛选",
		joining_label: "入职日期",
		modified_label: "更新时间",
		code_label: "工号",
		pagination_label: "分页",
		selected_status_card: true,
		department_filter: true,
		sort_options: ["入职日期", "更新时间", "姓名", "工号"],
		page_length: ROSTER_ALL_EMPLOYEES_PAGE_LENGTH,
		dynamic_columns: true,
		quick_update_employee_roster: true,
		get_employee_roster: true,
		get_employee_roster_summary: true,
	};

	// 业务上只有一个“工作性质”口径；其五个显示值由 Employee 的在职、
	// 转正、返聘和离职资料共同计算，不再维护另一套人员字段。
	const roster_cards = [
		{ label: "全部", filters: {} },
		{ label: "在职 · 正式", filters: { employment_type: "Full-time", custom_is_confirmed: "是", status: "Active" } },
		// 转正标记为空的员工由转正日期判断。定时任务会在到期时把他们
		// 正式办理为“是”；在此之前，他们与明确“否”的员工一样归入试用。
		{ label: "在职 · 试用期", filters: { employment_type: "Full-time", custom_is_confirmed: ["!=", "是"], status: "Active" } },
		{ label: "退休返聘", filters: { employment_type: "Retainer", status: "Active" } },
		{ label: "待离职", filters: { status: "Inactive" } },
		{ label: "离职", filters: { status: "Left" } },
	];

	const roster_list_columns = [
		{ fieldname: "employee_name", label: "姓名" },
		{ fieldname: "custom_employee_code", label: "工号" },
		{ fieldname: "department", label: "部门" },
		{ fieldname: "designation", label: "岗位" },
		{ fieldname: "employment_type", label: "工作性质" },
		{ fieldname: "date_of_joining", label: "入职日期" },
		{ fieldname: "relieving_date", label: "离职日期" },
		{ fieldname: "custom_id_type", label: "证件类型" },
		{ fieldname: "passport_number", label: "证件号码" },
		{ fieldname: "cell_number", label: "手机号码" },
	];
	const roster_fieldnames = new Set(roster_list_columns.map((column) => column.fieldname));
	const roster_filterable_columns = new Map(
		roster_list_columns.filter((column) => column.filterable !== false).map((column) => [column.fieldname, column]),
	);

	// ListView snapshots its visible columns during construction. Apply the roster
	// configuration before it is instantiated, rather than waiting for onload.
	apply_roster_meta_columns();

	frappe.listview_settings[EMPLOYEE_DOCTYPE] = {
		hide_name_column: true,
		page_length: ROSTER_ALL_EMPLOYEES_PAGE_LENGTH,
		disable_comment_count: true,
		add_fields: [
			"employee_name",
			"custom_employee_code",
			"department",
			"designation",
			"employment_type",
			"custom_is_confirmed",
			"final_confirmation_date",
			"status",
			"date_of_joining",
			"relieving_date",
			"custom_id_type",
			"passport_number",
			"cell_number",
			"company",
			"image",
		],
		button: {
			show(doc) {
				return Boolean(doc.name);
			},
			get_label() {
				return __("快速编辑");
			},
			get_description(doc) {
				return __("打开 {0}", [doc.employee_name || doc.name]);
			},
			action(doc) {
				frappe.set_route("employee-detail", doc.name);
			},
		},
		formatters: {
			name(value, df, doc) {
				return format_roster_employee_code_display(value, doc);
			},
			department(value, df, doc) {
				return format_roster_department_display(value, doc);
			},
			employment_type(value, df, doc) {
				return frappe.utils.escape_html(format_roster_employment_type(value, doc));
			},
		},
		onload(listview) {
			setup_roster_page(listview);
		},
		refresh(listview) {
			setup_roster_page(listview);
			update_roster_counts(listview);
		},
	};

	function is_roster_probation_employee(value, doc = {}) {
		if (value === "Probation" || doc.custom_is_confirmed === "否") return true;
		if (doc.custom_is_confirmed === "是") return false;

		// 只有“是否转正”未维护时，才以转正日期作为兜底依据；当天到期即为正式。
		const confirmation_date = String(doc.final_confirmation_date || "").slice(0, 10);
		if (!confirmation_date) return false;
		return confirmation_date > frappe.datetime.get_today();
	}

	function format_roster_employment_type(value, doc = {}) {
		if (doc.status === "Left") return __("离职");
		if (doc.status === "Inactive") return __("待离职");
		if (value === "Retainer") return __("退休返聘");
		if (is_roster_probation_employee(value, doc)) return __("在职 · 试用期");
		if (value) return __("在职 · 正式");
		return __("未设置");
	}

	function setup_roster_page(listview) {
		if (!listview || !listview.page) return;
		bind_natural_employee_code_sorting(listview);
		if (configure_roster_page_length(listview)) return;

		mark_employee_roster_view();
		expand_roster_layout(listview);
		bind_roster_result_height(listview);
		bind_roster_employee_detail_navigation(listview);
		bind_roster_row_decorations(listview);
		configure_roster_list_columns(listview);
		listview.page.set_title(__("员工花名册"));
		hide_native_filter_controls();
		hide_native_roster_field_filters(listview);
		apply_roster_status_date_columns(listview);
		bind_native_roster_list_header_removal(listview);
		remove_native_roster_list_header(listview);
		hide_unused_roster_toolbar_controls(listview);
		hide_roster_page_length_controls();
	setup_roster_actions(listview);
		setup_roster_summary(listview);
		ensure_roster_empty_result_header(listview);
		sync_active_roster_card(listview);
		setTimeout(function () {
			expand_roster_layout(listview);
			stretch_roster_result_area(listview);
			hide_native_filter_controls();
			hide_native_roster_field_filters(listview);
			normalise_roster_list_cells(listview);
			apply_roster_status_date_columns(listview);
			remove_native_roster_list_header(listview);
			hide_unused_roster_toolbar_controls(listview);
			hide_roster_page_length_controls();
			sync_active_roster_card(listview);
			ensure_roster_empty_result_header(listview);
	}, 300);
		normalise_roster_list_cells(listview);
		apply_roster_status_date_columns(listview);
		ensure_roster_records_loaded(listview);
	}

	function ensure_roster_records_loaded(listview) {
		if (
			listview.__hrmsRosterInitialLoadRequested ||
			!Array.isArray(listview.data) ||
			!listview.data.length
		) {
			return;
		}

		// BaseList starts with 20 rows on compact browsers.  Requesting a larger
		// page from onload races that initial request, which can leave only those
		// first 20 rows rendered despite the total count being much larger.
		listview.__hrmsRosterInitialLoadRequested = true;
		listview.start = 0;
		listview.page_length = ROSTER_ALL_EMPLOYEES_PAGE_LENGTH;
		listview.selected_page_count = ROSTER_ALL_EMPLOYEES_PAGE_LENGTH;
		listview.last_args = null;
		listview.refresh();
	}

	function bind_natural_employee_code_sorting(listview) {
		if (listview.__hrmsNaturalEmployeeCodeSortingBound) return;

		listview.__hrmsNaturalEmployeeCodeSortingBound = true;
		const original_before_render = listview.before_render;
		listview.before_render = function () {
			original_before_render.call(this);
			sort_roster_by_employee_code(this);
		};
	}

	function sort_roster_by_employee_code(listview) {
		const sort_by = listview.sort_selector?.sort_by || listview.sort_by;
		if (sort_by !== "custom_employee_code" || !Array.isArray(listview.data)) return;

		const sort_order = (listview.sort_selector?.sort_order || listview.sort_order) === "asc" ? "asc" : "desc";
		const populated = [];
		const blank = [];

		listview.data.forEach((employee, original_index) => {
			const value = get_employee_business_code(employee);
			(value ? populated : blank).push({ employee, original_index, value });
		});

		populated.sort((left, right) => {
			const comparison = compare_employee_business_codes(left.value, right.value);
			if (comparison) return sort_order === "asc" ? comparison : -comparison;
			return left.original_index - right.original_index;
		});

		// Missing work numbers are data-quality exceptions, so keep them at the
		// bottom in both directions instead of making them look like top-ranked rows.
		listview.data = populated.concat(blank).map((item) => item.employee);
	}

	function get_employee_business_code(employee) {
		return String(employee?.custom_employee_code || "").trim();
	}

	function compare_employee_business_codes(left, right) {
		return String(left || "").localeCompare(String(right || ""), "zh-CN", {
			numeric: true,
			sensitivity: "base",
		});
	}

	function configure_roster_page_length(listview) {
		if (listview.page_length === ROSTER_ALL_EMPLOYEES_PAGE_LENGTH) return false;

		listview.page_length = ROSTER_ALL_EMPLOYEES_PAGE_LENGTH;
		listview.selected_page_count = ROSTER_ALL_EMPLOYEES_PAGE_LENGTH;
		return false;
	}

	function configure_roster_list_columns(listview) {
		const meta = apply_roster_meta_columns();
		if (!meta) return;

		if (listview.meta && Array.isArray(listview.meta.fields)) {
			listview.meta.fields = meta.fields;
		}
	}

	function apply_roster_meta_columns() {
		const meta = frappe.get_meta(EMPLOYEE_DOCTYPE);
		if (!meta || !Array.isArray(meta.fields)) return null;

		meta.fields.forEach((field) => {
			if (!field.fieldname) return;
			field.in_list_view = roster_fieldnames.has(field.fieldname) ? 1 : 0;
		});

		roster_list_columns.forEach((column) => {
			const field = meta.fields.find((item) => item.fieldname === column.fieldname);
			if (!field) return;
			field.in_list_view = 1;
			field.label = __(column.label);
		});

		return meta;
	}

	function setup_roster_actions(listview) {
		if (listview.page.__hrms_roster_actions_ready) return;
		listview.page.__hrms_roster_actions_ready = true;

		listview.page.set_primary_action(__("添加员工"), function () {
			frappe.new_doc(EMPLOYEE_DOCTYPE);
		});

		listview.page.add_inner_button(__("表单导入"), function () {
			window.hrmsFormImport?.open("employee_roster") || frappe.set_route("employee-roster-import");
		});

		listview.page.add_inner_button(__("导出"), function () {
			frappe.set_route("employee-roster-export");
		});

		if (can_clear_current_company_roster()) {
			listview.page.add_inner_button(__("清空花名册"), function () {
				open_roster_cleanup_dialog(listview);
			});
		}
	}

	const ROSTER_CLEANUP_MODULES = ["attendance", "payroll", "form_intake", "personnel_changes", "dingtalk", "employees"];

	function can_clear_current_company_roster() {
		const roles = frappe.user_roles || frappe.boot?.user?.roles || [];
		return roles.includes("System Manager");
	}

	function open_roster_cleanup_dialog(listview) {
		const default_company = frappe.defaults.get_user_default("Company");
		frappe.call({
			method: "hrms.api.data_operations.get_company_data_management_context",
			args: { company: default_company || "" },
			freeze: true,
			freeze_message: __("正在生成清空预览…"),
		}).then((context_response) => {
			const company = context_response.message?.company;
			if (!company) {
				frappe.msgprint(__("未找到可清空的当前公司。"));
				return;
			}
			return frappe.call({
				method: "hrms.api.data_operations.preview_company_data_cleanup",
				args: { company, modules: ROSTER_CLEANUP_MODULES },
				freeze: true,
				freeze_message: __("正在检查关联数据…"),
			}).then((preview_response) => render_roster_cleanup_confirmation(listview, preview_response.message || {}));
		});
	}

	function render_roster_cleanup_confirmation(listview, preview) {
		const blockers = [...(preview.blockers || []), ...(preview.linked_blockers || [])];
		const blocker_text = blockers
			.map((item) => `${item.label || item.doctype}（${item.count || 0}）`)
			.join("、");
		const dialog = new frappe.ui.Dialog({
			title: __("确认清空花名册"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "warning",
					options: `<div class="alert alert-danger">${frappe.utils.escape_html(__("即将清除 {0} 的员工花名册及其关联业务数据，共 {1} 条。此操作不可撤销。", [preview.company, preview.count || 0]))}${blocker_text ? `<br><br>${frappe.utils.escape_html(__("仍有关联记录：{0}。请先在数据处理中心处理后再清空。", [blocker_text]))}` : ""}</div>`,
				},
				{ fieldtype: "Data", fieldname: "confirmation", label: __("输入确认文本：{0}", [preview.confirmation_text || ""]), reqd: 1 },
				{ fieldtype: "Check", fieldname: "acknowledge", label: __("我确认清空的是当前公司数据"), reqd: 1 },
			],
			primary_action_label: blockers.length ? __("前往数据处理中心") : __("确认清空"),
			primary_action(values) {
				if (blockers.length) {
					dialog.hide();
					frappe.set_route("hrms-data-operations");
					return;
				}
				if (values.confirmation !== preview.confirmation_text || !values.acknowledge) {
					frappe.msgprint(__("确认文本不匹配，未执行任何清空操作。"));
					return;
				}
				frappe.call({
					method: "hrms.api.data_operations.execute_company_data_cleanup",
					args: {
						company: preview.company,
						modules: ROSTER_CLEANUP_MODULES,
						confirm: values.confirmation,
						plan_token: preview.plan_token,
					},
					freeze: true,
					freeze_message: __("正在清空花名册…"),
				}).then((response) => {
					dialog.hide();
					frappe.show_alert({ message: response.message?.message || __("花名册已清空"), indicator: "green" });
					listview.start = 0;
					listview.refresh();
					update_roster_counts(listview);
				});
			},
		});
		dialog.show();
	}

	function setup_roster_summary(listview) {
		const wrapper = get_list_wrapper(listview);
		if (!wrapper || wrapper.querySelector(".hrms-roster-summary")) return;

		const panel = document.createElement("div");
		panel.className = "hrms-roster-summary";
		panel.setAttribute("aria-label", "员工花名册统计");

		const cards = document.createElement("div");
		cards.className = "hrms-roster-summary__cards";
		roster_cards.forEach((card) => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "hrms-roster-card";
			button.dataset.label = card.label;
			button.innerHTML = [
				`<span class="hrms-roster-card__label">${frappe.utils.escape_html(__(card.label))}</span>`,
				`<strong class="hrms-roster-card__value">-</strong>`,
				`<span class="hrms-roster-card__unit">人</span>`,
			].join("");
			button.addEventListener("click", function () {
				apply_single_roster_filter(card, get_stored_roster_column_filter());
			});
			cards.appendChild(button);
		});
		panel.appendChild(cards);

		wrapper.insertBefore(panel, wrapper.firstChild);
	}

	function ensure_roster_empty_result_header(listview) {
		const wrapper = get_list_wrapper(listview);
		if (!wrapper) return;
		const result_container = wrapper.querySelector(".result-container");
		const header_host = result_container?.parentElement;
		if (!result_container || !header_host) return;

		// Frappe replaces the complete result container for an empty response, not
		// merely `.result` / `.no-result`.  Keep the business header as a sibling
		// in ListView's stable host, so a search can never remove its own filter.
		result_container.querySelectorAll(":scope > .hrms-roster-table-header").forEach((stale_header) => stale_header.remove());
		let header = header_host.querySelector(":scope > .hrms-roster-table-header");
		if (!header) {
			header = document.createElement("div");
			header.className = "hrms-roster-table-header";
			header.setAttribute("aria-label", __("员工花名册表头"));
			header_host.insertBefore(header, result_container);
		}

		const active_filter = get_stored_roster_column_filter();
		const columns = get_visible_roster_columns();
		const signature = columns.map((column) => column.fieldname).join(",");
		if (header.dataset.signature === signature) {
			header.querySelectorAll(".hrms-roster-table-header__input").forEach((input) => {
				if (document.activeElement === input) return;
				input.value = input.dataset.fieldname === active_filter?.fieldname ? active_filter.display_value || active_filter.value || "" : "";
			});
			return;
		}

		header.dataset.signature = signature;
		header.style.setProperty("--hrms-roster-column-count", String(columns.length));
		header.replaceChildren();
		columns.forEach((column) => {
			const cell = document.createElement("div");
			cell.className = "hrms-roster-table-header__cell";
			cell.dataset.fieldname = column.fieldname;
			const title = document.createElement("button");
			title.type = "button";
			title.className = "hrms-roster-table-header__sort";
			title.textContent = __(column.label);
			title.setAttribute("title", __("点击按{0}排序", [column.label]));
			title.addEventListener("click", () => apply_roster_column_sort(listview, column.fieldname));
			const input = document.createElement("input");
			input.type = "search";
			input.className = "form-control input-sm hrms-roster-table-header__input";
			input.dataset.fieldname = column.fieldname;
			input.placeholder = __("搜索");
			input.autocomplete = "off";
			input.setAttribute("aria-label", __("搜索{0}", [column.label]));
			input.value = active_filter?.fieldname === column.fieldname ? active_filter.display_value || active_filter.value || "" : "";
			let filter_timer;
			const apply_input = () => {
				const value = input.value.trim();
				if (!value) return clear_roster_column_filter();
				apply_roster_column_filter(column, { value, label: value }, false);
			};
			input.addEventListener("input", () => {
				window.clearTimeout(filter_timer);
				filter_timer = window.setTimeout(apply_input, 450);
			});
			input.addEventListener("keydown", (event) => {
				if (event.key !== "Enter") return;
				event.preventDefault();
				window.clearTimeout(filter_timer);
				apply_input();
			});
			cell.append(title, input);
			header.appendChild(cell);
		});
	}

	function get_or_create_roster_native_header(wrapper) {
		const current_header = wrapper.querySelector(".list-row-head");
		if (current_header) return current_header;

		// Frappe removes the native header together with the last matching row.
		// Recreate that same header only in the empty-result state so the user can
		// adjust or clear the column filter without leaving the page.
		const empty_result = wrapper.querySelector(".no-result");
		if (!empty_result) return null;
		const header = document.createElement("div");
		header.className = "list-row list-row-head hrms-roster-native-table-header";
		get_visible_roster_columns().forEach((column) => {
			const cell = document.createElement("div");
			cell.className = "list-row-col";
			cell.dataset.fieldname = column.fieldname;
			header.appendChild(cell);
		});
		empty_result.prepend(header);
		return header;
	}

	function hide_native_roster_field_filters(listview) {
		const wrapper = get_list_wrapper(listview);
		if (!wrapper) return;

		wrapper.querySelectorAll(".standard-filter-section").forEach((section) => {
			section.classList.add("hrms-roster-native-filters-hidden");
			section.setAttribute("aria-hidden", "true");
		});
	}

	function remove_native_roster_list_header(listview) {
		const wrapper = get_list_wrapper(listview);
		if (!wrapper) return;
		// The native header is only a framework layout artefact now.  Hiding it
		// avoids a second, differently formatted header above the fixed roster one.
		wrapper.querySelectorAll(".list-row-head").forEach((header) => {
			header.classList.add("hrms-roster-native-table-header-hidden");
		});
		ensure_roster_empty_result_header(listview);
	}

	function bind_native_roster_list_header_removal(listview) {
		if (listview.__hrmsRosterNativeHeaderObserver) return;
		const wrapper = get_list_wrapper(listview);
		if (!wrapper || !window.MutationObserver) return;

		const observer = new MutationObserver((mutations) => {
			const native_header_was_added = mutations.some((mutation) =>
				Array.from(mutation.addedNodes).some(
					(node) => node.nodeType === Node.ELEMENT_NODE && (node.matches?.(".list-row-head") || node.querySelector?.(".list-row-head")),
				),
			);
			const result_container_was_replaced = mutations.some((mutation) =>
				Array.from(mutation.addedNodes).some(
					(node) => node.nodeType === Node.ELEMENT_NODE && (node.matches?.(".result-container") || node.querySelector?.(".result-container")),
				),
			);
			if (native_header_was_added || result_container_was_replaced) {
				window.requestAnimationFrame(() => {
					remove_native_roster_list_header(listview);
					ensure_roster_empty_result_header(listview);
				});
			}
		});
		observer.observe(wrapper, { childList: true, subtree: true });
		listview.__hrmsRosterNativeHeaderObserver = observer;
	}

	function get_roster_column_from_native_header_cell(cell, used_fieldnames) {
		const fieldname = cell.dataset.fieldname || cell.querySelector("[data-fieldname]")?.dataset.fieldname;
		const aliases = { name: "employee_name", employee: "employee_name" };
		const resolved_fieldname = aliases[fieldname] || fieldname;
		let column = roster_list_columns.find((item) => item.fieldname === resolved_fieldname);
		if (!column) {
			const label = (cell.textContent || "").replace(/[↕↑↓]/g, "").trim();
			column = roster_list_columns.find((item) => __(item.label) === label || item.label === label);
		}
		return column && !used_fieldnames.has(column.fieldname) ? column : null;
	}

	function get_visible_roster_columns() {
		const show_departure_date = get_active_roster_card().filters.status === "Left";
		return roster_list_columns.filter((column) =>
			show_departure_date ? column.fieldname !== "date_of_joining" : column.fieldname !== "relieving_date",
		);
	}


	function apply_roster_status_date_columns(listview) {
		const wrapper = get_list_wrapper(listview);
		if (!wrapper) return;

		// 离职日期只属于“已离职”视图；其余人员仍以入职日期作为时间字段。
		const show_departure_date = get_active_roster_card().filters.status === "Left";
		toggle_roster_date_column(wrapper, "date_of_joining", show_departure_date);
		toggle_roster_date_column(wrapper, "relieving_date", !show_departure_date);
	}

	function toggle_roster_date_column(wrapper, fieldname, hidden) {
		const header_cells = Array.from(
			wrapper.querySelectorAll(".list-row-head .list-row-col, .list-header .list-row-col"),
		);
		const target_indexes = new Set();
		header_cells.forEach((cell, index) => {
			const column = get_roster_column_from_native_header_cell(cell, new Set());
			if (column?.fieldname === fieldname) target_indexes.add(index);
		});

		header_cells.forEach((cell, index) => {
			if (!target_indexes.has(index)) return;
			cell.classList.toggle("hrms-roster-status-date-column-hidden", hidden);
			cell.style.setProperty("display", hidden ? "none" : "", hidden ? "important" : "");
		});

		wrapper.querySelectorAll(".list-row").forEach((row) => {
			Array.from(row.querySelectorAll(".list-row-col")).forEach((cell, index) => {
				if (!target_indexes.has(index)) return;
				cell.dataset.fieldname = fieldname;
				cell.classList.toggle("hrms-roster-status-date-column-hidden", hidden);
				cell.style.setProperty("display", hidden ? "none" : "", hidden ? "important" : "");
			});
		});

		wrapper.querySelectorAll(`.hrms-roster-table-header__cell[data-fieldname="${fieldname}"]`).forEach((cell) => {
			cell.classList.toggle("hrms-roster-status-date-column-hidden", hidden);
		});
	}

	function expand_roster_layout(listview) {
		const main_section = get_list_wrapper(listview);
		if (!main_section) return;

		// ListView's desktop shell reserves 20% for the optional side section.
		// Employee has no side controls, so use Frappe's own no-list-sidebar mode
		// on the actual page node instead of hiding or duplicating list content.
		const page_container = main_section.closest(".page-container");
		page_container?.classList.add("no-list-sidebar", "hrms-employee-roster-page");

		const layout_wrapper = main_section.closest(".layout-main-section-wrapper");
		const layout_main = main_section.closest(".layout-main");
		[layout_main, layout_wrapper, main_section].filter(Boolean).forEach((element) => {
			element.style.setProperty("width", "100%", "important");
			element.style.setProperty("max-width", "none", "important");
		});
		if (layout_wrapper) layout_wrapper.style.setProperty("flex", "1 1 100%", "important");
		stretch_roster_result_area(listview);
	}

	function bind_roster_result_height(listview) {
		if (listview.__hrmsRosterResultHeightBound) return;
		listview.__hrmsRosterResultHeightBound = true;
		window.addEventListener("resize", () => stretch_roster_result_area(listview));
	}

	function stretch_roster_result_area(listview) {
		const wrapper = get_list_wrapper(listview);
		const result_container = wrapper?.querySelector(".result-container");
		if (!result_container) return;

		window.requestAnimationFrame(() => {
			// Frappe's ListView height is normally content-driven.  On the compact
			// Desk shell that can make the parent stop above the browser bottom,
			// leaving a blank document canvas beneath the employee rows.  Size the
			// actual ListView section from its live viewport position first; this
			// keeps the normal table and its native scrolling behaviour intact.
			const desktop_zoom = Number.parseFloat(window.getComputedStyle(document.documentElement).zoom) || 1;
			const main_top = wrapper.getBoundingClientRect().top;
			const main_height = Math.max(320, Math.floor((window.innerHeight - main_top - 8) / desktop_zoom));
			wrapper.style.setProperty("height", `${main_height}px`, "important");
			wrapper.style.setProperty("min-height", `${main_height}px`, "important");

			const top = result_container.getBoundingClientRect().top;
			const available_height = Math.max(320, Math.floor((window.innerHeight - top - 12) / desktop_zoom));
			result_container.style.setProperty("height", `${available_height}px`, "important");
			result_container.style.setProperty("min-height", `${available_height}px`, "important");
		});
	}

	function enhance_roster_column_headers(listview) {
		const wrapper = get_list_wrapper(listview);
		if (!wrapper) return;

		wrapper.querySelectorAll(".list-row-head .list-row-col[data-fieldname]").forEach((cell) => {
			const fieldname = cell.dataset.fieldname;
			const column = roster_filterable_columns.get(fieldname);
			const sort_label = cell.querySelector(`[data-sort-by="${fieldname}"]`);
			if (!column || !sort_label || cell.querySelector(".hrms-roster-column-filter-hotspot")) return;

			cell.classList.add("hrms-roster-filterable-column");
			sort_label.classList.add("hrms-roster-column-sort");
			sort_label.setAttribute("title", __("点击按{0}排序", [column.label]));

			const hotspot = document.createElement("button");
			hotspot.type = "button";
			hotspot.className = "hrms-roster-column-filter-hotspot";
			hotspot.setAttribute("aria-label", __("筛选{0}", [column.label]));
			hotspot.setAttribute("title", __("筛选{0}", [column.label]));
			hotspot.innerHTML = frappe.utils.icon?.("search", "xs") || "&#128269;";
			hotspot.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				open_roster_column_filter(listview, cell, column);
			});
			cell.appendChild(hotspot);

			const active_filter = get_stored_roster_column_filter();
			if (active_filter?.fieldname === fieldname) {
				cell.classList.add("has-filter");
				hotspot.setAttribute("title", __("当前筛选：{0}", [active_filter.display_value || active_filter.value]));
			}
		});
	}

	function open_roster_column_filter(listview, cell, column) {
		close_open_roster_column_filter();
		cell.classList.add("is-filtering");
		const editor = document.createElement("div");
		editor.className = "hrms-roster-column-filter-editor";
		const input = document.createElement("input");
		input.type = "search";
		input.className = "form-control input-sm hrms-roster-column-filter-input";
		input.autocomplete = "off";
		input.placeholder = __("筛选{0}", [column.label]);
		input.setAttribute("aria-label", __("筛选{0}", [column.label]));
		const active_filter = get_stored_roster_column_filter();
		input.value = active_filter?.fieldname === column.fieldname ? active_filter.display_value || active_filter.value || "" : "";
		const suggestions = document.createElement("div");
		suggestions.className = "hrms-roster-column-filter-suggestions is-visible";
		suggestions.setAttribute("role", "listbox");
		const clear_button = document.createElement("button");
		clear_button.type = "button";
		clear_button.className = "hrms-roster-column-filter-clear";
		clear_button.setAttribute("aria-label", __("清除筛选"));
		clear_button.innerHTML = "&times;";
		clear_button.hidden = !input.value;

		const render_suggestions = () => {
			const query = input.value.trim().toLocaleLowerCase("zh-CN");
			const matches = get_roster_filter_suggestions(listview, column.fieldname)
				.filter((item) => !query || item.label.toLocaleLowerCase("zh-CN").includes(query))
				.slice(0, 8);
			suggestions.replaceChildren();
			matches.forEach((item) => {
				const option = document.createElement("button");
				option.type = "button";
				option.className = "hrms-roster-column-filter-option";
				option.setAttribute("role", "option");
				option.textContent = item.label;
				option.addEventListener("mousedown", (event) => event.preventDefault());
				option.addEventListener("click", () => apply_roster_column_filter(column, item, true));
				suggestions.appendChild(option);
			});
			suggestions.classList.toggle("is-visible", matches.length > 0);
		};
		const apply_value = () => {
			const value = input.value.trim();
			if (!value) return clear_roster_column_filter();
			const suggestion = get_roster_filter_suggestions(listview, column.fieldname).find((item) => item.label === value);
			apply_roster_column_filter(column, suggestion || { value, label: value }, Boolean(suggestion));
		};
		input.addEventListener("input", () => {
			clear_button.hidden = !input.value.trim();
			render_suggestions();
		});
		input.addEventListener("keydown", (event) => {
			if (event.key === "Escape") return close_open_roster_column_filter();
			if (event.key !== "Enter") return;
			event.preventDefault();
			apply_value();
		});
		clear_button.addEventListener("click", () => clear_roster_column_filter());
		editor.append(input, clear_button, suggestions);
		cell.appendChild(editor);
		const close_on_outside_click = (event) => {
			if (!cell.contains(event.target)) close_open_roster_column_filter();
		};
		document.addEventListener("mousedown", close_on_outside_click, true);
		cell.__hrmsRosterFilterCleanup = () => document.removeEventListener("mousedown", close_on_outside_click, true);
		render_suggestions();
		input.focus();
		input.select();
	}

	function close_open_roster_column_filter() {
		document.querySelectorAll(".hrms-roster-column-filter-editor").forEach((editor) => {
			const cell = editor.closest(".hrms-roster-filterable-column");
			cell?.__hrmsRosterFilterCleanup?.();
			if (cell) {
				delete cell.__hrmsRosterFilterCleanup;
				cell.classList.remove("is-filtering");
			}
			editor.remove();
		});
	}

	function ensure_roster_header_actions(listview) {
		const wrapper = get_list_wrapper(listview);
		const header = wrapper?.querySelector(".list-row-head");
		if (!header) return;

		let actions = header.querySelector(".hrms-roster-header-actions");
		if (!actions) {
			actions = document.createElement("div");
			actions.className = "hrms-roster-header-actions";
			actions.setAttribute("aria-label", __("花名册排序和筛选操作"));
			actions.innerHTML = [
				`<span class="hrms-roster-header-actions__label">${frappe.utils.escape_html(__("排序"))}</span>`,
				`<button type="button" class="btn btn-default btn-sm hrms-roster-sort-order" data-sort-order="asc">${frappe.utils.escape_html(__("正序"))}</button>`,
				`<button type="button" class="btn btn-default btn-sm hrms-roster-sort-order" data-sort-order="desc">${frappe.utils.escape_html(__("反序"))}</button>`,
				`<button type="button" class="btn btn-default btn-sm hrms-roster-clear-all-filters">${frappe.utils.escape_html(__("清除筛选"))}</button>`,
			].join("");
			actions.querySelectorAll(".hrms-roster-sort-order").forEach((button) => {
				button.addEventListener("click", () => apply_roster_sort_order(listview, button.dataset.sortOrder));
			});
			actions.querySelector(".hrms-roster-clear-all-filters").addEventListener("click", () => clear_roster_column_filter());
			header.appendChild(actions);
		}

		const active_filter = get_stored_roster_column_filter();
		actions.querySelector(".hrms-roster-clear-all-filters").hidden = !active_filter?.value;
		const sort_order = (listview.sort_selector?.sort_order || listview.sort_order) === "asc" ? "asc" : "desc";
		actions.querySelectorAll(".hrms-roster-sort-order").forEach((button) => {
			button.classList.toggle("is-active", button.dataset.sortOrder === sort_order);
		});
	}

	function apply_roster_sort_order(listview, sort_order) {
		if (!listview || !["asc", "desc"].includes(sort_order)) return;
		const sort_by = listview.sort_selector?.sort_by || listview.sort_by || "custom_employee_code";
		listview.sort_by = sort_by;
		listview.sort_order = sort_order;
		if (listview.sort_selector) {
			listview.sort_selector.sort_by = sort_by;
			listview.sort_selector.sort_order = sort_order;
		}
		listview.start = 0;
		listview.refresh();
	}

	function apply_roster_column_sort(listview, fieldname) {
		if (!listview || !fieldname) return;
		const current_fieldname = listview.sort_selector?.sort_by || listview.sort_by;
		const current_order = listview.sort_selector?.sort_order || listview.sort_order;
		const sort_order = current_fieldname === fieldname && current_order === "asc" ? "desc" : "asc";
		listview.sort_by = fieldname;
		listview.sort_order = sort_order;
		if (listview.sort_selector) {
			listview.sort_selector.sort_by = fieldname;
			listview.sort_selector.sort_order = sort_order;
		}
		listview.start = 0;
		listview.refresh();
	}

	function get_roster_filter_suggestions(listview, fieldname) {
		const suggestions = new Map();
		(listview.data || []).forEach((employee) => {
			let value = employee?.[fieldname];
			if (fieldname === "custom_employee_code") value = get_employee_business_code(employee);
			value = String(value || "").trim();
			if (!value) return;
			const label = fieldname === "department" ? get_roster_department_label(value) : value;
			if (!suggestions.has(value)) suggestions.set(value, { value, label });
		});
		return Array.from(suggestions.values()).sort((left, right) =>
			left.label.localeCompare(right.label, "zh-CN", { numeric: true, sensitivity: "base" }),
		);
	}

	function get_active_roster_card() {
		const preferred_label = sessionStorage.getItem("hrms_roster_active_card") || roster_cards[0].label;
		return roster_cards.find((card) => card.label === preferred_label) || roster_cards[0];
	}

	function apply_roster_column_filter(column, item, exact) {
		const filter = {
			fieldname: column.fieldname,
			value: item.value,
			display_value: item.label,
			exact: Boolean(exact),
		};
		sessionStorage.setItem(ROSTER_COLUMN_FILTER_STORAGE_KEY, JSON.stringify(filter));
		apply_single_roster_filter(get_active_roster_card(), filter);
	}

	function clear_roster_column_filter() {
		sessionStorage.removeItem(ROSTER_COLUMN_FILTER_STORAGE_KEY);
		apply_single_roster_filter(get_active_roster_card());
	}

	function get_stored_roster_column_filter() {
		try {
			return JSON.parse(sessionStorage.getItem(ROSTER_COLUMN_FILTER_STORAGE_KEY) || "null");
		} catch (error) {
			sessionStorage.removeItem(ROSTER_COLUMN_FILTER_STORAGE_KEY);
			return null;
		}
	}

	function update_roster_counts(listview) {
		const wrapper = get_list_wrapper(listview);
		if (!wrapper) return;

		roster_cards.forEach((card) => {
			const value = wrapper.querySelector(`.hrms-roster-card[data-label="${card.label}"] .hrms-roster-card__value`);
			if (!value) return;

			count_with_available_fields(card.filters)
				.then((count) => {
					value.textContent = count;
				})
				.catch(() => {
					value.textContent = "0";
				});
		});
	}

	function count_with_available_fields(filters) {
		const available_filters = {};
		Object.keys(filters || {}).forEach((fieldname) => {
			if (has_employee_field(fieldname)) {
				available_filters[fieldname] = filters[fieldname];
			}
		});
		// The cleanup action is deliberately scoped to the selected company.  Keep
		// the status cards in that same scope; otherwise an Administrator can see
		// counts from a fixture or another company after this company's roster has
		// been successfully cleared.
		const current_company = get_current_roster_company();
		if (current_company && has_employee_field("company")) {
			available_filters.company = current_company;
		}

		return frappe.db.count(EMPLOYEE_DOCTYPE, { filters: available_filters });
	}

	function get_current_roster_company() {
		return has_employee_field("company") ? frappe.defaults.get_user_default("Company") : "";
	}

	function apply_single_roster_filter(card, search) {
		sessionStorage.setItem("hrms_roster_active_card", card.label || "");
		const route_options = build_roster_route_options(card.filters, search);
		const listview = get_active_employee_roster_listview();
		frappe.route_options = route_options;

		// A status-card click can happen while the Employee List is already the
		// current route. In that case Frappe does not re-create ListView, so merely
		// setting route_options leaves the old (often one-person) result on screen.
		// Reset its actual filter state before loading the requested rows.
		if (listview) {
			apply_roster_filters_to_live_listview(listview, route_options);
			return;
		}

		frappe.set_route("List", EMPLOYEE_DOCTYPE);
	}

	function get_active_employee_roster_listview() {
		const listview = window.cur_listview;
		return listview?.doctype === EMPLOYEE_DOCTYPE ? listview : null;
	}

	function apply_roster_filters_to_live_listview(listview, route_options) {
		const filter_area = listview.filter_area;
		if (!filter_area?.clear_filters || !filter_area?.add) {
			frappe.route_options = route_options;
			listview.start = 0;
			listview.refresh();
			return;
		}

		filter_area.clear_filters();
		const filters = Object.entries(route_options).map(([fieldname, value]) => {
			if (Array.isArray(value)) return [EMPLOYEE_DOCTYPE, fieldname, value[0], value[1]];
			return [EMPLOYEE_DOCTYPE, fieldname, "=", value];
		});
		if (filters.length) filter_area.add(filters);

		listview.search_term = "";
		clear_roster_native_search_input(listview);
		listview.start = 0;
		listview.refresh();
		update_roster_filter_status(listview);
	}

	function bind_roster_row_decorations(listview) {
		if (listview.__hrmsRosterRowDecorationsBound) return;
		listview.__hrmsRosterRowDecorationsBound = true;
		const original_after_render = listview.after_render;
		listview.after_render = function (...args) {
			const result = original_after_render?.apply(this, args);
			expand_roster_layout(this);
			stretch_roster_result_area(this);
			normalise_roster_list_cells(this);
			apply_roster_status_date_columns(this);
			remove_native_roster_list_header(this);
			ensure_roster_empty_result_header(this);
			return result;
		};
	}

	function build_roster_route_options(filters, search) {
		const route_options = {};
		Object.keys(filters || {}).forEach((fieldname) => {
			if (has_employee_field(fieldname)) {
				route_options[fieldname] = filters[fieldname];
			}
		});

		if (search && search.value && has_employee_field(search.fieldname)) {
			route_options[search.fieldname] = search.exact
				? search.value
				: ["like", `%${search.value}%`];
		}
		const current_company = get_current_roster_company();
		if (current_company) route_options.company = current_company;
		return route_options;
	}

	function build_roster_query(filters, search) {
		const params = new URLSearchParams();
		Object.keys(filters || {}).forEach((fieldname) => {
			if (has_employee_field(fieldname)) {
				params.set(fieldname, filters[fieldname]);
			}
		});

		if (search && search.value && has_employee_field(search.fieldname)) {
			params.set(
				search.fieldname,
				search.exact ? search.value : JSON.stringify(["like", `%${search.value}%`]),
			);
		}
		const current_company = get_current_roster_company();
		if (current_company) params.set("company", current_company);

		return params.toString();
	}

	function sync_active_roster_card(listview) {
		const wrapper = get_list_wrapper(listview);
		if (!wrapper) return;

		const preferred_label = sessionStorage.getItem("hrms_roster_active_card") || roster_cards[0].label;
		let active_label = roster_cards[0].label;
		if (preferred_label) {
			const preferred_card = roster_cards.find((card) => card.label === preferred_label);
			if (preferred_card) {
				active_label = preferred_label;
			}
		}

		roster_cards.forEach((card) => {
			const button = wrapper.querySelector(`.hrms-roster-card[data-label="${card.label}"]`);
			if (!button) return;
			button.classList.toggle("is-active", card.label === active_label);
		});
		update_roster_filter_status(listview);
	}

	function update_roster_filter_status(listview) {
		const wrapper = get_list_wrapper(listview);
		const panel = wrapper?.querySelector(".hrms-roster-summary");
		if (!panel) return;

		let status = panel.querySelector(".hrms-roster-filter-status");
		if (!status) {
			status = document.createElement("div");
			status.className = "hrms-roster-filter-status";
			panel.appendChild(status);
		}

		const card = get_active_roster_card();
		const column_filter = get_stored_roster_column_filter();
		const details = [__(card.label)];
		if (column_filter?.value) {
			const label = roster_filterable_columns.get(column_filter.fieldname)?.label || column_filter.fieldname;
			details.push(`${__(label)}：${column_filter.display_value || column_filter.value}`);
		}
		status.textContent = `${__("当前筛选")}：${details.join(" · ")}`;
	}

function hide_native_filter_controls() {
	document.querySelectorAll(".filter-button, .filter-popover").forEach((element) => {
		element.style.display = "none";
	});
}

	function hide_unused_roster_toolbar_controls(listview) {
		const page_wrapper = listview?.page?.wrapper?.[0] || listview?.page?.wrapper?.get?.(0);
		if (!page_wrapper) return;

		const allowed_labels = ["添加员工", "表单导入", "导出", "清空花名册"];
		const toolbar = page_wrapper.querySelector(".page-actions, .list-view-actions, .list-actions") || page_wrapper;

		// Sorting is provided by the fixed table header. Remove Frappe's separate
		// selector rather than leaving two competing entry points on the page.
		page_wrapper.querySelectorAll(".sort-selector").forEach((selector) => selector.remove());
		// Its now-empty parent keeps a full toolbar row between the fixed header
		// and the employee rows. The custom header owns all filter controls.
		page_wrapper.querySelectorAll(".filter-section").forEach((section) => section.remove());

		toolbar.querySelectorAll("button, [role='button'], .btn").forEach((control) => {
			if (control.closest(".hrms-roster-empty-result-header, .list-row-head")) return;
			const control_text = [
				control.textContent,
				control.getAttribute("title"),
				control.getAttribute("aria-label"),
			]
				.filter(Boolean)
				.join(" ")
				.replace(/\s+/g, " ")
				.trim();

			if (!allowed_labels.some((label) => control_text === label || control_text.startsWith(`${label} `))) {
				control.classList.add("hrms-roster-toolbar-control-hidden");
				control.setAttribute("aria-hidden", "true");
			}
		});

		page_wrapper.querySelectorAll(".list-search-form, .list-search, .list-search-input, input[type='search'], input[placeholder*='搜索']").forEach((control) => {
			// The roster's column inputs are search fields too.  Only hide Frappe's
			// generic top search, never the purpose-built inputs inside the header.
			if (control.matches(".hrms-roster-column-filter-input, .hrms-roster-empty-result-header__input, .hrms-roster-table-header__input")) return;
			const container = control.closest(".list-search-form, .list-search, .search-bar, .form-group, .input-group") || control;
			container.classList.add("hrms-roster-toolbar-control-hidden");
			container.setAttribute("aria-hidden", "true");
		});
	}

	function hide_roster_page_length_controls() {
		document.querySelectorAll(".list-paging-area").forEach((paging_area) => {
			paging_area.querySelectorAll("button, a, .btn, .dropdown-toggle").forEach((control) => {
				if (["20", "100", "500", "2500"].includes((control.textContent || "").trim())) {
					control.classList.add("hrms-roster-page-length-hidden");
				}
			});
		});
	}

	function get_roster_department_label(value) {
		return String(value || "").replace(/\s+-\s+[^-]+$/, "").trim();
	}

	function format_roster_department_display(value) {
		return frappe.utils.escape_html(get_roster_department_label(value));
	}

	function format_roster_employee_code_display(value, doc) {
		doc = doc || {};
		const display_value = doc.custom_employee_code || value || "";
		return frappe.utils.escape_html(display_value);
	}

	function normalise_roster_list_cells(listview) {
		const wrapper = get_list_wrapper(listview);
		if (!wrapper) return;

		const header_cells = Array.from(
			wrapper.querySelectorAll(".list-row-head .list-row-col, .list-header .list-row-col, .list-header-subject"),
		);
		const department_indexes = new Set();
		const employee_code_indexes = new Set();
		header_cells.forEach((cell, index) => {
			const text = (cell.textContent || "").trim();
			if (text === __("编号") || text === "编号" || text === "ID") {
				cell.textContent = __("工号");
				employee_code_indexes.add(index);
			}
			if (text === __("工号") || text === "工号") {
				employee_code_indexes.add(index);
			}
			if (text === __("部门") || text === "部门") {
				department_indexes.add(index);
			}
		});

		Array.from(wrapper.querySelectorAll(".list-row")).forEach((row, row_index) => {
			row.querySelectorAll(".list-row-activity").forEach((activity) => activity.remove());
			const cells = Array.from(row.querySelectorAll(".list-row-col"));
			const doc = listview?.data?.[row_index];
			const employee_name_cell = get_roster_employee_name_cell(cells, doc);
			if (employee_name_cell && doc) {
				prepend_roster_employee_photo(employee_name_cell, doc.image, doc.employee_name);
			}
			cells.forEach((cell, column_index) => {
				const text = (cell.textContent || "").trim();
				if (employee_code_indexes.has(column_index) && doc?.custom_employee_code) {
					cell.textContent = doc.custom_employee_code;
				}
				if (department_indexes.has(column_index) && /\s+-\s+[^-]+$/.test(text)) {
					cell.textContent = text.replace(/\s+-\s+[^-]+$/, "").trim();
				}
			});
		});
	}

	function get_roster_employee_name_cell(cells, doc) {
		if (!doc) return null;
		const by_fieldname = cells.find(
			(cell) =>
				cell.dataset.fieldname === "employee_name" ||
				Boolean(cell.querySelector('[data-fieldname="employee_name"]')),
		);
		if (by_fieldname) return by_fieldname;

		const employee_name = String(doc.employee_name || "").trim();
		return cells.find((cell) => (cell.textContent || "").trim() === employee_name) || null;
	}

	function prepend_roster_employee_photo(cell, image_url, employee_name) {
		cell.querySelector(".hrms-roster-photo-frame")?.remove();

		const photo = document.createElement("span");
		photo.className = "hrms-roster-photo-frame";
		photo.title = employee_name || __("员工照片");
		photo.style.cssText =
			"align-items:center;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:50%;box-sizing:border-box;display:inline-flex;flex:0 0 18px;height:18px;justify-content:center;max-height:18px;max-width:18px;min-height:18px;min-width:18px;overflow:hidden;width:18px;";
		const url = String(image_url || "").trim();
		if (url) {
			const image = document.createElement("img");
			image.src = url;
			image.alt = "";
			image.style.cssText = "display:block;height:100%;max-height:100%;max-width:100%;object-fit:cover;width:100%;";
			image.addEventListener("error", () => {
				image.remove();
				append_roster_default_avatar(photo);
			});
			photo.append(image);
		} else {
			append_roster_default_avatar(photo);
		}
		const checkbox_container = cell.querySelector(".list-row-checkbox")?.closest(".level-item");
		const employee_name_container = checkbox_container?.parentElement;
		if (employee_name_container) {
			employee_name_container.classList.add("hrms-roster-employee-name-cell");
			employee_name_container.style.cssText += "display:flex;align-items:center;gap:7px;min-width:0;";
			checkbox_container.insertAdjacentElement("afterend", photo);
			return;
		}

		cell.classList.add("hrms-roster-employee-name-cell");
		cell.prepend(photo);
	}

	function append_roster_default_avatar(photo) {
		photo.classList.add("hrms-roster-photo-frame--default");
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 20 20");
		svg.setAttribute("aria-hidden", "true");
		svg.style.cssText = "display:block;height:100%;width:100%;";
		const head = document.createElementNS("http://www.w3.org/2000/svg", "circle");
		head.setAttribute("cx", "10");
		head.setAttribute("cy", "7");
		head.setAttribute("r", "3.2");
		head.setAttribute("fill", "#9da7b2");
		const shoulders = document.createElementNS("http://www.w3.org/2000/svg", "path");
		shoulders.setAttribute("d", "M3.3 18c.5-3.9 3.1-6.1 6.7-6.1s6.2 2.2 6.7 6.1z");
		shoulders.setAttribute("fill", "#9da7b2");
		svg.append(head, shoulders);
		photo.append(svg);
	}

	// Frappe's default ListView opens the native Employee form when a row is
	// selected. Employee records are read through the dedicated archive page;
	// intercept the row action before ListView handles it so the first click
	// reaches the archive page instead of requiring a browser refresh.
	function bind_roster_employee_detail_navigation(listview) {
		const wrapper = get_list_wrapper(listview);
		if (!wrapper || wrapper.__hrmsRosterEmployeeDetailNavigationBound) return;

		wrapper.__hrmsRosterEmployeeDetailNavigationBound = true;
		wrapper.addEventListener(
			"click",
			(event) => {
				if (
					event.defaultPrevented ||
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey
				) {
					return;
				}

				const interactive = event.target.closest(
					"button, input, select, textarea, .btn, .dropdown-menu, .list-row-checkbox, [data-action]",
				);
				if (interactive) return;

				const employee = resolve_roster_employee_name(listview, event.target);
				if (!employee) return;

				event.preventDefault();
				event.stopImmediatePropagation();
				frappe.set_route("employee-detail", employee);
			},
			true,
		);
	}

	function resolve_roster_employee_name(listview, target) {
		const row = target.closest(".list-row");
		const named_element = target.closest("[data-name]");
		const direct_name = (row && row.getAttribute("data-name")) || (named_element && named_element.getAttribute("data-name"));
		if (direct_name) return direct_name;

		const link = target.closest("a[href]");
		const href = link && link.getAttribute("href");
		const match = href && href.match(/(?:employee|Employee)\/([^/?#]+)/);
		if (match && match[1]) return decodeURIComponent(match[1]);

		if (!row || !Array.isArray(listview.data)) return "";
		const rows = Array.from(get_list_wrapper(listview).querySelectorAll(".list-row"));
		const row_index = rows.indexOf(row);
		return row_index >= 0 ? listview.data[row_index]?.name || "" : "";
	}

	function mark_employee_roster_view() {
		document.body.classList.add("hrms-employee-roster-view");
	}

	function has_employee_field(fieldname) {
		const meta = frappe.get_meta(EMPLOYEE_DOCTYPE);
		return fieldname === "name" || Boolean(meta.fields.find((field) => field.fieldname === fieldname));
	}

	function get_list_wrapper(listview) {
		if (listview.page && listview.page.main && listview.page.main[0]) {
			return listview.page.main[0];
		}
		return document.querySelector(".layout-main-section");
	}
})();
