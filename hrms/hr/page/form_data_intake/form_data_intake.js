frappe.pages["form-data-intake"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("人资表单导入中心"), single_column: true });
	wrapper.form_data_intake = new FormDataIntake(page);
	wrapper.form_data_intake.show();
};

frappe.pages["form-data-intake"].on_page_show = function (wrapper) {
	wrapper.form_data_intake?.activate();
};

frappe.pages["form-data-intake"].on_page_hide = function (wrapper) {
	wrapper.form_data_intake?.deactivate();
};

class FormDataIntake {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.company = this.get_context_company();
		this.templates = [];
		this.module = "";
		this.selected = null;
		this.file_url = "";
		this.preview = null;
		this.refresh_request_id = 0;
		this.batch_request_id = 0;
		this.company_context_bound = false;
		this.last_refresh_at = 0;
		this.cache_ttl = 30_000;
	}

	show() {
		this.page.set_primary_action(__("上传表单"), () => this.open_uploader());
		this.activate(true);
	}

	is_active() {
		const container = this.wrapper.closest(".page-container");
		return !container || container.classList.contains("active");
	}

	activate(initial = false) {
		this.bind_company_context();
		if (initial || Date.now() - this.last_refresh_at > this.cache_ttl) this.refresh();
	}

	deactivate() {
		if (!this.company_context_bound) return;
		window.removeEventListener("hrms:company-context-changed", this.handle_company_context_change);
		this.company_context_bound = false;
	}

	get_context_company() {
		return window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	}

	bind_company_context() {
		if (this.company_context_bound) return;
		this.company_context_bound = true;
		this.handle_company_context_change = (event) => {
			if (!this.is_active()) return;
			const next = event?.detail?.company || this.get_context_company();
			if (!next || next === this.company) return;
			this.company = next;
			this.preview = null;
			this.refresh();
		};
		window.addEventListener("hrms:company-context-changed", this.handle_company_context_change);
		window.hrmsCompanyContext?.ready?.().then((company) => {
			if (!this.is_active()) return;
			if (company && company !== this.company) {
				this.company = company;
				this.refresh();
			}
		});
	}

	refresh() {
		const request_id = ++this.refresh_request_id;
		this.last_refresh_at = Date.now();
		frappe.call({ method: "hrms.api.form_data_intake.list_form_import_templates", args: { module_name: this.module } }).then((response) => {
			if (request_id !== this.refresh_request_id) return;
			this.templates = response.message || [];
			if (this.selected && !this.templates.some((item) => item.key === this.selected.key)) this.selected = null;
			this.render();
			this.load_batches();
		});
	}

	escape(value) {
		return frappe.utils.escape_html(String(value ?? ""));
	}

	modules() {
		return [...new Set(this.templates.map((item) => item.module))];
	}

	render() {
		const modules = this.modules();
		this.wrapper.innerHTML = `
			<div class="hrms-form-intake">
				<section class="hrms-form-intake__hero">
					<div><h2>${this.escape(__("人资表单导入中心"))}</h2><p>${this.escape(__("下载标准模板、填写、上传校验并入库。签核型表单先进入数据池，确认后才影响人事、考勤或薪资结果。"))}</p></div>
					<div class="hrms-form-intake__company"><span>${this.escape(__("当前公司"))}</span><strong>${this.escape(this.company || __("请在顶部选择公司"))}</strong></div>
				</section>
				<section class="hrms-form-intake__steps"><span>1 ${this.escape(__("下载模板"))}</span><span>2 ${this.escape(__("填写数据"))}</span><span>3 ${this.escape(__("上传预览"))}</span><span>4 ${this.escape(__("校验入库"))}</span><span>5 ${this.escape(__("后续业务处理"))}</span></section>
				<div class="hrms-form-intake__filters"><button class="btn btn-sm ${this.module ? "btn-default" : "btn-primary"}" data-module="">${this.escape(__("全部"))}</button>${modules.map((module) => `<button class="btn btn-sm ${this.module === module ? "btn-primary" : "btn-default"}" data-module="${this.escape(module)}">${this.escape(module)}</button>`).join("")}</div>
				<section class="hrms-form-intake__grid">${this.templates.map((item) => this.render_template(item)).join("")}</section>
				<section class="hrms-form-intake__preview" data-preview>${this.render_preview()}</section>
				<section class="hrms-form-intake__batches"><h3>${this.escape(__("已导入批次"))}</h3><div data-batches>${this.escape(__("正在读取…"))}</div></section>
			</div>`;
		this.bind_events();
	}

	render_template(item) {
		const selected = this.selected?.key === item.key;
		return `<article class="hrms-form-template ${selected ? "is-selected" : ""}">
			<div class="hrms-form-template__meta"><span>${this.escape(item.module)}</span><small>${this.escape((item.source_sheets || []).join(" / "))}</small></div>
			<h3>${this.escape(item.label)}</h3><p>${this.escape(item.description)}</p>
			<div class="hrms-form-template__target">${this.escape(__("后续处理："))}${this.escape(item.processing_target)}</div>
			<div class="hrms-form-template__actions"><button class="btn btn-default btn-sm" data-route="${this.escape(item.entry_route || "/desk/form-data-intake")}">${this.escape(__("进入对应模块"))}</button><button class="btn btn-default btn-sm" data-download="${this.escape(item.key)}">${this.escape(__("下载模板"))}</button><button class="btn btn-primary btn-sm" data-select="${this.escape(item.key)}">${this.escape(item.entry_mode === "employee_roster" ? "进入导入" : "填写后上传")}</button></div>
		</article>`;
	}

	render_preview() {
		if (!this.selected) return `<div class="text-muted">${this.escape(__("选择一张表单后，可下载模板或上传已填写的文件。"))}</div>`;
		if (this.selected.entry_mode === "employee_roster") return `<div class="alert alert-info">${this.escape(__("员工花名册将进入智能花名册导入，以便安全创建或更新员工主档。"))} <button class="btn btn-primary btn-sm" data-roster>${this.escape(__("进入智能花名册导入"))}</button></div>`;
		if (!this.file_url) return `<div><strong>${this.escape(this.selected.label)}</strong><p>${this.escape(__("先下载模板填写，再上传。系统会核验必填列、工号和部门，并只把有效行写入表单数据池。"))}</p><button class="btn btn-primary" data-upload>${this.escape(__("上传已填写文件"))}</button></div>`;
		if (!this.preview) return `<div>${this.escape(__("正在读取并校验文件…"))}</div>`;
		if (this.preview.missing_required?.length) return `<div class="alert alert-danger">${this.escape(__("缺少必填列："))}${this.escape(this.preview.missing_required.join("、"))}</div>`;
		return `<div><div class="hrms-form-intake__preview-summary"><strong>${this.escape(this.selected.label)}</strong><span>${this.escape(__("工作表："))}${this.escape(this.preview.sheet_name)}</span><span>${this.escape(__("读取"))} ${this.escape(this.preview.total_rows)} ${this.escape(__("行"))}</span><span class="text-success">${this.escape(__("有效"))} ${this.escape(this.preview.valid_rows)} ${this.escape(__("行"))}</span><span class="text-danger">${this.escape(__("失败"))} ${this.escape(this.preview.failed_rows)} ${this.escape(__("行"))}</span></div>
			${this.render_preview_rows()}<div class="hrms-form-intake__preview-actions"><button class="btn btn-default" data-upload>${this.escape(__("重新上传"))}</button><button class="btn btn-primary" data-import ${this.preview.failed_rows ? "disabled" : ""}>${this.escape(__("确认校验并入库"))}</button></div></div>`;
	}

	render_preview_rows() {
		const rows = this.preview.preview_rows || [];
		if (!rows.length) return `<p class="text-muted">${this.escape(__("没有可导入数据行。"))}</p>`;
		return `<table class="table table-bordered table-sm"><thead><tr><th>${this.escape(__("行号"))}</th><th>${this.escape(__("业务键"))}</th><th>${this.escape(__("匹配员工"))}</th><th>${this.escape(__("校验结果"))}</th></tr></thead><tbody>${rows.slice(0, 20).map((row) => `<tr><td>${this.escape(row.row_number)}</td><td>${this.escape(row.record_key)}</td><td>${this.escape(row.employee || "—")}</td><td>${row.errors?.length ? `<span class="text-danger">${this.escape(row.errors.join("；"))}</span>` : `<span class="text-success">${this.escape(__("通过"))}</span>`}</td></tr>`).join("")}</tbody></table>`;
	}

	bind_events() {
		this.wrapper.querySelectorAll("[data-module]").forEach((button) => button.addEventListener("click", () => { this.module = button.dataset.module || ""; this.selected = null; this.file_url = ""; this.preview = null; this.refresh(); }));
		this.wrapper.querySelectorAll("[data-select]").forEach((button) => button.addEventListener("click", () => { this.selected = this.templates.find((item) => item.key === button.dataset.select); this.file_url = ""; this.preview = null; this.render(); }));
		this.wrapper.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => {
			const route = button.dataset.route || "/desk/form-data-intake";
			window.location.assign(route);
		}));
		this.wrapper.querySelectorAll("[data-download]").forEach((button) => button.addEventListener("click", () => this.download_template(button.dataset.download)));
		this.wrapper.querySelectorAll("[data-upload]").forEach((button) => button.addEventListener("click", () => this.open_uploader()));
		this.wrapper.querySelector("[data-import]")?.addEventListener("click", () => this.import_file());
		this.wrapper.querySelector("[data-roster]")?.addEventListener("click", () => frappe.set_route("employee-roster-import"));
	}

	download_template(template_key) {
		const template = this.templates.find((item) => item.key === template_key);
		if (template?.entry_mode === "employee_roster") {
			window.open(frappe.urllib.get_full_url("/api/method/hrms.api.employee_field_template.download_employee_import_template"));
			return;
		}
		frappe.call({ method: "hrms.api.form_data_intake.create_form_import_template_file", args: { template_key }, freeze: true }).then((response) => {
			const file = response.message || {};
			if (file.file_url) window.open(frappe.urllib.get_full_url(file.file_url));
		});
	}

	open_uploader() {
		if (!this.selected) { frappe.show_alert({ message: __("请先选择表单类型"), indicator: "orange" }); return; }
		if (this.selected.entry_mode === "employee_roster") { frappe.set_route("employee-roster-import"); return; }
		if (!this.company) { frappe.msgprint(__("请先在顶部公司切换器选择公司。")); return; }
		new frappe.ui.FileUploader({ folder: "Home/Attachments", restrictions: { allowed_file_types: [".xlsx"] }, on_success: (file) => { this.file_url = file.file_url; this.preview = null; this.render(); this.preview_file(); } });
	}

	preview_file() {
		frappe.call({ method: "hrms.api.form_data_intake.preview_form_import", args: { file_url: this.file_url, template_key: this.selected.key, company: this.company }, freeze: true, freeze_message: __("正在校验表单…") }).then((response) => { this.preview = response.message || {}; this.render(); });
	}

	import_file() {
		if (!this.preview || this.preview.failed_rows) return;
		frappe.call({ method: "hrms.api.form_data_intake.import_form_workbook", args: { file_url: this.file_url, template_key: this.selected.key, company: this.company }, freeze: true, freeze_message: __("正在写入表单数据池…") }).then((response) => {
			const result = response.message || {};
			frappe.show_alert({ message: __("已导入 {0} 行，批次：{1}", [result.valid_rows || 0, result.batch_name || ""]), indicator: "green" });
			this.file_url = ""; this.preview = null; this.refresh();
		});
	}

	load_batches() {
		const target = this.wrapper.querySelector("[data-batches]");
		if (!target || !this.company) { if (target) target.innerHTML = this.escape(__("请先选择公司。")); return; }
		const request_id = ++this.batch_request_id;
		frappe.call({ method: "hrms.api.form_data_intake.list_form_import_batches", args: { company: this.company, module_name: this.module } }).then((response) => {
			if (request_id !== this.batch_request_id || !this.is_active()) return;
			const rows = response.message || [];
			target.innerHTML = rows.length ? `<table class="table table-bordered table-sm"><thead><tr><th>${this.escape(__("批次"))}</th><th>${this.escape(__("表单"))}</th><th>${this.escape(__("状态"))}</th><th>${this.escape(__("有效/失败"))}</th><th>${this.escape(__("时间"))}</th></tr></thead><tbody>${rows.map((row) => `<tr><td><a href="/app/hrms-form-import-batch/${encodeURIComponent(row.name)}">${this.escape(row.name)}</a></td><td>${this.escape(row.template_name)}</td><td>${this.escape(row.status)}</td><td>${this.escape(row.valid_rows)}/${this.escape(row.failed_rows)}</td><td>${this.escape(frappe.datetime.str_to_user(row.imported_on || ""))}</td></tr>`).join("")}</tbody></table>` : `<div class="text-muted">${this.escape(__("当前公司尚无导入批次。"))}</div>`;
		});
	}
}
