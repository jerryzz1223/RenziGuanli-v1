frappe.pages["cross-department-support"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("跨部门支援"),
		single_column: true,
	});

	const support = new CrossDepartmentSupportPage(page);
	wrapper.cross_department_support = support;
	support.show();
};

class CrossDepartmentSupportPage {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.rows = [];
		this.page_number = 1;
		this.page_length = 10;
		this.total_pages = 1;
	}

	show() {
		this.page.set_primary_action(__("新建支援"), () =>
			frappe.new_doc("Cross Department Support Capability"),
		);
		this.render_shell();
		this.add_filters();
		this.apply_route_filters();
		this.bind_events();
		this.load_filter_options();
		this.search();
	}

	render_shell() {
		$(this.wrapper).html(`
			<div class="cross-department-support-page">
				<div class="cross-department-support-page__intro">
					<div><h4>${__("查询支援人员")}</h4><p>${__("可按原部门/岗位、可支援部门/岗位或姓名/工号查询；每项均可直接输入，并从下拉匹配项中选择。")}</p></div>
					<div class="cross-department-support-page__intro-actions"><button class="btn btn-default" data-action="open-import">${__("导入初始名单")}</button></div>
				</div>
				<div class="cross-department-support-page__filters" data-filters>
					<div class="cross-department-support-page__filter-group"><div class="cross-department-support-page__filter-label">${__("原部门 / 岗位查询")}</div><div class="cross-department-support-page__filter-fields" data-filter-group="source"></div></div>
					<div class="cross-department-support-page__filter-group"><div class="cross-department-support-page__filter-label">${__("可支援部门 / 岗位查询")}</div><div class="cross-department-support-page__filter-fields" data-filter-group="support"></div></div>
					<div class="cross-department-support-page__filter-group"><div class="cross-department-support-page__filter-label">${__("姓名 / 工号查询")}</div><div class="cross-department-support-page__filter-fields" data-filter-group="employee"></div></div>
					<div class="cross-department-support-page__filter-actions"><div data-filter-group="availability"></div><button class="btn btn-primary" data-action="search">${__("查询")}</button></div>
				</div>
				<div class="cross-department-support-page__summary" data-summary></div>
				<div class="cross-department-support-page__results" data-results></div>
			</div>
		`);
	}

	add_filters() {
		const filters = $(this.wrapper).find("[data-filters]");
		const reset_to_first_page = () => {
			this.page_number = 1;
		};
		const add_filter = (target, df) =>
			frappe.ui.form.make_control({
				parent: filters.find(target),
				df: { ...df, change: reset_to_first_page },
				render_input: true,
			});

		this.source_department = add_filter("[data-filter-group='source']", {
			fieldname: "source_department",
			label: __("原部门"),
			fieldtype: "Autocomplete",
			options: [],
		});
		this.source_designation = add_filter("[data-filter-group='source']", {
			fieldname: "source_designation",
			label: __("原岗位"),
			fieldtype: "Autocomplete",
			options: [],
		});
		this.department = add_filter("[data-filter-group='support']", {
			fieldname: "support_department",
			label: __("可支援部门"),
			fieldtype: "Autocomplete",
			options: [],
		});
		this.designation = add_filter("[data-filter-group='support']", {
			fieldname: "support_designation",
			label: __("可支援岗位"),
			fieldtype: "Autocomplete",
			options: [],
		});
		this.employee = add_filter("[data-filter-group='employee']", {
			fieldname: "employee_keyword",
			label: __("姓名或工号"),
			fieldtype: "Autocomplete",
			options: [],
		});
		this.show_unavailable = add_filter("[data-filter-group='availability']", {
			fieldname: "include_unavailable",
			label: __("同时显示不可派人员"),
			fieldtype: "Check",
			default: 1,
		});
	}

	load_filter_options() {
		frappe.call({
			method: "hrms.hr.doctype.cross_department_support_capability.cross_department_support_capability.get_support_filter_options",
		}).then((response) => {
			const options = response.message || {};
			this.set_autocomplete_options(this.source_department, options.source_departments || []);
			this.set_autocomplete_options(this.source_designation, options.source_designations || []);
			this.set_autocomplete_options(this.department, options.support_departments || []);
			this.set_autocomplete_options(this.designation, options.support_designations || []);
			this.set_autocomplete_options(this.employee, options.employees || []);
		});
	}

	set_autocomplete_options(control, options) {
		control.df.options = options;
		control.set_data?.(options);
		if (control.awesomplete) control.awesomplete.list = options;
	}

	apply_route_filters() {
		const route = frappe.get_route();
		if (route[1]) this.department.set_value(route[1]);
		if (route[2]) this.designation.set_value(route[2]);
	}

	bind_events() {
		$(this.wrapper).on("click", "[data-action='search']", () => this.search());
		$(this.wrapper).on("click", "[data-action='open-import']", () => this.open_import_dialog());
		$(this.wrapper).on("click", "[data-action='previous-page']", () => this.go_to_page(this.page_number - 1));
		$(this.wrapper).on("click", "[data-action='next-page']", () => this.go_to_page(this.page_number + 1));
		$(this.wrapper).on("click", "[data-capability]", (event) => {
			frappe.set_route("Form", "Cross Department Support Capability", event.currentTarget.dataset.capability);
		});
	}

	go_to_page(page_number) {
		if (page_number < 1 || page_number > this.total_pages) return;
		this.page_number = page_number;
		this.search();
	}

	download_import_template() {
		frappe
			.call({
				method: "hrms.hr.doctype.cross_department_support_capability.cross_department_support_capability.download_cross_department_support_template",
			})
			.then((response) => {
				const file = response.message || {};
				if (file.file_url) window.open(file.file_url);
			});
	}

	open_import_dialog() {
		let file_url = "";
		let preview = null;
		const dialog = new frappe.ui.Dialog({
			title: __("导入初始支援名单"),
			fields: [{ fieldtype: "HTML", fieldname: "import_content" }],
			primary_action_label: __("选择 Excel 文件"),
			primary_action: select_file,
		});

		function render_preview() {
			const body = dialog.fields_dict.import_content.$wrapper;
			if (!preview) {
				body.html(`<div class="cross-department-support-page__import-tip">
					<p>${__("支持现有的“部门、姓名、可支援部门、可支援岗位”名单格式。可支援部门和岗位可直接填写，不依赖系统主数据；同一人后续行留空部门、姓名或可支援部门时，系统会自动沿用上一行信息。")}</p>
					<button class="btn btn-default btn-sm" data-download-import-template>${__("下载空白模板")}</button>
				</div>`);
				body.find("[data-download-import-template]").on("click", () => this.download_import_template());
				dialog.set_primary_action(__("选择 Excel 文件"), select_file);
				return;
			}
			const escape = (value) => frappe.utils.escape_html(String(value || "—"));
			const sample = (preview.rows || []).slice(0, 12);
			const canImport = Boolean(preview.can_import);
			body.html(`
				<div class="cross-department-support-page__import-summary ${preview.failed ? "text-warning" : "text-success"}">
					${__("已读取 {0} 行；通过 {1} 行；错误 {2} 行。", [preview.total || 0, (preview.total || 0) - (preview.failed || 0), preview.failed || 0])}
				</div>
				${preview.failed ? `<div class="alert alert-warning">${__("异常行会导入为“待复核、不可派”记录；补齐员工、部门或岗位后即可正常使用。")}</div>` : ""}
				<table class="table table-bordered table-sm"><thead><tr><th>${__("Excel 行")}</th><th>${__("部门")}</th><th>${__("姓名")}</th><th>${__("可支援部门")}</th><th>${__("可支援岗位")}</th><th>${__("结果")}</th></tr></thead>
				<tbody>${sample.map((row) => `<tr><td>${escape(row.row_number)}</td><td>${escape(row.source_department)}</td><td>${escape(row.employee_name)}</td><td>${escape(row.support_department)}</td><td>${escape(row.support_designation)}</td><td>${row.errors?.length ? `<span class="text-warning">${escape(row.action)}：${escape(row.errors.join("；"))}</span>` : `<span class="text-success">${escape(row.action)}</span>`}</td></tr>`).join("")}</tbody></table>
				${(preview.rows || []).length > sample.length ? `<p class="text-muted">${__("仅显示前 12 行预览。")}</p>` : ""}
			`);
			dialog.set_primary_action(canImport ? (preview.failed ? __("导入并保留异常") : __("确认导入")) : __("重新选择文件"), canImport ? import_file : select_file);
		}

		function select_file() {
			new frappe.ui.FileUploader({
				folder: "Home/Attachments",
				restrictions: { allowed_file_types: [".xlsx"] },
				on_success: (file) => {
					file_url = file.file_url;
					frappe
						.call({
							method: "hrms.hr.doctype.cross_department_support_capability.cross_department_support_capability.preview_cross_department_support_import",
							args: { file_url },
							freeze: true,
							freeze_message: __("正在校验支援名单…"),
						})
						.then((response) => {
							preview = response.message || {};
							render_preview();
						});
				},
			});
		}

		function import_file() {
			frappe
				.call({
					method: "hrms.hr.doctype.cross_department_support_capability.cross_department_support_capability.import_cross_department_support_capabilities",
					args: { file_url },
					freeze: true,
					freeze_message: __("正在导入支援名单…"),
				})
				.then((response) => {
					const result = response.message || {};
					dialog.hide();
					const pendingText = result.pending_review ? __("；其中 {0} 条为待复核记录。", [result.pending_review]) : "";
					frappe.show_alert({ message: __("已新增 {0} 条支援记录，跳过 {1} 条已有记录{2}", [result.inserted || 0, result.skipped || 0, pendingText]), indicator: "green" });
					this.search();
				});
		}

		render_preview();
		dialog.show();
	}

	search() {
		const args = {
			source_department: this.source_department?.get_value() || "",
			source_designation: this.source_designation?.get_value() || "",
			support_department: this.department?.get_value() || "",
			support_designation: this.designation?.get_value() || "",
			employee_keyword: this.employee?.get_value() || "",
			include_unavailable: this.show_unavailable?.get_value() || 0,
			page: this.page_number,
			page_length: this.page_length,
		};
		frappe.call({
			method: "hrms.hr.doctype.cross_department_support_capability.cross_department_support_capability.get_available_support_candidates",
			args,
			freeze: true,
			freeze_message: __("正在查询可支援人员..."),
		}).then((response) => {
			const result = response.message || {};
			this.rows = result.rows || [];
			this.page_number = result.page || 1;
			this.total_pages = result.total_pages || 1;
			this.render_results(result.count || 0);
		});
	}

	render_results(count) {
		$(this.wrapper).find("[data-summary]").html(`
			<div class="cross-department-support-page__count"><strong>${frappe.utils.escape_html(String(count))}</strong><span>${__("名符合当前条件")}</span></div>
			<div class="text-muted">${__("名单会随新增或状态变更立即更新。")}</div>
		`);
		const result = $(this.wrapper).find("[data-results]");
		if (!this.rows.length) {
			result.html(`<div class="frappe-empty-state"><div class="text-muted">${__("没有符合条件的可支援人员。可先新增人员能力，或放宽部门/岗位筛选。")}</div></div>`);
			return;
		}
		result.html(`
			<table class="table table-bordered table-hover">
				<thead><tr><th>${__("姓名 / 工号")}</th><th>${__("原部门 / 岗位")}</th><th>${__("可支援部门")}</th><th>${__("可支援岗位")}</th><th>${__("状态")}</th><th>${__("有效期")}</th><th>${__("备注")}</th></tr></thead>
				<tbody>${this.rows.map((row) => this.render_row(row)).join("")}</tbody>
			</table>
			${this.render_pagination(count)}
		`);
	}

	render_pagination(count) {
		if (count <= this.page_length) return "";
		return `<div class="cross-department-support-page__pagination">
			<span class="text-muted">${__("第 {0} / {1} 页，共 {2} 名", [this.page_number, this.total_pages, count])}</span>
			<div><button class="btn btn-default btn-sm" data-action="previous-page" ${this.page_number === 1 ? "disabled" : ""}>${__("上一页")}</button><button class="btn btn-default btn-sm" data-action="next-page" ${this.page_number === this.total_pages ? "disabled" : ""}>${__("下一页")}</button></div>
		</div>`;
	}

	render_row(row) {
		const escape = (value) => frappe.utils.escape_html(value || "");
		const two_lines = (primary, secondary, emphasize = false) => `${primary ? (emphasize ? `<strong>${escape(primary)}</strong>` : escape(primary)) : ""}${secondary ? `${primary ? "<br>" : ""}<small class="text-muted">${escape(secondary)}</small>` : ""}`;
		const period = row.valid_from || row.valid_until ? `${escape(row.valid_from || __("不限"))} ~ ${escape(row.valid_until || __("不限"))}` : __("长期有效");
		const indicator = row.availability === "可派" ? "green" : "gray";
		return `<tr class="pointer" data-capability="${escape(row.name)}">
			<td>${two_lines(row.employee_name, row.employee_code, true)}</td>
			<td>${two_lines(row.source_department, row.source_designation)}</td>
			<td>${escape(row.support_department)}</td><td>${escape(row.support_designation)}</td>
			<td><span class="indicator-pill ${indicator}">${escape(row.availability)}</span><br><small class="text-muted">${escape(row.qualification_status)}</small></td>
			<td>${period}</td><td>${escape(row.remarks)}</td>
		</tr>`;
	}
}
