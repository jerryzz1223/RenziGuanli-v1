frappe.pages["employee-archive"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("员工档案库"),
		single_column: true,
	});

	const view = new EmployeeArchivePage(page);
	view.show();
};

class EmployeeArchivePage {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.selected_status_card = "";
		this.department_filter = "";
		this.search = "";
		this.sort_by = "modified";
		this.sort_order = "desc";
		this.page_number = 1;
		this.page_length = 500;
		this.dynamic_columns = [];
		this.rows = [];
		this.total = 0;
		this.status_cards = [];
		this.sort_options = [];
		this.legacy_search_label = "姓名/手机号";
		this.roster_labels = ["员工姓名", "姓名", "工号", "部门", "岗位", "工作性质", "入职日期", "证件类型", "证件号码", "手机号码", "操作"];
	}

	show() {
		this.page.set_primary_action(__("添加员工"), () => frappe.new_doc("Employee"));
		this.page.add_inner_button(__("导入花名册"), () => frappe.set_route("employee-roster-import"));
		this.page.add_inner_button(__("导出花名册"), () => {
			sessionStorage.setItem("hrms_employee_roster_current_filters", JSON.stringify(this.build_filters()));
			frappe.set_route("employee-roster-export");
		});
		this.page.add_inner_button(__("设置花名册字段"), () => this.open_roster_field_settings());
		this.page.add_inner_button(__("打开标准列表"), () => frappe.set_route("List", "Employee"));
		this.render_shell();
		this.load();
		this.load_summary();
	}

	open_roster_field_settings() {
		sessionStorage.setItem("hrms_settings_center_active_module", "字段管理中心");
		sessionStorage.setItem("hrms_settings_center_focus", "roster_visible");
		frappe.set_route("hr-settings-center");
	}

	render_shell() {
		this.wrapper.innerHTML = `
			<div class="hrms-archive-page hrms-employee-archive-view">
				<div class="hrms-archive-summary" data-summary></div>
				<div class="hrms-archive-toolbar">
					<div class="hrms-archive-search">
						<input class="form-control hrms-archive-search-input" type="search"
							placeholder="${frappe.utils.escape_html(__("姓名、手机号、工号"))}">
						<button class="btn btn-default btn-sm hrms-archive-search-button" type="button">
							${frappe.utils.escape_html(__("搜索"))}
						</button>
					</div>
					<select class="form-control hrms-archive-department" title="${frappe.utils.escape_html(__("部门筛选"))}">
						<option value="">${frappe.utils.escape_html(__("全部部门"))}</option>
					</select>
					<select class="form-control hrms-archive-sort" title="${frappe.utils.escape_html(__("排序"))}"></select>
				</div>
				<div class="hrms-archive-table-wrap">
					<table class="table table-bordered hrms-archive-table">
						<thead class="hrms-archive-head"></thead>
						<tbody class="hrms-archive-rows"></tbody>
					</table>
					<div class="hrms-archive-empty text-muted hidden">
						${frappe.utils.escape_html(__("当前没有真实员工档案"))}
					</div>
				</div>
				<div class="hrms-archive-pagination">
					<button class="btn btn-default btn-sm" data-page-prev>${frappe.utils.escape_html(__("上一页"))}</button>
					<span data-page-status>${frappe.utils.escape_html(__("分页"))}</span>
					<button class="btn btn-default btn-sm" data-page-next>${frappe.utils.escape_html(__("下一页"))}</button>
				</div>
			</div>
		`;

		this.bind_events();
		this.load_departments();
	}

	bind_events() {
		this.wrapper.querySelector(".hrms-archive-search-button").addEventListener("click", () => this.run_search());
		this.wrapper.querySelector(".hrms-archive-search-input").addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.run_search();
			}
		});
		this.wrapper.querySelector(".hrms-archive-department").addEventListener("change", (event) => {
			this.department_filter = event.target.value;
			this.page_number = 1;
			this.load();
			this.load_summary();
		});
		this.wrapper.querySelector(".hrms-archive-sort").addEventListener("change", (event) => {
			this.sort_by = event.target.value;
			this.page_number = 1;
			this.load();
		});
		this.wrapper.querySelector("[data-page-prev]").addEventListener("click", () => {
			if (this.page_number <= 1) return;
			this.page_number -= 1;
			this.load();
		});
		this.wrapper.querySelector("[data-page-next]").addEventListener("click", () => {
			if (this.page_number * this.page_length >= this.total) return;
			this.page_number += 1;
			this.load();
		});
	}

	run_search() {
		this.search = this.wrapper.querySelector(".hrms-archive-search-input").value.trim();
		this.page_number = 1;
		this.load();
	}

	build_filters(extra_filters = {}) {
		const filters = {};
		if (this.department_filter) filters.department = this.department_filter;
		if (this.selected_status_card) Object.assign(filters, this.selected_status_card.filters || {});
		Object.assign(filters, extra_filters);
		return filters;
	}

	load() {
		this.set_loading(true);
		frappe.call({
			method: "hrms.api.employee_field_template.get_employee_roster",
			args: {
				filters: JSON.stringify(this.build_filters()),
				search: this.search,
				sort_by: this.sort_by,
				sort_order: this.sort_order,
				page: this.page_number,
				page_length: this.page_length,
			},
			callback: (response) => {
				this.set_loading(false);
				const data = response.message || {};
				this.rows = data.rows || [];
				this.dynamic_columns = data.columns || [];
				this.total = data.total || 0;
				this.page_length = data.page_length || this.page_length;
				this.status_cards = data.status_cards || this.status_cards;
				this.sort_options = data.sort_options || this.sort_options;
				this.render_sort_options();
				this.render_table();
				this.render_pagination();
			},
			error: () => {
				this.set_loading(false);
				frappe.msgprint(__("员工花名册读取失败，请检查 Employee 权限或字段配置。"));
			},
		});
	}

	load_summary() {
		frappe.call({
			method: "hrms.api.employee_field_template.get_employee_roster_summary",
			args: { filters: JSON.stringify(this.build_filters()) },
			callback: (response) => {
				this.status_cards = response.message || [];
				this.render_summary();
			},
		});
	}

	load_departments() {
		frappe.db
			.get_list("Department", { fields: ["name", "department_name"], limit: 200, order_by: "department_name asc" })
			.then((departments) => {
				const select = this.wrapper.querySelector(".hrms-archive-department");
				departments.forEach((department) => {
					const option = document.createElement("option");
					option.value = department.name;
					option.textContent = department.department_name || this.format_department_display(department.name);
					select.appendChild(option);
				});
			});
	}

	render_summary() {
		const summary = this.wrapper.querySelector("[data-summary]");
		summary.innerHTML = `
			<div class="hrms-roster-summary__cards">
				${(this.status_cards || [])
					.map(
						(card) => `
						<button type="button" class="hrms-roster-card ${this.selected_status_card?.label === card.label ? "is-active" : ""}" data-card-label="${frappe.utils.escape_html(card.label)}">
							<span class="hrms-roster-card__label">${frappe.utils.escape_html(__(card.label))}</span>
							<strong class="hrms-roster-card__value">${frappe.utils.escape_html(card.count ?? "-")}</strong>
							<span class="hrms-roster-card__unit">${frappe.utils.escape_html(__("人"))}</span>
						</button>`,
					)
					.join("")}
			</div>
		`;
		summary.querySelectorAll("[data-card-label]").forEach((button) => {
			button.addEventListener("click", () => {
				const card = this.status_cards.find((item) => item.label === button.dataset.cardLabel);
				this.selected_status_card = this.selected_status_card?.label === card?.label ? "" : card;
				this.page_number = 1;
				this.load();
				this.render_summary();
			});
		});
	}

	render_sort_options() {
		const select = this.wrapper.querySelector(".hrms-archive-sort");
		if (select.dataset.ready) return;
		const options = this.sort_options.length
			? this.sort_options
			: [
					{ label: "入职日期", value: "date_of_joining" },
					{ label: "更新时间", value: "modified" },
					{ label: "姓名", value: "employee_name" },
					{ label: "工号", value: "custom_employee_code" },
				];
		select.innerHTML = options
			.map((option) => `<option value="${option.value}">${frappe.utils.escape_html(__(option.label))}</option>`)
			.join("");
		select.value = this.sort_by;
		select.dataset.ready = "1";
	}

	render_table() {
		const head = this.wrapper.querySelector(".hrms-archive-head");
		const tbody = this.wrapper.querySelector(".hrms-archive-rows");
		const empty = this.wrapper.querySelector(".hrms-archive-empty");
		const columns = this.dynamic_columns;
		head.innerHTML = `
			<tr>
				${columns.map((column) => `<th>${frappe.utils.escape_html(__(column.field_label))}</th>`).join("")}
				<th>${frappe.utils.escape_html(__("操作"))}</th>
			</tr>
		`;
		tbody.innerHTML = "";
		empty.classList.toggle("hidden", this.rows.length > 0);

		this.rows.forEach((employee) => {
			const tr = document.createElement("tr");
			tr.className = "hrms-archive-row";
			tr.innerHTML = `
				${columns.map((column) => `<td>${this.render_cell(employee, column)}</td>`).join("")}
				<td><button class="btn btn-xs btn-default" data-quick-edit>${frappe.utils.escape_html(__("快速编辑"))}</button></td>
			`;
			tr.addEventListener("click", (event) => {
				if (event.target.closest("button")) return;
				frappe.set_route("employee-detail", employee.name);
			});
			tr.querySelector("[data-quick-edit]").addEventListener("click", (event) => {
				event.stopPropagation();
				this.open_quick_edit(employee);
			});
			tbody.appendChild(tr);
		});
	}

	render_cell(employee, column) {
		const value = employee[column.fieldname] || "";
		if (column.fieldname === "employee_name") {
			return `
				<div class="hrms-archive-person">
					${employee.image ? `<img class="hrms-archive-avatar" src="${frappe.utils.escape_html(employee.image)}" alt="">` : `<span class="avatar avatar-small"><span class="avatar-frame standard-image"></span></span>`}
					<strong>${frappe.utils.escape_html(value || employee.name || "")}</strong>
				</div>
			`;
		}
		if (column.fieldname === "department") {
			return frappe.utils.escape_html(__(employee.department_display || this.format_department_display(value)));
		}
		if (column.fieldname === "custom_employee_code") {
			return frappe.utils.escape_html(__(employee.employee_code_display || value || employee.employee_number || ""));
		}
		return frappe.utils.escape_html(__(String(value)));
	}

	format_department_display(value) {
		return String(value || "").replace(/\s+-\s+[^-]+$/, "").trim();
	}

	open_quick_edit(employee) {
		frappe.prompt(
			[
				{ fieldname: "department", fieldtype: "Link", options: "Department", label: __("部门"), default: employee.department },
				{ fieldname: "designation", fieldtype: "Link", options: "Designation", label: __("职位"), default: employee.designation },
				{ fieldname: "cell_number", fieldtype: "Data", label: __("手机号"), default: employee.cell_number },
				{ fieldname: "status", fieldtype: "Select", label: __("员工状态"), options: "Active\nInactive\nSuspended\nLeft", default: employee.status },
			],
			(values) => {
				frappe.call({
					method: "hrms.api.employee_field_template.quick_update_employee_roster",
					args: { employee: employee.name, values: JSON.stringify(values) },
					callback: () => this.load(),
				});
			},
			__("快速编辑"),
			__("保存"),
		);
	}

	render_pagination() {
		const total_pages = Math.max(Math.ceil(this.total / this.page_length), 1);
		const pagination = this.wrapper.querySelector(".hrms-archive-pagination");
		pagination.classList.toggle("hidden", total_pages <= 1);
		this.wrapper.querySelector("[data-page-status]").textContent = __("分页 {0} / {1}，共 {2} 人", [
			this.page_number,
			total_pages,
			this.total,
		]);
	}

	set_loading(is_loading) {
		this.wrapper.querySelector(".hrms-archive-table-wrap").classList.toggle("is-loading", is_loading);
	}
}
