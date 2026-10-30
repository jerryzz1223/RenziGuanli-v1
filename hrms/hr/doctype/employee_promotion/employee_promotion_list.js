/* global frappe, __ */
(() => {
	const api = "hrms.api.employee_confirmation";
	const escape = (value) => frappe.utils.escape_html(String(value ?? ""));
	const company = () => window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	const can_create = () => frappe.model.can_create("Employee Promotion");

	function open_confirmation(employee = "") {
		const today = frappe.datetime.get_today();
		const dialog = new frappe.ui.Dialog({
			title: __("新增员工转正"),
			size: "large",
			fields: [
				{ fieldname: "employee", fieldtype: "Link", options: "Employee", label: __("员工"), reqd: 1, default: employee, get_query: () => ({ filters: { status: "Active", ...(company() ? { company: company() } : {}) } }) },
				{ fieldname: "confirmation_date", fieldtype: "Date", label: __("转正日期"), reqd: 1, default: today },
				{ fieldtype: "Column Break" },
				{ fieldname: "interview_date", fieldtype: "Date", label: __("面谈日期"), reqd: 1, default: today },
				{ fieldname: "interviewer", fieldtype: "Data", label: __("面谈人") },
				{ fieldtype: "Section Break" },
				{ fieldname: "result", fieldtype: "Select", label: __("转正结果"), options: "\n转正通过\n转正不通过", reqd: 1 },
				{ fieldname: "notes", fieldtype: "Small Text", label: __("面谈记录"), reqd: 1 },
				{ fieldtype: "HTML", options: `<p class="text-muted">${__("保存后进入转正单，核对并提交后生效。转正不通过不会修改员工档案。")}</p>` },
			],
			primary_action_label: __("保存并查看转正单"),
			primary_action(values) {
				dialog.disable_primary_action();
				Promise.resolve(frappe.call({ method: `${api}.create_draft`, args: values, freeze: true, freeze_message: __("正在保存转正单…") }))
					.then(({ message }) => { dialog.hide(); frappe.set_route("Form", "Employee Promotion", message); })
					.catch(() => {})
					.finally(() => dialog.enable_primary_action());
			},
		});
		dialog.show();
	}

	function setup(listview) {
		if (listview.$confirmation_panel) return;
		const panel = $(`<section class="hrms-confirmation-panel" style="padding:20px;border:1px solid var(--border-color);border-radius:10px;margin-bottom:20px;background:var(--card-bg)">
			<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:14px"><strong style="font-size:16px">${__("未转正人员")}</strong><span class="candidate-count text-muted"></span>
			<input class="form-control candidate-search" style="max-width:300px;margin-left:auto" placeholder="${__("搜索工号、姓名、部门或岗位")}" aria-label="${__("搜索未转正人员")}"><button class="btn btn-default btn-sm candidate-reload">${__("查询")}</button></div>
			<div class="candidate-content"></div><div class="candidate-paging" style="display:flex;align-items:center;gap:12px;margin-top:12px"></div>
		</section>`);
		listview.$result.before(panel);
		listview.$confirmation_panel = panel;
		listview.$result.before(`<h4 style="margin:18px 0 12px">${__("转正办理记录")}</h4>`);
		const root = listview.$frappe_list || listview.$result.parent();
		const translate_empty_state = () => {
			root.find(".no-result").each(function () {
				if ($(this).find(".hrms-confirmation-empty").length) return;
				$(this).html(`<div class="hrms-confirmation-empty text-center text-muted" style="padding:32px"><p>${__("暂无转正办理记录，可在上方选择未转正人员办理。")}</p>${can_create() ? `<button class="btn btn-default btn-sm hrms-new-confirmation">${__("新增员工转正")}</button>` : ""}</div>`);
			});
		};
		root.on("click", ".hrms-new-confirmation", () => open_confirmation());
		// Frappe renders the empty state after the list refresh callback.
		listview.confirmation_empty_observer = new MutationObserver(translate_empty_state);
		listview.confirmation_empty_observer.observe(root[0], { childList: true, subtree: true });
		translate_empty_state();
		listview.confirmation_start = 0;
		panel.on("click", ".candidate-reload", () => { listview.confirmation_start = 0; load(listview); });
		panel.on("keydown", ".candidate-search", (event) => { if (event.key === "Enter") { listview.confirmation_start = 0; load(listview); } });
		panel.on("click", "[data-page]", function () { listview.confirmation_start = Number(this.dataset.page); load(listview); });
		panel.on("click", "[data-confirm]", function () { if (can_create()) open_confirmation(this.dataset.confirm); });
		panel.on("click", "[data-employee]", function () { frappe.set_route("employee-detail", this.dataset.employee); });
	}

	function load(listview) {
		const panel = listview.$confirmation_panel;
		const request = (listview.confirmation_request || 0) + 1;
		listview.confirmation_request = request;
		panel.find(".candidate-content").html(`<p class="text-muted">${__("正在加载未转正人员…")}</p>`);
		panel.find(".candidate-paging").empty();
		return Promise.resolve(frappe.call({ method: `${api}.get_candidates`, args: { company: company(), search: panel.find(".candidate-search").val(), start: listview.confirmation_start } }))
			.then(({ message }) => {
				if (request !== listview.confirmation_request) return;
				const { rows = [], total = 0 } = message || {};
				panel.find(".candidate-count").text(__("共 {0} 人", [total]));
				const headers = ["工号", "姓名", "部门", "岗位", "入职日期", "计划转正日期", "操作"];
				panel.find(".candidate-content").html(rows.length ? `<div style="overflow-x:auto"><table class="table table-bordered" style="margin:0;white-space:nowrap"><thead><tr>${headers.map((label) => `<th>${__(label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${[row.custom_employee_code, row.employee_name, row.department, row.designation, row.date_of_joining, row.final_confirmation_date].map((value) => `<td>${escape(value || "—")}</td>`).join("")}<td><button class="btn btn-default btn-xs" data-employee="${escape(row.name)}">${__("查看资料")}</button> ${can_create() ? `<button class="btn btn-primary btn-xs" data-confirm="${escape(row.name)}">${__("办理转正")}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="text-muted">${__("暂无符合条件的未转正人员，请检查搜索条件和当前公司。")}</p>`);
				const start = listview.confirmation_start;
				panel.find(".candidate-paging").html(`${start > 0 ? `<button class="btn btn-default btn-sm" data-page="${Math.max(0, start - 20)}">${__("上一页")}</button>` : ""}<span class="text-muted">${__("第 {0} 页", [Math.floor(start / 20) + 1])}</span>${start + 20 < total ? `<button class="btn btn-default btn-sm" data-page="${start + 20}">${__("下一页")}</button>` : ""}`);
			})
			.catch(() => {
				if (request !== listview.confirmation_request) return;
				panel.find(".candidate-count").empty();
				panel.find(".candidate-content").html(`<p class="text-danger">${__("未转正人员加载失败，请确认员工查看权限后重新查询。")}</p>`);
			});
	}

	function refresh(listview) {
		setup(listview);
		listview.page.set_title(__("转正管理"));
		if (can_create()) listview.page.set_primary_action(__("新增员工转正"), () => open_confirmation());

		if (window.hrmsConfirmationEmployee) {
			listview.$confirmation_panel.find(".candidate-search").val(window.hrmsConfirmationEmployee);
			listview.confirmation_start = 0;
			delete window.hrmsConfirmationEmployee;
		}
		load(listview);
	}

	frappe.listview_settings["Employee Promotion"] = {
		add_fields: ["employee_name", "department", "promotion_date", "custom_confirmation_result"],
		hide_name_column: true,
		onload: setup,
		refresh,
	};
})();
