frappe.pages["employee-roster-export"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("自定义导出"),
		single_column: true,
	});

	const state = {
		schema: null,
		selected: new Set(),
		selected_tables: new Set(),
		active_category: "",
		export_scope: "all",
		current_filters: {},
		export_records: [],
		schema_request_id: 0,
		records_request_id: 0,
	};

	$(page.body).addClass("hrms-roster-export-page");
	page.set_secondary_action(__("返回"), () => frappe.set_route("List", "Employee"));

	function load_schema() {
		try {
			state.current_filters = JSON.parse(sessionStorage.getItem("hrms_employee_roster_current_filters") || "{}");
		} catch (e) {
			state.current_filters = {};
		}
		const company = window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
		if (company) state.current_filters.company = company;
		const request_id = ++state.schema_request_id;
		return frappe.call("hrms.api.employee_field_template.get_employee_import_export_schema").then((r) => {
			if (request_id !== state.schema_request_id) return;
			state.schema = r.message;
			state.active_category = state.schema.categories?.[0]?.label || "";
			(state.schema.fields || []).forEach((field) => {
				if (field.required) state.selected.add(field.fieldname);
			});
			load_export_records();
			render();
		});
	}

	function load_export_records() {
		const request_id = ++state.records_request_id;
		return frappe.call({
			method: "hrms.api.employee_field_template.get_employee_export_records",
			args: { current_filters: JSON.stringify(state.current_filters) },
		}).then((r) => {
			if (request_id !== state.records_request_id) return;
			state.export_records = r.message || [];
		});
	}

	function render() {
		if (!state.schema) {
			$(page.body).html(`<div class="text-muted">${__("正在加载字段配置...")}</div>`);
			return;
		}
		page.set_primary_action(__("排序并导出"), export_selected, "download");
		$(page.body).html(`
			<div class="hrms-export-shell">
				<div class="hrms-export-note">
					<span class="text-danger">*</span> ${__("选择需要导出的字段，已勾选的必选字段不可取消。")}
					<span class="text-muted ml-2">${__("字段来源于员工属性设置，禁用字段不会出现在导出范围内。")}</span>
					<span class="text-muted ml-2">${__("导出模板设置位于设置中心，可保存导出模板。")}</span>
				</div>
				<div class="hrms-export-layout">
					<div class="hrms-export-categories">
						${render_category_menu()}
					</div>
					<div class="hrms-export-fields">
						${render_export_scope()}
						${render_active_fields()}
					</div>
				</div>
				${render_multi_record_categories()}
				${render_export_records()}
				<div class="hrms-export-footer">
					<span>${__("已选择 {0} 个字段，{1} 个工作表", [state.selected.size, state.selected_tables.size])}</span>
					<button class="btn btn-default" data-action="save-report">${__("保存为人事报表")}</button>
					<button class="btn btn-primary" data-action="export">${__("排序并导出")}</button>
				</div>
			</div>
		`);
	}

	function render_export_scope() {
		return `
			<div class="hrms-export-scope">
				<label class="hrms-export-check">
					<input type="radio" name="export_scope" value="all" ${state.export_scope === "all" ? "checked" : ""}>
					<span>${__("全部员工")}</span>
				</label>
				<label class="hrms-export-check">
					<input type="radio" name="export_scope" value="current_filters" ${state.export_scope === "current_filters" ? "checked" : ""}>
					<span>${__("当前筛选结果")}</span>
				</label>
			</div>
		`;
	}

	function render_category_menu() {
		return (state.schema.categories || [])
			.map(
				(category) => `
				<button class="hrms-export-category ${state.active_category === category.label ? "is-active" : ""}" data-category="${category.label}">
					${frappe.utils.escape_html(__(category.label))}
				</button>`,
			)
			.join("");
	}

	function render_active_fields() {
		const category = (state.schema.categories || []).find((item) => item.label === state.active_category);
		const fields = category?.fields || [];
		return `
			<div class="hrms-export-field-grid">
				${fields
					.map((field) => {
						const checked = state.selected.has(field.fieldname);
						const disabled = field.required ? "disabled" : "";
						return `
							<label class="hrms-export-check">
								<input type="checkbox" data-fieldname="${field.fieldname}" ${checked ? "checked" : ""} ${disabled}>
								<span>${frappe.utils.escape_html(field.field_label)}${field.required ? " *" : ""}</span>
							</label>`;
					})
					.join("")}
			</div>`;
	}

	function render_multi_record_categories() {
		const rows = state.schema.multi_record_categories || [];
		return `
			<div class="hrms-export-repeat-section">
				<div class="hrms-export-repeat-note">
					<span class="text-danger">*</span> ${__("以下信息每个员工可能会有一条或多条记录，可统一选择是否作为独立工作表导出。基础信息、联系信息、合同信息、工资社保等工作表会按所选分类生成。")}
				</div>
				<table class="table table-bordered hrms-export-repeat-table">
					<thead><tr><th>${__("工作表分类")}</th><th>${__("描述")}</th></tr></thead>
					<tbody>
						${rows
							.map((row) => {
								const checked = state.selected_tables.has(row.label) ? "checked" : "";
								return `
								<tr>
									<td>
										<label class="hrms-export-check">
											<input type="checkbox" data-table-name="${frappe.utils.escape_html(row.label)}" ${checked}>
											<span>${frappe.utils.escape_html(row.label)}</span>
										</label>
									</td>
									<td>${frappe.utils.escape_html(row.description)}</td>
								</tr>`;
							})
							.join("")}
					</tbody>
				</table>
			</div>
		`;
	}

	function render_export_records() {
		return `
			<div class="hrms-export-records">
				<h4>${__("导出记录")}</h4>
				${
					state.export_records.length
						? `<table class="table table-bordered">
							<thead><tr><th>${__("时间")}</th><th>${__("文件")}</th><th>${__("范围")}</th><th>${__("用户")}</th></tr></thead>
							<tbody>${state.export_records
								.map(
									(record) => `
									<tr>
										<td>${frappe.utils.escape_html(record.created_at || "")}</td>
										<td>${frappe.utils.escape_html(record.filename || "")}</td>
										<td>${frappe.utils.escape_html(record.export_scope === "current_filters" ? __("当前筛选结果") : __("全部员工"))}</td>
										<td>${frappe.utils.escape_html(record.user || "")}</td>
									</tr>`,
								)
								.join("")}</tbody>
						</table>`
						: `<div class="text-muted">${__("暂无导出记录")}</div>`
				}
			</div>
		`;
	}

	function export_selected() {
		const fields = encodeURIComponent(JSON.stringify(Array.from(state.selected)));
		const tables = encodeURIComponent(JSON.stringify(Array.from(state.selected_tables)));
		const export_scope = encodeURIComponent(state.export_scope);
		const current_filters = encodeURIComponent(JSON.stringify(state.current_filters));
		window.open(
			frappe.urllib.get_full_url(
				`/api/method/hrms.api.employee_field_template.download_employee_roster_export?fields=${fields}&tables=${tables}&export_scope=${export_scope}&current_filters=${current_filters}`,
			),
		);
		setTimeout(() => load_export_records().then(render), 800);
	}

	function save_report() {
		if (!state.selected.size) {
			frappe.msgprint(__("请至少选择一个字段"));
			return;
		}

		frappe.prompt(
			[
				{
					fieldname: "report_name",
					fieldtype: "Data",
					label: __("报表名称"),
					reqd: 1,
				},
				{
					fieldname: "description",
					fieldtype: "Small Text",
					label: __("报表描述"),
				},
				{
					default: "人事档案",
					fieldname: "group_name",
					fieldtype: "Select",
					label: __("报表分组"),
					options: ["人事档案", "人事统计", "行政报表"].join("\n"),
					reqd: 1,
				},
			],
			(values) => {
				frappe
					.call({
						method: "hrms.api.employee_field_template.save_employee_roster_report",
						args: {
							report_name: values.report_name,
							description: values.description || "",
							group_name: values.group_name,
							fields: JSON.stringify(Array.from(state.selected)),
							tables: JSON.stringify(Array.from(state.selected_tables)),
						},
						freeze: true,
						freeze_message: __("正在保存报表..."),
					})
					.then(() => {
						frappe.show_alert({ message: __("报表已保存"), indicator: "green" });
						frappe.set_route("personnel-reports");
					});
			},
			__("保存为人事报表"),
			__("保存"),
		);
	}

	$(page.body).on("click", "[data-category]", function () {
		state.active_category = this.dataset.category;
		render();
	});

	$(page.body).on("change", "input[data-fieldname]", function () {
		if (this.checked) {
			state.selected.add(this.dataset.fieldname);
		} else {
			state.selected.delete(this.dataset.fieldname);
		}
		render();
	});

	$(page.body).on("change", "input[data-table-name]", function () {
		if (this.checked) {
			state.selected_tables.add(this.dataset.tableName);
		} else {
			state.selected_tables.delete(this.dataset.tableName);
		}
		render();
	});

	$(page.body).on("change", "input[name='export_scope']", function () {
		state.export_scope = this.value;
		render();
	});

	$(page.body).on("click", "[data-action='export']", export_selected);
	$(page.body).on("click", "[data-action='save-report']", save_report);

	wrapper.employee_roster_export = {
		refresh() {
			return load_schema();
		},
	};
	load_schema();
};

frappe.pages["employee-roster-export"].on_page_show = function (wrapper) {
	wrapper.employee_roster_export?.refresh();
};
