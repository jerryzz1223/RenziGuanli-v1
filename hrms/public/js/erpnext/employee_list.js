(function () {
	const EMPLOYEE_DOCTYPE = "Employee";
	const ROSTER_ALL_EMPLOYEES_PAGE_LENGTH = 500;
	const ROSTER_COLUMN_FILTER_STORAGE_KEY = "hrms_roster_column_filter";
	const ROSTER_DEPARTURE_DATE_STATUSES = new Set(["待离职", "已离职"]);
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

	const roster_cards = [
		{ label: "在职", filters: { custom_personnel_status: "在职" } },
		{ label: "试用期", filters: { custom_personnel_status: "试用期" } },
		{ label: "退休返聘", filters: { custom_personnel_status: "退休返聘" } },
		{ label: "待离职", filters: { custom_personnel_status: "待离职" } },
		{ label: "已离职", filters: { custom_personnel_status: "已离职" } },
	];

	const roster_list_columns = [
		{ fieldname: "employee_name", label: "姓名" },
		{ fieldname: "custom_employee_code", label: "工号" },
		{ fieldname: "department", label: "部门" },
		{ fieldname: "designation", label: "岗位" },
		{ fieldname: "custom_personnel_status", label: "工作性质" },
		{ fieldname: "date_of_joining", label: "入职日期" },
		{ fieldname: "relieving_date", label: "离职日期" },
		{ fieldname: "custom_id_type", label: "证件类型" },
		{ fieldname: "passport_number", label: "证件号码" },
		{ fieldname: "cell_number", label: "手机号码" },
	];
	const roster_fieldnames = new Set(roster_list_columns.map((column) => column.fieldname));
	const roster_filterable_columns = new Map(
		roster_list_columns.map((column) => [column.fieldname, column]),
	);

	// ListView snapshots its visible columns during construction. Apply the roster
	// configuration before it is instantiated, rather than waiting for onload.
	apply_roster_meta_columns();

	frappe.listview_settings[EMPLOYEE_DOCTYPE] = {
		hide_name_column: true,
		page_length: ROSTER_ALL_EMPLOYEES_PAGE_LENGTH,
		add_fields: [
			"employee_name",
			"custom_employee_code",
			"employee_number",
			"department",
			"designation",
			"employment_type",
			"custom_is_confirmed",
			"custom_personnel_status",
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
			custom_personnel_status(value) {
				return frappe.utils.escape_html(String(value || __("未设置")));
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

	function setup_roster_page(listview) {
		if (!listview || !listview.page) return;
		bind_natural_employee_code_sorting(listview);
		if (configure_roster_page_length(listview)) return;

		mark_employee_roster_view();
		bind_roster_employee_detail_navigation(listview);
		configure_roster_list_columns(listview);
		listview.page.set_title(__("员工花名册"));
		hide_native_filter_controls();
		hide_native_roster_field_filters(listview);
		hide_unused_roster_toolbar_controls(listview);
		hide_roster_page_length_controls();
	setup_roster_actions(listview);
	setup_roster_summary(listview);
		enhance_roster_column_headers(listview);
		bind_personnel_status_updates(listview);
		sync_active_roster_card(listview);
		sync_roster_status_date_column(listview);
		setTimeout(function () {
			hide_native_filter_controls();
			hide_native_roster_field_filters(listview);
			hide_unused_roster_toolbar_controls(listview);
			hide_roster_page_length_controls();
			sync_active_roster_card(listview);
		sync_roster_status_date_column(listview);
		normalise_roster_list_cells(listview);
		enhance_roster_column_headers(listview);
	}, 300);
		normalise_roster_list_cells(listview);
	}

	function sync_roster_status_date_column(listview) {
		const wrapper = get_list_wrapper(listview);
		if (!wrapper) return;

		const show_departure_date = ROSTER_DEPARTURE_DATE_STATUSES.has(get_active_roster_card().label);
		wrapper.classList.toggle("hrms-roster-shows-departure-date", show_departure_date);
		toggle_roster_date_column(wrapper, "date_of_joining", show_departure_date);
		toggle_roster_date_column(wrapper, "relieving_date", !show_departure_date);
	}

	function toggle_roster_date_column(wrapper, fieldname, hidden) {
		wrapper.querySelectorAll(`[data-fieldname="${fieldname}"]`).forEach((cell) => {
			cell.classList.toggle("hrms-roster-status-date-column-hidden", hidden);
			cell.style.setProperty("display", hidden ? "none" : "", hidden ? "important" : "");
			cell.setAttribute("aria-hidden", hidden ? "true" : "false");
		});
	}

	function bind_personnel_status_updates(listview) {
		if (listview.__hrmsPersonnelStatusUpdatesBound || !frappe.realtime?.on) return;
		listview.__hrmsPersonnelStatusUpdatesBound = true;

		frappe.realtime.on("hrms_employee_personnel_status_updated", function () {
			const route = frappe.get_route();
			if (route[0] !== "List" || route[1] !== EMPLOYEE_DOCTYPE) return;
			clearTimeout(listview.__hrmsPersonnelStatusRefreshTimer);
			listview.__hrmsPersonnelStatusRefreshTimer = setTimeout(function () {
				listview.refresh();
				update_roster_counts(listview);
			}, 120);
		});
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
		return String(employee?.custom_employee_code || employee?.employee_number || "").trim();
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
		listview.start = 0;
		listview.refresh();
		return true;
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

	listview.page.add_inner_button(__("设置花名册字段"), function () {
		open_roster_field_settings();
	});

	listview.page.add_inner_button(__("清除搜索与筛选"), function () {
		clear_roster_search_and_filters(listview, true);
	});

}

	function open_roster_field_settings() {
		sessionStorage.setItem("hrms_settings_center_active_module", "字段管理中心");
		sessionStorage.setItem("hrms_settings_center_focus", "roster_visible");
		frappe.set_route("hr-settings-center");
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

	function hide_native_roster_field_filters(listview) {
		const wrapper = get_list_wrapper(listview);
		if (!wrapper) return;

		wrapper.querySelectorAll(".standard-filter-section").forEach((section) => {
			section.classList.add("hrms-roster-native-filters-hidden");
			section.setAttribute("aria-hidden", "true");
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
		close_open_roster_column_filter(listview);
		cell.classList.add("is-filtering");

		const active_filter = get_stored_roster_column_filter();
		const editor = document.createElement("div");
		editor.className = "hrms-roster-column-filter-editor";
		editor.innerHTML = [
			`<input class="hrms-roster-column-filter-input" type="search" autocomplete="off" placeholder="${frappe.utils.escape_html(__("筛选{0}", [column.label]))}">`,
			`<button class="hrms-roster-column-filter-clear" type="button" aria-label="${frappe.utils.escape_html(__("清除{0}筛选", [column.label]))}" title="${frappe.utils.escape_html(__("清除筛选"))}">&times;</button>`,
			`<div class="hrms-roster-column-filter-suggestions" role="listbox"></div>`,
		].join("");
		cell.appendChild(editor);
		listview.__hrmsOpenRosterColumnFilter = { cell, editor };

		const input = editor.querySelector(".hrms-roster-column-filter-input");
		const clear_button = editor.querySelector(".hrms-roster-column-filter-clear");
		const suggestions = editor.querySelector(".hrms-roster-column-filter-suggestions");
		if (active_filter?.fieldname === column.fieldname) {
			input.value = active_filter.display_value || active_filter.value || "";
		}

		const render_suggestions = () => {
			const query = input.value.trim().toLocaleLowerCase("zh-CN");
			const matches = get_roster_filter_suggestions(listview, column.fieldname)
				.filter((item) => !query || item.label.toLocaleLowerCase("zh-CN").includes(query))
				.slice(0, 8);
			suggestions.replaceChildren();
			matches.forEach((item, index) => {
				const option = document.createElement("button");
				option.type = "button";
				option.className = "hrms-roster-column-filter-option";
				option.dataset.value = item.value;
				option.dataset.label = item.label;
				option.setAttribute("role", "option");
				option.classList.toggle("is-active", index === 0);
				option.textContent = item.label;
				option.addEventListener("mousedown", (event) => event.preventDefault());
				option.addEventListener("click", () => apply_roster_column_filter(column, item, true));
				suggestions.appendChild(option);
			});
			suggestions.classList.toggle("is-visible", matches.length > 0);
		};

		editor.addEventListener("click", (event) => event.stopPropagation());
		input.addEventListener("input", render_suggestions);
		input.addEventListener("focus", render_suggestions);
		input.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				close_open_roster_column_filter(listview);
				return;
			}
			if (event.key !== "Enter") return;
			event.preventDefault();
			const first_option = suggestions.querySelector(".hrms-roster-column-filter-option");
			if (first_option) {
				apply_roster_column_filter(
					column,
					{ value: first_option.dataset.value, label: first_option.dataset.label },
					true,
				);
				return;
			}
			const value = input.value.trim();
			if (value) apply_roster_column_filter(column, { value, label: value }, false);
		});
		clear_button.addEventListener("click", () => clear_roster_column_filter());

		const close_on_outside_click = (event) => {
			if (cell.contains(event.target)) return;
			close_open_roster_column_filter(listview);
		};
		listview.__hrmsRosterColumnFilterOutsideClick = close_on_outside_click;
		setTimeout(() => document.addEventListener("mousedown", close_on_outside_click), 0);
		input.focus();
		input.select();
	}

	function close_open_roster_column_filter(listview) {
		const current = listview?.__hrmsOpenRosterColumnFilter;
		if (current) {
			current.editor.remove();
			current.cell.classList.remove("is-filtering");
			delete listview.__hrmsOpenRosterColumnFilter;
		}
		if (listview?.__hrmsRosterColumnFilterOutsideClick) {
			document.removeEventListener("mousedown", listview.__hrmsRosterColumnFilterOutsideClick);
			delete listview.__hrmsRosterColumnFilterOutsideClick;
		}
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

	function clear_roster_search_and_filters(listview, show_alert) {
		sessionStorage.removeItem(ROSTER_COLUMN_FILTER_STORAGE_KEY);

		if (listview?.filter_area?.get_filters?.()?.length) {
			listview.filter_area.clear_filters();
		}
		if (listview) {
			listview.search_term = "";
		}
		clear_roster_native_search_input(listview);
		apply_single_roster_filter(get_active_roster_card());

		if (show_alert) {
			frappe.show_alert({
				message: __("已清除搜索与筛选，已恢复{0}", [__(get_active_roster_card().label)]),
				indicator: "green",
			});
		}
	}

	function clear_roster_native_search_input(listview) {
		listview?.search_field?.set_value?.("");
		listview?.search_field?.$input?.val?.("");
		listview?.$search_input?.val?.("");

		const page_wrapper = listview?.page?.wrapper?.[0] || listview?.page?.wrapper?.get?.(0);
		const wrapper = page_wrapper || get_list_wrapper(listview);
		const search_input = wrapper?.querySelector(
			".list-search input, .search-bar input, .search-input input, input[type=\"search\"]",
		);
		if (search_input) search_input.value = "";
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

		if (!Object.keys(available_filters).length) {
			return Promise.resolve(0);
		}

		return frappe.db.count(EMPLOYEE_DOCTYPE, { filters: available_filters });
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

		const unused_labels = ["列表视图", "List View", "已保存的筛选器", "Saved Filters"];
		const toolbar = page_wrapper.querySelector(".page-actions, .list-view-actions, .list-actions") || page_wrapper;

		toolbar.querySelectorAll("button, [role='button'], .btn").forEach((control) => {
			const control_text = [
				control.textContent,
				control.getAttribute("title"),
				control.getAttribute("aria-label"),
			]
				.filter(Boolean)
				.join(" ")
				.replace(/\s+/g, " ")
				.trim();

			if (unused_labels.some((label) => control_text === label || control_text.startsWith(`${label} `))) {
				control.classList.add("hrms-roster-toolbar-control-hidden");
				control.setAttribute("aria-hidden", "true");
			}
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
		const display_value = doc.custom_employee_code || doc.employee_number || value || "";
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
			const cells = Array.from(row.querySelectorAll(".list-row-col"));
			cells.forEach((cell, column_index) => {
				const text = (cell.textContent || "").trim();
				if (employee_code_indexes.has(column_index) && /^HR-EMP-\d+$/i.test(text)) {
					const doc = listview?.data?.[row_index];
					if (doc) {
						cell.textContent = doc.custom_employee_code || doc.employee_number || text;
					}
				}
				if (department_indexes.has(column_index) && /\s+-\s+[^-]+$/.test(text)) {
					cell.textContent = text.replace(/\s+-\s+[^-]+$/, "").trim();
				}
			});
		});
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
