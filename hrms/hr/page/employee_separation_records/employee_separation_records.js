frappe.pages["employee-separation-records"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("离职记录"),
		single_column: true,
	});

	wrapper.employee_separation_records = new EmployeeSeparationRecordsPage(page);
	wrapper.employee_separation_records.show();
};

frappe.pages["employee-separation-records"].on_page_show = function (wrapper) {
	wrapper.employee_separation_records?.activate();
};

frappe.pages["employee-separation-records"].on_page_hide = function (wrapper) {
	wrapper.employee_separation_records?.deactivate();
};

class EmployeeSeparationRecordsPage {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.company = this.current_company();
		this.search = "";
		this.start = 0;
		this.page_length = 50;
		this.total = 0;
		this.request_id = 0;
		this.context_bound = false;
		this.company_context_handler = () => {
			if (!this.is_active()) return;
			this.company = this.current_company();
			this.start = 0;
			this.load();
		};
	}

	show() {
		this.page.set_primary_action(__("办理离职"), () => frappe.new_doc("Employee Separation"));
		this.render_shell();
		this.activate(true);
	}

	current_company() {
		return window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	}

	is_active() {
		const container = this.wrapper.closest(".page-container");
		return !container || container.classList.contains("active");
	}

	activate(initial = false) {
		if (!this.context_bound) {
			window.addEventListener("hrms:company-context-changed", this.company_context_handler);
			this.context_bound = true;
		}
		if (initial) this.load();
	}

	deactivate() {
		if (!this.context_bound) return;
		window.removeEventListener("hrms:company-context-changed", this.company_context_handler);
		this.context_bound = false;
	}

	render_shell() {
		this.wrapper.innerHTML = `
			<style>
				.hrms-separation-records { padding: 0 2px 24px; }
				.hrms-separation-records__toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; max-width: 520px; }
				.hrms-separation-records__table-wrap { overflow-x: auto; border-top: 1px solid var(--border-color); }
				.hrms-separation-records__table { min-width: 820px; margin-bottom: 0; }
				.hrms-separation-records__table tbody tr { cursor: pointer; }
				.hrms-separation-records__table tbody tr:hover { background: var(--subtle-fg); }
				.hrms-separation-records__empty { padding: 56px 16px; text-align: center; }
				.hrms-separation-records__pagination { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding-top: 12px; }
				.hrms-separation-records__detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; }
				.hrms-separation-records__detail-item { min-width: 0; }
				.hrms-separation-records__detail-label { color: var(--text-muted); font-size: var(--text-xs); margin-bottom: 4px; }
				.hrms-separation-records__detail-value { overflow-wrap: anywhere; }
				.hrms-separation-records__interview { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border-color); }
				.hrms-separation-records__interview-text { white-space: pre-wrap; line-height: 1.6; margin-top: 8px; }
				.hrms-separation-records__detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
				@media (max-width: 767px) { .hrms-separation-records__detail-grid { grid-template-columns: 1fr; } }
			</style>
			<div class="hrms-separation-records">
				<div class="hrms-separation-records__toolbar">
					<input type="search" class="form-control" data-search placeholder="${frappe.utils.escape_html(__("姓名、工号、部门、岗位"))}">
					<button type="button" class="btn btn-default btn-sm" data-search-button>${frappe.utils.escape_html(__("搜索"))}</button>
				</div>
				<div class="hrms-separation-records__table-wrap">
					<table class="table hrms-separation-records__table">
						<thead><tr>
							<th>${frappe.utils.escape_html(__("离职日期"))}</th>
							<th>${frappe.utils.escape_html(__("员工姓名"))}</th>
							<th>${frappe.utils.escape_html(__("工号"))}</th>
							<th>${frappe.utils.escape_html(__("部门"))}</th>
							<th>${frappe.utils.escape_html(__("岗位"))}</th>
							<th>${frappe.utils.escape_html(__("离职面谈"))}</th>
						</tr></thead>
						<tbody data-rows></tbody>
					</table>
					<div class="hrms-separation-records__empty text-muted hidden" data-empty>${frappe.utils.escape_html(__("暂无离职记录"))}</div>
				</div>
				<div class="hrms-separation-records__pagination">
					<button type="button" class="btn btn-default btn-sm" data-prev>${frappe.utils.escape_html(__("上一页"))}</button>
					<span class="text-muted" data-page-status></span>
					<button type="button" class="btn btn-default btn-sm" data-next>${frappe.utils.escape_html(__("下一页"))}</button>
				</div>
			</div>
		`;

		this.wrapper.querySelector("[data-search-button]").addEventListener("click", () => this.run_search());
		this.wrapper.querySelector("[data-search]").addEventListener("keydown", (event) => {
			if (event.key === "Enter") this.run_search();
		});
		this.wrapper.querySelector("[data-prev]").addEventListener("click", () => {
			if (this.start <= 0) return;
			this.start = Math.max(this.start - this.page_length, 0);
			this.load();
		});
		this.wrapper.querySelector("[data-next]").addEventListener("click", () => {
			if (this.start + this.page_length >= this.total) return;
			this.start += this.page_length;
			this.load();
		});
	}

	run_search() {
		this.search = this.wrapper.querySelector("[data-search]").value.trim();
		this.start = 0;
		this.load();
	}

	load() {
		const request_id = ++this.request_id;
		const empty = this.wrapper.querySelector("[data-empty]");
		empty.textContent = __("正在加载离职记录…");
		empty.classList.remove("hidden");
		frappe.call({
			method: "hrms.hr.page.employee_separation_records.employee_separation_records.get_separation_records",
			args: {
				company: this.company,
				search: this.search,
				start: this.start,
				page_length: this.page_length,
			},
			freeze: false,
			callback: (response) => {
				if (request_id !== this.request_id) return;
				const data = response.message || {};
				this.total = data.total || 0;
				this.page_length = data.page_length || this.page_length;
				this.render_rows(data.rows || [], __("暂无离职记录"));
				this.render_pagination();
			},
			error: (response) => {
				if (request_id !== this.request_id) return;
				this.total = 0;
				const detail = this.error_message(response);
				const message = detail
					? __("离职记录加载失败：{0}", [detail])
					: __("离职记录加载失败，请检查权限或刷新后重试。");
				this.render_rows([], message);
				this.render_pagination();
			},
		});
	}

	render_rows(rows, empty_message = __("暂无离职记录")) {
		const tbody = this.wrapper.querySelector("[data-rows]");
		const empty = this.wrapper.querySelector("[data-empty]");
		this.visible_rows = rows;
		tbody.innerHTML = rows
			.map(
				(row, index) => `
					<tr data-row-index="${index}">
						<td>${frappe.utils.escape_html(row.departure_date ? frappe.datetime.str_to_user(row.departure_date) : "-")}</td>
						<td><strong>${frappe.utils.escape_html(row.employee_name || "-")}</strong></td>
						<td>${frappe.utils.escape_html(row.employee_code || "-")}</td>
						<td>${frappe.utils.escape_html(row.department_display || "-")}</td>
						<td>${frappe.utils.escape_html(row.designation || "-")}</td>
						<td>${frappe.utils.escape_html(row.exit_interview ? __("查看面谈") : __("未填写"))}</td>
					</tr>`,
			)
			.join("");
		empty.textContent = empty_message;
		empty.classList.toggle("hidden", rows.length > 0);
		tbody.querySelectorAll("tr[data-row-index]").forEach((element) => {
			element.addEventListener("click", () => {
				const row = this.visible_rows[Number(element.dataset.rowIndex)];
				if (row) this.show_record_details(row);
			});
		});
	}

	show_record_details(row) {
		const escape = frappe.utils.escape_html;
		const date = row.departure_date ? frappe.datetime.str_to_user(row.departure_date) : __("未填写");
		const interview = this.plain_text(row.exit_interview) || __("暂无离职面谈记录");
		const dialog = new frappe.ui.Dialog({
			title: `${row.employee_code || __("未设置工号")} · ${row.employee_name || __("未命名员工")}`,
			fields: [
				{
					fieldname: "record_details",
					fieldtype: "HTML",
					options: `
						<div class="hrms-separation-records__detail-grid">
							${this.detail_item(__("员工姓名"), row.employee_name)}
							${this.detail_item(__("工号"), row.employee_code)}
							${this.detail_item(__("离职日期"), date)}
							${this.detail_item(__("部门"), row.department_display)}
							${this.detail_item(__("岗位"), row.designation)}
							${this.detail_item(__("离职单状态"), row.separation_name ? __("已关联") : __("未建立离职单"))}
						</div>
						<div class="hrms-separation-records__interview">
							<strong>${escape(__("离职面谈"))}</strong>
							<div class="hrms-separation-records__interview-text">${escape(interview)}</div>
						</div>
						<div class="hrms-separation-records__detail-actions">
							<button type="button" class="btn btn-default btn-sm" data-view-employee>${escape(__("查看员工档案"))}</button>
							${row.separation_name ? `<button type="button" class="btn btn-primary btn-sm" data-view-separation>${escape(__("查看离职单"))}</button>` : ""}
						</div>`,
				},
			],
		});
		dialog.show();
		dialog.$wrapper.find("[data-view-employee]").on("click", () => {
			dialog.hide();
			frappe.set_route("employee-detail", row.employee);
		});
		dialog.$wrapper.find("[data-view-separation]").on("click", () => {
			dialog.hide();
			frappe.set_route("Form", "Employee Separation", row.separation_name);
		});
	}

	detail_item(label, value) {
		const escape = frappe.utils.escape_html;
		return `<div class="hrms-separation-records__detail-item">
			<div class="hrms-separation-records__detail-label">${escape(label)}</div>
			<div class="hrms-separation-records__detail-value">${escape(value || "-")}</div>
		</div>`;
	}

	plain_text(value) {
		if (!value) return "";
		const document = new DOMParser().parseFromString(String(value), "text/html");
		return (document.body.textContent || "").trim();
	}

	error_message(response) {
		const messages = [];
		try {
			const server_messages = JSON.parse(response?._server_messages || "[]");
			for (const item of server_messages) {
				const parsed = typeof item === "string" ? JSON.parse(item) : item;
				if (parsed?.message) messages.push(this.plain_text(parsed.message));
			}
		} catch (error) {
			// Fall through to the stable response fields below.
		}
		if (!messages.length && response?.message) messages.push(this.plain_text(response.message));
		if (!messages.length && response?.exc_type) messages.push(response.exc_type);
		return messages.filter(Boolean).join("；");
	}

	render_pagination() {
		const first = this.total ? this.start + 1 : 0;
		const last = Math.min(this.start + this.page_length, this.total);
		this.wrapper.querySelector("[data-page-status]").textContent = `${first}-${last} / ${this.total}`;
		this.wrapper.querySelector("[data-prev]").disabled = this.start <= 0;
		this.wrapper.querySelector("[data-next]").disabled = this.start + this.page_length >= this.total;
	}
}
