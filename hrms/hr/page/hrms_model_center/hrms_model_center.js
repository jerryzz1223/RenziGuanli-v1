frappe.pages["hrms-model-center"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("基础模型管理"),
		single_column: true,
	});

	const roles = () => window.frappe?.user_roles || window.frappe?.boot?.user?.roles || [];
	const isSystemManager = () => roles().includes("System Manager");
	const escape = (value) => frappe.utils.escape_html(value == null ? "" : String(value));
	const route = (target) => frappe.set_route(...String(target || "").split("/"));
	let catalogue = [];
	let activeCategory = "全部重点模型";
	let query = "";

	if (!isSystemManager()) {
		$(page.body).html(`<div class="alert alert-danger">${__("基础模型管理仅对系统管理员开放。日常人资配置请使用设置中心。")}</div>`);
		return;
	}

	page.set_primary_action(__("返回开发与配置"), () => route("hrms-developer-center"), "left");

	function risk_class(risk) {
		if (risk === "低") return "green";
		if (risk === "中") return "blue";
		return "orange";
	}

	function filtered_items() {
		const needle = query.trim().toLowerCase();
		return catalogue.filter((item) => {
			const categoryMatches = activeCategory === "全部重点模型" || item.category === activeCategory;
			const text = [item.label, item.doctype, item.purpose, item.where_used, item.origin].join(" ").toLowerCase();
			return categoryMatches && (!needle || text.includes(needle));
		});
	}

	function render_rows() {
		const items = filtered_items();
		const target = $(page.body).find("[data-model-list]")[0];
		if (!target) return;
		if (!items.length) {
			target.innerHTML = `<div class="hrms-model-center__empty">${__("没有符合条件的重点模型。可以清除搜索或切换分类。")}</div>`;
			return;
		}
		target.innerHTML = items.map((item) => `
			<article class="hrms-model-center__model">
				<div class="hrms-model-center__model-head">
					<div><span class="hrms-model-center__category">${escape(item.category)}</span><h4>${escape(item.label)}</h4><code title="${__("系统内部技术名称")}">${escape(item.doctype)}</code></div>
					<div class="hrms-model-center__badges"><span class="indicator-pill ${item.exists ? "green" : "orange"}">${escape(item.usage)}</span><span class="indicator-pill ${risk_class(item.risk)}">${__("修改风险：{0}", [item.risk])}</span></div>
				</div>
				<div class="hrms-model-center__model-grid">
					<div><strong>${__("它是做什么的")}</strong><p>${escape(item.purpose)}</p></div>
					<div><strong>${__("项目中用在哪里")}</strong><p>${escape(item.where_used)}</p></div>
					<div><strong>${__("应该怎样修改")}</strong><p>${escape(item.safe_change)}</p></div>
				</div>
				<div class="hrms-model-center__model-footer">
					<span>${escape(item.origin)} · ${__("当前记录数：{0}", [item.record_count])}</span>
					<div>
						<button class="btn btn-primary btn-sm" data-manage-route="${escape(item.manage_route)}">${escape(item.manage_label)}</button>
						<button class="btn btn-default btn-sm" data-structure-route="${escape(item.structure_route)}" data-model-label="${escape(item.label)}">${__("查看底层结构（高级）")}</button>
					</div>
				</div>
			</article>`).join("");
		bind_row_actions();
	}

	function bind_row_actions() {
		$(page.body).find("[data-manage-route]").off("click").on("click", function () {
			route(this.dataset.manageRoute);
		});
		$(page.body).find("[data-structure-route]").off("click").on("click", function () {
			const target = this.dataset.structureRoute;
			const label = this.dataset.modelLabel;
			frappe.confirm(
				__("“{0}”的底层结构会影响数据库、表单、权限和现有代码。这里只建议开发人员查看；如需修改，请先确认没有对应的业务配置入口，并准备迁移与回归测试。是否继续？", [label]),
				() => route(target),
			);
		});
	}

	function render(data) {
		catalogue = data.items || [];
		const summary = data.summary || {};
		const guidance = data.guidance || {};
		const categories = ["全部重点模型", "核心业务模型", "无代码业务配置", "系统内部记录"];
		$(page.body).html(`
			<div class="hrms-model-center">
				<section class="hrms-model-center__hero">
					<div><span class="indicator blue"></span><h3>${__("不需要了解全部单据类型")}</h3><p>${escape(guidance.need_to_know)}</p></div>
					<span class="indicator-pill blue">${__("已筛出 {0} 个项目重点模型", [summary.project_model_count || 0])}</span>
				</section>

				<section class="hrms-model-center__explain">
					<div><span>1</span><strong>${__("先理解概念")}</strong><p>${escape(guidance.doctype_meaning)}</p></div>
					<div><span>2</span><strong>${__("只看项目相关")}</strong><p>${escape(guidance.raw_registry)}</p></div>
					<div><span>3</span><strong>${__("优先业务入口")}</strong><p>${__("修改资料和规则时先点每个模型的主要按钮，不从底层结构编辑器开始。")}</p></div>
					<div><span>4</span><strong>${__("底层结构受控")}</strong><p>${__("只有新增数据关系或标准配置无法满足时，才由开发人员修改结构并执行迁移测试。")}</p></div>
				</section>

				<section class="hrms-model-center__summary">
					<div><strong>${escape(summary.business_model_count || 0)}</strong><span>${__("核心业务模型")}</span></div>
					<div><strong>${escape(summary.config_model_count || 0)}</strong><span>${__("无代码业务配置")}</span></div>
					<div><strong>${escape(summary.internal_model_count || 0)}</strong><span>${__("系统内部记录")}</span></div>
					<div><strong>${escape(summary.framework_model_count || 0)}</strong><span>${__("框架全部模型（无需逐一了解）")}</span></div>
				</section>

				<section class="hrms-model-center__catalogue">
					<div class="hrms-model-center__toolbar">
						<div><h4>${__("本项目基础模型目录")}</h4><p>${__("名称、实际使用位置、修改方式和风险都集中在这里。技术英文名仅作为开发排查标识。")}</p></div>
						<input class="form-control input-sm" data-model-search placeholder="${__("搜索中文名称、用途或技术名称")}" />
					</div>
					<div class="hrms-model-center__filters">${categories.map((category) => `<button class="btn btn-sm ${category === activeCategory ? "btn-primary" : "btn-default"}" data-model-category="${escape(category)}">${escape(category)}</button>`).join("")}</div>
					<div data-model-list></div>
				</section>

				<section class="hrms-model-center__advanced">
					<div><h4>${__("完整底层模型注册表（高级）")}</h4><p>${__("这里包含库存、会计、网站、框架内部表和所有已安装模块。它用于开发排查，不是人资配置菜单；例如“套件明细”属于库存产品套件，与本项目人资日常管理无关。")}</p></div>
					<button class="btn btn-default btn-sm" data-open-all-models>${__("谨慎查看全部底层模型")}</button>
				</section>
			</div>
		`);

		$(page.body).find("[data-model-category]").on("click", function () {
			activeCategory = this.dataset.modelCategory;
			$(page.body).find("[data-model-category]").removeClass("btn-primary").addClass("btn-default");
			$(this).removeClass("btn-default").addClass("btn-primary");
			render_rows();
		});
		$(page.body).find("[data-model-search]").on("input", function () {
			query = this.value || "";
			render_rows();
		});
		$(page.body).find("[data-open-all-models]").on("click", function () {
			frappe.confirm(
				__("完整列表包含大量与当前人资项目无关的框架模型。请只用于定位技术结构，不要直接修改陌生模型。是否继续？"),
				() => frappe.set_route("List", "DocType"),
			);
		});
		render_rows();
	}

	$(page.body).html(`<div class="text-muted">${__("正在分析本项目实际使用的基础模型...")}</div>`);
	frappe.call("hrms.api.employee_field_template.get_hrms_model_governance_catalog")
		.then((response) => render(response.message || {}))
		.catch(() => $(page.body).html(`<div class="alert alert-danger">${__("无法读取基础模型目录，请确认当前账户拥有系统管理员角色。")}</div>`));
};
