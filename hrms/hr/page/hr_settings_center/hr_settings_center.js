frappe.pages["hr-settings-center"].on_page_load = function (wrapper) {
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
		active_module: requested_module || (route.includes("dingtalk-integration") ? "钉钉集成" : "字段管理中心"),
		focus: requested_focus || "",
		data: null,
		loading: true,
	};

	$(page.body).addClass("hrms-settings-center-page");
	page.set_primary_action(__("新增自定义字段"), () => open_custom_field_dialog(), "add");

	function load() {
		state.loading = true;
		render();
		return frappe
			.call("hrms.api.employee_field_template.get_hr_settings_center")
			.then((r) => {
				state.data = r.message || {};
				state.loading = false;
				render();
			});
	}

	function modules() {
		return [
			"字段管理中心",
			"员工属性设置",
			"字段别名配置",
			"导入映射设置",
			"详情资料块设置",
			"导出模板设置",
			"基础资料设置",
			"钉钉集成",
			"多行记录类型",
			"用户与权限",
		];
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

		$(page.body).html(`
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
		if (state.active_module === "字段别名配置") return render_aliases();
		if (state.active_module === "导入映射设置") return render_import_mapping();
		if (state.active_module === "详情资料块设置") return render_detail_blocks();
		if (state.active_module === "导出模板设置") return render_export_templates();
		if (state.active_module === "基础资料设置") return render_base_data();
		if (state.active_module === "钉钉集成") return render_dingtalk_integration();
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
				<h3>${__("基础资料设置")}</h3>
				<p>${__("统一维护公司、分支机构、部门、岗位、职级、工作性质等基础字典。")}</p>
				<div class="hrms-settings-card-grid">
					${(state.data?.field_center?.base_data_modules || [])
						.map((item) => `<button class="hrms-settings-card" data-doctype="${escape(item.doctype)}">${escape(item.label)}<small>${escape(item.doctype)}</small></button>`)
						.join("")}
				</div>
			</div>
		`;
	}

	function render_dingtalk_integration() {
		return `
			<div class="hrms-settings-panel">
				<div class="hrms-settings-panel-head">
					<div>
						<h3>${__("钉钉集成")}</h3>
						<p>${__("员工端继续使用钉钉，管理、计算、分析、沉淀放在人资系统；钉钉数据先单向同步，不反向深度写入。")}</p>
					</div>
					<div class="btn-group">
						<button class="btn btn-default btn-sm" data-action="apply-dingtalk-defaults">${__("应用安全默认设置")}</button>
						<button class="btn btn-default btn-sm" data-action="load-dingtalk-status">${__("读取连接状态")}</button>
					</div>
				</div>
				<div class="hrms-settings-card-grid">
					<button class="hrms-settings-card" data-doctype="HRMS DingTalk Settings">${__("连接配置")}<small>${__("App ID、AgentId、Client Secret、公网小网关")}</small></button>
					<button class="hrms-settings-card" data-doctype="HRMS DingTalk User Map">${__("员工映射")}<small>${__("dingtalk_userid -> Employee")}</small></button>
					<button class="hrms-settings-card" data-doctype="HRMS DingTalk Raw Record">${__("原始数据")}<small>${__("部门、员工、考勤、审批 payload")}</small></button>
					<button class="hrms-settings-card" data-doctype="HRMS DingTalk Sync Log">${__("同步日志")}<small>${__("每次同步的记录数、失败数和错误")}</small></button>
				</div>
				<div class="alert alert-info mt-3">
					<strong>${__("公网小网关")}</strong>：${__("钉钉里只配置员工入口网页；公网只开放 get_employee_gateway_config 和 get_employee_self_snapshot，不开放完整 Desk 后台。")}
				</div>
				<div class="alert alert-warning mt-3">
					<strong>${__("基础数据同步")}</strong>：${__("第一阶段只接部门、员工、考勤、审批结果；身份证、银行卡、合同附件、薪资结果仍留在人资系统内网侧管理。")}
				</div>
				<pre class="text-muted">get_dingtalk_connection_status
apply_dingtalk_default_settings
save_dingtalk_connection_settings
get_employee_gateway_config
get_employee_self_snapshot
sync_departments_from_dingtalk
sync_users_from_dingtalk
sync_attendance_from_dingtalk
preview_sync_payload
服务器部署</pre>
			</div>
		`;
	}

	function render_record_types() {
		return `
			<div class="hrms-settings-panel">
				<h3>${__("多行记录类型")}</h3>
				<p>${__("奖惩记录、教育经历、任职记录等后续可从单行资料块升级成独立多行记录。")}</p>
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
						<h3>${__("用户与权限")}</h3>
						<p>${__("统一管理登录账号、角色、用户权限和角色权限。系统继续使用 Frappe 原生 User、Role 和 User Permission，保证登录、审计和权限校验一致。")}</p>
					</div>
				</div>
				<div class="hrms-settings-card-grid">
					<button class="hrms-settings-card" data-new-doctype="User">${__("创建用户")}<small>${__("为办公人员创建登录账号")}</small></button>
					<button class="hrms-settings-card" data-doctype="User">${__("用户管理")}<small>User</small></button>
					<button class="hrms-settings-card" data-doctype="Role">${__("角色管理")}<small>Role</small></button>
					<button class="hrms-settings-card" data-doctype="User Permission">${__("用户权限")}<small>User Permission</small></button>
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
		$(page.body).find("[data-action='load-dingtalk-status']").on("click", function () {
			frappe.call("hrms.api.dingtalk_integration.get_dingtalk_connection_status").then((r) => {
				frappe.msgprint({
					title: __("钉钉连接状态"),
					message: `<pre>${escape(JSON.stringify(r.message || {}, null, 2))}</pre>`,
					wide: true,
				});
			});
		});
		$(page.body).find("[data-action='apply-dingtalk-defaults']").on("click", function () {
			frappe.call("hrms.api.dingtalk_integration.apply_dingtalk_default_settings").then((r) => {
				frappe.msgprint({
					title: __("已应用安全默认设置"),
					message: `<pre>${escape(JSON.stringify(r.message || {}, null, 2))}</pre>`,
					wide: true,
				});
			});
		});
	}

	load();
};
