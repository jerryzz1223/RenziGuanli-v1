frappe.pages["employee-separation-interview"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("离职面谈"),
		single_column: true,
	});
	wrapper.employee_separation_interview = new EmployeeSeparationInterviewPage(page);
	wrapper.employee_separation_interview.show();
};

frappe.pages["employee-separation-interview"].on_page_show = function (wrapper) {
	wrapper.employee_separation_interview?.refresh();
};

class EmployeeSeparationInterviewPage {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.rows = [];
		this.company = "";
		this.bind_events();
	}

	show() {
		this.render_shell();
		this.refresh();
	}

	current_company() {
		return window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	}

	bind_events() {
		this.wrapper.addEventListener("click", (event) => {
			const button = event.target.closest("[data-edit-interview]");
			if (!button) return;
			const row = this.rows.find((item) => item.separation_name === button.dataset.editInterview);
			if (row) this.open_editor(row);
		});
		this.wrapper.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && event.target.matches("[data-search]")) this.refresh();
		});
	}

	render_shell() {
		this.wrapper.innerHTML = `
			<style>
				.hrms-separation-interview { display: grid; gap: 14px; }
				.hrms-separation-interview__note { padding: 12px 14px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--subtle-accent); color: var(--text-muted); }
				.hrms-separation-interview__toolbar { display: flex; gap: 8px; max-width: 680px; }
				.hrms-separation-interview__list { display: grid; gap: 10px; }
				.hrms-separation-interview__card { display: grid; gap: 8px; padding: 14px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--card-bg); }
				.hrms-separation-interview__identity, .hrms-separation-interview__footer { display: flex; gap: 10px; align-items: center; }
				.hrms-separation-interview__identity span, .hrms-separation-interview__meta { color: var(--text-muted); }
				.hrms-separation-interview__text { white-space: pre-wrap; line-height: 1.6; max-height: 96px; overflow: hidden; }
				.hrms-separation-interview__footer { justify-content: space-between; }
				.hrms-separation-interview__empty { padding: 42px 16px; text-align: center; }
				@media (max-width: 640px) { .hrms-separation-interview__toolbar { display: grid; } .hrms-separation-interview__footer { align-items: stretch; flex-direction: column; } }
			</style>
			<div class="hrms-separation-interview">
				<div class="hrms-separation-interview__note">${frappe.utils.escape_html(__("本页只显示已审批的离职申请。填写内容会保存到离职单，并自动带入后续离职记录。"))}</div>
				<div class="hrms-separation-interview__toolbar">
					<input class="form-control" data-search type="search" placeholder="${frappe.utils.escape_html(__("搜索员工、工号、部门或岗位"))}">
					<button class="btn btn-default" type="button" data-refresh>${frappe.utils.escape_html(__("刷新"))}</button>
				</div>
				<div class="hrms-separation-interview__list" data-list></div>
				<div class="hrms-separation-interview__empty text-muted hidden" data-empty>${frappe.utils.escape_html(__("暂无已审批的离职申请。"))}</div>
			</div>`;
		this.wrapper.querySelector("[data-refresh]").addEventListener("click", () => this.refresh());
	}

	refresh() {
		this.company = this.current_company();
		const list = this.wrapper.querySelector("[data-list]");
		const empty = this.wrapper.querySelector("[data-empty]");
		if (!list || !empty) return;
		list.innerHTML = `<div class="text-muted">${frappe.utils.escape_html(__("正在读取已审批离职申请……"))}</div>`;
		empty.classList.add("hidden");
		frappe.call({
			method: "hrms.hr.page.employee_separation_interview.employee_separation_interview.get_employee_separation_interviews",
			args: { company: this.company, search: this.wrapper.querySelector("[data-search]")?.value || "" },
			callback: (response) => {
				this.rows = response.message?.rows || [];
				this.render_rows();
			},
			error: () => {
				this.rows = [];
				list.innerHTML = "";
				empty.textContent = __("离职面谈读取失败，请检查离职审批权限后重试。");
				empty.classList.remove("hidden");
			},
		});
	}

	render_rows() {
		const escape = frappe.utils.escape_html;
		const list = this.wrapper.querySelector("[data-list]");
		const empty = this.wrapper.querySelector("[data-empty]");
		empty.classList.toggle("hidden", this.rows.length > 0);
		list.innerHTML = this.rows.map((row) => {
			const interview = this.plain_text(row.exit_interview) || __("未填写");
			const approval = row.approval_time ? frappe.datetime.str_to_user(row.approval_time) : "-";
			return `<article class="hrms-separation-interview__card">
				<div class="hrms-separation-interview__identity"><strong>${escape(row.employee_name || "-")}</strong><span>${escape(row.employee_code || "-")}</span></div>
				<div class="hrms-separation-interview__meta">${escape(row.department || "-")} · ${escape(row.designation || "-")} · ${escape(__("审批时间"))}：${escape(approval)}</div>
				<div class="hrms-separation-interview__text">${escape(interview)}</div>
				<div class="hrms-separation-interview__footer"><span class="text-muted">${escape(row.exit_interview ? __("已填写") : __("待填写"))}</span><button class="btn btn-primary btn-sm" type="button" data-edit-interview="${escape(row.separation_name)}">${escape(__("填写离职面谈"))}</button></div>
			</article>`;
		}).join("");
	}

	open_editor(row) {
		const dialog = new frappe.ui.Dialog({
			title: `${row.employee_code || __("未设置工号")} · ${row.employee_name || __("未命名员工")}`,
			fields: [{
				fieldname: "exit_interview",
				fieldtype: "Text Editor",
				label: __("离职面谈"),
				description: __("面谈信息会保存到离职单，并在离职记录中继续显示。"),
				default: row.exit_interview || "",
			}],
			primary_action_label: __("保存"),
			primary_action: (values) => {
				frappe.call({
					method: "hrms.hr.page.employee_separation_interview.employee_separation_interview.save_employee_separation_interview",
					args: { separation_name: row.separation_name, exit_interview: values.exit_interview || "" },
					freeze: true,
					freeze_message: __("正在保存离职面谈……"),
					callback: () => { dialog.hide(); this.refresh(); frappe.show_alert({ message: __("离职面谈已保存"), indicator: "green" }); },
				});
			},
		});
		dialog.show();
	}

	plain_text(value) {
		if (!value) return "";
		const document = new DOMParser().parseFromString(String(value), "text/html");
		return (document.body.textContent || "").trim();
	}
}
