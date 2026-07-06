(function () {
	const EMPLOYEE_DOCTYPE = "Employee";
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
		page_length: 20,
		dynamic_columns: true,
		quick_update_employee_roster: true,
		get_employee_roster: true,
		get_employee_roster_summary: true,
	};

	const roster_cards = [
		{ label: "在职", filters: { status: "Active" } },
		{ label: "全职", filters: { employment_type: "Full-time" } },
		{ label: "实习生", filters: { employment_type: "Intern" } },
		{ label: "外包", filters: { employment_type: "Contract" } },
		{ label: "退休返聘", filters: { employment_type: "Retainer" } },
		{ label: "试用期", filters: { status: "Active", employment_type: "Probation" } },
		{ label: "待离职", filters: { status: "Inactive" } },
		{ label: "正式", filters: { status: "Active" } },
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

	frappe.listview_settings[EMPLOYEE_DOCTYPE] = {
		add_fields: [
			"employee_name",
			"custom_employee_code",
			"employee_number",
			"department",
			"designation",
			"employment_type",
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

		mark_employee_roster_view();
		configure_roster_list_columns(listview);
		listview.page.set_title(__("员工花名册"));
		set_search_placeholder();
		hide_native_filter_controls();
		setup_roster_actions(listview);
		setup_roster_summary(listview);
		sync_active_roster_card(listview);
		setTimeout(function () {
			hide_native_filter_controls();
			sync_active_roster_card(listview);
		}, 300);
	}

	function configure_roster_list_columns(listview) {
		const meta = frappe.get_meta(EMPLOYEE_DOCTYPE);
		if (!meta || !Array.isArray(meta.fields)) return;

		const roster_fieldnames = new Set(roster_list_columns.map((column) => column.fieldname));
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

		if (listview.meta && Array.isArray(listview.meta.fields)) {
			listview.meta.fields = meta.fields;
		}
	}

	function setup_roster_actions(listview) {
		if (listview.page.__hrms_roster_actions_ready) return;
		listview.page.__hrms_roster_actions_ready = true;

		listview.page.set_primary_action(__("添加员工"), function () {
			frappe.new_doc(EMPLOYEE_DOCTYPE);
		});

		listview.page.add_inner_button(__("导入"), function () {
			frappe.set_route("employee-roster-import");
		});

		listview.page.add_inner_button(__("导出"), function () {
			frappe.set_route("employee-roster-export");
		});

		listview.page.add_inner_button(__("设置花名册字段"), function () {
			open_roster_field_settings();
		});

		listview.page.add_inner_button(__("更多功能"), function () {
			frappe.set_route("Workspaces", "人事");
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
		const query = build_roster_query(card.filters, search);
		const target = `/desk/employee${query ? `?${query}` : ""}`;
		if (window.location.pathname + window.location.search === target) {
			window.location.reload();
			return;
		}
		window.location.href = target;
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

		const params = new URLSearchParams(window.location.search);
		const preferred_label = sessionStorage.getItem("hrms_roster_active_card") || "";
		let active_label = "";
		if (preferred_label) {
			const preferred_card = roster_cards.find((card) => card.label === preferred_label);
			if (preferred_card && does_query_match_filters(params, preferred_card.filters)) {
				active_label = preferred_label;
			}
		}
		if (!active_label) {
			const first_match = roster_cards.find((card) => does_query_match_filters(params, card.filters));
			active_label = first_match ? first_match.label : "";
		}

		roster_cards.forEach((card) => {
			const button = wrapper.querySelector(`.hrms-roster-card[data-label="${card.label}"]`);
			if (!button) return;
			button.classList.toggle("is-active", card.label === active_label);
		});
	}

	function does_query_match_filters(params, filters) {
		return Object.keys(filters || {}).every((fieldname) => params.get(fieldname) === filters[fieldname]);
	}

	function hide_native_filter_controls() {
		document.querySelectorAll(".filter-button, .filter-x-button, .filter-popover").forEach((element) => {
			element.style.display = "none";
		});
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
