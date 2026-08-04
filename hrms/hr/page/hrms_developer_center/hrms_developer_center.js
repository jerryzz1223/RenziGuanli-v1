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

	if (!isSystemManager()) {
		$(page.body).html(`<div class="alert alert-danger">${__("开发中心仅对系统管理员开放。请使用人资管理员账号进入设置中心处理日常配置。")}</div>`);
		return;
	}

	page.set_primary_action(__("打开账户与权限"), () => route("hrms-access-center"), "key");

	const cards = [
		{
			title: "基础模型目录",
			description: "先查看本项目实际使用的业务模型、用途、记录数量和修改风险；不需要从全部框架单据类型中寻找。",
			action: "models",
			button: "打开基础模型管理",
		},
		{
			title: "业务字段配置",
			description: "员工字段、别名、导入导出和资料块统一在设置中心维护；改动会映射到员工档案和花名册工具。",
			action: "settings",
			button: "前往设置中心",
		},
		{
			title: "账户、角色与权限",
			description: "从账户查看成员，再按角色配置业务对象权限，并用真实账户验证最终有效权限。",
			action: "permissions",
			button: "打开账户与权限中心",
		},
		{
			title: "工作区与页面",
			description: "维护业务导航、Workspace 和 Page。这里改变入口呈现，不等于授予后端数据权限。",
			action: "pages",
			button: "高级：打开页面列表",
		},
		{
			title: "运行状态",
			description: "查看人资队列和待处理任务，验证配置触发的异步任务是否完成；这里不展示数据库和密钥。",
			action: "operations",
			button: "查看运行状态",
		},
	];

	function configuration_rows(items) {
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

	function render(data) {
		const items = data.items || [];
		const boundary = data.boundary || {};
		$(page.body).html(`
			<div class="hrms-developer-center">
				<section class="hrms-developer-center__hero">
					<div>
						<span class="indicator blue"></span>
						<h3>${__("业务配置与受控开发通道")}</h3>
						<p>${__("先从下方“可配置业务逻辑地图”确认配置是否已接入业务，再修改、打开实际生效位置并执行验证。")}</p>
					</div>
					<div class="hrms-developer-center__role"><strong>${__("当前要求")}</strong><span>System Manager</span></div>
				</section>

				<section class="hrms-developer-center__boundary">
					<div><strong>${__("可以不改代码")}</strong><p>${escape(boundary.no_code)}</p></div>
					<div><strong>${__("仍然需要代码和迁移")}</strong><p>${escape(boundary.requires_code)}</p></div>
				</section>

				<section class="hrms-developer-center__grid">
					${cards.map((card) => `<article class="hrms-developer-center__card"><h4>${escape(__(card.title))}</h4><p>${escape(__(card.description))}</p><button class="btn btn-default btn-sm" data-action="${escape(card.action)}">${escape(__(card.button))}</button></article>`).join("")}
				</section>

				<section class="hrms-developer-center__map">
					<div class="hrms-developer-center__map-head">
						<div><h4>${__("可配置业务逻辑地图")}</h4><p>${__("每一项都标明保存位置、代码读取点、业务生效页面和验证方法。显示“已接入业务”表示修改会被现有业务代码读取。")}</p></div>
						<span class="indicator-pill blue">${escape(items.length)} ${__("项可配置能力")}</span>
					</div>
					<div class="table-responsive">
						<table class="table hrms-developer-center__map-table">
							<thead><tr><th>${__("配置项 / 保存对象")}</th><th>${__("作用 / 使用位置")}</th><th>${__("当前接入状态")}</th><th>${__("管理与验证")}</th></tr></thead>
							<tbody>${configuration_rows(items)}</tbody>
						</table>
					</div>
				</section>

				<section class="hrms-developer-center__checklist">
					<h4>${__("配置变更验证与发布检查")}</h4>
					<ol>
						<li>${__("记录修改前的配置值和一份固定业务样例，避免只凭页面勾选判断是否生效。")}</li>
						<li>${__("修改后点击“打开生效位置”，用同一业务样例重跑预览或流程并对比结果。")}</li>
						<li>${__("权限修改必须到“账户与权限中心”选择真实账户、操作和具体记录执行有效权限测试。")}</li>
						<li>${__("结构变化才执行迁移；普通规则参数和权限保存后直接由业务引擎读取，不需要迁移。")}</li>
						<li><code>./scripts/hrms-local.sh migrate</code> ${__("后刷新浏览器，并以最小角色再次做页面、接口、导入导出回归。")}</li>
					</ol>
				</section>
			</div>
		`);

		$(page.body).find("[data-action]").on("click", function () {
			switch (this.dataset.action) {
				case "models": route("hrms-model-center"); break;
				case "settings": route("hr-settings-center"); break;
				case "permissions": route("hrms-access-center"); break;
				case "pages": frappe.set_route("List", "Page"); break;
				case "operations": route("hrms-data-operations"); break;
			}
		});
		$(page.body).find("[data-route]").on("click", function () {
			route(this.dataset.route);
		});
		$(page.body).find("[data-test-hint]").on("click", function () {
			frappe.msgprint({ title: __("验证方法"), message: escape(this.dataset.testHint), indicator: "blue" });
		});
	}

	$(page.body).html(`<div class="text-muted">${__("正在分析当前业务配置及实际使用位置...")}</div>`);
	frappe.call("hrms.api.employee_field_template.get_hrms_developer_configuration_map")
		.then((response) => render(response.message || {}))
		.catch(() => $(page.body).html(`<div class="alert alert-danger">${__("无法读取业务配置地图，请确认当前账户拥有系统管理员角色。")}</div>`));
};
