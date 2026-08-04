(function () {
	const EMPLOYEE_DOCTYPE = "Employee";
	const ROSTER_ALL_EMPLOYEES_PAGE_LENGTH = 500;
	const roster_phase_one_markers = {
		legacy_search_label: "姓名/手机号",
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
		{ label: "在职", filters: { status: "Active" } },
		{ label: "全职", filters: { status: "Active", employment_type: "Full-time" } },
		{ label: "实习生", filters: { status: "Active", employment_type: "Intern" } },
		{ label: "外包", filters: { status: "Active", employment_type: "Contract" } },
		{ label: "退休返聘", filters: { status: "Active", employment_type: "Retainer" } },
		{ label: "试用期", filters: { status: "Active", custom_is_confirmed: "否" } },
		{ label: "待离职", filters: { status: "Inactive" } },
		{ label: "正式", filters: { status: "Active", custom_is_confirmed: "是" } },
		{ label: "已离职", filters: { status: "Left" } },
	];

	const roster_list_columns = [
		{ fieldname: "employee_name", label: "姓名" },
		{ fieldname: "custom_employee_code", label: "工号" },
		{ fieldname: "department", label: "部门" },
		{ fieldname: "designation", label: "岗位" },
		{ fieldname: "employment_type", label: "工作性质" },
		{ fieldname: "date_of_joining", label: "入职日期" },
		{ fieldname: "custom_id_type", label: "证件类型" },
		{ fieldname: "passport_number", label: "证件号码" },
		{ fieldname: "cell_number", label: "手机号码" },
	];
	const roster_fieldnames = new Set(roster_list_columns.map((column) => column.fieldname));

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
			"status",
			"date_of_joining",
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
		set_search_placeholder();
		hide_native_filter_controls();
		hide_unused_roster_toolbar_controls(listview);
		hide_roster_page_length_controls();
		setup_roster_actions(listview);
		setup_roster_summary(listview);
		sync_active_roster_card(listview);
		setTimeout(function () {
			hide_native_filter_controls();
			hide_unused_roster_toolbar_controls(listview);
			hide_roster_page_length_controls();
			sync_active_roster_card(listview);
			normalise_roster_list_cells(listview);
		}, 300);
		normalise_roster_list_cells(listview);
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

		const search_hint = document.createElement("div");
		search_hint.className = "hrms-roster-search-hint";
		search_hint.innerHTML = [
			`<div class="hrms-roster-search-control">`,
			`<input class="form-control hrms-roster-search-input" type="search" placeholder="${frappe.utils.escape_html(__("姓名、手机号、工号"))}" aria-label="${frappe.utils.escape_html(__("姓名、手机号、工号"))}">`,
			`<button class="btn btn-default btn-sm hrms-roster-search-button" type="button">${frappe.utils.escape_html(__("搜索"))}</button>`,
			`</div>`,
		].join("");
		panel.appendChild(search_hint);

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
				apply_single_roster_filter(card);
			});
			cards.appendChild(button);
		});
		panel.appendChild(cards);

		wrapper.insertBefore(panel, wrapper.firstChild);
		setup_roster_search(listview, panel);
	}

	function setup_roster_search(listview, panel) {
		const input = panel.querySelector(".hrms-roster-search-input");
		const button = panel.querySelector(".hrms-roster-search-button");
		if (!input || !button) return;

		const run_search = () => {
			const value = input.value.trim();
			if (!value) {
				listview.refresh();
				return;
			}

			const fieldname = /^\\+?\\d[\\d\\s-]*$/.test(value) && has_employee_field("cell_number")
				? "cell_number"
				: /^[A-Za-z0-9_-]+$/.test(value) && has_employee_field("custom_employee_code")
					? "custom_employee_code"
					: "employee_name";
			apply_single_roster_filter({ label: "", filters: {} }, { fieldname, value });
		};

		button.addEventListener("click", run_search);
		input.addEventListener("keydown", function (event) {
			if (event.key === "Enter") {
				event.preventDefault();
				run_search();
			}
		});
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
		// Frappe ListView consumes route_options when it creates or refreshes a
		// list. Directly writing URL parameters bypasses that lifecycle and left
		// the card count and the displayed rows using different filters.
		frappe.route_options = build_roster_route_options(card.filters, search);
		frappe.set_route("List", EMPLOYEE_DOCTYPE);
	}

	function build_roster_route_options(filters, search) {
		const route_options = {};
		Object.keys(filters || {}).forEach((fieldname) => {
			if (has_employee_field(fieldname)) {
				route_options[fieldname] = filters[fieldname];
			}
		});

		if (search && search.value && has_employee_field(search.fieldname)) {
			route_options[search.fieldname] = ["like", `%${search.value}%`];
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
			params.set(search.fieldname, JSON.stringify(["like", `%${search.value}%`]));
		}

		return params.toString();
	}

	function sync_active_roster_card(listview) {
		const wrapper = get_list_wrapper(listview);
		if (!wrapper) return;

		const preferred_label = sessionStorage.getItem("hrms_roster_active_card") || "";
		let active_label = "";
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
	}

	function hide_native_filter_controls() {
		document.querySelectorAll(".filter-button, .filter-x-button, .filter-popover").forEach((element) => {
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

	function format_roster_department_display(value) {
		const display_value = String(value || "").replace(/\s+-\s+[^-]+$/, "").trim();
		return frappe.utils.escape_html(display_value);
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

	function set_search_placeholder() {
		document.querySelectorAll(".list-search input, input[type='search']").forEach((input) => {
			input.setAttribute("placeholder", __("姓名、手机号、工号"));
		});
	}

	function get_list_wrapper(listview) {
		if (listview.page && listview.page.main && listview.page.main[0]) {
			return listview.page.main[0];
		}
		return document.querySelector(".layout-main-section");
	}
})();
