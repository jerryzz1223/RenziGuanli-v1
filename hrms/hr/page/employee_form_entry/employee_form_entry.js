frappe.pages["employee-form-entry"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("员工表单录入"), single_column: true });
	page.set_primary_action(__("打开员工花名册"), () => frappe.set_route("List", "Employee"));
	const forms = [
		{ key: "employee-talk-form", form_type: "employee_talk", label: "员工谈话表", description: "员工谈话记录材料" },
		{ key: "employee-duty-change", form_type: "employee_transfer_application", label: "员工职务调动申请表", description: "职务调动申请材料" },
		{ key: "employee-reward-form", form_type: "reward_punishment_report", label: "奖惩提报单", description: "奖励或惩处提报材料" },
	];
	const state = { search_text: "", matches: [], selected_employee: null, loading: false, error: "", search_request_id: 0, success: {}, latest_records: {}, latest_records_loading: false, latest_records_error: "", latest_records_request_id: 0 };
	const escape = (value) => frappe.utils.escape_html(String(value ?? ""));
	function render_employee_photo(employee) {
		const image = String(employee.image || "").trim();
		return image
			? `<img class="hrms-employee-form-entry__photo-image" src="${escape(image)}" alt="${escape(employee.employee_name || "员工照片")}">`
			: `<span class="hrms-employee-form-entry__photo-empty">${__("无")}</span>`;
	}

	function render_matches() {
		if (state.loading) return `<div class="text-muted">${__("正在匹配员工…")}</div>`;
		if (state.error) return `<div class="text-danger">${escape(state.error)}</div>`;
		if (state.search_text && !state.matches.length) return `<div class="text-muted">${__("没有匹配到员工，请检查工号或姓名。")}</div>`;
		return state.matches.filter((employee) => !state.selected_employee || employee.name !== state.selected_employee.name).map((employee) => `<button type="button" class="hrms-employee-form-entry__result" data-select-employee="${escape(employee.name)}"><span class="hrms-employee-form-entry__identity"><span class="hrms-employee-form-entry__photo">${render_employee_photo(employee)}</span><span><strong>${escape(employee.employee_name || "未填写姓名")}</strong><small>${escape(employee.employee_code || "未填写工号")} · ${escape(employee.department || "未填写部门")} · ${escape(employee.designation || "未填写岗位")}</small></span></span><span class="text-muted">${escape(employee.status || "")}</span></button>`).join("");
	}

	function render_selected() {
		if (!state.selected_employee) return `<div class="hrms-employee-form-entry__selected text-muted">${__("请先匹配并选择员工，下面三个“录入”按钮会直接归档到该员工资料。")}</div>`;
		const employee = state.selected_employee;
		return `<div class="hrms-employee-form-entry__selected"><span class="hrms-employee-form-entry__identity"><span class="hrms-employee-form-entry__photo">${render_employee_photo(employee)}</span><span><strong>${escape(employee.employee_name || "未填写姓名")}</strong><small>${escape(employee.employee_code || "未填写工号")} · ${escape(employee.department || "未填写部门")} · ${escape(employee.designation || "未填写岗位")} · ${escape(employee.status || "")}</small></span></span><span class="text-success">${__("当前录入员工")}</span></div>`;
	}

	function render_latest_record(form_type) {
		if (!state.selected_employee) return `<div class="hrms-employee-form-entry-card__history text-muted">${__("请先匹配员工")}</div>`;
		if (state.latest_records_loading) return `<div class="hrms-employee-form-entry-card__history text-muted">${__("正在检查历史记录…")}</div>`;
		if (state.latest_records_error) return `<div class="hrms-employee-form-entry-card__history text-danger">${escape(state.latest_records_error)}</div>`;
		const record = state.latest_records[form_type];
		if (!record) return `<div class="hrms-employee-form-entry-card__history text-muted">${__("暂无历史记录，可直接录入")}</div>`;
		const is_image = /\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(record.file_url || record.file_name || "");
		const preview = is_image
			? `<button type="button" class="hrms-employee-form-entry-card__thumbnail" data-preview-latest="${escape(form_type)}" title="${__("查看最新材料")}"><img src="${escape(record.file_url)}" alt="${escape(record.file_name || "最新材料")}"></button>`
			: `<a class="hrms-employee-form-entry-card__file" href="${escape(record.file_url)}" target="_blank" rel="noopener">${escape(record.file_name || __("打开最新材料"))}</a>`;
		return `<div class="hrms-employee-form-entry-card__history hrms-employee-form-entry-card__history--has-record"><div class="hrms-employee-form-entry-card__history-copy"><strong>${__("已有历史记录")}</strong><span>${__("最新提交")}：${escape(record.creation || record.modified || "")}</span><span>${__("提交人")}：${escape(record.submitted_by_name || record.submitted_by || "未记录")}</span>${is_image ? `<span>${__("点击右侧小图查看最新材料")}</span>` : ""}</div>${preview}</div>`;
	}

	function render() {
		wrapper.innerHTML = `
			<style>
				.hrms-employee-form-entry-home { max-width: 1080px; margin: 0 auto; padding: 28px 12px 72px; }
				.hrms-employee-form-entry-home__hero { background: linear-gradient(135deg, #ecfdf5, #f8fafc); border: 1px solid #d8eee5; border-radius: 12px; padding: 24px 28px; margin-bottom: 16px; }
				.hrms-employee-form-entry-home__hero h2 { margin: 0 0 8px; font-size: 22px; }
				.hrms-employee-form-entry-home__hero p { margin: 0; color: #687385; }
				.hrms-employee-form-entry__employee { background: #fff; border: 1px solid #e6edf3; border-radius: 10px; padding: 20px; margin-bottom: 16px; }
				.hrms-employee-form-entry__employee h3 { margin: 0 0 5px; }
				.hrms-employee-form-entry__hint { color: #687385; margin: 0 0 14px; }
				.hrms-employee-form-entry__search { display: flex; gap: 8px; max-width: 720px; }
				.hrms-employee-form-entry__search input { flex: 1; }
				.hrms-employee-form-entry__results { max-width: 720px; margin-top: 12px; }
				.hrms-employee-form-entry__result { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; text-align: left; background: #f8fafc; border: 1px solid #e6edf3; border-radius: 8px; padding: 11px 13px; margin-bottom: 8px; }
				.hrms-employee-form-entry__result:hover { border-color: #10b981; }
				.hrms-employee-form-entry__identity { display: inline-flex; min-width: 0; align-items: center; gap: 10px; }
				.hrms-employee-form-entry__photo { display: inline-flex; width: 42px; height: 42px; flex: 0 0 42px; align-items: center; justify-content: center; overflow: hidden; border: 1px solid #dbe5ed; border-radius: 8px; background: #f1f5f9; color: #8a96a3; font-size: 12px; }
				.hrms-employee-form-entry__photo-image { display: block; width: 100%; height: 100%; object-fit: cover; }
				.hrms-employee-form-entry__result small, .hrms-employee-form-entry__selected small { display: block; color: #687385; margin-top: 3px; }
				.hrms-employee-form-entry__selected { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #f0fdf8; border: 1px solid #b7ead5; border-radius: 8px; padding: 13px 14px; max-width: 720px; margin-top: 12px; }
				.hrms-employee-form-entry-entry { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
				.hrms-employee-form-entry-card { background: #fff; border: 1px solid #e6edf3; border-radius: 10px; padding: 20px; }
				.hrms-employee-form-entry-card h3 { margin: 0 0 8px; font-size: 16px; }
				.hrms-employee-form-entry-card p { min-height: 38px; color: #687385; font-size: 12px; line-height: 1.6; }
				.hrms-employee-form-entry-card__history { align-items: center; display: flex; gap: 10px; justify-content: space-between; min-height: 72px; margin-top: 12px; }
				.hrms-employee-form-entry-card__history--has-record { border-top: 1px solid #eef2f6; padding-top: 10px; }
				.hrms-employee-form-entry-card__history-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
				.hrms-employee-form-entry-card__history-copy strong { color: #047857; font-size: 13px; }
				.hrms-employee-form-entry-card__history-copy span { color: #687385; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				.hrms-employee-form-entry-card__thumbnail { background: #f8fafc; border: 1px solid #dbe5ed; border-radius: 7px; cursor: zoom-in; height: 64px; overflow: hidden; padding: 0; width: 64px; }
				.hrms-employee-form-entry-card__thumbnail img { display: block; height: 100%; object-fit: cover; width: 100%; }
				.hrms-employee-form-entry-card__file { color: #2563eb; font-size: 11px; max-width: 80px; overflow: hidden; text-align: center; text-overflow: ellipsis; }
				.hrms-employee-form-entry-card__actions { display: flex; gap: 8px; margin-top: 18px; }
				.hrms-employee-form-entry-card__success { color: #047857; font-size: 12px; margin-top: 10px; }
				@media (max-width: 760px) { .hrms-employee-form-entry-entry { grid-template-columns: 1fr; } .hrms-employee-form-entry__search, .hrms-employee-form-entry__selected { align-items: stretch; flex-direction: column; } }
			</style>
			<div class="hrms-employee-form-entry-home">
				<div class="hrms-employee-form-entry-home__hero"><h2>${__("员工表单录入")}</h2><p>${__("先匹配一次员工，下面三个表单都可以直接录入到当前员工的材料附件中。")}</p></div>
				<div class="hrms-employee-form-entry__employee"><h3>${__("匹配员工")}</h3><p class="hrms-employee-form-entry__hint">${__("请输入公司工号或姓名并选择员工；选择后，下面三个“录入”按钮都会使用这个员工。")}</p><div class="hrms-employee-form-entry__search"><input class="form-control" data-role="employee-search" value="${escape(state.search_text)}" placeholder="${__("请输入公司工号或姓名")}"><button type="button" class="btn btn-primary" data-action="search">${__("匹配员工")}</button></div><div class="hrms-employee-form-entry__results">${render_matches()}</div>${render_selected()}</div>
				<div class="hrms-employee-form-entry-entry">${forms.map((form) => `<div class="hrms-employee-form-entry-card"><h3>${__(form.label)}</h3><p>${__(form.description)}</p>${render_latest_record(form.form_type)}<div class="hrms-employee-form-entry-card__actions"><button type="button" class="btn btn-primary" data-entry-form="${form.form_type}" ${state.selected_employee ? "" : "disabled"}>${__("录入")}</button><button type="button" class="btn btn-default" data-records="${form.key}">${__("录入记录")}</button></div>${state.success[form.form_type] ? `<div class="hrms-employee-form-entry-card__success">${escape(state.success[form.form_type])}</div>` : ""}</div>`).join("")}</div>
			</div>
		`;
		bind_events();
	}

	function bind_events() {
		const input = wrapper.querySelector("[data-role='employee-search']");
		input?.addEventListener("input", () => { state.search_text = input.value; state.error = ""; });
		input?.addEventListener("keydown", (event) => { if (event.key === "Enter") search_employees(); });
		wrapper.querySelector("[data-action='search']")?.addEventListener("click", search_employees);
		wrapper.querySelectorAll("[data-select-employee]").forEach((button) => button.addEventListener("click", () => {
			state.selected_employee = state.matches.find((employee) => employee.name === button.dataset.selectEmployee) || null;
			state.success = {};
			state.latest_records = {};
			state.latest_records_error = "";
			state.latest_records_loading = Boolean(state.selected_employee);
			render();
			if (state.selected_employee) load_latest_records();
		}));
		wrapper.querySelectorAll("[data-records]").forEach((button) => button.addEventListener("click", () => frappe.set_route(button.dataset.records, "records")));
		wrapper.querySelectorAll("[data-preview-latest]").forEach((button) => button.addEventListener("click", () => open_latest_preview(button.dataset.previewLatest)));
		wrapper.querySelectorAll("[data-entry-form]").forEach((button) => button.addEventListener("click", () => upload_form(button.dataset.entryForm)));
	}

	function search_employees() {
		state.search_text = String(wrapper.querySelector("[data-role='employee-search']")?.value || "").trim();
		if (!state.search_text) { frappe.show_alert({ message: __("请输入工号或姓名"), indicator: "orange" }); return; }
		const request_id = ++state.search_request_id;
		state.loading = true; state.error = ""; state.matches = []; state.selected_employee = null; state.success = {}; state.latest_records = {}; state.latest_records_loading = false; state.latest_records_error = ""; state.latest_records_request_id += 1;
		render();
		const company = window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
		frappe.call({ method: "hrms.api.employee_form_entry.find_employee_matches", args: { search_text: state.search_text, company } }).then(
			(response) => { if (request_id !== state.search_request_id) return; state.matches = response.message || []; state.loading = false; render(); },
			(error) => { if (request_id !== state.search_request_id) return; state.error = error?.message || __("匹配员工失败，请刷新后重试"); state.loading = false; render(); }
		);
	}

	function load_latest_records() {
		if (!state.selected_employee) return;
		const request_id = ++state.latest_records_request_id;
		const company = window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
		frappe.call({ method: "hrms.api.employee_form_entry.get_employee_form_entry_summaries", args: { employee: state.selected_employee.name, company } }).then(
			(response) => { if (request_id !== state.latest_records_request_id) return; state.latest_records = response.message || {}; state.latest_records_loading = false; render(); },
			(error) => { if (request_id !== state.latest_records_request_id) return; state.latest_records_error = error?.message || __("历史记录加载失败，请刷新后重试"); state.latest_records_loading = false; render(); }
		);
	}

	function open_latest_preview(form_type) {
		const record = state.latest_records[form_type];
		if (!record?.file_url) return;
		const dialog = new frappe.ui.Dialog({
			title: record.file_name || __("最新材料"),
			size: "extra-large",
			fields: [{ fieldtype: "HTML", fieldname: "preview", options: `<div style="align-items:center;display:flex;justify-content:center;max-height:calc(100vh - 150px);min-height:360px;overflow:auto;padding:8px"><img src="${escape(record.file_url)}" alt="${escape(record.file_name || "")}" style="display:block;height:auto;max-height:calc(100vh - 230px);max-width:92vw;object-fit:contain;width:auto"></div>` }],
			primary_action_label: __("关闭"),
			primary_action: () => dialog.hide(),
		});
		dialog.show();
	}

	function upload_form(form_type) {
		if (!state.selected_employee) { frappe.show_alert({ message: __("请先匹配并选择员工"), indicator: "orange" }); return; }
		const form = forms.find((item) => item.form_type === form_type);
		if (!form) return;
		new frappe.ui.FileUploader({ doctype: "Employee", docname: state.selected_employee.name, allow_multiple: false, allow_take_photo: true, allow_web_link: false, disable_file_browser: true, restrictions: { allowed_file_types: [".jpg", ".jpeg", ".png", ".webp", ".pdf"], max_file_size: 10 * 1024 * 1024 }, on_success: (file, response) => {
			const file_url = file?.file_url || response?.message?.file_url;
			if (!file_url) return;
			frappe.call({ method: "hrms.api.employee_form_entry.archive_employee_form_attachment", args: { employee: state.selected_employee.name, form_type, file_url }, freeze: true, freeze_message: __("正在提交员工表单…") }).then(
				() => { state.success[form_type] = `${form.label}已归档到${state.selected_employee.employee_name || state.selected_employee.name}的材料附件。`; state.latest_records_loading = true; render(); load_latest_records(); frappe.show_alert({ message: __("员工表单已提交"), indicator: "green" }); },
				(error) => frappe.show_alert({ message: error?.message || __("员工表单提交失败，请重试"), indicator: "red" })
			);
		} });
	}

	render();
};
