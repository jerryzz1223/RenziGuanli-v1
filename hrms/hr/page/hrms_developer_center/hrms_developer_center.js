frappe.pages["hrms-developer-center"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("开发中心"),
		single_column: true,
	});

	const userRoles = () => window.frappe?.user_roles || window.frappe?.boot?.user?.roles || [];
	const isSystemManager = () => userRoles().includes("System Manager");
	const escape = (value) => frappe.utils.escape_html(value == null ? "" : String(value));
	const route = (target) => frappe.set_route(...target.split("/"));
	const state = { showAllFields: false, data: null };

	if (!isSystemManager()) {
		$(page.body).html(`<div class="alert alert-danger">${__("开发中心仅对系统管理员开放。请使用人资管理员账号进入设置中心处理日常配置。")}</div>`);
		return;
	}

	page.set_primary_action(__("字段管理"), () => openSettings("字段管理中心"), "settings");

	function openSettings(module, focus = "") {
		sessionStorage.setItem("hrms_settings_center_active_module", module);
		if (focus) sessionStorage.setItem("hrms_settings_center_focus", focus);
		route("hr-settings-center");
	}

	function configurationRows(items) {
		return items.map((item) => `
			<tr>
				<td><span class="hrms-developer-center__category">${escape(item.category)}</span><strong>${escape(item.label)}</strong><code>${escape(item.doctype)}</code></td>
				<td><p>${escape(item.purpose)}</p><small><strong>${__("实际使用")}</strong>：${escape(item.where_used)}</small></td>
				<td><span class="indicator-pill ${item.record_count ? "green" : "orange"}">${escape(item.status)}</span><small>${__("当前记录数：{0}", [item.record_count])}</small><small>${escape(item.storage)}</small></td>
				<td class="hrms-developer-center__map-actions">
					<button class="btn btn-primary btn-sm" data-route="${escape(item.manage_route)}">${__("管理配置")}</button>
					<button class="btn btn-default btn-sm" data-route="${escape(item.verify_route)}">${__("打开生效位置")}</button>
					<button class="btn btn-link btn-sm" data-test-hint="${escape(item.test_hint)}">${__("如何验证")}</button>
				</td>
			</tr>`).join("");
	}

	function fieldRows(fields) {
		const priority = ["employment_type", "department", "designation", "grade", "company"];
		const ordered = [...fields].sort((left, right) => {
			const leftIndex = priority.indexOf(left.fieldname);
			const rightIndex = priority.indexOf(right.fieldname);
			return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
		});
		const visible = state.showAllFields ? ordered : ordered.slice(0, 6);
		return visible.map((field) => `
			<tr>
				<td><strong>${escape(field.field_label)}</strong><code>${escape(field.fieldname)}</code><small>${escape(field.category)} · ${escape(field.fieldtype)} · ${escape(field.source)}</small></td>
				<td><p>${escape(field.meaning)}</p><small>${escape(field.description)}</small></td>
				<td><span class="hrms-developer-center__value-source">${escape(field.value_source)}</span>${field.allowed_values?.length ? `<div class="hrms-developer-center__chips">${field.allowed_values.map((value) => `<span>${escape(value)}</span>`).join("")}</div>` : "<small>按字段格式填写</small>"}</td>
				<td><p>${escape(field.scope)}</p><small>${escape(field.managed_by)}</small></td>
				<td><button class="btn btn-default btn-xs" data-edit-field="${escape(field.fieldname)}">${__("编辑字段")}</button></td>
			</tr>`).join("");
	}

	function dictionaryCards(dictionaries) {
		return dictionaries.map((item) => `
			<article class="hrms-developer-center__dictionary-card ${item.doctype === "Employment Type" ? "is-highlighted" : ""}">
				<div class="hrms-developer-center__dictionary-title"><div><h5>${escape(item.label)}</h5><code>${escape(item.doctype)}</code></div><span>${escape(item.record_count)} ${__("项")}</span></div>
				<p>${escape(item.description)}</p>
				<small><strong>${__("引用字段")}</strong>：${escape((item.linked_fields || []).join("、"))}</small>
				<small><strong>${__("影响范围")}</strong>：${escape(item.scope)}</small>
				<div class="hrms-developer-center__chips">${(item.values || []).map((value) => `<span>${escape(value)}</span>`).join("") || `<span>${__("暂无记录")}</span>`}</div>
				<small class="hrms-developer-center__risk">${escape(item.risk)}</small>
				<div class="hrms-developer-center__dictionary-actions">
					<button class="btn btn-default btn-sm" data-dictionary="${escape(item.doctype)}">${__("查看与维护")}</button>
					${item.allow_quick_create ? `<button class="btn btn-primary btn-sm" data-action="create-employment-type">${__("新增工作性质")}</button>` : ""}
				</div>
			</article>`).join("");
	}

	function render(data) {
		state.data = data;
		const items = data.items || [];
		const fields = data.field_catalog || [];
		const dictionaries = data.base_dictionaries || [];
		const boundary = data.boundary || {};
		$(page.body).html(`
			<div class="hrms-developer-center">
				<section class="hrms-developer-center__hero">
					<div><span class="indicator blue"></span><h3>${__("面向业务管理员的开发中心")}</h3><p>${__("先确认字段、取值字典与业务引用范围，再进入对应配置；每一个入口都能看到它会影响哪里。")}</p></div>
					<div class="hrms-developer-center__role"><strong>${__("当前要求")}</strong><span>System Manager</span></div>
				</section>

				<section class="hrms-developer-center__summary-grid">
					<article><strong>${escape(fields.length)}</strong><span>${__("个已启用员工字段")}</span><small>${__("可配置显示、别名、导入导出与资料块")}</small></article>
					<article><strong>${escape(dictionaries.length)}</strong><span>${__("类基础字典")}</span><small>${__("可维护选项值，并查看引用字段")}</small></article>
					<article><strong>${escape(items.length)}</strong><span>${__("项受控业务配置")}</span><small>${__("规则、审批、映射和集成均标注生效位置")}</small></article>
				</section>

				<section class="hrms-developer-center__clarify">
					<h4>${__("工作性质统一口径")}</h4>
					<div><strong>${__("工作性质")}</strong><p>${__("花名册、员工档案、导入和筛选统一使用实习、试用、全职、外包、返聘五类取值。")}</p></div>
				</section>

				<section class="hrms-developer-center__catalog">
					<div class="hrms-developer-center__map-head"><div><h4>${__("字段字典与引用范围")}</h4><p>${__("字段名称、系统字段名、可填范围、业务含义及实际影响范围集中在此。编辑字段用于控制展示、必填、别名、导入导出和资料块。")}</p></div><button class="btn btn-default btn-sm" data-action="toggle-fields">${state.showAllFields ? __("收起字段") : __("查看全部字段")}</button></div>
					<div class="table-responsive"><table class="table hrms-developer-center__field-table"><thead><tr><th>${__("字段")}</th><th>${__("业务含义")}</th><th>${__("取值范围")}</th><th>${__("引用与影响范围")}</th><th>${__("操作")}</th></tr></thead><tbody>${fieldRows(fields)}</tbody></table></div>
				</section>

				<section class="hrms-developer-center__catalog">
					<div class="hrms-developer-center__map-head"><div><h4>${__("基础字典：可新增的业务取值")}</h4><p>${__("字典值是字段的可选内容；新增工作性质后，员工档案和招聘职位会立即可以选择该值。修改或删除已使用的值前，请先检查下方影响范围。")}</p></div></div>
					<div class="hrms-developer-center__dictionary-grid">${dictionaryCards(dictionaries)}</div>
				</section>

				<section class="hrms-developer-center__boundary"><div><strong>${__("可以不改代码")}</strong><p>${escape(boundary.no_code)}</p></div><div><strong>${__("仍然需要代码和迁移")}</strong><p>${escape(boundary.requires_code)}</p></div></section>

				<section class="hrms-developer-center__map">
					<div class="hrms-developer-center__map-head"><div><h4>${__("规则、流程与集成配置")}</h4><p>${__("每一项都标明保存位置、代码读取点、业务生效页面和验证方法。")}</p></div><span class="indicator-pill blue">${escape(items.length)} ${__("项")}</span></div>
					<div class="table-responsive"><table class="table hrms-developer-center__map-table"><thead><tr><th>${__("配置项 / 保存对象")}</th><th>${__("作用 / 使用位置")}</th><th>${__("当前接入状态")}</th><th>${__("管理与验证")}</th></tr></thead><tbody>${configurationRows(items)}</tbody></table></div>
				</section>

				<section class="hrms-developer-center__checklist"><h4>${__("配置变更检查")}</h4><ol><li>${__("新增字典值后，先在员工档案或招聘职位选择一次，确认可选且名称正确。")}</li><li>${__("改字段显示、别名或范围后，用同一条样例员工验证档案、导入预览和导出。")}</li><li>${__("改规则或审批后，使用固定业务样例预览或走完整流程；不要只以保存成功判断生效。")}</li><li>${__("删除或改名已有字典值前，先搜索引用记录并确认薪资、合同、导入模板没有使用该值。")}</li></ol></section>
			</div>`);
		bindEvents();
	}

	function openEmploymentTypeDialog() {
		const dialog = new frappe.ui.Dialog({
			title: __("新增工作性质"),
			fields: [{ fieldname: "employee_type_name", fieldtype: "Data", label: __("工作性质名称"), description: __("例如：劳务派遣、非全日制。新增后可在员工档案和招聘职位选择。"), reqd: 1 }],
			primary_action_label: __("新增"),
			primary_action(values) {
				frappe.call("hrms.api.employee_field_template.create_employment_type_from_developer_center", values).then(() => {
					dialog.hide();
					frappe.show_alert({ message: __("工作性质已新增"), indicator: "green" });
					load();
				});
			},
		});
		dialog.show();
	}

	function bindEvents() {
		$(page.body).find("[data-route]").on("click", function () { route(this.dataset.route); });
		$(page.body).find("[data-test-hint]").on("click", function () { frappe.msgprint({ title: __("验证方法"), message: escape(this.dataset.testHint), indicator: "blue" }); });
		$(page.body).find("[data-action='toggle-fields']").on("click", function () { state.showAllFields = !state.showAllFields; render(state.data); });
		$(page.body).find("[data-edit-field]").on("click", function () { openSettings("字段管理中心", this.dataset.editField); });
		$(page.body).find("[data-dictionary]").on("click", function () { frappe.set_route("List", this.dataset.dictionary); });
		$(page.body).find("[data-action='create-employment-type']").on("click", openEmploymentTypeDialog);
	}

	function load() {
		$(page.body).html(`<div class="text-muted">${__("正在分析字段、基础字典及实际业务引用... ")}</div>`);
		frappe.call("hrms.api.employee_field_template.get_hrms_developer_configuration_map")
			.then((response) => render(response.message || {}))
			.catch(() => $(page.body).html(`<div class="alert alert-danger">${__("无法读取业务配置地图，请确认当前账户拥有系统管理员角色。")}</div>`));
	}

	load();
};
