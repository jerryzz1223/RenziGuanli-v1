frappe.pages["hr-settings-center"].on_page_load = function (wrapper) {
	const SYSTEM_SETTINGS_MODULES = new Set(["用户与权限"]);
	const BUSINESS_SETTINGS_MODULES = [
		"字段管理中心",
		"员工属性设置",
		"字段别名配置",
		"导入映射设置",
		"详情资料块设置",
		"导出模板设置",
		"基础资料设置",
		"多行记录类型",
	];

	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("设置中心"),
		single_column: true,
	});

	const requested_module = sessionStorage.getItem("hrms_settings_center_active_module");
	const requested_focus = sessionStorage.getItem("hrms_settings_center_focus");
	const route = frappe.get_route ? frappe.get_route() : [];
	sessionStorage.removeItem("hrms_settings_center_active_module");
	sessionStorage.removeItem("hrms_settings_center_focus");

	const state = {
		active_module: requested_module || "字段管理中心",
		focus: requested_focus || "",
		data: null,
		error: "",
		loading: true,
		load_request_id: 0,
	};

	$(page.body).addClass("hrms-settings-center-page");
	page.set_primary_action(__("新增自定义字段"), () => open_custom_field_dialog(), "add");

	function load() {
		const request_id = ++state.load_request_id;
		state.loading = true;
		state.error = "";
		render();
		return frappe
			.call("hrms.api.employee_field_template.get_hr_settings_center")
			.then((r) => {
				if (request_id !== state.load_request_id) return;
				state.data = r.message || {};
				state.loading = false;
				render();
			})
			.catch(() => {
				if (request_id !== state.load_request_id) return;
				state.loading = false;
				state.error = __("无法读取设置数据。请确认当前账号具有人资管理员或系统管理员角色。");
				render();
			});
	}

	function user_roles() {
		const roles = window.frappe?.user_roles || window.frappe?.boot?.user?.roles || [];
		return Array.isArray(roles) ? roles : [];
	}

	function is_system_manager() {
		return user_roles().includes("System Manager");
	}

	function modules() {
		return is_system_manager() ? [...BUSINESS_SETTINGS_MODULES, "用户与权限"] : BUSINESS_SETTINGS_MODULES;
	}

	function normalize_active_module() {
		if (!modules().includes(state.active_module)) {
			state.active_module = "字段管理中心";
			state.focus = "";
		}
	}

	function fields() {
		return state.data?.field_center?.fields || [];
	}

	function escape(value) {
		return frappe.utils.escape_html(value == null ? "" : String(value));
	}

	function checked(value) {
		return value ? "checked" : "";
	}

	function render() {
		if (state.loading) {
			$(page.body).html(`<div class="text-muted">${__("正在加载设置中心...")}</div>`);
			return;
		}
		if (state.error) {
			$(page.body).html(`<div class="alert alert-danger">${escape(state.error)}</div>`);
			return;
		}

		normalize_active_module();

		$(page.body).html(`
			<div class="hrms-settings-access-note alert alert-info">
				<strong>${__("人资配置通道")}</strong>：${is_system_manager() ? __("当前账号可维护业务设置及系统级集成、用户权限。") : __("当前账号可维护业务配置；用户权限、钉钉密钥和底层开发工具仅对系统管理员开放。")}
			</div>
			<div class="hrms-settings-shell">
				<aside class="hrms-settings-nav">${render_module_nav()}</aside>
				<section class="hrms-settings-main">${render_active_module()}</section>
			</div>
		`);
		bind_events();
	}

	function render_module_nav() {
		return modules()
			.map(
				(label) => `
					<button class="hrms-settings-nav-item ${state.active_module === label ? "is-active" : ""}" data-module="${escape(label)}">
						<span>${__(label)}</span>
						<small>${module_count(label)}</small>
					</button>
				`,
			)
			.join("");
	}

	function module_count(label) {
		const module = (state.data?.modules || []).find((item) => item.label === label);
		return module?.count || "";
	}

	function render_active_module() {
		if (SYSTEM_SETTINGS_MODULES.has(state.active_module) && !is_system_manager()) {
			return `<div class="alert alert-warning">${__("该项为系统级设置，仅系统管理员可维护。")}</div>`;
		}
		if (state.active_module === "字段别名配置") return render_aliases();
		if (state.active_module === "导入映射设置") return render_import_mapping();
		if (state.active_module === "详情资料块设置") return render_detail_blocks();
		if (state.active_module === "导出模板设置") return render_export_templates();
		if (state.active_module === "基础资料设置") return render_base_data();
		if (state.active_module === "多行记录类型") return render_record_types();
		if (state.active_module === "用户与权限") return render_user_permissions();
		return render_field_center(state.active_module === "员工属性设置");
	}

	function render_field_center(compact) {
		const roster_focus = state.focus === "roster_visible";
		return `
			<div class="hrms-settings-panel">
				<div class="hrms-settings-panel-head">
					<div>
						<h3>${compact ? __("员工属性设置") : __("字段管理中心")}</h3>
						<p>${__("统一管理员工字段中文名、分类、显示、必填、导入、导出、搜索和详情资料块。")}</p>
						${roster_focus ? `<div class="alert alert-info mt-2">${__("正在配置员工花名册字段：勾选“花名册”的字段会出现在员工花名册、导出字段和档案库列表中。")}</div>` : ""}
					</div>
					<button class="btn btn-default btn-sm" data-action="download-template">${__("下载导入模板")}</button>
				</div>
				<div class="table-responsive">
					<table class="table table-bordered hrms-settings-field-table ${roster_focus ? "is-roster-focus" : ""}">
						<thead>
							<tr>
								<th>${__("字段名称")}</th>
								<th>${__("Frappe字段名")}</th>
								<th>${__("分类")}</th>
								<th>${__("来源")}</th>
								<th>${__("显示")}</th>
								<th>${__("必填")}</th>
								<th>${__("导入")}</th>
								<th>${__("导出")}</th>
								<th>${__("表单")}</th>
								<th>${__("详情")}</th>
								<th>${__("花名册")}</th>
								<th>${__("操作")}</th>
							</tr>
						</thead>
						<tbody>${fields().map(render_field_row).join("")}</tbody>
					</table>
				</div>
			</div>
		`;
	}

	function render_field_row(field) {
		return `
			<tr>
				<td><strong>${escape(field.field_label)}</strong><div class="text-muted small">${escape(field.description)}</div></td>
				<td><code>${escape(field.fieldname)}</code></td>
				<td>${escape(field.category)}</td>
				<td>${escape(field.source)}</td>
				${["enabled", "required", "import_enabled", "export_enabled", "form_visible", "detail_visible", "roster_visible"]
					.map(
						(flag) => `<td class="${state.focus === flag ? "is-focus-column" : ""}"><input type="checkbox" data-field-flag="${flag}" data-fieldname="${escape(field.fieldname)}" ${checked(field[flag])}></td>`,
					)
					.join("")}
				<td><button class="btn btn-xs btn-default" data-action="edit-field" data-fieldname="${escape(field.fieldname)}">${__("编辑")}</button></td>
			</tr>
		`;
	}

	function render_aliases() {
		return `
			<div class="hrms-settings-panel">
				<h3>${__("字段别名配置")}</h3>
				<p>${__("维护 Excel 表头、历史叫法和公司内部叫法。每行一个别名。")}</p>
				${fields()
					.filter((field) => field.enabled)
					.map(
						(field) => `
						<div class="hrms-settings-alias-row">
							<div><strong>${escape(field.field_label)}</strong><code>${escape(field.fieldname)}</code></div>
							<textarea data-field-aliases="${escape(field.fieldname)}" rows="2">${escape(field.aliases || "")}</textarea>
							<button class="btn btn-sm btn-primary" data-action="save-aliases" data-fieldname="${escape(field.fieldname)}">${__("保存")}</button>
						</div>`,
					)
					.join("")}
			</div>
		`;
	}

	function render_import_mapping() {
		return `
			<div class="hrms-settings-panel">
				<h3>${__("导入映射设置")}</h3>
				<p>${__("导入时按字段名称、字段别名、Frappe 字段名自动匹配；后续手动匹配字段也会沉淀到这里。")}</p>
				<div class="hrms-settings-chip-grid">
					${(state.data?.field_center?.import_mappings || [])
						.map((item) => `<span class="hrms-settings-chip">${escape(item.field_label)}：${escape(item.aliases || "无别名")}</span>`)
						.join("")}
				</div>
				<button class="btn btn-default" data-route="employee-roster-import">${__("手动匹配字段")}</button>
			</div>
		`;
	}

	function render_detail_blocks() {
		return `
			<div class="hrms-settings-panel">
				<h3>${__("详情资料块设置")}</h3>
				<p>${__("配置字段在员工详情页归属到哪个资料块。第二阶段支持可视化拖拽排序。")}</p>
				${(state.data?.field_center?.detail_blocks || [])
					.map(
						(block) => `
						<div class="hrms-settings-block-row">
							<div><strong>${escape(block.label)}</strong><small>${escape(block.tab)}</small><p>${escape(block.description)}</p></div>
							<div>${(block.fields || []).map((field) => `<span class="hrms-settings-chip">${escape(field.field_label)}</span>`).join("") || __("暂无字段")}</div>
						</div>`,
					)
					.join("")}
			</div>
		`;
	}

	function render_export_templates() {
		return `
			<div class="hrms-settings-panel">
				<h3>${__("导出模板设置")}</h3>
				<p>${__("保存导出模板后，可在自定义导出和人事报表中复用。")}</p>
				<button class="btn btn-primary" data-route="employee-roster-export">${__("保存导出模板")}</button>
				<div class="hrms-settings-chip-grid">
					${(state.data?.field_center?.export_templates || [])
						.map((item) => `<span class="hrms-settings-chip">${escape(item.group)} / ${escape(item.label)}</span>`)
						.join("")}
				</div>
			</div>
		`;
	}

	function render_base_data() {
		return `
			<div class="hrms-settings-panel">
				<div class="hrms-settings-panel-head">
					<div><h3>${__("基础资料设置")}</h3><p>${__("统一维护公司、分支机构、部门、岗位、职级、工作性质等基础字典。")}</p></div>
					${is_system_manager() ? `<button class="btn btn-primary btn-sm" data-route="hrms-data-operations">${__("公司与数据空间管理")}</button>` : ""}
				</div>
				<div class="hrms-settings-card-grid">
					${(state.data?.field_center?.base_data_modules || [])
						.map((item) => `<button class="hrms-settings-card" data-doctype="${escape(item.doctype)}">${escape(item.label)}<small>${escape(item.doctype)}</small></button>`)
						.join("")}
				</div>
			</div>
		`;
	}

	function render_record_types() {
		return `
			<div class="hrms-settings-panel">
				<h3>${__("多行记录类型")}</h3>
				<p>${__("教育经历、任职记录等资料块可按业务需要继续升级为独立多行记录；奖惩记录已使用独立档案。")}</p>
				${(state.data?.field_center?.record_types || [])
					.map(
						(item) => `
							<div class="hrms-settings-block-row">
								<strong>${escape(item.label)}</strong>
								<span>${escape(item.record_type)}</span>
								<small>${escape(item.tab)}</small>
							</div>`,
					)
					.join("")}
			</div>
		`;
	}

	function render_user_permissions() {
		return `
			<div class="hrms-settings-panel">
				<div class="hrms-settings-panel-head">
					<div>
						<h3>${__("账户与权限")}</h3>
						<p>${__("先进入账户与权限中心查看现有账户与角色，再按账号、角色、数据范围和权限矩阵分别维护。这样不会把“用户权限限制”误认为账户列表。")}</p>
					</div>
				</div>
				<div class="hrms-settings-card-grid">
					<button class="hrms-settings-card hrms-settings-card--primary" data-route="hrms-access-center">${__("打开账户与权限中心")}<small>${__("账户摘要、角色说明和操作步骤")}</small></button>
					<button class="hrms-settings-card" data-new-doctype="User">${__("创建用户")}<small>${__("为办公人员创建登录账号")}</small></button>
					<button class="hrms-settings-card" data-doctype="User">${__("用户管理")}<small>User</small></button>
					<button class="hrms-settings-card" data-doctype="Role">${__("角色管理")}<small>Role</small></button>
					<button class="hrms-settings-card" data-doctype="User Permission">${__("数据范围限制")}<small>${__("User Permission：按公司、员工等限制可见数据")}</small></button>
					<button class="hrms-settings-card" data-route="permission-manager">${__("角色权限管理")}<small>${__("维护 DocType 级权限矩阵")}</small></button>
				</div>
				<div class="alert alert-info mt-3">
					${__("建议：普通员工只开移动端/自助权限；人事专员开放员工档案、入离转调和导入导出；系统管理员再开放字段中心和权限管理。")}
				</div>
			</div>
		`;
	}

	function save_field_patch(fieldname, patch) {
		return frappe
			.call("hrms.api.employee_field_template.save_employee_field_center", {
				items: JSON.stringify([{ fieldname, ...patch }]),
			})
			.then(() => load());
	}

	function open_custom_field_dialog() {
		const dialog = new frappe.ui.Dialog({
			title: __("新增自定义字段"),
			fields: [
				{ fieldname: "category", fieldtype: "Select", label: __("所属分类"), options: "在职信息\n个人信息\n联系信息\n教育信息\n合同保险\n工资社保\n个税申报\n附件", reqd: 1 },
				{ fieldname: "field_label", fieldtype: "Data", label: __("字段名称"), reqd: 1 },
				{ fieldname: "fieldtype", fieldtype: "Select", label: __("字段类型"), options: "文本格式\n日期格式\n自定义选项\n长文本格式", default: "文本格式", reqd: 1 },
				{ fieldname: "description", fieldtype: "Small Text", label: __("字段描述") },
				{ fieldname: "options", fieldtype: "Small Text", label: __("自定义选项"), depends_on: "eval:doc.fieldtype=='自定义选项'" },
			],
			primary_action_label: __("保存"),
			primary_action(values) {
				frappe.call("hrms.api.employee_field_template.create_employee_custom_field", values).then(() => {
					dialog.hide();
					load();
				});
			},
		});
		dialog.show();
	}

	function open_edit_field_dialog(fieldname) {
		const field = fields().find((item) => item.fieldname === fieldname);
		if (!field) return;
		const dialog = new frappe.ui.Dialog({
			title: __("编辑字段"),
			fields: [
				{ fieldname: "field_label", fieldtype: "Data", label: __("字段名称"), default: field.field_label, reqd: 1 },
				{ fieldname: "category", fieldtype: "Select", label: __("所属分类"), options: "在职信息\n个人信息\n联系信息\n教育信息\n合同保险\n工资社保\n个税申报\n附件", default: field.category, reqd: 1 },
				{ fieldname: "detail_block", fieldtype: "Select", label: __("详情资料块"), options: "\n任职记录\n教育经历\n工作经历\n语言能力\n工作技能\n奖惩记录\n考察期信息\n退休信息\n档案信息\n合同记录\n社保公积金记录\n材料附件\n背景调查", default: field.detail_block },
				{ fieldname: "record_type", fieldtype: "Select", label: __("记录类型"), options: "\n单字段\n单行资料块\n多行记录", default: field.record_type },
				{ fieldname: "description", fieldtype: "Small Text", label: __("字段描述"), default: field.description },
			],
			primary_action_label: __("保存"),
			primary_action(values) {
				save_field_patch(fieldname, values).then(() => dialog.hide());
			},
		});
		dialog.show();
	}

	function bind_events() {
		$(page.body).find("[data-module]").on("click", function () {
			state.active_module = this.dataset.module;
			state.focus = "";
			render();
		});
		$(page.body).find("[data-field-flag]").on("change", function () {
			save_field_patch(this.dataset.fieldname, { [this.dataset.fieldFlag]: this.checked ? 1 : 0 });
		});
		$(page.body).find("[data-action='edit-field']").on("click", function () {
			open_edit_field_dialog(this.dataset.fieldname);
		});
		$(page.body).find("[data-action='save-aliases']").on("click", function () {
			const fieldname = this.dataset.fieldname;
			const aliases = $(page.body).find(`[data-field-aliases="${fieldname}"]`).val();
			save_field_patch(fieldname, { aliases });
		});
		$(page.body).find("[data-route]").on("click", function () {
			frappe.set_route(this.dataset.route);
		});
		$(page.body).find("[data-new-doctype]").on("click", function () {
			const doctype = this.dataset.newDoctype;
			if (frappe.new_doc) {
				frappe.new_doc(doctype);
				return;
			}
			frappe.set_route("Form", doctype, `new-${doctype.toLowerCase().replace(/\s+/g, "-")}`);
		});
		$(page.body).find("[data-doctype]").on("click", function () {
			frappe.set_route("List", this.dataset.doctype);
		});
		$(page.body).find("[data-action='download-template']").on("click", function () {
			window.open(frappe.urllib.get_full_url("/api/method/hrms.api.employee_field_template.download_employee_import_template"));
		});
	}

	wrapper.hrms_settings_center = {
		refresh() {
			const requested_module = sessionStorage.getItem("hrms_settings_center_active_module");
			const requested_focus = sessionStorage.getItem("hrms_settings_center_focus");
			if (requested_module) state.active_module = requested_module;
			if (requested_focus) state.focus = requested_focus;
			sessionStorage.removeItem("hrms_settings_center_active_module");
			sessionStorage.removeItem("hrms_settings_center_focus");
			return load();
		},
	};
	load();
};

frappe.pages["hr-settings-center"].on_page_show = function (wrapper) {
	wrapper.hrms_settings_center?.refresh();
};
