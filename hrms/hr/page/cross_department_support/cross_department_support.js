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
	}

	show() {
		this.page.set_primary_action(__("新增支援能力"), () =>
			frappe.new_doc("Cross Department Support Capability"),
		);
		this.page.set_secondary_action(__("维护台账"), () =>
			frappe.set_route("List", "Cross Department Support Capability"),
		);
		this.render_shell();
		this.add_filters();
		this.apply_route_filters();
		this.bind_events();
		this.search();
	}

	render_shell() {
		$(this.wrapper).html(`
			<div class="cross-department-support-page">
				<div class="cross-department-support-page__intro">
					<div><h4>${__("快速查询可派人员")}</h4><p>${__("选择需要支援的部门和岗位，例如：连续课 / 收料员；系统只显示资格有效且在有效期内的人员。")}</p></div>
					<div class="cross-department-support-page__intro-actions"><button class="btn btn-default" data-action="open-import">${__("导入初始名单")}</button><button class="btn btn-primary" data-action="search">${__("查询")}</button></div>
				</div>
				<div class="cross-department-support-page__filters" data-filters></div>
				<div class="cross-department-support-page__summary" data-summary></div>
				<div class="cross-department-support-page__results" data-results></div>
			</div>
		`);
	}

	add_filters() {
		const filters = $(this.wrapper).find("[data-filters]");
		this.department = this.page.add_field({
			fieldname: "support_department",
			label: __("需要支援的部门"),
			fieldtype: "Data",
			change: () => this.search(),
		});
		this.designation = this.page.add_field({
			fieldname: "support_designation",
			label: __("需要支援的岗位"),
			fieldtype: "Data",
			change: () => this.search(),
		});
		this.employee = this.page.add_field({
			fieldname: "employee",
			label: __("指定员工（可选）"),
			fieldtype: "Link",
			options: "Employee",
			change: () => this.search(),
		});
		this.show_unavailable = this.page.add_field({
			fieldname: "include_unavailable",
			label: __("显示不可派人员"),
			fieldtype: "Check",
			change: () => this.search(),
		});
		filters.append(this.department.$wrapper, this.designation.$wrapper, this.employee.$wrapper, this.show_unavailable.$wrapper);
	}

	apply_route_filters() {
		const route = frappe.get_route();
		if (route[1]) this.department.set_value(route[1]);
		if (route[2]) this.designation.set_value(route[2]);
	}

	bind_events() {
		$(this.wrapper).on("click", "[data-action='search']", () => this.search());
		$(this.wrapper).on("click", "[data-action='open-import']", () => this.open_import_dialog());
		$(this.wrapper).on("click", "[data-capability]", (event) => {
			frappe.set_route("Form", "Cross Department Support Capability", event.currentTarget.dataset.capability);
		});
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
			body.html(`
				<div class="cross-department-support-page__import-summary ${preview.failed ? "text-danger" : "text-success"}">
					${__("已读取 {0} 行；通过 {1} 行；错误 {2} 行。", [preview.total || 0, (preview.total || 0) - (preview.failed || 0), preview.failed || 0])}
				</div>
				<table class="table table-bordered table-sm"><thead><tr><th>${__("Excel 行")}</th><th>${__("部门")}</th><th>${__("姓名")}</th><th>${__("可支援部门")}</th><th>${__("可支援岗位")}</th><th>${__("结果")}</th></tr></thead>
				<tbody>${sample.map((row) => `<tr><td>${escape(row.row_number)}</td><td>${escape(row.source_department)}</td><td>${escape(row.employee_name)}</td><td>${escape(row.support_department)}</td><td>${escape(row.support_designation)}</td><td>${row.errors?.length ? `<span class="text-danger">${escape(row.errors.join("；"))}</span>` : `<span class="text-success">${escape(row.action)}</span>`}</td></tr>`).join("")}</tbody></table>
				${(preview.rows || []).length > sample.length ? `<p class="text-muted">${__("仅显示前 12 行预览。")}</p>` : ""}
			`);
			dialog.set_primary_action(preview.can_import ? __("确认导入") : __("重新选择文件"), preview.can_import ? import_file : select_file);
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
					frappe.show_alert({ message: __("已新增 {0} 条支援能力，跳过 {1} 条已有记录。", [result.inserted || 0, result.skipped || 0]), indicator: "green" });
					this.search();
				});
		}

		render_preview();
		dialog.show();
	}

	search() {
		const args = {
			support_department: this.department?.get_value() || "",
			support_designation: this.designation?.get_value() || "",
			employee: this.employee?.get_value() || "",
			include_unavailable: this.show_unavailable?.get_value() || 0,
		};
		frappe.call({
			method: "hrms.hr.doctype.cross_department_support_capability.cross_department_support_capability.get_available_support_candidates",
			args,
			freeze: true,
			freeze_message: __("正在查询可支援人员..."),
		}).then((response) => {
			const result = response.message || {};
			this.rows = result.rows || [];
			this.render_results(result.count || 0);
		});
	}

	render_results(count) {
		$(this.wrapper).find("[data-summary]").html(`
			<div class="cross-department-support-page__count"><strong>${frappe.utils.escape_html(String(count))}</strong><span>${__("名符合当前条件")}</span></div>
			<div class="text-muted">${__("名单来自“跨部门支援能力”台账；新增、暂停、失效后会立即反映。")}</div>
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
		`);
	}

	render_row(row) {
		const escape = (value) => frappe.utils.escape_html(value || "—");
		const period = row.valid_from || row.valid_until ? `${escape(row.valid_from || __("不限"))} ~ ${escape(row.valid_until || __("不限"))}` : __("长期有效");
		const indicator = row.availability === "可派" ? "green" : "gray";
		return `<tr class="pointer" data-capability="${escape(row.name)}">
			<td><strong>${escape(row.employee_name)}</strong><br><small class="text-muted">${escape(row.employee_code)}</small></td>
			<td>${escape(row.source_department)}<br><small class="text-muted">${escape(row.source_designation)}</small></td>
			<td>${escape(row.support_department)}</td><td>${escape(row.support_designation)}</td>
			<td><span class="indicator-pill ${indicator}">${escape(row.availability)}</span><br><small class="text-muted">${escape(row.qualification_status)}</small></td>
			<td>${period}</td><td>${escape(row.remarks)}</td>
		</tr>`;
	}
}
