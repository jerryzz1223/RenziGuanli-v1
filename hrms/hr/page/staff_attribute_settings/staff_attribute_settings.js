frappe.pages["staff-attribute-settings"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("员工属性设置"),
		single_column: true,
	});

	const state = {
		main_tab: "员工属性",
		category: "在职信息",
		template: null,
		loading: true,
	};

	const category_descriptions = {
		在职信息: "记录员工入职后的工号、合同公司、部门、岗位、工作性质、员工状态与入职日期。",
		个人信息: "维护姓名、性别、出生日期、证件号码等员工基础身份信息。",
		联系信息: "维护手机号、邮箱、地址与紧急联系人。",
		教育信息: "维护学历类别、学习形式、学历、毕业院校和专业等花名册字段。",
		合同保险: "维护合同签订、合同编号、合同期限、社保、医保和公积金字段。",
		工资社保: "维护薪酬、社保、公积金和个税相关字段。",
		个税申报: "维护个税申报需要的员工补充信息。",
		附件: "维护员工证件、照片、合同扫描件等附件字段。",
	};

	const related_templates = {
		员工档案材料: [
			{ field_label: "身份证材料", description: "入职时收集的身份材料模板", source: "系统" },
			{ field_label: "学历证明", description: "学历及学位证明材料", source: "系统" },
			{ field_label: "离职证明", description: "前雇主离职证明材料", source: "自定义" },
		],
		自定义设置: [
			{ field_label: "离职信息", description: "离职日期、离职原因、离职去向", source: "系统" },
			{ field_label: "任职记录", description: "任职开始日期、任职结束日期、部门、岗位", source: "系统" },
			{ field_label: "奖惩记录", description: "奖惩类别、奖惩日期、奖惩内容", source: "系统" },
			{ field_label: "考察期信息", description: "考察开始日期、考察结束日期、考察结果", source: "系统" },
			{ field_label: "退休信息", description: "是否已退休、退休日期、退休备注", source: "系统" },
			{ field_label: "档案信息", description: "档案编号、档案备注", source: "系统" },
			{ field_label: "与本公司员工关系", description: "姓名、关系、任职单位、任职部门", source: "系统" },
		],
	};

	page.set_primary_action(__("添加属性字段"), () => open_field_dialog(), "add");
	$(page.body).addClass("hrms-staff-attribute-page");
	$(page.body).prepend(
		`<div class="alert alert-info">${__("员工属性设置已迁移到设置中心，请在“设置中心 / 员工属性设置”中统一维护。")}</div>`,
	);
	setTimeout(() => {
		frappe
			.call("hrms.api.employee_field_template.ensure_personnel_pages")
			.always(() => frappe.set_route("hr-settings-center"));
	}, 50);

	function load_template() {
		state.loading = true;
		render();
		return frappe
			.call("hrms.api.employee_field_template.get_employee_field_template")
			.then((r) => {
				state.template = r.message;
				const first_category = state.template?.categories?.[0]?.label;
				state.category = state.category || first_category || "在职信息";
				state.loading = false;
				render();
			});
	}

	function get_categories() {
		return state.template?.categories || [];
	}

	function get_active_category() {
		return get_categories().find((item) => item.label === state.category) || get_categories()[0];
	}

	function fieldtype_options() {
		return ["文本格式", "日期格式", "自定义选项", "长文本格式"].join("\n");
	}

	function open_field_dialog(default_category) {
		const dialog = new frappe.ui.Dialog({
			title: __("添加自定义字段"),
			fields: [
				{
					fieldname: "category",
					fieldtype: "Select",
					label: __("所属分类"),
					options: get_categories()
						.map((item) => item.label)
						.join("\n"),
					default: default_category || state.category,
					reqd: 1,
				},
				{
					fieldname: "fieldtype",
					fieldtype: "Select",
					label: __("字段类型"),
					options: fieldtype_options(),
					default: "文本格式",
					reqd: 1,
				},
				{
					fieldname: "field_label",
					fieldtype: "Data",
					label: __("字段名称"),
					reqd: 1,
					description: __("不超过 30 个字符"),
				},
				{
					fieldname: "description",
					fieldtype: "Small Text",
					label: __("字段描述"),
				},
				{
					fieldname: "options",
					fieldtype: "Small Text",
					label: __("自定义选项"),
					description: __("选择“自定义选项”时，每行一个选项。"),
					depends_on: "eval:doc.fieldtype=='自定义选项'",
				},
				{
					fieldname: "search_enabled",
					fieldtype: "Check",
					label: __("启用搜索"),
					description: __("启用后，该字段后续可作为员工高级搜索条件。"),
				},
				{
					fieldname: "required",
					fieldtype: "Check",
					label: __("是否必填"),
					description: __("启用后，新建员工表单和花名册导入模板都会显示红色必填标记。"),
				},
			],
			primary_action_label: __("保存"),
			primary_action(values) {
				return create_custom_field(values).then(() => dialog.hide());
			},
		});

		dialog.set_secondary_action_label(__("保存并继续添加"));
		dialog.set_secondary_action(() => {
			const values = dialog.get_values();
			if (!values) return;
			return create_custom_field(values).then(() => {
				dialog.set_value("field_label", "");
				dialog.set_value("description", "");
				dialog.set_value("options", "");
			});
		});

		dialog.show();
	}

	function create_custom_field(values) {
		state.category = values.category;
		return frappe
			.call("hrms.api.employee_field_template.create_employee_custom_field", values)
			.then(() => {
				frappe.show_alert({ message: __("已添加到员工属性模板"), indicator: "green" });
				return load_template();
			});
	}

	function open_edit_dialog(field) {
		const dialog = new frappe.ui.Dialog({
			title: __("编辑属性字段"),
			fields: [
				{
					fieldname: "category",
					fieldtype: "Select",
					label: __("所属分类"),
					options: get_categories()
						.map((item) => item.label)
						.join("\n"),
					default: field.category,
					reqd: 1,
				},
				{
					fieldname: "field_label",
					fieldtype: "Data",
					label: __("字段名称"),
					default: field.field_label,
					reqd: 1,
				},
				{
					fieldname: "description",
					fieldtype: "Small Text",
					label: __("字段描述"),
					default: field.description,
				},
				{
					fieldname: "search_enabled",
					fieldtype: "Check",
					label: __("启用搜索"),
					default: field.search_enabled,
				},
				{
					fieldname: "required",
					fieldtype: "Check",
					label: __("是否必填"),
					default: field.required,
				},
			],
			primary_action_label: __("保存"),
			primary_action(values) {
				return frappe
					.call("hrms.api.employee_field_template.save_employee_field_template", {
						items: [
							{
								fieldname: field.fieldname,
								category: values.category,
								field_label: values.field_label,
								description: values.description,
								required: values.required,
								search_enabled: values.search_enabled,
							},
						],
					})
					.then(() => {
						dialog.hide();
						return load_template();
					});
			},
		});
		dialog.show();
	}

	function set_field_enabled(field, enabled) {
		return frappe
			.call("hrms.api.employee_field_template.set_employee_template_field_enabled", {
				fieldname: field.fieldname,
				enabled,
			})
			.then(() => load_template());
	}

	function download_employee_import_template() {
		const url = frappe.urllib.get_full_url(
			"/api/method/hrms.api.employee_field_template.download_employee_import_template",
		);
		window.open(url);
	}

	function open_employee_web_form() {
		frappe.new_doc("Employee");
	}

	function open_roster_import() {
		frappe.set_route("employee-roster-import");
	}

	function open_roster_export() {
		frappe.set_route("employee-roster-export");
	}

	function render_tabs() {
		const tabs = ["员工属性", "员工档案材料", "自定义设置"];
		return `
			<div class="hrms-staff-attribute-tabs">
				${tabs
					.map(
						(tab) => `
						<button class="hrms-staff-attribute-tab ${state.main_tab === tab ? "is-active" : ""}" data-main-tab="${tab}">
							${__(tab)}
						</button>`,
					)
					.join("")}
			</div>`;
	}

	function render_category_tabs() {
		return `
			<div class="hrms-staff-attribute-category-tabs">
				${get_categories()
					.map(
						(category) => `
						<button class="hrms-staff-attribute-category-tab ${state.category === category.label ? "is-active" : ""}" data-category="${category.label}">
							${__(category.label)}
						</button>`,
					)
					.join("")}
			</div>`;
	}

	function render_source(field) {
		const source = field.source || "自定义";
		return `<span class="indicator-pill ${source === "系统" ? "gray" : "blue"}">${__(source)}</span>`;
	}

	function render_field_table(fields, readonly = false) {
		if (!fields || !fields.length) {
			return `<div class="hrms-staff-attribute-empty">${__("当前没有真实数据，可以点击添加属性字段创建模板项。")}</div>`;
		}
		return `
			<table class="table hrms-staff-attribute-table">
				<thead>
					<tr>
						<th>${__("字段名称")}</th>
						<th>${__("字段描述")}</th>
						<th>${__("来源")}</th>
						<th>${__("操作")}</th>
					</tr>
				</thead>
				<tbody>
					${fields
						.map(
							(field) => `
							<tr class="${field.enabled === 0 ? "text-muted" : ""}">
								<td>${frappe.utils.escape_html(field.field_label || "")}</td>
								<td>${frappe.utils.escape_html(field.description || "")}</td>
								<td>${render_source(field)}${field.required ? ` <span class="indicator-pill orange">${__("必填")}</span>` : ""}${field.search_enabled ? ` <span class="indicator-pill blue">${__("已启用搜索")}</span>` : ""}</td>
								<td>
									${
										readonly
											? `<span class="text-muted">${__("模板入口")}</span>`
											: `
												<button class="btn btn-xs btn-default hrms-edit-field" data-fieldname="${field.fieldname}">${__("编辑")}</button>
												<button class="btn btn-xs btn-default hrms-toggle-field" data-fieldname="${field.fieldname}" data-enabled="${field.enabled ? 0 : 1}">
													${field.enabled ? __("禁用") : __("启用")}
												</button>
												${
													field.source === "自定义"
														? `<button class="btn btn-xs btn-default text-danger hrms-delete-field" data-fieldname="${field.fieldname}">${__("删除")}</button>`
														: `<span class="text-muted">${__("系统字段不可删除")}</span>`
												}
											`
									}
								</td>
							</tr>`,
						)
						.join("")}
				</tbody>
			</table>`;
	}

	function render_attribute_tab() {
		const category = get_active_category();
		if (!category) {
			return `<div class="text-muted">${__("正在加载员工属性模板...")}</div>`;
		}
		return `
			${render_category_tabs()}
			<div class="hrms-staff-attribute-card">
				<div class="hrms-staff-attribute-card__header">
					<div>
						<div class="hrms-staff-attribute-card__title">${__(category.label)}</div>
						<div class="text-muted small">${__(category_descriptions[category.label] || "")}</div>
					</div>
					<button class="btn btn-default btn-sm" data-add-category="${category.label}">${__("添加")}</button>
				</div>
				${render_field_table(category.fields)}
			</div>`;
	}

	function render_related_tab(tab) {
		return `
			<div class="hrms-staff-attribute-card">
				<div class="hrms-staff-attribute-card__header">
					<div>
						<div class="hrms-staff-attribute-card__title">${__(tab)}</div>
						<div class="text-muted small">${__("这里保留为后续自定义规则的模板入口，当前阶段先完成员工属性到 Employee 表单的映射。")}</div>
					</div>
				</div>
				${render_field_table(related_templates[tab] || [], true)}
			</div>`;
	}

	function render() {
		const content = `
			<div class="hrms-staff-attribute-guide">
				<div class="hrms-staff-attribute-guide__title">${__("使用指南")}</div>
				<div>1. ${__("员工属性字段分为“在职信息”、“个人信息”、“联系信息”、“工资社保”、“个税申报”和“附件”。")}</div>
				<div>2. ${__("这里的字段会同时控制网页新建员工表单和 Excel 初始导入模板。")}</div>
				<div>3. ${__("系统必填字段会保留显示；其他字段可以按业务需要隐藏、改名或启用搜索。")}</div>
			</div>
			<div class="hrms-staff-attribute-toolbar">
				${render_tabs()}
				<div class="hrms-staff-attribute-actions">
					<button class="btn btn-default btn-sm" data-download-template>${__("下载 Excel 模板")}</button>
					<button class="btn btn-default btn-sm" data-open-roster-import>${__("智能导入")}</button>
					<button class="btn btn-default btn-sm" data-open-roster-export>${__("自定义导出")}</button>
					<button class="btn btn-default btn-sm" data-open-employee-form>${__("网页填写员工")}</button>
					<button class="btn btn-primary btn-sm" data-add-category="${state.category}">${__("添加属性字段")}</button>
				</div>
			</div>
			${
				state.loading
					? `<div class="text-muted">${__("正在加载...")}</div>`
					: state.main_tab === "员工属性"
						? render_attribute_tab()
						: render_related_tab(state.main_tab)
			}
		`;

		$(page.body).html(content);
		bind_events();
	}

	function bind_events() {
		$(page.body)
			.find("[data-main-tab]")
			.on("click", function () {
				state.main_tab = $(this).data("main-tab");
				render();
			});
		$(page.body)
			.find("[data-category]")
			.on("click", function () {
				state.category = $(this).data("category");
				render();
			});
		$(page.body)
			.find("[data-add-category]")
			.on("click", function () {
				open_field_dialog($(this).data("add-category"));
			});
		$(page.body).find("[data-download-template]").on("click", download_employee_import_template);
		$(page.body).find("[data-open-roster-import]").on("click", open_roster_import);
		$(page.body).find("[data-open-roster-export]").on("click", open_roster_export);
		$(page.body).find("[data-open-employee-form]").on("click", open_employee_web_form);
		$(page.body)
			.find(".hrms-edit-field")
			.on("click", function () {
				const field = state.template.fields.find((item) => item.fieldname === $(this).data("fieldname"));
				if (field) open_edit_dialog(field);
			});
		$(page.body)
			.find(".hrms-toggle-field")
			.on("click", function () {
				const field = state.template.fields.find((item) => item.fieldname === $(this).data("fieldname"));
				if (field) set_field_enabled(field, Number($(this).data("enabled")));
			});
		$(page.body)
			.find(".hrms-delete-field")
			.on("click", function () {
				const field = state.template.fields.find((item) => item.fieldname === $(this).data("fieldname"));
				if (!field) return;
				frappe.confirm(
					__("第一阶段不会删除数据库字段。确认后将禁用该字段，并保留已有员工数据。"),
					() => set_field_enabled(field, 0),
				);
			});
	}

	load_template();
};
