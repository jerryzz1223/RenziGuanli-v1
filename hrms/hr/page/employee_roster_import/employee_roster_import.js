frappe.pages["employee-roster-import"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("智能花名册导入"),
		single_column: true,
	});

	const state = {
		step: 1,
		mode: "",
		match_by: "employee_code",
		parse_result: null,
		preview_result: null,
		import_result: null,
		manual_mappings: {},
		file: null,
	};

	$(page.body).addClass("hrms-roster-import-page");
	page.set_secondary_action(__("返回"), () => frappe.set_route("List", "Employee"));

	function download_template() {
		window.open(
			frappe.urllib.get_full_url(
				"/api/method/hrms.api.employee_field_template.download_employee_import_template",
			),
		);
	}

	function render_landing() {
		page.set_title(__("智能花名册导入"));
		page.set_primary_action(null);
		$(page.body).html(`
			<div class="hrms-import-landing">
				<div class="hrms-import-card">
					<div>
						<div class="hrms-import-card__title"><span class="blue-dot"></span>${__("批量添加员工")}</div>
						<p>${__("适用于首次批量导入添加员工信息，支持导入在职、离职员工。")}</p>
					</div>
					<button class="btn btn-primary" data-action="start-insert">${__("导入花名册")}</button>
				</div>
				<div class="hrms-import-card">
					<div>
						<div class="hrms-import-card__title"><span class="orange-dot"></span>${__("批量修改信息")}</div>
						<p>${__("适用于批量更新、修改系统已存在人员的信息。")}</p>
					</div>
					<button class="btn btn-warning" data-action="start-update">${__("去修改信息")}</button>
				</div>
				<button class="btn btn-link hrms-import-records" data-action="records">${__("查看导入花名册记录")}</button>
			</div>
		`);
	}

	function render_upload() {
		page.set_title(state.mode === "update" ? __("智能花名册导入-批量修改信息") : __("智能花名册导入-批量添加员工"));
		page.set_primary_action(null);
		$(page.body).html(`
			<div class="hrms-import-wizard">
				${render_steps()}
				<div class="hrms-upload-box" data-action="upload">
					<div class="hrms-upload-box__icon">⇧</div>
					<div>${__("点击上传花名册文件")}</div>
					<small>${__("文件不超过 50M，支持 .xlsx")}</small>
				</div>
				<div class="hrms-import-tips">
					<h4>${__("温馨提示")}</h4>
					<p>1. ${__("可导入在职员工和离职员工。上传后会先匹配表头，不会立即写入员工资料。")}</p>
					<p>2. ${__("您可以用自有花名册导入，也可以")} <button class="btn btn-link btn-xs" data-action="download-template">${__("下载标准模板")}</button></p>
				</div>
				<div class="hrms-import-effects">
					<h4>${__("导入花名册后的效果")}</h4>
					<div><strong>01</strong>${__("生成员工生日、入职周年、待办等提醒")}</div>
					<div><strong>02</strong>${__("建立部门、岗位等基础组织资料")}</div>
					<div><strong>03</strong>${__("为后续人事报表和员工档案提供基础数据")}</div>
				</div>
			</div>
		`);
	}

	function render_match() {
		const headers = state.parse_result?.headers || [];
		const fields = state.parse_result?.fields || [];
		const missing = state.parse_result?.missing_required || [];
		page.set_title(__("智能花名册导入-匹配表头"));
		page.set_primary_action(__("预览导入结果"), () => {
			state.manual_mappings = collect_manual_mappings();
			const missing_required = current_missing_required();
			if (missing_required.length) {
				frappe.msgprint({
					title: __("无法导入"),
					indicator: "orange",
					message: __("请先补齐必填字段匹配：{0}", [
						missing_required.map((field) => frappe.utils.escape_html(field.field_label)).join("、"),
					]),
				});
				return;
			}
			frappe
				.call({
					method: "hrms.api.employee_field_template.preview_employee_roster_import",
					args: {
						file_url: state.file.file_url,
						mode: state.mode || "insert",
						match_by: state.match_by,
						manual_mappings: JSON.stringify(state.manual_mappings),
					},
					freeze: true,
					freeze_message: __("正在预览导入结果..."),
				})
				.then((r) => {
					state.step = 3;
					state.preview_result = r.message || {};
					render_preview();
				});
		});
		$(page.body).html(`
			<div class="hrms-import-wizard">
				${render_steps()}
				<div class="hrms-import-result">
					<div class="hrms-import-result__summary">
						<strong>${__("已读取 {0} 行员工数据", [state.parse_result?.row_count || 0])}</strong>
						<span class="${missing.length ? "text-danger" : "text-success"}">
							${missing.length ? __("缺少 {0} 个必填字段", [missing.length]) : __("必填字段已匹配")}
						</span>
					</div>
					${missing.length ? `<div class="alert alert-warning">${__("缺失字段：")} ${missing.map((field) => frappe.utils.escape_html(field.field_label)).join("、")}</div>` : ""}
					<div class="alert alert-info">
						${__("如果表头没有自动匹配，可以进入导入映射设置维护字段别名，或后续使用手动匹配字段。")}
						<button class="btn btn-link btn-xs" data-route="hr-settings-center">${__("导入映射设置")}</button>
						<span class="text-muted">${__("手动匹配字段")}</span>
					</div>
					<div class="form-group">
						<label class="control-label">${__("重复员工更新策略")}</label>
						<select class="form-control" data-match-by>
							<option value="employee_code" ${state.match_by === "employee_code" ? "selected" : ""}>${__("按工号")}</option>
							<option value="id_card" ${state.match_by === "id_card" ? "selected" : ""}>${__("按身份证")}</option>
							<option value="phone" ${state.match_by === "phone" ? "selected" : ""}>${__("按手机号")}</option>
							<option value="auto" ${state.match_by === "auto" ? "selected" : ""}>${__("工号/身份证/手机号自动匹配")}</option>
						</select>
					</div>
					<table class="table table-bordered">
						<thead><tr><th>${__("Excel 表头")}</th><th>${__("匹配员工字段")}</th><th>${__("状态")}</th></tr></thead>
						<tbody>
							${headers
								.map(
									(item) => `
									<tr>
										<td>${frappe.utils.escape_html(item.header)}</td>
										<td>${render_field_mapping_select(item, fields)}</td>
										<td>${item.matched ? `<span class="indicator-pill green">${__("已匹配")}</span>` : `<span class="indicator-pill gray">${__("手动匹配字段")}</span>`}</td>
									</tr>`,
								)
								.join("")}
						</tbody>
					</table>
				</div>
			</div>
		`);
	}

	function render_field_mapping_select(item, fields) {
		const current = state.manual_mappings[item.column_index] || item.fieldname || "";
		return `
			<select class="form-control" data-manual-mapping="${frappe.utils.escape_html(item.column_index)}">
				<option value="">${__("- 不导入该列 -")}</option>
				${fields
					.map(
						(field) => `
							<option value="${frappe.utils.escape_html(field.fieldname)}" ${current === field.fieldname ? "selected" : ""}>
								${frappe.utils.escape_html(field.field_label)} / ${frappe.utils.escape_html(field.fieldname)}
							</option>`,
					)
					.join("")}
			</select>
		`;
	}

	function collect_manual_mappings() {
		const mappings = {};
		$(page.body)
			.find("[data-manual-mapping]")
			.each(function () {
				if (this.value) {
					mappings[this.dataset.manualMapping] = this.value;
				}
			});
		return mappings;
	}

	function current_missing_required() {
		const fields = state.parse_result?.missing_required || [];
		const selected = new Set(Object.values(collect_manual_mappings()));
		return fields.filter((field) => !selected.has(field.fieldname));
	}

	function render_preview() {
		const result = state.preview_result || {};
		const errors = result.errors || [];
		const preview_rows = result.preview_rows || [];
		page.set_title(__("智能花名册导入-预览导入结果"));
		page.set_primary_action(__("写入 Employee"), confirm_import);
		$(page.body).html(`
			<div class="hrms-import-wizard">
				${render_steps()}
				<div class="hrms-import-result">
					<div class="hrms-import-result__cards">
						<div><span>${__("读取行数")}</span><strong>${frappe.utils.escape_html(result.row_count || 0)}</strong></div>
						<div><span>${__("将新增")}</span><strong>${frappe.utils.escape_html(result.inserted || 0)}</strong></div>
						<div><span>${__("将更新")}</span><strong>${frappe.utils.escape_html(result.updated || 0)}</strong></div>
						<div><span>${__("失败行")}</span><strong>${frappe.utils.escape_html(result.failed || 0)}</strong></div>
					</div>
					<table class="table table-bordered">
						<thead><tr><th>${__("行号")}</th><th>${__("动作")}</th><th>${__("匹配员工")}</th><th>${__("错误数")}</th></tr></thead>
						<tbody>${preview_rows
							.slice(0, 100)
							.map(
								(row) => `
								<tr>
									<td>${frappe.utils.escape_html(row.row || "")}</td>
									<td>${frappe.utils.escape_html(__(row.action || ""))}</td>
									<td>${frappe.utils.escape_html(row.employee || "-")}</td>
									<td>${frappe.utils.escape_html((row.errors || []).length)}</td>
								</tr>`,
							)
							.join("")}</tbody>
					</table>
					${render_errors(errors, __("预览通过，可以写入 Employee。"))}
					<div class="hrms-import-actions">
						<button class="btn btn-default" data-action="back-to-match">${__("返回匹配表头")}</button>
						<button class="btn btn-primary" data-action="confirm-import">${__("写入 Employee")}</button>
					</div>
				</div>
			</div>
		`);
	}

	function render_errors(errors, empty_message) {
		return errors.length
			? `<table class="table table-bordered">
				<thead><tr><th>${__("行号")}</th><th>${__("字段")}</th><th>${__("问题")}</th></tr></thead>
				<tbody>${errors
					.map(
						(error) => `
						<tr>
							<td>${frappe.utils.escape_html(error.row || "")}</td>
							<td>${frappe.utils.escape_html(error.field_label || error.fieldname || "")}</td>
							<td>${frappe.utils.escape_html(error.message || "")}</td>
						</tr>`,
					)
					.join("")}</tbody>
			</table>`
			: `<div class="alert alert-success">${empty_message}</div>`;
	}

	function confirm_import() {
		frappe
			.call({
				method: "hrms.api.employee_field_template.import_employee_roster",
				args: {
					file_url: state.file.file_url,
					mode: state.mode || "insert",
					match_by: state.match_by,
					manual_mappings: JSON.stringify(state.manual_mappings || {}),
				},
				freeze: true,
				freeze_message: __("正在写入 Employee..."),
			})
			.then((r) => {
				state.step = 4;
				state.import_result = r.message || {};
				render_result();
			});
	}

	function download_failed_rows() {
		const failed_rows_key = encodeURIComponent(state.import_result?.failed_rows_key || "");
		const failed_rows = encodeURIComponent(JSON.stringify(state.import_result?.failed_rows || []));
		window.open(
			frappe.urllib.get_full_url(
				`/api/method/hrms.api.employee_field_template.download_employee_roster_failed_rows?failed_rows_key=${failed_rows_key}&failed_rows=${failed_rows}`,
			),
		);
	}

	function render_result() {
		const result = state.import_result || {};
		const base_records = result.base_records || {};
		const errors = result.errors || [];
		const warnings = result.warnings || [];
		page.set_title(__("智能花名册导入-查看导入结果"));
		page.set_primary_action(__("打开员工花名册"), () => frappe.set_route("List", "Employee"));
		$(page.body).html(`
			<div class="hrms-import-wizard">
				${render_steps()}
				<div class="hrms-import-result">
					<div class="hrms-import-result__cards">
						<div><span>${__("读取行数")}</span><strong>${frappe.utils.escape_html(result.row_count || 0)}</strong></div>
						<div><span>${__("新增员工")}</span><strong>${frappe.utils.escape_html(result.inserted || 0)}</strong></div>
						<div><span>${__("更新员工")}</span><strong>${frappe.utils.escape_html(result.updated || 0)}</strong></div>
						<div><span>${__("跳过")}</span><strong>${frappe.utils.escape_html(result.skipped || 0)}</strong></div>
						<div><span>${__("失败")}</span><strong>${frappe.utils.escape_html(result.failed || 0)}</strong></div>
					</div>
					<div class="hrms-import-base-records">
						<h4>${__("自动补齐的基础资料")}</h4>
						<p>${__("性别")}：${frappe.utils.escape_html(base_records["性别"] || 0)}　${__("部门")}：${frappe.utils.escape_html(base_records["部门"] || 0)}　${__("岗位")}：${frappe.utils.escape_html(base_records["岗位"] || 0)}　${__("工作性质")}：${frappe.utils.escape_html(base_records["工作性质"] || 0)}</p>
					</div>
					${
						warnings.length
							? `<div class="alert alert-warning">${warnings.map((warning) => frappe.utils.escape_html(warning)).join("<br>")}</div>`
							: ""
					}
					${
						errors.length
							? render_errors(errors, __("导入完成，没有发现行级错误。"))
							: `<div class="alert alert-success">${__("导入完成，没有发现行级错误。")}</div>`
					}
					<div class="hrms-import-actions">
						<button class="btn btn-default" data-action="restart">${__("继续导入")}</button>
						${(result.failed_rows || []).length ? `<button class="btn btn-default" data-action="download-failed">${__("下载失败行")}</button>` : ""}
						<button class="btn btn-primary" data-action="open-employee-list">${__("打开员工花名册")}</button>
					</div>
				</div>
			</div>
		`);
	}

	function render_steps() {
		const steps = [__("上传文件"), __("匹配表头"), __("预览导入结果"), __("查看导入结果")];
		return `
			<div class="hrms-import-steps">
				${steps
					.map(
						(label, index) => `
						<div class="hrms-import-step ${state.step === index + 1 ? "is-active" : ""}">
							<span>${index + 1}</span>${label}
						</div>`,
					)
					.join("")}
			</div>`;
	}

	function open_uploader() {
		new frappe.ui.FileUploader({
			allow_multiple: false,
			restrictions: { allowed_file_types: [".xlsx"] },
			on_success(file) {
				state.file = file;
				frappe
					.call("hrms.api.employee_field_template.parse_employee_roster_file", {
						file_url: file.file_url,
					})
					.then((r) => {
						state.step = 2;
						state.parse_result = r.message;
						render_match();
					});
			},
		});
	}

	$(page.body).on("change", "[data-match-by]", function () {
		state.match_by = this.value;
	});

	$(page.body).on("click", "[data-action]", function () {
		const action = this.dataset.action;
		if (action === "start-insert" || action === "start-update") {
			state.mode = action === "start-update" ? "update" : "insert";
			state.step = 1;
			render_upload();
		}
		if (action === "upload") open_uploader();
		if (action === "download-template") download_template();
		if (action === "records") frappe.set_route("List", "Employee");
		if (action === "back-to-match") {
			state.step = 2;
			render_match();
		}
		if (action === "confirm-import") confirm_import();
		if (action === "download-failed") download_failed_rows();
		if (action === "restart") {
			state.step = 1;
			state.parse_result = null;
			state.preview_result = null;
			state.import_result = null;
			state.manual_mappings = {};
			state.file = null;
			render_upload();
		}
		if (action === "open-employee-list") frappe.set_route("List", "Employee");
	});

	$(page.body).on("click", "[data-route]", function () {
		frappe.set_route(this.dataset.route);
	});

	render_landing();
};
