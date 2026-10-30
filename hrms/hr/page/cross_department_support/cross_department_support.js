frappe.pages["cross-department-support"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("跨部门支援"),
		single_column: true,
	});

	const support = new CrossDepartmentSupportPage(page);
	wrapper.cross_department_support = support;
	support.show();
};

class CrossDepartmentSupportPage {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.rows = [];
		this.page_number = 1;
		this.page_length = 10;
		this.total_pages = 1;
	}

	show() {
		this.page.set_primary_action(__("新建支援"), () =>
			frappe.new_doc("Cross Department Support Capability"),
		);
		this.render_shell();
		this.add_filters();
		this.add_period_filters();
		this.apply_route_filters();
		this.bind_events();
		this.load_filter_options();
		this.search();
	}

	render_shell() {
		$(this.wrapper).html(`
			<div class="cross-department-support-page">
				<div class="cross-department-support-page__intro">
					<div><h4>${__("查询支援人员")}</h4><p>${__("可按原部门/岗位、可支援部门/岗位或姓名/工号查询；每项均可直接输入，并从下拉匹配项中选择。")}</p></div>
					<div class="cross-department-support-page__intro-actions"><button class="btn btn-default" data-action="support-counts">${__("支援次数")}</button><button class="btn btn-default" data-action="support-records">${__("支援记录")}</button><button class="btn btn-default" data-action="open-import">${__("导入初始名单")}</button></div>
				</div>
				<div class="cross-department-support-page__filters" data-filters>
					<div class="cross-department-support-page__filter-group"><div class="cross-department-support-page__filter-label">${__("原部门 / 岗位查询")}</div><div class="cross-department-support-page__filter-fields" data-filter-group="source"></div></div>
					<div class="cross-department-support-page__filter-group"><div class="cross-department-support-page__filter-label">${__("可支援部门 / 岗位查询")}</div><div class="cross-department-support-page__filter-fields" data-filter-group="support"></div></div>
					<div class="cross-department-support-page__filter-group"><div class="cross-department-support-page__filter-label">${__("姓名 / 工号查询")}</div><div class="cross-department-support-page__filter-fields" data-filter-group="employee"></div></div>
					<div class="cross-department-support-page__filter-actions"><div data-filter-group="availability"></div><div data-filter-group="period"></div><button class="btn btn-primary" data-action="search">${__("查询")}</button></div>
				</div>
				<div class="cross-department-support-page__summary" data-summary></div>
				<div class="cross-department-support-page__results" data-results></div>
			</div>
		`);
	}

	add_filters() {
		const filters = $(this.wrapper).find("[data-filters]");
		const reset_to_first_page = () => {
			this.page_number = 1;
		};
		const add_filter = (target, df) =>
			frappe.ui.form.make_control({
				parent: filters.find(target),
				df: { ...df, change: reset_to_first_page },
				render_input: true,
			});

		this.source_department = add_filter("[data-filter-group='source']", {
			fieldname: "source_department",
			label: __("原部门"),
			fieldtype: "Autocomplete",
			options: [],
		});
		this.source_designation = add_filter("[data-filter-group='source']", {
			fieldname: "source_designation",
			label: __("原岗位"),
			fieldtype: "Autocomplete",
			options: [],
		});
		this.department = add_filter("[data-filter-group='support']", {
			fieldname: "support_department",
			label: __("可支援部门"),
			fieldtype: "Autocomplete",
			options: [],
		});
		this.designation = add_filter("[data-filter-group='support']", {
			fieldname: "support_designation",
			label: __("可支援岗位"),
			fieldtype: "Autocomplete",
			options: [],
		});
		this.employee = add_filter("[data-filter-group='employee']", {
			fieldname: "employee_keyword",
			label: __("姓名或工号"),
			fieldtype: "Autocomplete",
			options: [],
		});
		this.show_unavailable = add_filter("[data-filter-group='availability']", {
			fieldname: "include_unavailable",
			label: __("同时显示不可派人员"),
			fieldtype: "Check",
			default: 0,
		});
	}

    add_period_filters() {
        const parent = $(this.wrapper).find("[data-filter-group='period']");
        const make = (df) => frappe.ui.form.make_control({parent, df, render_input: true});
        this.count_month = make({fieldname: "month", fieldtype: "Data", label: __("统计月份（YYYY-MM）"), default: frappe.datetime.get_today().slice(0, 7)});
        this.dispatch_date = make({fieldname: "dispatch_date", fieldtype: "Date", label: __("派遣日期（用于排除）"), default: frappe.datetime.get_today()});
    }

	load_filter_options() {
		frappe.call({
			method: "hrms.hr.doctype.cross_department_support_capability.cross_department_support_capability.get_support_filter_options",
		}).then((response) => {
			const options = response.message || {};
			this.set_autocomplete_options(this.source_department, options.source_departments || []);
			this.set_autocomplete_options(this.source_designation, options.source_designations || []);
			this.set_autocomplete_options(this.department, options.support_departments || []);
			this.set_autocomplete_options(this.designation, options.support_designations || []);
			this.set_autocomplete_options(this.employee, options.employees || []);
		});
	}

	set_autocomplete_options(control, options) {
		control.df.options = options;
		control.set_data?.(options);
		if (control.awesomplete) control.awesomplete.list = options;
	}

	apply_route_filters() {
		const route = frappe.get_route();
		if (route[1]) this.department.set_value(route[1]);
		if (route[2]) this.designation.set_value(route[2]);
	}

	bind_events() {
		$(this.wrapper).on("click", "[data-action='search']", () => this.search());
		$(this.wrapper).on("click", "[data-action='support-counts']", () => this.open_counts_dialog());
		$(this.wrapper).on("click", "[data-action='support-records']", () => this.open_records_list());
		$(this.wrapper).on("click", "[data-action='open-import']", () => this.open_import_dialog());
		$(this.wrapper).on("click", "[data-action='previous-page']", () => this.go_to_page(this.page_number - 1));
		$(this.wrapper).on("click", "[data-action='next-page']", () => this.go_to_page(this.page_number + 1));
		$(this.wrapper).on("click", "[data-delete-capability]", (event) => {
			event.stopPropagation();
			const name = event.currentTarget.dataset.deleteCapability;
			const row = this.rows.find((item) => item.name === name);
			if (!row) return;
			const label = `${row.employee_name || ""} / ${row.employee_code || ""} / ${row.support_designation || ""}`;
			frappe.confirm(__("确认删除支援资格：{0}？", [frappe.utils.escape_html(label)]), () =>
				Promise.resolve(frappe.call({
					method: "hrms.hr.doctype.cross_department_support_capability.cross_department_support_capability.delete_support_capability",
					args: { name }, freeze: true,
				})).then(() => {
					if (this.rows.length === 1 && this.page_number > 1) this.page_number -= 1;
					this.search(); this.load_filter_options();
				})
			);
		});
		$(this.wrapper).on("click", "[data-support-employee]", (event) => {
            event.preventDefault(); event.stopPropagation();
            frappe.set_route("employee-detail", event.currentTarget.dataset.supportEmployee);
        });
        $(this.wrapper).on("click", "[data-support-action]", event => {
            event.stopPropagation();
            const row = this.rows.find(item => item.name === event.currentTarget.dataset.supportAction);
            if (row) this.open_dispatch_dialog(row);
        });

        $(this.wrapper).on("click", "[data-capability]", (event) => {
            if (event.target.closest("[data-delete-capability], [data-support-employee], [data-support-action]")) return;
            const row = this.rows.find(item => item.name === event.currentTarget.dataset.capability);
            if (row) this.open_support_details(row);
        });
	}

    open_records_list(employee = null) {
        return Promise.resolve(frappe.call({method: "hrms.api.cross_department_support.get_support_overview", args: {capabilities: "[]"}})).then(response => {
            if (!response.message?.counts_ready) {frappe.msgprint(__("支援台账尚未就绪，请管理员检查站点迁移和读取权限。")); return;}
            frappe.route_options = employee ? {employee} : {};
            frappe.set_route("List", "Cross Department Support Record");
            return true;
        });
    }

	go_to_page(page_number) {
		if (page_number < 1 || page_number > this.total_pages) return;
		this.page_number = page_number;
		this.search();
	}

	open_counts_dialog(employee = null) {
		const dialog = new frappe.ui.Dialog({
			title: __("员工支援次数"),
			fields: [
				{ fieldname: "employee", fieldtype: "Link", options: "Employee", label: __("员工"), default: employee, reqd: 1 },
				{ fieldname: "month", fieldtype: "Data", label: __("月份（YYYY-MM）"), default: frappe.datetime.get_today().slice(0, 7), reqd: 1 },
				{ fieldname: "counts", fieldtype: "HTML" },
			],
			primary_action_label: __("查询"),
			primary_action: (values) => {
				const request = (dialog.support_request || 0) + 1;
				dialog.support_request = request;
				const output = dialog.fields_dict.counts.$wrapper;
				output.text(__("正在查询…"));
				return Promise.resolve(frappe.call({
					method: "hrms.api.cross_department_support.get_employee_support_counts",
					args: values,
				})).then((response) => {
					if (dialog.support_request !== request) return;
					const result = response.message || {};
					const escape = (value) => frappe.utils.escape_html(String(value ?? ""));
                    if (result.available === false) { output.text(result.message); return; }
					output.html(`<p><strong>${escape(result.month)}</strong> ${__("支援次数")}：${escape(result.monthly_count)}　${__("累计支援次数")}：${escape(result.total_count)}</p>
						<p class="text-muted">${escape(result.counting_rule)}</p>
						<table class="table table-bordered"><thead><tr><th>${__("月份")}</th><th>${__("次数")}</th></tr></thead><tbody>
						${(result.months || []).map((row) => `<tr><td>${escape(row.month)}</td><td>${escape(row.count)}</td></tr>`).join("") || `<tr><td colspan="2">${__("暂无有效支援记录；请先录入并提交支援记录。")}</td></tr>`}
						</tbody></table>`);
				}).catch(() => {
					if (dialog.support_request === request) output.text(__("查询失败，请检查权限或稍后重试。"));
				});
			},
		});
		dialog.show();
		dialog.fields_dict.counts.$wrapper.text(__("统计实际支援记录；资格名单不计次。仅已提交计次，草稿和取消不计次，同一员工同一来源单号去重，按最早开始月份归属。"));
	}

    open_dispatch_dialog(row) {
        const add_job = "__new_support_job__";
        const request_id = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        const today = this.dispatch_date?.get_value() || frappe.datetime.get_today();
        let dialog, available = [], can_add = false;
        const refresh_jobs = () => {
            if (!dialog) return;
            const department = dialog.get_value("support_department");
            const jobs = [...new Set(available.filter(q => q.support_department === department).map(q => q.support_designation).filter(Boolean))];
            const current = dialog.get_value("support_designation");
            dialog.set_df_property("support_designation", "options", ["", ...jobs,
                ...(can_add ? [{label: __("＋ 添加新的岗位"), value: add_job}] : [])]);
            dialog.set_value("support_designation", jobs.includes(current) ? current : jobs.includes(row.support_designation) ? row.support_designation : jobs[0] || "");
            refresh_new_job();
        };
        const refresh_new_job = () => {
            if (!dialog) return;
            const adding = dialog.get_value("support_designation") === add_job;
            dialog.set_df_property("new_designation", "hidden", !adding);
            dialog.set_df_property("new_designation", "reqd", adding);
        };
        dialog = new frappe.ui.Dialog({title: __("派出支援 · {0}", [row.employee_name || row.employee || ""]),
            fields: [
                {fieldname: "notice", fieldtype: "HTML"},
                {fieldname: "support_department", fieldtype: "Select", label: __("支援部门"), options: [], reqd: 1, change: refresh_jobs},
                {fieldname: "support_designation", fieldtype: "Select", label: __("支援岗位"), options: [], reqd: 1, change: refresh_new_job},
                {fieldname: "new_designation", fieldtype: "Data", label: __("新岗位名称"), hidden: 1,
                    description: __("确认派出后，该岗位会保存到此员工的可支援岗位中，供以后选择。")},
                {fieldname: "support_date", fieldtype: "Date", label: __("支援开始日期"), default: today, reqd: 1},
                {fieldname: "end_date", fieldtype: "Date", label: __("支援结束日期"), default: today, reqd: 1},
                {fieldname: "remarks", fieldtype: "Small Text", label: __("备注")},
            ], primary_action_label: __("确认派出"), primary_action: values => {
                if (dialog.dispatching || !dialog.can_dispatch) return;
                dialog.dispatching = true;
                dialog.get_primary_btn().prop("disabled", true);
                const adding = values.support_designation === add_job;
                return Promise.resolve(frappe.call({method: "hrms.api.cross_department_support.dispatch_employee_support",
                    args: {capability: row.name, support_department: values.support_department,
                        support_designation: adding ? values.new_designation : values.support_designation,
                        add_new: adding ? 1 : 0, support_date: values.support_date, end_date: values.end_date,
                        remarks: values.remarks, request_id}, freeze: true, freeze_message: __("正在确认派出…")
                })).then(() => {
                    dialog.hide();
                    frappe.show_alert({message: __("已派出支援，记录已保存。"), indicator: "green"});
                    this.search(); this.load_filter_options();
                }).finally(() => {dialog.dispatching = false; dialog.get_primary_btn().prop("disabled", !dialog.can_dispatch);});
            }});
        dialog.show();
        dialog.get_primary_btn().prop("disabled", true);
        dialog.fields_dict.notice.$wrapper.text(__("正在读取该员工的可支援岗位…"));
        Promise.resolve(frappe.call({method: "hrms.api.cross_department_support.get_dispatch_options", args: {capability: row.name}})).then(response => {
            const result = response.message || {};
            available = result.capabilities || [];
            can_add = Boolean(result.can_add);
            dialog.can_dispatch = Boolean(result.can_dispatch);
            const departments = [...new Set([...available.map(q => q.support_department), row.support_department].filter(Boolean))];
            dialog.set_df_property("support_department", "options", ["", ...departments]);
            dialog.set_value("support_department", departments.includes(row.support_department) ? row.support_department : departments[0] || "");
            refresh_jobs();
            dialog.get_primary_btn().prop("disabled", !dialog.can_dispatch);
            dialog.fields_dict.notice.$wrapper.text(dialog.can_dispatch ? __("选择本次支援岗位和日期，确认后生成支援记录并计入次数。") : __("当前无法确认派出，请联系管理员检查支援记录是否启用及派出权限。"));
        }).catch(() => dialog.fields_dict.notice.$wrapper.text(__("可支援岗位加载失败，请关闭后重试。")));
    }

    open_support_details(row) {
        const escape = value => frappe.utils.escape_html(String(value ?? ""));
        const dialog = new frappe.ui.Dialog({title: __("个人支援信息"), size: "large",
            fields: [{fieldname: "detail", fieldtype: "HTML"}], primary_action_label: __("编辑支援能力"),
            primary_action: () => {dialog.hide(); frappe.set_route("Form", "Cross Department Support Capability", row.name);}});
        dialog.show();
        const output = dialog.fields_dict.detail.$wrapper;
        output.text(__("正在加载…"));
        Promise.resolve(frappe.call({method: "hrms.api.cross_department_support.get_support_details",
            args: {capability: row.name, month: this.count_month?.get_value()}})).then(response => {
            const data = response.message || {}, counts = data.counts;
            const count_ready = counts && counts.available !== false;
            const action = (attribute, title, description, enabled = true) => `<button type="button" class="support-info__action" ${attribute} ${enabled ? "" : 'disabled title="' + escape(__("该功能暂不可用")) + '"'}><strong>${escape(title)}</strong><span>${escape(description)}</span></button>`;
            output.html(`<div class="support-info">
                <div class="support-info__person"><div class="support-info__avatar">${escape((row.employee_name || "?").slice(0, 1))}</div>
                    <div><h4>${escape(row.employee_name || __("待关联员工"))}</h4><span class="text-muted">${escape(row.employee_code || row.employee || "")} · ${escape(row.source_department || "—")}</span></div>
                    <span class="indicator-pill ${row.availability === "可派" ? "green" : "gray"}">${escape(row.availability || __("支援资格"))}</span></div>
                <div class="support-info__assignment"><span>${__("可支援部门")}<strong>${escape(row.support_department || "—")}</strong></span><span>${__("可支援岗位")}<strong>${escape(row.support_designation || "—")}</strong></span></div>
                <div class="support-info__stats"><div><span>${count_ready ? escape(counts.month) : __("所选月份")} · ${__("支援次数")}</span><strong>${count_ready ? escape(counts.monthly_count) : "—"}</strong></div><div><span>${__("累计支援次数")}</span><strong>${count_ready ? escape(counts.total_count) : "—"}</strong></div></div>
                <p class="support-info__hint">${count_ready ? __("按已提交的实际支援记录统计，同一来源单号计一次。") : __("支援次数暂不可用，不影响查看支援能力。")}</p>
                <div class="support-info__actions">
                    ${action("data-view-records", __("支援记录"), __("查看此人的实际支援明细"), Boolean(data.records_ready && row.employee))}
                    ${action("data-new-record", __("录入支援"), __("填写本次支援的日期与部门"), Boolean(data.records_ready && row.employee))}
                    ${action("data-detail-counts", __("按月统计"), __("选择月份查看支援次数"), Boolean(data.records_ready && row.employee))}
                    ${action("data-exclude", __("排除派遣"), __("设置暂不可派的日期与原因"), Boolean(data.exclusions_ready && row.employee))}
                </div>
                <div class="support-info__exclusions"><h5>${__("排除派遣时段")}</h5><p class="support-info__hint">${__("对该员工全部支援岗位生效，包含开始和结束当天。")}</p>
                ${(data.exclusions || []).map(e => `<div class="support-info__exclusion"><div><strong>${escape(e.from_date)} ~ ${escape(e.to_date)}</strong><p>${escape(e.reason)}</p></div><button type="button" class="btn btn-default btn-xs" data-revoke="${escape(e.name)}">${__("撤销排除")}</button></div>`).join("") || `<div class="support-info__empty">${data.exclusions_ready ? __("暂无排除时段") : __("排除功能暂不可用")}</div>`}</div>
            </div>`);
            output.find("[data-detail-counts]").on("click", () => this.open_counts_dialog(row.employee));
            output.find("[data-new-record]").on("click", () => {
                if (!data.records_ready) {frappe.msgprint(__("该功能暂不可用，请联系管理员。")); return;}
                frappe.new_doc("Cross Department Support Record", {employee: row.employee, support_date: this.dispatch_date?.get_value(), support_department: row.support_department});
            });
            output.find("[data-view-records]").on("click", () => this.open_records_list(row.employee).then(opened => {if (opened) dialog.hide();}));
            output.find("[data-exclude]").on("click", () => {
                if (!data.exclusions_ready) {frappe.msgprint(__("该功能暂不可用，请联系管理员。")); return;}
                const exclusion = new frappe.ui.Dialog({title: __("按时间排除派遣"), fields: [
                    {fieldname: "from_date", fieldtype: "Date", label: __("开始日期"), reqd: 1, default: this.dispatch_date?.get_value() || frappe.datetime.get_today()},
                    {fieldname: "to_date", fieldtype: "Date", label: __("结束日期"), reqd: 1},
                    {fieldname: "reason", fieldtype: "Small Text", label: __("排除原因"), reqd: 1}],
                    primary_action_label: __("保存排除"), primary_action: values => Promise.resolve(frappe.call({
                        method: "hrms.api.cross_department_support.save_support_exclusion", args: {capability: row.name, ...values}, freeze: true
                    })).then(() => {exclusion.hide(); dialog.hide(); this.search(); this.open_support_details(row);})});
                exclusion.show();
            });
            output.find("[data-revoke]").on("click", event => frappe.confirm(__("确认撤销该排除时段？"), () => Promise.resolve(frappe.call({
                method: "hrms.api.cross_department_support.revoke_support_exclusion", args: {name: event.currentTarget.dataset.revoke}, freeze: true
            })).then(() => {dialog.hide(); this.search(); this.open_support_details(row);})));
        }).catch(() => output.text(__("支援详情加载失败，请检查权限后重试。")));
    }

	download_import_template() {
		frappe
			.call({
				method: "hrms.hr.doctype.cross_department_support_capability.cross_department_support_capability.download_cross_department_support_template",
			})
			.then((response) => {
				const file = response.message || {};
				if (file.file_url) window.open(file.file_url);
			});
	}

	open_import_dialog() {
        const support_page = this;
		let file_url = "";
		let preview = null;
		const dialog = new frappe.ui.Dialog({
			title: __("导入初始支援名单"),
			fields: [{ fieldtype: "HTML", fieldname: "import_content" }],
			primary_action_label: __("选择 Excel 文件"),
			primary_action: select_file,
		});

		function render_preview() {
			const body = dialog.fields_dict.import_content.$wrapper;
			if (!preview) {
				body.html(`<div class="cross-department-support-page__import-tip">
					<p>${__("支持现有的“部门、姓名、可支援部门、可支援岗位”名单格式。可支援部门和岗位可直接填写，不依赖系统主数据；同一人后续行留空部门、姓名或可支援部门时，系统会自动沿用上一行信息。")}</p>
					<button class="btn btn-default btn-sm" data-download-import-template>${__("下载空白模板")}</button>
				</div>`);
				body.find("[data-download-import-template]").on("click", () => support_page.download_import_template());
				dialog.set_primary_action(__("选择 Excel 文件"), select_file);
				return;
			}
			const escape = (value) => frappe.utils.escape_html(String(value || "—"));
			const sample = (preview.rows || []).slice(0, 12);
			const canImport = Boolean(preview.can_import);
			body.html(`
				<div class="cross-department-support-page__import-summary ${preview.failed ? "text-warning" : "text-success"}">
					${__("已读取 {0} 行；通过 {1} 行；错误 {2} 行。", [preview.total || 0, (preview.total || 0) - (preview.failed || 0), preview.failed || 0])}
				</div>
				${preview.failed ? `<div class="alert alert-warning">${__("异常行会导入为“待复核、不可派”记录；补齐员工、部门或岗位后即可正常使用。")}</div>` : ""}
				<table class="table table-bordered table-sm"><thead><tr><th>${__("Excel 行")}</th><th>${__("部门")}</th><th>${__("姓名")}</th><th>${__("可支援部门")}</th><th>${__("可支援岗位")}</th><th>${__("结果")}</th></tr></thead>
				<tbody>${sample.map((row) => `<tr><td>${escape(row.row_number)}</td><td>${escape(row.source_department)}</td><td>${escape(row.employee_name)}</td><td>${escape(row.support_department)}</td><td>${escape(row.support_designation)}</td><td>${row.errors?.length ? `<span class="text-warning">${escape(row.action)}：${escape(row.errors.join("；"))}</span>` : `<span class="text-success">${escape(row.action)}</span>`}</td></tr>`).join("")}</tbody></table>
				${(preview.rows || []).length > sample.length ? `<p class="text-muted">${__("仅显示前 12 行预览。")}</p>` : ""}
			`);
			dialog.set_primary_action(canImport ? (preview.failed ? __("导入并保留异常") : __("确认导入")) : __("重新选择文件"), canImport ? import_file : select_file);
		}

		function select_file() {
			new frappe.ui.FileUploader({
				folder: "Home/Attachments",
				restrictions: { allowed_file_types: [".xlsx"] },
				on_success: (file) => {
					file_url = file.file_url;
					frappe
						.call({
							method: "hrms.hr.doctype.cross_department_support_capability.cross_department_support_capability.preview_cross_department_support_import",
							args: { file_url },
							freeze: true,
							freeze_message: __("正在校验支援名单…"),
						})
						.then((response) => {
							preview = response.message || {};
							render_preview();
						});
				},
			});
		}

		function import_file() {
			frappe
				.call({
					method: "hrms.hr.doctype.cross_department_support_capability.cross_department_support_capability.import_cross_department_support_capabilities",
					args: { file_url },
					freeze: true,
					freeze_message: __("正在导入支援名单…"),
				})
				.then((response) => {
					const result = response.message || {};
					dialog.hide();
					const pendingText = result.pending_review ? __("；其中 {0} 条为待复核记录。", [result.pending_review]) : "";
					frappe.show_alert({ message: __("已新增 {0} 条支援资格，跳过 {1} 条已有资格{2}", [result.inserted || 0, result.skipped || 0, pendingText]), indicator: "green" });
					support_page.page_number = 1;
                    support_page.search();
                    support_page.load_filter_options();
				});
		}

		render_preview();
		dialog.show();
	}

	search() {
		const args = {
			source_department: this.source_department?.get_value() || "",
			source_designation: this.source_designation?.get_value() || "",
			support_department: this.department?.get_value() || "",
			support_designation: this.designation?.get_value() || "",
			employee_keyword: this.employee?.get_value() || "",
			include_unavailable: this.show_unavailable?.get_value() || 0,
			page: this.page_number,
			page_length: this.page_length,
            dispatch_date: this.dispatch_date?.get_value() || frappe.datetime.get_today(),
		};
		frappe.call({
			method: "hrms.hr.doctype.cross_department_support_capability.cross_department_support_capability.get_available_support_candidates",
			args,
			freeze: true,
			freeze_message: __("正在查询可支援人员..."),
		}).then((response) => {
			const result = response.message || {};
			this.rows = result.rows || [];
			this.can_delete = Boolean(result.can_delete);
			this.page_number = result.page || 1;
			this.total_pages = result.total_pages || 1;
			this.render_results(result.count || 0);
            const generation = (this.overview_request || 0) + 1;
            this.overview_request = generation;
            Promise.resolve(frappe.call({method: "hrms.api.cross_department_support.get_support_overview",
                args: {capabilities: JSON.stringify(this.rows.map(r => r.name)), month: this.count_month?.get_value(), dispatch_date: args.dispatch_date}
            })).then(response => {
                if (this.overview_request !== generation) return;
                const overview = response.message || {};
                this.rows.forEach(row => Object.assign(row, overview.rows?.[row.employee] || {monthly_count: null, total_count: null}));
                this.render_results(result.count || 0);

            }).catch(() => {
                // Counts are optional enrichment; the candidate list remains usable on failure.
            });
		});
	}

	render_results(count) {
		$(this.wrapper).find("[data-summary]").html(`
			<div class="cross-department-support-page__count"><strong>${frappe.utils.escape_html(String(count))}</strong><span>${__("名符合当前条件")}</span></div>
			<div class="text-muted">${__("名单会随新增或状态变更立即更新。")}</div>
		`);
		const result = $(this.wrapper).find("[data-results]");
		if (!this.rows.length) {
			result.html(`<div class="frappe-empty-state"><div class="text-muted">${__("没有符合条件的可支援人员。可先新增人员能力，或放宽部门/岗位筛选。")}</div></div>`);
			return;
		}
		result.html(`
			<table class="table table-bordered table-hover">
				<thead><tr><th>${__("姓名")}</th><th>${__("工号")}</th><th>${__("原部门 / 岗位")}</th><th>${__("可支援部门")}</th><th>${__("可支援岗位")}</th><th>${__("所选月次数")}</th><th>${__("累计次数")}</th><th>${__("状态")}</th><th>${__("有效期")}</th><th>${__("备注")}</th><th>${__("操作")}</th></tr></thead>
				<tbody>${this.rows.map((row) => this.render_row(row)).join("")}</tbody>
			</table>
			${this.render_pagination(count)}
		`);
	}

	render_pagination(count) {
		if (count <= this.page_length) return "";
		return `<div class="cross-department-support-page__pagination">
			<span class="text-muted">${__("第 {0} / {1} 页，共 {2} 名", [this.page_number, this.total_pages, count])}</span>
			<div><button class="btn btn-default btn-sm" data-action="previous-page" ${this.page_number === 1 ? "disabled" : ""}>${__("上一页")}</button><button class="btn btn-default btn-sm" data-action="next-page" ${this.page_number === this.total_pages ? "disabled" : ""}>${__("下一页")}</button></div>
		</div>`;
	}

	render_row(row) {
		const escape = (value) => frappe.utils.escape_html(value || "");
		const two_lines = (primary, secondary, emphasize = false) => `${primary ? (emphasize ? `<strong>${escape(primary)}</strong>` : escape(primary)) : ""}${secondary ? `${primary ? "<br>" : ""}<small class="text-muted">${escape(secondary)}</small>` : ""}`;
		const period = row.valid_from || row.valid_until ? `${escape(row.valid_from || __("不限"))} ~ ${escape(row.valid_until || __("不限"))}` : __("长期有效");
		const indicator = row.availability === "可派" ? "green" : "gray";
		return `<tr class="pointer" data-capability="${escape(row.name)}">
			<td>${row.employee ? `<a href="/app/employee-detail/${encodeURIComponent(row.employee)}" data-support-employee="${escape(row.employee)}"><strong>${escape(row.employee_name)}</strong></a>` : `<strong>${escape(row.employee_name)}</strong>`}</td>
			<td>${escape(row.employee_code)}</td>
			<td>${two_lines(row.source_department, row.source_designation)}</td>
			<td>${escape(row.support_department)}</td><td>${escape(row.support_designation)}</td>
			<td>${escape(row.monthly_count == null ? "—" : String(row.monthly_count))}</td><td>${escape(row.total_count == null ? "—" : String(row.total_count))}</td>
			<td><span class="indicator-pill ${indicator}">${escape(row.availability)}</span><br><small class="text-muted">${escape(row.qualification_status)}</small></td>
			<td>${period}</td><td>${escape(row.remarks)}</td><td><button type="button" class="btn btn-default btn-xs" data-support-action="${escape(row.name)}">${__("支援操作")}</button>${this.can_delete ? ` <button type="button" class="btn btn-danger btn-xs" data-delete-capability="${escape(row.name)}">${__("删除")}</button>` : ""}</td>
		</tr>`;
	}
}
