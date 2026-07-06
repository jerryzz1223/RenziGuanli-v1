frappe.pages["employee-property-history"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("任职记录"),
		single_column: true,
	});

	const view = new EmployeePropertyHistoryPage(page);
	view.show();
};

class EmployeePropertyHistoryPage {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.limit_start = 0;
		this.limit_page_length = 20;
		this.total = 0;
		this.rows = [];
	}

	show() {
		this.page.set_primary_action(__("办理人事异动"), () => frappe.set_route("Form", "Employee Transfer", "new-employee-transfer"));
		this.page.add_inner_button(__("办理转正"), () => frappe.set_route("Form", "Employee Promotion", "new-employee-promotion"));
		this.page.add_inner_button(__("打开人事异动列表"), () => frappe.set_route("List", "Employee Transfer"));
		this.render();
		this.load();
	}

	render() {
		this.wrapper.innerHTML = `
			<div class="hrms-property-history">
				<div class="hrms-property-history-note">
					${frappe.utils.escape_html(__("任职记录来自人事异动和转正/晋升单据中的 Employee Property History 变更明细。员工主档不在这里直接编辑。"))}
				</div>
				<div class="hrms-property-history-toolbar">
					<input class="form-control" data-filter="search" type="search" placeholder="${frappe.utils.escape_html(__("搜索员工、部门、变更字段"))}">
					<input class="form-control" data-filter="employee" type="text" placeholder="${frappe.utils.escape_html(__("员工编号"))}">
					<input class="form-control" data-filter="department" type="text" placeholder="${frappe.utils.escape_html(__("部门"))}">
					<button class="btn btn-default btn-sm" type="button" data-action="search">${frappe.utils.escape_html(__("搜索"))}</button>
					<button class="btn btn-default btn-sm" type="button" data-action="reset">${frappe.utils.escape_html(__("重置"))}</button>
				</div>
				<div class="hrms-property-history-list" data-list></div>
				<div class="hrms-property-history-empty text-muted hidden" data-empty>
					${frappe.utils.escape_html(__("暂无任职记录。请通过人事异动或转正单据生成任职变化。"))}
				</div>
				<div class="hrms-property-history-pagination">
					<button class="btn btn-default btn-sm" type="button" data-action="prev">${frappe.utils.escape_html(__("上一页"))}</button>
					<span data-page-status></span>
					<button class="btn btn-default btn-sm" type="button" data-action="next">${frappe.utils.escape_html(__("下一页"))}</button>
				</div>
			</div>
		`;
		this.inject_style();
		this.bind_events();
	}

	inject_style() {
		if (document.getElementById("hrms-property-history-style")) return;
		const style = document.createElement("style");
		style.id = "hrms-property-history-style";
		style.textContent = `
			.hrms-property-history { display: grid; gap: 12px; }
			.hrms-property-history-note {
				border: 1px solid var(--border-color);
				border-radius: 8px;
				background: var(--subtle-accent);
				color: var(--text-muted);
				padding: 12px 14px;
			}
			.hrms-property-history-toolbar {
				display: grid;
				grid-template-columns: minmax(220px, 2fr) minmax(160px, 1fr) minmax(160px, 1fr) auto auto;
				gap: 8px;
				align-items: center;
			}
			.hrms-property-history-list { display: grid; gap: 10px; }
			.hrms-property-history-card {
				border: 1px solid var(--border-color);
				border-radius: 8px;
				background: var(--card-bg);
				padding: 14px;
			}
			.hrms-property-history-card-head {
				display: flex;
				justify-content: space-between;
				gap: 12px;
				align-items: flex-start;
				margin-bottom: 10px;
			}
			.hrms-property-history-title { font-weight: 600; color: var(--heading-color); }
			.hrms-property-history-meta { color: var(--text-muted); font-size: 12px; margin-top: 4px; }
			.hrms-property-history-changes { display: grid; gap: 6px; }
			.hrms-property-history-change {
				display: grid;
				grid-template-columns: minmax(120px, 180px) 1fr 1fr;
				gap: 8px;
				align-items: center;
				border-top: 1px solid var(--border-color);
				padding-top: 6px;
				color: var(--text-color);
			}
			.hrms-property-history-field { color: var(--text-muted); }
			.hrms-property-history-value {
				min-height: 28px;
				border-radius: 6px;
				background: var(--control-bg);
				padding: 4px 8px;
				word-break: break-word;
			}
			.hrms-property-history-empty { text-align: center; padding: 48px 0; }
			.hrms-property-history-pagination { display: flex; justify-content: flex-end; align-items: center; gap: 10px; }
			@media (max-width: 768px) {
				.hrms-property-history-toolbar { grid-template-columns: 1fr; }
				.hrms-property-history-card-head { flex-direction: column; }
				.hrms-property-history-change { grid-template-columns: 1fr; }
			}
		`;
		document.head.appendChild(style);
	}

	bind_events() {
		this.wrapper.querySelector('[data-action="search"]').addEventListener("click", () => {
			this.limit_start = 0;
			this.load();
		});
		this.wrapper.querySelector('[data-filter="search"]').addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.limit_start = 0;
				this.load();
			}
		});
		this.wrapper.querySelector('[data-action="reset"]').addEventListener("click", () => {
			this.wrapper.querySelectorAll("[data-filter]").forEach((input) => {
				input.value = "";
			});
			this.limit_start = 0;
			this.load();
		});
		this.wrapper.querySelector('[data-action="prev"]').addEventListener("click", () => {
			if (this.limit_start <= 0) return;
			this.limit_start = Math.max(this.limit_start - this.limit_page_length, 0);
			this.load();
		});
		this.wrapper.querySelector('[data-action="next"]').addEventListener("click", () => {
			if (this.limit_start + this.limit_page_length >= this.total) return;
			this.limit_start += this.limit_page_length;
			this.load();
		});
		this.wrapper.addEventListener("click", (event) => {
			const button = event.target.closest("[data-open-source]");
			if (!button) return;
			frappe.set_route("Form", button.dataset.sourceDoctype, button.dataset.sourceName);
		});
	}

	filter_value(name) {
		return (this.wrapper.querySelector(`[data-filter="${name}"]`)?.value || "").trim();
	}

	load() {
		this.set_loading(true);
		frappe.call({
			method: "hrms.api.employee_field_template.get_employee_property_history",
			args: {
				search: this.filter_value("search"),
				employee: this.filter_value("employee"),
				department: this.filter_value("department"),
				limit_start: this.limit_start,
				limit_page_length: this.limit_page_length,
			},
			callback: (response) => {
				this.set_loading(false);
				const data = response.message || {};
				this.rows = data.rows || [];
				this.total = data.total || 0;
				this.limit_page_length = data.limit_page_length || this.limit_page_length;
				this.render_rows();
				this.render_pagination();
			},
			error: () => {
				this.set_loading(false);
				frappe.msgprint(__("任职记录读取失败，请检查 Employee Transfer / Employee Promotion 权限。"));
			},
		});
	}

	set_loading(loading) {
		const list = this.wrapper.querySelector("[data-list]");
		if (!list) return;
		list.classList.toggle("text-muted", Boolean(loading));
		if (loading) {
			list.innerHTML = frappe.utils.escape_html(__("正在读取任职记录..."));
		}
	}

	render_rows() {
		const list = this.wrapper.querySelector("[data-list]");
		const empty = this.wrapper.querySelector("[data-empty]");
		empty.classList.toggle("hidden", this.rows.length > 0);
		if (!this.rows.length) {
			list.innerHTML = "";
			return;
		}
		list.innerHTML = this.rows.map((row) => this.render_card(row)).join("");
	}

	render_card(row) {
		const changes = row.changes && row.changes.length
			? row.changes.map((change) => this.render_change(change)).join("")
			: `<div class="text-muted">${frappe.utils.escape_html(__("该单据暂无变更明细。"))}</div>`;
		const employeeName = row.employee_name || row.employee || __("未关联员工");
		const effectiveDate = row.effective_date || __("未填写日期");
		return `
			<div class="hrms-property-history-card">
				<div class="hrms-property-history-card-head">
					<div>
						<div class="hrms-property-history-title">
							${frappe.utils.escape_html(employeeName)} · ${frappe.utils.escape_html(row.source_label || "")}
						</div>
						<div class="hrms-property-history-meta">
							${frappe.utils.escape_html(row.employee || "")}
							${row.department ? " / " + frappe.utils.escape_html(row.department) : ""}
							${row.company ? " / " + frappe.utils.escape_html(row.company) : ""}
							${" / " + frappe.utils.escape_html(effectiveDate)}
						</div>
					</div>
					<button class="btn btn-default btn-xs" type="button"
						data-open-source="1"
						data-source-doctype="${frappe.utils.escape_html(row.source_doctype || "")}"
						data-source-name="${frappe.utils.escape_html(row.source_name || "")}">
						${frappe.utils.escape_html(__("查看来源单据"))}
					</button>
				</div>
				<div class="hrms-property-history-changes">${changes}</div>
			</div>
		`;
	}

	render_change(change) {
		return `
			<div class="hrms-property-history-change">
				<div class="hrms-property-history-field">${frappe.utils.escape_html(change.property || change.fieldname || __("字段"))}</div>
				<div class="hrms-property-history-value">${frappe.utils.escape_html(change.current || __("原值为空"))}</div>
				<div class="hrms-property-history-value">${frappe.utils.escape_html(change.new || __("新值为空"))}</div>
			</div>
		`;
	}

	render_pagination() {
		const status = this.wrapper.querySelector("[data-page-status]");
		const currentStart = this.total ? this.limit_start + 1 : 0;
		const currentEnd = Math.min(this.limit_start + this.limit_page_length, this.total);
		status.textContent = __("第 {0}-{1} 条 / 共 {2} 条", [currentStart, currentEnd, this.total]);
		this.wrapper.querySelector('[data-action="prev"]').disabled = this.limit_start <= 0;
		this.wrapper.querySelector('[data-action="next"]').disabled = this.limit_start + this.limit_page_length >= this.total;
	}
}
