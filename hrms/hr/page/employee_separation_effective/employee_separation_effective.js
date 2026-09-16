frappe.pages["employee-separation-effective"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("实际离职"),
		single_column: true,
	});
	page.main[0].innerHTML = `
		<div class="hrms-separation-effective">
			<div class="hrms-separation-effective__note">
				${frappe.utils.escape_html(__("本页只办理已审批申请。填写的实际离职时间是唯一生效时间；时间未到时为“待离职”，时间到达后自动归类为“已离职”。"))}
			</div>
			<div class="hrms-separation-effective__toolbar">
				<input class="form-control" data-search type="search" placeholder="${frappe.utils.escape_html(__("搜索员工、工号、部门或岗位"))}">
				<button class="btn btn-default" type="button" data-refresh>${frappe.utils.escape_html(__("刷新"))}</button>
			</div>
			<div data-list></div>
			<div class="text-muted hidden" data-empty>${frappe.utils.escape_html(__("暂无已审批且待办理实际离职的员工。"))}</div>
		</div>`;
	wrapper.employee_separation_effective = new EmployeeSeparationEffectivePage(page);
	wrapper.employee_separation_effective.show();
};

frappe.pages["employee-separation-effective"].on_page_show = function (wrapper) {
	wrapper.employee_separation_effective?.refresh();
};

class EmployeeSeparationEffectivePage {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.rows = [];
		this.company = "";
		this.bind_events();
	}

	show() {
		this.inject_style();
		this.refresh();
	}

	current_company() {
		return window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	}

	bind_events() {
		this.wrapper.querySelector("[data-refresh]").addEventListener("click", () => this.refresh());
		this.wrapper.querySelector("[data-search]").addEventListener("keydown", (event) => {
			if (event.key === "Enter") this.refresh();
		});
		this.wrapper.querySelector("[data-list]").addEventListener("click", (event) => {
			const button = event.target.closest("[data-save-actual-time]");
			if (!button) return;
			const card = button.closest("[data-separation-name]");
			const input = card?.querySelector("[data-actual-time]");
			if (!card || !input?.value) {
				frappe.msgprint(__("请填写实际离职时间。"));
				return;
			}
			this.save_actual_time(card.dataset.separationName, input.value);
		});
	}

	refresh() {
		this.company = this.current_company();
		const search = this.wrapper.querySelector("[data-search]")?.value || "";
		const list = this.wrapper.querySelector("[data-list]");
		list.innerHTML = `<div class="text-muted">${frappe.utils.escape_html(__("正在读取待办理实际离职记录……"))}</div>`;
		frappe.call({
			method: "hrms.hr.page.employee_separation_effective.employee_separation_effective.get_pending_employee_separations",
			args: { company: this.company, search },
			callback: (response) => {
				this.rows = response.message?.rows || [];
				this.render_rows();
			},
			error: () => {
				list.innerHTML = "";
				frappe.msgprint(__("实际离职记录读取失败，请检查权限后重试。"));
			},
		});
	}

	save_actual_time(separation_name, value) {
		frappe.call({
			method: "hrms.hr.doctype.employee_separation.employee_separation.record_employee_separation_actual_time",
			args: {
				separation_name,
				actual_departure_time: value.replace("T", " ") + (value.length === 16 ? ":00" : ""),
			},
			freeze: true,
			freeze_message: __("正在保存实际离职时间……"),
			callback: () => {
				frappe.show_alert({ message: __("实际离职时间已保存"), indicator: "green" });
				this.refresh();
			},
		});
	}

	to_input_datetime(value) {
		return value ? String(value).replace(" ", "T").slice(0, 16) : "";
	}

	render_rows() {
		const list = this.wrapper.querySelector("[data-list]");
		const empty = this.wrapper.querySelector("[data-empty]");
		empty.classList.toggle("hidden", this.rows.length > 0);
		list.innerHTML = this.rows.map((row) => {
			const actual = row.actual_departure_time
				? frappe.datetime.str_to_user(row.actual_departure_time)
				: __("未填写");
			return `<div class="hrms-separation-effective__card" data-separation-name="${frappe.utils.escape_html(row.separation_name)}">
				<div class="hrms-separation-effective__identity"><strong>${frappe.utils.escape_html(row.employee_name || "-")}</strong><span>${frappe.utils.escape_html(row.employee_code || "-")}</span></div>
				<div class="hrms-separation-effective__meta">${frappe.utils.escape_html(row.department || "-")} · ${frappe.utils.escape_html(row.designation || "-")} · ${frappe.utils.escape_html(__("拟离职日期"))}：${frappe.utils.escape_html(row.planned_departure_date || "-")}</div>
				<div class="hrms-separation-effective__status">${frappe.utils.escape_html(__("当前归类"))}：${frappe.utils.escape_html(row.status || "待离职")}；${frappe.utils.escape_html(__("已记录时间"))}：${frappe.utils.escape_html(actual)}</div>
				<div class="hrms-separation-effective__entry"><label>${frappe.utils.escape_html(__("唯一实际离职时间"))}</label><input class="form-control" data-actual-time type="datetime-local" value="${this.to_input_datetime(row.actual_departure_time)}"><button class="btn btn-primary" type="button" data-save-actual-time>${frappe.utils.escape_html(__("保存并办理"))}</button></div>
			</div>`;
		}).join("");
	}

	inject_style() {
		if (document.getElementById("hrms-separation-effective-style")) return;
		const style = document.createElement("style");
		style.id = "hrms-separation-effective-style";
		style.textContent = `
			.hrms-separation-effective { display: grid; gap: 12px; }
			.hrms-separation-effective__note { padding: 12px 14px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--subtle-accent); color: var(--text-muted); }
			.hrms-separation-effective__toolbar { display: flex; gap: 8px; max-width: 640px; }
			.hrms-separation-effective__card { display: grid; gap: 8px; padding: 14px; margin-bottom: 10px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--card-bg); }
			.hrms-separation-effective__identity, .hrms-separation-effective__entry { display: flex; gap: 10px; align-items: center; }
			.hrms-separation-effective__identity span, .hrms-separation-effective__meta, .hrms-separation-effective__status { color: var(--text-muted); }
			.hrms-separation-effective__entry label { margin: 0; white-space: nowrap; font-weight: 600; }
			.hrms-separation-effective__entry input { max-width: 240px; }
			@media (max-width: 640px) { .hrms-separation-effective__toolbar, .hrms-separation-effective__entry { display: grid; grid-template-columns: 1fr; align-items: stretch; } }
		`;
		document.head.appendChild(style);
	}
}
