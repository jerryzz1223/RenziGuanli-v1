(function () {
	const API = "hrms.api.form_data_intake";
	const ROSTER_TEMPLATE_KEY = "employee_roster";
	let listImportAttachTimers = [];

	function current_company() {
		return window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	}

	function escape(value) {
		return frappe.utils.escape_html(String(value ?? ""));
	}

	function reset_action_button(button) {
		if (!button || !window.$) return;
		const target = button.jquery ? button : window.$(button);
		if (!target?.length) return;
		target.prop("disabled", false).removeAttr("disabled").removeClass("disabled").attr("aria-disabled", "false");
	}

	function get_template(template_key) {
		return frappe.call({ method: `${API}.list_form_import_templates` }).then((response) => {
			const template = (response.message || []).find((item) => item.key === template_key);
			if (!template) frappe.throw(__("未找到对应的表单模板"));
			return template;
		});
	}

	function download_template(template) {
		if (template.key === ROSTER_TEMPLATE_KEY) {
			window.open(frappe.urllib.get_full_url("/api/method/hrms.api.employee_field_template.download_employee_import_template"));
			return;
		}
		frappe.call({ method: `${API}.create_form_import_template_file`, args: { template_key: template.key }, freeze: true }).then((response) => {
			const file = response.message || {};
			if (file.file_url) window.open(frappe.urllib.get_full_url(file.file_url));
		});
	}

	function show_roster_import() {
		frappe.set_route("employee-roster-import");
	}

	function open_roster_import_dialog() {
		const dialog = new frappe.ui.Dialog({
			title: __("员工花名册表单导入"),
			fields: [{ fieldtype: "HTML", fieldname: "roster_import_content" }],
			primary_action_label: __("开始导入"),
			primary_action() {
				dialog.hide();
				show_roster_import();
			},
		});
		dialog.show();
		dialog.fields_dict.roster_import_content.$wrapper.html(`<div class="hrms-context-import"><p>${escape(__("花名册导入会创建或更新员工主档；上传前会逐列匹配工号、姓名、部门、岗位和入职日期。"))}</p><div class="alert alert-info">${escape(__("建议先下载基础模板填写；进入导入流程后可选择新增员工或批量修改已有员工。"))}</div><button class="btn btn-default btn-sm" data-download-roster-template>${escape(__("下载基础模板"))}</button></div>`);
		dialog.fields_dict.roster_import_content.$wrapper.find("[data-download-roster-template]").on("click", () => get_template(ROSTER_TEMPLATE_KEY).then(download_template));
	}

	function preview_rows(preview) {
		const rows = preview.preview_rows || [];
		if (!rows.length) return `<p class="text-muted">${escape(__("未读取到可导入的数据行。"))}</p>`;
		return `<table class="table table-bordered table-sm"><thead><tr><th>${escape(__("行号"))}</th><th>${escape(__("业务键"))}</th><th>${escape(__("匹配员工"))}</th><th>${escape(__("校验结果"))}</th></tr></thead><tbody>${rows.slice(0, 20).map((row) => `<tr><td>${escape(row.row_number)}</td><td>${escape(row.record_key)}</td><td>${escape(row.employee || "—")}</td><td>${row.errors?.length ? `<span class="text-danger">${escape(row.errors.join("；"))}</span>` : `<span class="text-success">${escape(__("通过"))}</span>`}</td></tr>`).join("")}</tbody></table>`;
	}

	function open_import_dialog(template_key, options = {}) {
		return get_template(template_key).then((template) => {
			if (template.key === ROSTER_TEMPLATE_KEY) {
				open_roster_import_dialog();
				return;
			}
			const company = current_company();
			if (!company) {
				frappe.msgprint(__("请先在页面顶部选择当前公司。"));
				return;
			}
			let file_url = "";
			let preview = null;
			let dialog;
			function select_file() {
				new frappe.ui.FileUploader({
					folder: "Home/Attachments",
					restrictions: { allowed_file_types: [".xlsx"] },
					on_success(file) {
						file_url = file.file_url;
						dialog.set_primary_action(__("正在校验…"), () => {});
						frappe.call({
							method: `${API}.preview_form_import`,
							args: { file_url, template_key: template.key, company },
							freeze: true,
							freeze_message: __("正在匹配字段和基础资料…"),
						}).then((response) => {
							preview = response.message || {};
							render_dialog();
						}).catch(() => {
							preview = null;
							render_dialog();
						});
					},
				});
			}
			dialog = new frappe.ui.Dialog({
				title: options.title || `${template.label}${__("导入")}`,
				fields: [{ fieldtype: "HTML", fieldname: "import_content" }],
				primary_action_label: __("选择 Excel 文件"),
				primary_action: select_file,
			});

			function render_dialog() {
				const body = dialog.fields_dict.import_content.$wrapper;
				if (!preview) {
					const uploadTip = template.entry_mode === "reward_punishment_drafts"
						? __("可直接上传现有《奖惩提报单》；系统会自动识别标题、表头和数据行，忽略合计与签字栏，并校验奖惩条例、全薪比例和金额。")
						: __("请先下载模板，填写“数据”页后上传。系统会校验必填字段、工号和部门，再写入对应模块的可处理数据。");
					body.html(`<div class="hrms-context-import"><p>${escape(template.description)}</p><div class="alert alert-info">${escape(__("当前公司："))}${escape(company)}<br>${escape(uploadTip)}</div><button class="btn btn-default btn-sm" data-download-template>${escape(__("下载基础模板"))}</button></div>`);
					dialog.set_primary_action(__("选择 Excel 文件"), select_file);
					body.find("[data-download-template]").on("click", () => download_template(template));
					return;
				}
				if (preview.missing_required?.length) {
					body.html(`<div class="alert alert-danger">${escape(__("缺少必填列："))}${escape(preview.missing_required.join("、"))}</div>`);
					dialog.set_primary_action(__("重新选择文件"), select_file);
					return;
				}
				body.html(`<div class="hrms-context-import"><div class="alert ${preview.failed_rows ? "alert-warning" : "alert-success"}">${escape(__("已读取 {0} 行；有效 {1} 行；失败 {2} 行。", [preview.total_rows || 0, preview.valid_rows || 0, preview.failed_rows || 0]))}<br>${escape(__("匹配成功的员工和部门将成为可点击的关联字段，供当前模块后续处理。"))}</div>${preview_rows(preview)}</div>`);
				dialog.set_primary_action(preview.failed_rows ? __("重新选择文件") : __("确认导入"), () => {
					if (preview.failed_rows) {
						file_url = "";
						preview = null;
						render_dialog();
						return;
					}
					frappe.call({ method: `${API}.import_form_workbook`, args: { file_url, template_key: template.key, company }, freeze: true, freeze_message: __("正在写入对应模块数据…") }).then((response) => {
						const result = response.message || {};
						dialog.hide();
						frappe.show_alert({ message: __("{0} 已导入 {1} 行", [template.label, result.valid_rows || 0]), indicator: "green" });
						if (result.target_doctype) {
							frappe.set_route("List", result.target_doctype, { source_import_batch: result.batch_name });
						} else {
							frappe.set_route("List", "HRMS Form Import Row", { import_batch: result.batch_name });
						}
					});
				});
			}

			dialog.show();
			render_dialog();
		});
	}

	function add_page_import_actions(page, template_key, label, button_label = "表单导入") {
		if (!page || !template_key) return;
		const marker = `__hrms_form_import_${template_key}`;
		if (page[marker]) return;
		page[marker] = true;
		let button;
		const reset_when_focus_returns = () => {
			const reset = () => reset_action_button(button);
			setTimeout(reset, 0);
			setTimeout(reset, 250);
			setTimeout(reset, 1000);
		};
		button = page.add_inner_button(__(button_label), () => {
			reset_when_focus_returns();
			const import_window = open_import_dialog(template_key, { title: `${label || "表单"}${__("导入")}` });
			Promise.resolve(import_window)
				.catch((error) => {
					console.error(error);
					frappe.msgprint(error?.message || __("导入窗口打开失败，请稍后重试。"));
				})
				.finally(reset_when_focus_returns);
			window.addEventListener("focus", reset_when_focus_returns, { once: true });
		});
		reset_action_button(button);
	}

	window.hrmsFormImport = { open: open_import_dialog, download(template_key) { return get_template(template_key).then(download_template); }, addPageActions: add_page_import_actions };

	const LIST_IMPORTS = {
		Department: { key: "org_structure", label: "组织架构与编制", button_label: "导入组织架构" },
		"Employee Onboarding": { key: "employee_onboarding", label: "员工入职衔接表", button_label: "导入入职衔接表" },
		"Employee Transfer": { key: "employee_transfer", label: "人事异动表单" },
		"Employee Promotion": { key: "qualification_review", label: "转正/晋升表单" },
		"Employee Separation": { key: "resignation_application", label: "离职表单" },
		"Job Applicant": { key: "recruitment_interview", label: "候选人面试表单" },
		"Training Event": { key: "training_registration", label: "培训登记表" },
		"Appraisal": { key: "performance_summary", label: "绩效总结表" },
		"Employee Skill Map": { key: "certificate_management", label: "证书管理表" },
		"HRMS Employee Reward Punishment": { key: "reward_punishment", label: "奖惩提报表", button_label: "导入奖惩表" },
		"HRMS Attendance Day Check": { key: "attendance_daily", label: "每日考勤表" },
		"HRMS Attendance Exception": { key: "attendance_exception", label: "出勤异常表" },
		"HRMS Apple Reward Record": { key: "apple_reward", label: "苹果树表" },
		"HRMS Monthly Attendance Summary": { key: "attendance_final", label: "月度考勤终稿" },
	};

	function attach_list_import_action() {
		const listview = window.cur_listview;
		// The localized desk uses friendly URLs such as /employee-transfer/view/list,
		// so the URL is not a dependable source of the DocType. ListView is.
		const config = LIST_IMPORTS[listview?.doctype];
		if (!config || !listview) return;
		add_page_import_actions(listview.page, config.key, config.label, config.button_label);
	}

	function schedule_list_import_action() {
		// Frappe recreates a List page's inner toolbar while its data is loading.
		// Replace outstanding delayed work so a fast route change cannot mutate an
		// old List page several seconds later.
		listImportAttachTimers.forEach((timer) => window.clearTimeout(timer));
		const timers = [];
		[0, 350, 1200].forEach((delay) => {
			const timer = window.setTimeout(() => {
				attach_list_import_action();
				listImportAttachTimers = listImportAttachTimers.filter((item) => item !== timer);
			}, delay);
			timers.push(timer);
		});
		listImportAttachTimers = timers;
	}

	function install_contextual_actions() {
		// app_include_js is evaluated before Desk finishes exposing frappe on some
		// routes. Delay binding instead of silently losing every non-Employee page.
		if (!window.frappe || !window.$) {
			setTimeout(install_contextual_actions, 100);
			return;
		}
		if (window.__hrms_contextual_form_import_installed) return;
		window.__hrms_contextual_form_import_installed = true;
		frappe.router?.on?.("change", schedule_list_import_action);
		$(document).on("app_ready", schedule_list_import_action);
		schedule_list_import_action();
	}

	install_contextual_actions();
})();
