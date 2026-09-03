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
		row_overrides: {},
		file: null,
		request_id: 0,
	};

	$(page.body).addClass("hrms-roster-import-page");
	page.set_secondary_action(__("返回"), () => go_back());

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
						<div class="hrms-import-card__title"><span class="orange-dot"></span>${__("覆盖当前花名册")}</div>
						<p>${__("仅用于首次同步最新版花名册：按工号更新已有员工、补充新员工，并将本表未出现的当前员工标记为已离职（不会删除档案）。")}</p>
					</div>
					<button class="btn btn-warning" data-action="start-replace">${__("覆盖当前花名册")}</button>
				</div>
				<div class="hrms-import-card">
					<div>
						<div class="hrms-import-card__title"><span class="blue-dot"></span>${__("批量添加员工")}</div>
						<p>${__("适用于后续导入新增人员。已存在工号将跳过，不会覆盖原有资料。")}</p>
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
		const title = {
			replace: __("智能花名册导入-覆盖当前花名册"),
			update: __("智能花名册导入-批量修改信息"),
			insert: __("智能花名册导入-批量添加员工"),
		}[state.mode] || __("智能花名册导入");
		page.set_title(title);
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
			request_preview();
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
					<div class="hrms-import-actions">
						<button class="btn btn-default" data-action="back-to-upload">${__("重新上传文件")}</button>
					</div>
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

	function render_warnings(warnings) {
		if (!warnings.length) return "";
		return `<details class="hrms-import-warnings"><summary>${__("查看 {0} 条其他非阻塞提示", [warnings.length])}</summary><ul>${warnings
			.slice(0, 50)
			.map((warning) => `<li>${frappe.utils.escape_html(warning)}</li>`)
			.join("")}${warnings.length > 50 ? `<li>${__("其余提示已省略")}</li>` : ""}</ul></details>`;
	}

	function request_preview() {
		const request_id = ++state.request_id;
		frappe
			.call({
				method: "hrms.api.employee_field_template.preview_employee_roster_import",
				args: {
					file_url: state.file.file_url,
					mode: state.mode || "insert",
					match_by: state.match_by,
					manual_mappings: JSON.stringify(state.manual_mappings || {}),
					row_overrides: JSON.stringify(state.row_overrides || {}),
				},
				freeze: true,
				freeze_message: __("正在校验花名册..."),
			})
			.then((r) => {
				if (request_id !== state.request_id) return;
				state.step = 3;
				state.preview_result = r.message || {};
				render_preview();
			});
	}

	function render_preview() {
		const result = state.preview_result || {};
		const errors = result.errors || [];
		const warnings = result.warnings || [];
		const is_replace = state.mode === "replace";
		const can_write = !is_replace || !result.failed;
		page.set_title(__("智能花名册导入-预览导入结果"));
		page.set_primary_action(can_write ? __("导入") : null, can_write ? confirm_import : null);
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
					${
						is_replace
							? `<div class="alert alert-warning">${__("确认写入后，将新增 {0} 人、更新 {1} 人，并把本花名册未出现的 {2} 名当前员工标记为已离职。员工档案不会删除。", [
								result.inserted || 0,
								result.updated || 0,
								result.archived || 0,
							])}${result.failed ? `<br>${__("请先修正所有错误行，覆盖操作才可执行。")}` : ""}</div>`
							: ""
					}
					${result.manual_corrections ? `<div class="alert alert-info">${__("已应用 {0} 项本次导入的人工校正；原 Excel 文件不会被修改。", [result.manual_corrections])}</div>` : ""}
					${result.deferred ? `<div class="alert alert-info">${__("有 {0} 项资料以“-”暂缓填写，将以空值导入，可在员工档案中后续补充。", [result.deferred])}</div>` : ""}
					${render_warnings(warnings)}
					${errors.length ? render_errors(errors, "", true) : ""}
					${errors.length ? "" : `<div class="alert alert-success">${__("预览通过，仅显示需要人工校正的数据。")}</div>`}
					<div class="hrms-import-actions">
						<button class="btn btn-default" data-action="back-to-upload">${__("重新上传文件")}</button>
						<button class="btn btn-default" data-action="back-to-match">${__("返回匹配表头")}</button>
						${(result.failed_rows || []).length ? `<button class="btn btn-default" data-action="download-preview-failed">${__("下载错误行及修改建议")}</button>` : ""}
						<button class="btn btn-primary" data-action="confirm-import" ${can_write ? "" : "disabled"}>${__("导入")}</button>
					</div>
				</div>
			</div>
		`);
	}

	function render_errors(errors, empty_message) {
		const editable = arguments.length > 2 ? arguments[2] : false;
		return errors.length
			? `<table class="table table-bordered">
				<thead><tr><th>${__("Excel 位置")}</th><th>${__("字段")}</th><th>${__("当前内容")}</th><th>${__("问题")}</th><th>${__("修改方法")}</th>${editable ? `<th>${__("操作")}</th>` : ""}</tr></thead>
				<tbody>${errors
					.map(
						(error) => `
						<tr>
							<td>${frappe.utils.escape_html(error.excel_cell || (error.row ? `${__("第")} ${error.row} ${__("行")}` : "-"))}</td>
							<td>${frappe.utils.escape_html(error.field_label || error.fieldname || "")}</td>
							<td>${frappe.utils.escape_html(error.current_value || "-")}</td>
							<td>${frappe.utils.escape_html(error.message || "")}</td>
							<td>${frappe.utils.escape_html(error.suggestion || __("请修正后重新上传。"))}</td>
							${editable && error.row && error.fieldname ? `<td><button class="btn btn-xs btn-default" data-action="edit-error-row" data-row-index="${frappe.utils.escape_html(error.row)}">${__("编辑本行")}</button></td>` : editable ? `<td>-</td>` : ""}
						</tr>`,
					)
					.join("")}</tbody>
			</table>`
			: `<div class="alert alert-success">${empty_message}</div>`;
	}

	function confirm_import() {
		const submit_import = () => frappe
			.call({
				method: "hrms.api.employee_field_template.import_employee_roster",
				args: {
					file_url: state.file.file_url,
					mode: state.mode || "insert",
					match_by: state.match_by,
					manual_mappings: JSON.stringify(state.manual_mappings || {}),
					row_overrides: JSON.stringify(state.row_overrides || {}),
				},
				freeze: true,
				freeze_message: __("正在导入..."),
			})
			.then((r) => {
				state.step = 4;
				state.import_result = r.message || {};
				render_result();
			});

		if (state.mode !== "replace") {
			submit_import();
			return;
		}

		const result = state.preview_result || {};
		frappe.confirm(
			__("将覆盖当前花名册：新增 {0} 人、更新 {1} 人，并将本表未出现的 {2} 名当前员工标记为已离职。员工档案不会删除，是否继续？", [
				result.inserted || 0,
				result.updated || 0,
				result.archived || 0,
			]),
			submit_import,
		);
	}

	function download_failed_rows(result = state.import_result) {
		const failed_rows_key = encodeURIComponent(result?.failed_rows_key || "");
		const failed_rows = encodeURIComponent(JSON.stringify(result?.failed_rows || []));
		window.open(
			frappe.urllib.get_full_url(
				`/api/method/hrms.api.employee_field_template.download_employee_roster_failed_rows?failed_rows_key=${failed_rows_key}&failed_rows=${failed_rows}`,
			),
		);
	}

	function open_error_row_editor(row_index) {
		const row_errors = (state.preview_result?.errors || []).filter(
			(error) => Number(error.row) === Number(row_index) && error.fieldname,
		);
		const unique_errors = [...new Map(row_errors.map((error) => [error.fieldname, error])).values()];
		if (!unique_errors.length) return;

		const existing_values = state.row_overrides[String(row_index)] || {};
		const dialog = new frappe.ui.Dialog({
			title: __("校正 Excel 第 {0} 行", [row_index]),
			fields: unique_errors.map((error) => ({
				fieldname: error.fieldname,
				label: `${error.excel_cell || ""} · ${error.field_label || error.fieldname}`,
				// Keep corrections as text: a Date control rejects the supported "-"
				// placeholder before the server can interpret it as "fill in later".
				fieldtype: "Data",
				default: existing_values[error.fieldname] ?? error.current_value ?? "",
				description: `${error.suggestion || ""}${_can_defer_field(error.fieldname) ? `<br>${__("暂不填写时可输入“-”，系统将保留为空，之后可在员工档案补充。")}` : ""}`,
				reqd: error.message === __("必填字段为空"),
			})),
			primary_action_label: __("保存并重新校验"),
			primary_action(values) {
				state.row_overrides[String(row_index)] = {
					...existing_values,
					...values,
				};
				dialog.hide();
				request_preview();
			},
		});
		dialog.show();
	}

	function _can_defer_field(fieldname) {
		return !["custom_employee_code", "first_name", "employee_name", "department", "date_of_joining", "designation"].includes(fieldname);
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
						${state.mode === "replace" ? `<div><span>${__("标记已离职")}</span><strong>${frappe.utils.escape_html(result.archived || 0)}</strong></div>` : ""}
						<div><span>${__("跳过")}</span><strong>${frappe.utils.escape_html(result.skipped || 0)}</strong></div>
						<div><span>${__("失败")}</span><strong>${frappe.utils.escape_html(result.failed || 0)}</strong></div>
					</div>
					<div class="hrms-import-base-records">
						<h4>${__("自动补齐的基础资料")}</h4>
						<p>${__("性别")}：${frappe.utils.escape_html(base_records["性别"] || 0)}　${__("部门")}：${frappe.utils.escape_html(base_records["部门"] || 0)}　${__("岗位")}：${frappe.utils.escape_html(base_records["岗位"] || 0)}　${__("工作性质")}：${frappe.utils.escape_html(base_records["工作性质"] || 0)}</p>
					</div>
					${render_warnings(warnings)}
					${
						errors.length
							? render_errors(errors, __("导入完成，没有发现行级错误。"))
							: `<div class="alert alert-success">${__("导入完成，没有发现行级错误。")}</div>`
					}
					<div class="hrms-import-actions">
						<button class="btn btn-default" data-action="restart">${__("继续导入其他花名册")}</button>
						${result.failed ? `<button class="btn btn-default" data-action="back-to-upload">${__("重新上传文件")}</button>` : ""}
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
				const request_id = ++state.request_id;
				frappe
					.call("hrms.api.employee_field_template.parse_employee_roster_file", {
						file_url: file.file_url,
					})
					.then((r) => {
					if (request_id !== state.request_id || state.file?.file_url !== file.file_url) return;
					state.step = 2;
					state.row_overrides = {};
						state.parse_result = r.message;
						render_match();
					});
			},
		});
	}

	function return_to_upload() {
		// Clear the previous file and invalidate any in-flight request so a newly
		// selected workbook always becomes the source for subsequent validation.
		state.request_id += 1;
		state.step = 1;
		state.file = null;
		state.parse_result = null;
		state.preview_result = null;
		state.import_result = null;
		state.manual_mappings = {};
		state.row_overrides = {};
		render_upload();
	}

	function go_back() {
		if (state.step === 2) {
			return_to_upload();
			return;
		}
		if (state.step === 3) {
			state.step = 2;
			render_match();
			return;
		}
		if (state.step === 4 && state.preview_result) {
			state.step = 3;
			render_preview();
			return;
		}
		if (state.mode) {
			state.mode = "";
			state.step = 1;
			render_landing();
			return;
		}
		frappe.set_route("List", "Employee");
	}

	$(page.body).on("change", "[data-match-by]", function () {
		state.match_by = this.value;
	});

	$(page.body).on("click", "[data-action]", function () {
		const action = this.dataset.action;
		if (["start-insert", "start-update", "start-replace"].includes(action)) {
			state.mode = { "start-insert": "insert", "start-update": "update", "start-replace": "replace" }[action];
			state.step = 1;
			render_upload();
		}
		if (action === "upload") open_uploader();
		if (action === "back-to-upload") return_to_upload();
		if (action === "download-template") download_template();
		if (action === "records") frappe.set_route("List", "Employee");
		if (action === "back-to-match") {
			state.step = 2;
			render_match();
		}
		if (action === "confirm-import") confirm_import();
		if (action === "edit-error-row") open_error_row_editor(this.dataset.rowIndex);
		if (action === "download-preview-failed") download_failed_rows(state.preview_result);
		if (action === "download-failed") download_failed_rows();
		if (action === "restart") {
			// A cached Page keeps the previous mode. Return to the landing page so
			// the next file can explicitly be imported as an addition or an update.
			state.mode = "";
			state.step = 1;
			state.match_by = "employee_code";
			state.parse_result = null;
			state.preview_result = null;
			state.import_result = null;
			state.manual_mappings = {};
			state.row_overrides = {};
			state.file = null;
			render_landing();
		}
		if (action === "open-employee-list") frappe.set_route("List", "Employee");
	});

	$(page.body).on("click", "[data-route]", function () {
		frappe.set_route(this.dataset.route);
	});

	function refresh() {
		if (state.step === 2 && state.parse_result) return render_match();
		if (state.step === 3 && state.preview_result) return render_preview();
		if (state.step === 4 && state.import_result) return render_result();
		if (state.mode) return render_upload();
		render_landing();
	}

	wrapper.employee_roster_import = { refresh };
	refresh();
};

frappe.pages["employee-roster-import"].on_page_show = function (wrapper) {
	wrapper.employee_roster_import?.refresh();
};
