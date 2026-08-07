frappe.pages["company-management"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("公司管理"),
		single_column: true,
	});
	page.set_primary_action(__("刷新"), () => load(), "refresh");

	const state = { companies: [] };

	function escape(value) {
		return frappe.utils.escape_html(value == null ? "" : String(value));
	}

	function scopeLabel(scope) {
		return scope === "primary" ? __("日常运行公司") : scope === "test" ? __("测试/夹具公司") : __("历史公司");
	}

	function companyLabel(company) {
		return company.company_name && company.company_name !== company.name
			? `${company.company_name}（编码：${company.name}）`
			: company.name;
	}

	function countCard(label, value) {
		return `<div class="hrms-company-management__count"><small>${escape(label)}</small><strong>${escape(value || 0)}</strong></div>`;
	}

	function companyCard(company) {
		const primary = company.scope === "primary";
		return `
			<article class="hrms-company-management__company${primary ? " is-primary" : ""}">
				<div class="hrms-company-management__heading">
					<div><h4>${escape(companyLabel(company))}</h4><p>${escape(scopeLabel(company.scope))}</p></div>
					<span class="indicator-pill ${primary ? "green" : company.scope === "test" ? "orange" : "gray"}">${escape(scopeLabel(company.scope))}</span>
				</div>
				<div class="hrms-company-management__counts">
					${countCard(__("员工"), company.employee_count)}
					${countCard(__("部门"), company.department_count)}
					${countCard(__("考勤草稿"), company.attendance_count)}
					${countCard(__("薪资结算"), company.payroll_count)}
					${countCard(__("导入批次"), company.form_import_count)}
				</div>
				<div class="hrms-company-management__actions">
					<button type="button" class="btn btn-default btn-sm" data-action="open-company" data-company="${escape(company.name)}">${__("公司档案")}</button>
					${primary ? `<button type="button" class="btn btn-primary btn-sm" data-action="use-yongxin" data-company="${escape(company.name)}">${__("设为日常公司")}</button>` : ""}
				</div>
			</article>`;
	}

	function render() {
		const primary = state.companies.find((company) => company.scope === "primary");
		const otherCompanies = state.companies.filter((company) => company.scope !== "primary");
		$(page.body).html(`
			<section class="hrms-company-management">
				<div class="alert alert-info"><strong>${__("永新单公司运行模式")}</strong><br>${__("日常人事、考勤与薪资固定使用“永新”。公司是底层数据隔离键；当前本地业务站只保留永新。未来新增分公司必须先完成数据迁移方案，不应直接复制测试公司。")}</div>
				<section class="hrms-company-management__primary">
					<h3>${__("当前日常公司")}</h3>
					${primary ? companyCard(primary) : `<div class="alert alert-danger">${__("未找到显示名称或内部编码为“永新”的公司。请先检查公司档案，暂不要新建重复公司。")}</div>`}
				</section>
				<section class="hrms-company-management__legacy">
					<div><h3>${__("其他公司")}</h3><p>${__("当前没有其他公司。若未来启用分公司，请先建立经审核的数据迁移与权限隔离方案。")}</p></div>
					<div class="hrms-company-management__list">${otherCompanies.map(companyCard).join("") || `<p class="text-muted">${__("当前仅保留永新")}</p>`}</div>
				</section>
			</section>`);
		bindEvents();
	}

	function bindEvents() {
		page.body[0].querySelectorAll("[data-action='open-company']").forEach((button) => {
			button.addEventListener("click", () => frappe.set_route("Form", "Company", button.dataset.company));
		});
		page.body[0].querySelectorAll("[data-action='use-yongxin']").forEach((button) => {
			button.addEventListener("click", () => {
				const selected = window.hrmsCompanyContext?.setCurrentCompany?.(button.dataset.company);
				if (selected !== button.dataset.company) {
					frappe.msgprint(__("当前日常公司未能更新，请刷新后重试。"));
					return;
				}
				frappe.show_alert({ message: __("日常公司已固定为：{0}", [companyLabel(state.companies.find((row) => row.name === selected) || {})]), indicator: "green" });
			});
		});
	}

	function load() {
		$(page.body).html(`<div class="text-muted">${__("正在读取公司数据情况…")}</div>`);
		return frappe.call("hrms.api.data_operations.get_company_data_management_context", { company: "" }).then((response) => {
			state.companies = response.message?.companies || [];
			state.companies.sort((left, right) => (left.scope === "primary" ? -1 : right.scope === "primary" ? 1 : companyLabel(left).localeCompare(companyLabel(right), "zh-CN")));
			render();
		});
	}

	load();
};
