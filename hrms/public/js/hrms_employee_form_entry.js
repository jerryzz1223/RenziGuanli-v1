(function () {
	const FORM_TYPES = {
		employee_talk: { label: "员工谈话表", material_type: "employee_talk_form" },
		employee_transfer_application: { label: "员工职务调动申请表", material_type: "employee_transfer_application" },
		reward_punishment_report: { label: "奖惩提报单", material_type: "reward_punishment_report" },
	};

	const ROUTE_TYPES = {
		"employee-talk-form": "employee_talk",
		"employee-duty-change": "employee_transfer_application",
		"employee-reward-form": "reward_punishment_report",
	};

	class EmployeeFormSubmitPage {
		constructor(page, form_type) {
			this.page = page;
			this.wrapper = page.main[0];
			this.form_type = form_type;
			this.form = FORM_TYPES[form_type];
			this.route = Object.keys(ROUTE_TYPES).find((route) => ROUTE_TYPES[route] === form_type);
			this.search_text = "";
			this.matches = [];
			this.selected_employee = null;
			this.loading = false;
			this.success = "";
			this.error_message = "";
			this.search_request_id = 0;
			this.record_search_text = "";
			this.record_request_id = 0;
		}

		show() {
			this.page.set_secondary_action(__("返回员工表单录入"), () => frappe.set_route("employee-form-entry"));
			if (frappe.get_route()[1] === "records") {
				this.page.set_primary_action(__("进入录入"), () => frappe.set_route(this.route));
				this.render_records_page();
				return;
			}
			this.page.set_primary_action(__("录入记录"), () => this.show_records());
			this.render();
		}

		escape(value) { return frappe.utils.escape_html(String(value ?? "")); }

		render_employee_photo(employee) {
			const image = String(employee.image || "").trim();
			return image
				? `<img class="hrms-employee-form-submit__photo-image" src="${this.escape(image)}" alt="${this.escape(employee.employee_name || "员工照片")}">`
				: `<span class="hrms-employee-form-submit__photo-empty">${__("无")}</span>`;
		}

		render() {
		this.wrapper.innerHTML = `
			<style>
				.hrms-employee-form-submit { max-width: 880px; margin: 0 auto; padding: 28px 12px 72px; }
				.hrms-employee-form-submit__hero { background: #ecfdf5; border: 1px solid #b7ead5; border-radius: 10px; padding: 20px 24px; margin-bottom: 16px; }
				.hrms-employee-form-submit__hero h2 { margin: 0 0 6px; font-size: 21px; }
				.hrms-employee-form-submit__hero p { margin: 0; color: #687385; }
				.hrms-employee-form-submit__panel { background: #fff; border: 1px solid #e6edf3; border-radius: 10px; padding: 22px; }
				.hrms-employee-form-submit__panel h3 { margin: 0 0 5px; }
				.hrms-employee-form-submit__hint { color: #687385; margin: 0 0 16px; }
				.hrms-employee-form-submit__search { display: flex; gap: 8px; max-width: 680px; }
				.hrms-employee-form-submit__search input { flex: 1; }
				.hrms-employee-form-submit__results { max-width: 680px; margin-top: 14px; }
				.hrms-employee-form-submit__result { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; text-align: left; background: #f8fafc; border: 1px solid #e6edf3; border-radius: 8px; padding: 11px 13px; margin-bottom: 8px; }
				.hrms-employee-form-submit__result:hover { border-color: #10b981; }
				.hrms-employee-form-submit__result small { display: block; color: #687385; margin-top: 3px; }
				.hrms-employee-form-submit__identity { display: inline-flex; min-width: 0; align-items: center; gap: 10px; }
				.hrms-employee-form-submit__photo { display: inline-flex; width: 42px; height: 42px; flex: 0 0 42px; align-items: center; justify-content: center; overflow: hidden; border: 1px solid #dbe5ed; border-radius: 8px; background: #f1f5f9; color: #8a96a3; font-size: 12px; }
				.hrms-employee-form-submit__photo-image { display: block; width: 100%; height: 100%; object-fit: cover; }
				.hrms-employee-form-submit__selected { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #f0fdf8; border: 1px solid #b7ead5; border-radius: 8px; padding: 14px; max-width: 680px; margin-top: 16px; }
				.hrms-employee-form-submit__selected small { display: block; color: #687385; margin-top: 3px; }
				.hrms-employee-form-submit__success { color: #047857; background: #ecfdf5; border: 1px solid #b7ead5; border-radius: 8px; padding: 12px 14px; max-width: 680px; margin-top: 14px; }
				@media (max-width: 640px) { .hrms-employee-form-submit__search, .hrms-employee-form-submit__selected { align-items: stretch; flex-direction: column; } }
			</style>
			<div class="hrms-employee-form-submit">
				<div class="hrms-employee-form-submit__hero"><h2>${__(this.form.label)}</h2><p>${__("先匹配员工，再拍照或上传本表单；提交后材料会归档到该员工花名册的材料附件。")}</p></div>
				<div class="hrms-employee-form-submit__panel"><h3>${__("选择员工")}</h3><p class="hrms-employee-form-submit__hint">${__("请输入公司工号或姓名。有多个同名员工时，请选择正确的员工后再提交。")}</p>
					<div class="hrms-employee-form-submit__search"><input class="form-control" data-role="employee-search" value="${this.escape(this.search_text)}" placeholder="${__("请输入公司工号或姓名")}"><button type="button" class="btn btn-primary" data-action="search">${__("匹配员工")}</button></div>
					<div class="hrms-employee-form-submit__results">${this.render_matches()}</div>${this.render_selected()}
				</div>
			</div>
		`;
			this.bind_events();
		}

		render_matches() {
			if (this.loading) return `<div class="text-muted">${__("正在匹配员工…")}</div>`;
			if (this.error_message) return `<div class="text-danger">${this.escape(this.error_message)}</div>`;
			if (this.search_text && !this.matches.length) return `<div class="text-muted">${__("没有匹配到员工，请检查工号或姓名。")}</div>`;
			return this.matches.map((employee) => `<button type="button" class="hrms-employee-form-submit__result" data-action="select" data-employee="${this.escape(employee.name)}"><span class="hrms-employee-form-submit__identity"><span class="hrms-employee-form-submit__photo">${this.render_employee_photo(employee)}</span><span><strong>${this.escape(employee.employee_name || "未填写姓名")}</strong><small>${this.escape(employee.employee_code || "未填写工号")} · ${this.escape(employee.department || "未填写部门")} · ${this.escape(employee.designation || "未填写岗位")}</small></span></span><span class="text-muted">${this.escape(employee.status || "")}</span></button>`).join("");
		}

		render_selected() {
			if (!this.selected_employee) return "";
			const employee = this.selected_employee;
			const success = this.success ? `<div class="hrms-employee-form-submit__success">${this.escape(this.success)} <button type="button" class="btn btn-link btn-xs" data-action="open-employee">${__("打开员工档案")}</button></div>` : "";
			return `<div class="hrms-employee-form-submit__selected"><span class="hrms-employee-form-submit__identity"><span class="hrms-employee-form-submit__photo">${this.render_employee_photo(employee)}</span><span><strong>${this.escape(employee.employee_name || "未填写姓名")}</strong><small>${this.escape(employee.employee_code || "未填写工号")} · ${this.escape(employee.department || "未填写部门")} · ${this.escape(employee.designation || "未填写岗位")}</small></span></span><button type="button" class="btn btn-primary" data-action="upload">${__("拍照/上传并提交")}</button></div>${success}`;
		}

		bind_events() {
			const input = this.wrapper.querySelector("[data-role='employee-search']");
			input?.addEventListener("input", () => { this.search_text = input.value; this.error_message = ""; });
			input?.addEventListener("keydown", (event) => { if (event.key === "Enter") this.search_employees(); });
			this.wrapper.querySelector("[data-action='search']")?.addEventListener("click", () => this.search_employees());
			this.wrapper.querySelectorAll("[data-action='select']").forEach((button) => button.addEventListener("click", () => {
				this.selected_employee = this.matches.find((employee) => employee.name === button.dataset.employee) || null;
				this.success = "";
				this.render();
			}));
			this.wrapper.querySelector("[data-action='upload']")?.addEventListener("click", () => this.upload());
			this.wrapper.querySelector("[data-action='open-employee']")?.addEventListener("click", () => frappe.set_route("employee-detail", this.selected_employee.name));
		}

		search_employees() {
			this.search_text = String(this.wrapper.querySelector("[data-role='employee-search']")?.value || "").trim();
			if (!this.search_text) { frappe.show_alert({ message: __("请输入工号或姓名"), indicator: "orange" }); return; }
			const request_id = ++this.search_request_id;
			this.loading = true;
			this.error_message = "";
			this.matches = [];
			this.render();
			const company = window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
			frappe.call({ method: "hrms.api.employee_form_entry.find_employee_matches", args: { search_text: this.search_text, company } }).then(
				(response) => {
					if (request_id !== this.search_request_id) return;
					this.matches = response.message || [];
					this.loading = false;
					this.render();
				},
				(error) => {
					if (request_id !== this.search_request_id) return;
					this.error_message = error?.message || __("匹配员工失败，请刷新后重试");
					this.loading = false;
					this.render();
				}
			);
		}

		upload() {
			if (!this.selected_employee) return;
			new frappe.ui.FileUploader({ doctype: "Employee", docname: this.selected_employee.name, allow_multiple: false, allow_take_photo: true, allow_web_link: false, disable_file_browser: true, restrictions: { allowed_file_types: [".jpg", ".jpeg", ".png", ".webp", ".pdf"], max_file_size: 10 * 1024 * 1024 }, on_success: (file, response) => {
				const file_url = file?.file_url || response?.message?.file_url;
				if (!file_url) return;
				frappe.call({ method: "hrms.api.employee_form_entry.archive_employee_form_attachment", args: { employee: this.selected_employee.name, form_type: this.form_type, file_url }, freeze: true, freeze_message: __("正在提交员工表单…") }).then(() => {
					this.success = `${this.form.label}已提交并归档到${this.selected_employee.employee_name || this.selected_employee.name}的材料附件。`;
					this.render();
					frappe.show_alert({ message: __("员工表单已提交"), indicator: "green" });
				});
			} });
		}

		render_records_page() {
			this.wrapper.innerHTML = `
				<style>
					.hrms-employee-form-records { max-width: 980px; margin: 0 auto; padding: 28px 12px 72px; }
					.hrms-employee-form-records__hero { background: #ecfdf5; border: 1px solid #b7ead5; border-radius: 10px; padding: 20px 24px; margin-bottom: 16px; }
					.hrms-employee-form-records__hero h2 { margin: 0 0 6px; font-size: 21px; }
					.hrms-employee-form-records__hero p { margin: 0; color: #687385; }
					.hrms-employee-form-records__panel { background: #fff; border: 1px solid #e6edf3; border-radius: 10px; padding: 16px; }
					.hrms-employee-form-records__filters { display: flex; gap: 8px; margin-bottom: 14px; max-width: 680px; }
					.hrms-employee-form-records__filters input { flex: 1; }
					.hrms-employee-form-record { align-items: center; border: 1px solid #e6edf3; border-radius: 10px; display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) 124px; margin-bottom: 10px; padding: 14px; }
					.hrms-employee-form-record:last-child { margin-bottom: 0; }
					.hrms-employee-form-record__info { display: grid; gap: 8px; grid-template-columns: repeat(5, minmax(0, 1fr)); min-width: 0; }
					.hrms-employee-form-record__field { min-width: 0; }
					.hrms-employee-form-record__field span, .hrms-employee-form-record__meta span { color: #687385; display: block; font-size: 12px; margin-bottom: 3px; }
					.hrms-employee-form-record__field strong, .hrms-employee-form-record__meta strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
					.hrms-employee-form-record__meta { border-top: 1px solid #eef2f6; display: flex; gap: 24px; grid-column: 1 / -1; padding-top: 10px; }
					.hrms-employee-form-record__preview { align-items: center; display: flex; height: 92px; justify-content: center; width: 112px; }
					.hrms-employee-form-record__preview button { background: #f8fafc; border: 1px solid #e6edf3; border-radius: 8px; cursor: zoom-in; height: 92px; overflow: hidden; padding: 0; width: 112px; }
					.hrms-employee-form-record__preview img { display: block; height: 100%; object-fit: cover; width: 100%; }
					.hrms-employee-form-record__file { color: #2563eb; font-size: 12px; text-align: center; word-break: break-all; }
					@media (max-width: 880px) { .hrms-employee-form-record__info { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
					@media (max-width: 680px) { .hrms-employee-form-record { grid-template-columns: 1fr; } .hrms-employee-form-record__preview { justify-self: start; } .hrms-employee-form-record__info { grid-template-columns: 1fr 1fr; } .hrms-employee-form-record__meta { flex-direction: column; gap: 8px; } }
				</style>
				<div class="hrms-employee-form-records"><div class="hrms-employee-form-records__hero"><h2>${__(this.form.label)}${__("录入记录")}</h2><p>${__("显示员工姓名、工号、当前部门、当前职务、当前状态、材料预览、提交时间和提交人。点击照片缩略图可放大查看。")}</p></div><div class="hrms-employee-form-records__panel"><div class="hrms-employee-form-records__filters"><input class="form-control" data-role="record-search" value="${this.escape(this.record_search_text)}" placeholder="${__("请输入员工姓名或部门")}"><button type="button" class="btn btn-primary" data-action="record-search">${__("筛选")}</button><button type="button" class="btn btn-default" data-action="record-reset">${__("重置")}</button></div><div data-role="records-view"><div class="text-muted">${__("正在加载录入记录…")}</div></div></div></div>
			`;
			const input = this.wrapper.querySelector("[data-role='record-search']");
			input?.addEventListener("input", () => { this.record_search_text = input.value; });
			input?.addEventListener("keydown", (event) => { if (event.key === "Enter") this.load_record_rows(); });
			this.wrapper.querySelector("[data-action='record-search']")?.addEventListener("click", () => this.load_record_rows());
			this.wrapper.querySelector("[data-action='record-reset']")?.addEventListener("click", () => { this.record_search_text = ""; this.render_records_page(); });
			this.load_record_rows();
		}

		load_record_rows() {
			const request_id = ++this.record_request_id;
			const view = this.wrapper.querySelector("[data-role='records-view']");
			if (!view) return;
			view.innerHTML = `<div class="text-muted">${__("正在加载录入记录…")}</div>`;
			const company = window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
			frappe.call({ method: "hrms.api.employee_form_entry.list_employee_form_entries", args: { form_type: this.form_type, company, search_text: this.record_search_text.trim() } }).then(
				(response) => { if (request_id === this.record_request_id) this.render_record_rows(response.message || []); },
				(error) => { if (request_id === this.record_request_id) view.innerHTML = `<div class="text-danger">${this.escape(error?.message || __("录入记录加载失败，请刷新后重试"))}</div>`; }
			);
		}

		render_record_rows(rows) {
			const view = this.wrapper.querySelector("[data-role='records-view']");
			if (!view) return;
			if (!rows.length) { view.innerHTML = `<div class="text-muted">${__("暂无该表单的录入记录")}</div>`; return; }
			view.innerHTML = rows.map((row) => {
				const image = /\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(row.file_url || row.file_name || "");
				const preview = image
					? `<button type="button" data-preview-src="${this.escape(row.file_url)}" data-preview-name="${this.escape(row.file_name || this.form.label)}"><img src="${this.escape(row.file_url)}" alt="${this.escape(row.file_name || this.form.label)}" loading="lazy"></button>`
					: `<a class="hrms-employee-form-record__file" href="${this.escape(row.file_url)}" target="_blank" rel="noopener">${this.escape(row.file_name || "打开文件")}</a>`;
				return `<div class="hrms-employee-form-record"><div><div class="hrms-employee-form-record__info"><div class="hrms-employee-form-record__field"><span>${__("员工姓名")}</span><strong><a href="#" data-employee="${this.escape(row.employee)}">${this.escape(row.employee_name || "未填写姓名")}</a></strong></div><div class="hrms-employee-form-record__field"><span>${__("工号")}</span><strong>${this.escape(row.employee_code || "未填写工号")}</strong></div><div class="hrms-employee-form-record__field"><span>${__("当前部门")}</span><strong>${this.escape(row.department || "未填写部门")}</strong></div><div class="hrms-employee-form-record__field"><span>${__("当前职务")}</span><strong>${this.escape(row.designation || "未填写职务")}</strong></div><div class="hrms-employee-form-record__field"><span>${__("当前状态")}</span><strong>${this.escape(row.status || "未记录")}</strong></div></div><div class="hrms-employee-form-record__meta"><div><span>${__("提交时间")}</span><strong>${this.escape(row.creation || row.modified || "")}</strong></div><div><span>${__("提交人")}</span><strong>${this.escape(row.submitted_by_name || row.submitted_by || "未记录")}</strong></div></div></div><div class="hrms-employee-form-record__preview">${preview}</div></div>`;
			}).join("");
			view.querySelectorAll("[data-employee]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); frappe.set_route("employee-detail", event.currentTarget.dataset.employee); }));
			view.querySelectorAll("[data-preview-src]").forEach((button) => button.addEventListener("click", () => this.open_record_preview(button.dataset.previewSrc, button.dataset.previewName)));
		}

		open_record_preview(file_url, file_name) {
			const dialog = new frappe.ui.Dialog({
				title: file_name || __("材料预览"),
				size: "extra-large",
				fields: [{ fieldtype: "HTML", fieldname: "preview", options: `<div class="hrms-employee-form-record-preview" style="align-items:center;display:flex;justify-content:center;max-height:calc(100vh - 150px);min-height:360px;overflow:auto;padding:8px"><img src="${this.escape(file_url)}" alt="${this.escape(file_name || "")}" style="display:block;height:auto;max-height:calc(100vh - 230px);max-width:92vw;object-fit:contain;width:auto"></div>` }],
				primary_action_label: __("关闭"),
				primary_action: () => dialog.hide()
			});
			dialog.$wrapper.addClass("hrms-employee-form-record-preview-dialog");
			dialog.show();
		}

		show_records() {
			frappe.set_route(this.route, "records");
		}
	}

	window.HRMSEmployeeFormSubmitPage = {
		ROUTE_TYPES,
		mount(page, form_type) { const instance = new EmployeeFormSubmitPage(page, form_type); instance.show(); return instance; },
	};
})();
