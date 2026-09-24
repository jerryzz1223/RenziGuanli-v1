(() => {
	const routes = {
		plans: ["List", "Training Program"],
		events: ["List", "Training Event"],
		results: ["List", "Training Result"],
		feedback: ["List", "Training Feedback"],
		skills: ["List", "Employee Skill Map"],
	};

	const escape = (value) => frappe.utils.escape_html(String(value ?? ""));
	const number = (value) => escape(value || 0);
	const route = (key) => frappe.set_route(...routes[key]);
	const importApi = "hrms.api.training_import";
	const workflowApi = "hrms.api.training_learning";
	const currentCompany = () => window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	let importState = { company: "", active_type: "", plan_file_url: "", record_file_url: "", preview: null };
	const planTableState = { status: "全部", department: "", person: "", personInput: "", trainingType: "", month: "", query: "", sort: "department", direction: "asc", page: 1, pageSize: 25 };

	function get_import_state(company) {
		if (importState.company !== company) importState = { company, active_type: "", plan_file_url: "", record_file_url: "", preview: null };
		return importState;
	}

	function new_training_program(reload) {
		if (!window.hrmsCapabilities?.require("training_submit")) return;
		const company = currentCompany();
		if (!company) return frappe.msgprint(__("请先在页面顶部选择当前公司。"));
		const dialog = new frappe.ui.Dialog({
			title: __("创建计划课程"),
			size: "large",
			fields: [
				{ fieldtype: "HTML", fieldname: "guide", options: `<div class="hrms-training-workflow-guide"><b>01</b><div><strong>${__("先建立课程，再安排实际上课")}</strong><span>${__("这里使用现有培训计划字段；Excel 导入仍保留为批量建课入口。")}</span></div></div>` },
				{ fieldtype: "Data", fieldname: "course_name", label: __("课程名称"), reqd: 1 },
				{ fieldtype: "Link", fieldname: "owner_department", label: __("归属部门"), options: "Department", get_query: () => ({ filters: { company } }) },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Data", fieldname: "plan_period", label: __("计划期间"), default: String(new Date().getFullYear()) },
				{ fieldtype: "Data", fieldname: "planned_month", label: __("计划月份"), placeholder: __("例如：2026-10") },
				{ fieldtype: "Section Break", label: __("课程要求") },
				{ fieldtype: "Select", fieldname: "training_category", label: __("培训类别"), options: "内部培训\n外部培训\n安全教育\n特种作业\n新员工培训\n职业健康\n岗位资格", reqd: 1 },
				{ fieldtype: "Select", fieldname: "training_mode", label: __("培训方式"), options: "内部\n外部\n线上\n自主学习\n混合", reqd: 1 },
				{ fieldtype: "Float", fieldname: "planned_hours", label: __("计划课时") },
				{ fieldtype: "Check", fieldname: "is_mandatory", label: __("必修培训") },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Data", fieldname: "trainer_name", label: __("讲师 / 召集人") },
				{ fieldtype: "Data", fieldname: "planned_location", label: __("计划地点") },
				{ fieldtype: "Small Text", fieldname: "target_audience", label: __("培训对象 / 岗位") },
				{ fieldtype: "Section Break" },
				{ fieldtype: "Small Text", fieldname: "objective", label: __("培训目标与达成标准"), reqd: 1 },
				{ fieldtype: "Text Editor", fieldname: "description", label: __("课程说明") },
			],
			primary_action_label: __("创建课程"),
			primary_action(values) {
				frappe.call({ method: `${workflowApi}.create_training_course`, args: { payload: JSON.stringify({ ...values, company }) }, freeze: true, freeze_message: __("正在创建课程…") }).then(({ message }) => {
					dialog.hide();
					frappe.show_alert({ message: __("课程已创建：{0}", [message?.name || values.course_name]), indicator: "green" });
					reload?.();
				});
			},
		});
		dialog.show();
	}

	function schedule_training_activity(reload, program = "", on_saved = null) {
		if (!window.hrmsCapabilities?.require("training_submit")) return;
		const company = currentCompany();
		if (!company) return frappe.msgprint(__("请先在页面顶部选择当前公司。"));
		const participantState = { participants: [], results: [], issues: [], importedFile: "" };
		const dialog = new frappe.ui.Dialog({
			title: __("安排实际上课"), size: "large",
			fields: [
				{ fieldtype: "HTML", fieldname: "guide", options: `<div class="hrms-training-workflow-guide"><b>02</b><div><strong>${__("安排实际上课并选择员工")}</strong><span>${__("可按公司工号或姓名逐人添加，也可用基础模板批量导入；学时和成绩可后补。")}</span></div></div>` },
				{ fieldtype: "Link", fieldname: "training_program", label: __("计划课程"), options: "Training Program", reqd: 1, default: program, get_query: () => ({ filters: { company } }) },
				{ fieldtype: "Data", fieldname: "course", label: __("实际上课名称") },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Select", fieldname: "type", label: __("授课形式"), options: "Theory\nSeminar\nWorkshop\nConference\nExam\nInternet\nSelf-Study", default: "Theory", reqd: 1 },
				{ fieldtype: "Data", fieldname: "delivery_method", label: __("授课 / 课件方式") },
				{ fieldtype: "Section Break", label: __("时间与地点") },
				{ fieldtype: "Datetime", fieldname: "start_time", label: __("开始时间"), reqd: 1 },
				{ fieldtype: "Datetime", fieldname: "end_time", label: __("结束时间"), reqd: 1 },
				{ fieldtype: "Data", fieldname: "location", label: __("地点"), reqd: 1 },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Link", fieldname: "owner_department", label: __("课程归属部门"), options: "Department", get_query: () => ({ filters: { company } }) },
				{ fieldtype: "Data", fieldname: "trainer_name", label: __("授课人") },
				{ fieldtype: "Small Text", fieldname: "target_audience", label: __("培训对象 / 岗位") },
				{ fieldtype: "Section Break", label: __("考核与复训") },
				{ fieldtype: "Check", fieldname: "assessment_required", label: __("需要考核") },
				{ fieldtype: "Float", fieldname: "passing_score", label: __("合格分数"), depends_on: "assessment_required" },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Date", fieldname: "retraining_due_on", label: __("复训截止日期") },
				{ fieldtype: "Select", fieldname: "qualification_gate", label: __("资格用途"), options: "\n无\n转正前必修\n晋升前必修\n上岗前必修\n证书复训" },
				{ fieldtype: "Section Break" },
				{ fieldtype: "Small Text", fieldname: "introduction", label: __("备注（选填）") },
				{ fieldtype: "Section Break", label: __("参训员工（可后补）") },
				{ fieldtype: "HTML", fieldname: "participant_picker" },
			],
			primary_action_label: __("保存上课安排"),
			primary_action(values) {
				collectParticipants();
				frappe.call({ method: `${workflowApi}.create_training_activity`, args: { payload: JSON.stringify({ ...values, company, participants: participantState.participants }) }, freeze: true, freeze_message: __("正在建立培训活动…") }).then(({ message }) => {
					dialog.hide();
					frappe.show_alert({ message: participantState.participants.length ? __("上课场次及参训名单已保存。") : __("上课场次已创建，可稍后补充参训员工。"), indicator: "green" });
					if (on_saved) on_saved(message);
					else reload?.();
				});
			},
		});

		const picker = () => dialog.fields_dict.participant_picker.$wrapper;
		function collectParticipants() {
			participantState.participants = [...picker().find("[data-schedule-participant]")].map((row) => ({
				employee: row.dataset.employee,
				employee_code: row.dataset.employeeCode,
				employee_name: row.dataset.employeeName,
				department: row.dataset.department,
				attendance: row.dataset.attendance || "Present",
				hours: row.querySelector("[data-schedule-hours]")?.value ?? "",
				score: row.querySelector("[data-schedule-score]")?.value ?? "",
				grade: row.dataset.grade || "",
				needs_retraining: Number(row.dataset.needsRetraining || 0),
				comments: row.dataset.comments || "",
			}));
		}

		function mergeParticipants(rows) {
			collectParticipants();
			const existing = new Set(participantState.participants.map((row) => row.employee_code));
			for (const row of rows) {
				if (!existing.has(row.employee_code)) {
					participantState.participants.push({ ...row, hours: row.hours ?? "", score: row.score ?? "" });
					existing.add(row.employee_code);
				}
			}
			renderParticipants();
		}

		function renderParticipants() {
			const rows = participantState.participants.map((row, index) => `<tr data-schedule-participant data-employee="${escape(row.employee)}" data-employee-code="${escape(row.employee_code)}" data-employee-name="${escape(row.employee_name)}" data-department="${escape(row.department || "")}" data-attendance="${escape(row.attendance || "Present")}" data-grade="${escape(row.grade || "")}" data-needs-retraining="${row.needs_retraining ? 1 : 0}" data-comments="${escape(row.comments || "")}"><td><strong>${escape(row.employee_code)}</strong></td><td>${escape(row.employee_name)}</td><td>${escape(row.department || "—")}</td><td><input class="form-control input-sm" inputmode="decimal" data-schedule-hours value="${escape(row.hours ?? "")}" placeholder="${__("可后补")}"></td><td><input class="form-control input-sm" inputmode="decimal" data-schedule-score value="${escape(row.score ?? "")}" placeholder="${__("可后补")}"></td><td><button type="button" class="btn btn-xs btn-default" data-schedule-remove="${index}">${__("移除")}</button></td></tr>`).join("");
			const results = participantState.results.map((row, index) => `<button type="button" class="hrms-training-employee-result" data-schedule-add="${index}"><strong>${escape(row.employee_code)}</strong><span>${escape(row.employee_name)}</span><small>${escape(row.department || __("未分配部门"))}</small></button>`).join("");
			const issueSummary = participantState.issues.length ? `<div class="hrms-training-roster-import-issues"><strong>${__("有 {0} 行未匹配", [participantState.issues.length])}</strong>${participantState.issues.slice(0, 5).map((item) => `<span>${escape(__("第 {0} 行：{1} {2}", [item.row_number, item.employee_code || item.employee_name || "—", item.reason]))}</span>`).join("")}</div>` : "";
			picker().html(`<div class="hrms-training-schedule-roster"><div class="hrms-training-schedule-roster-tools"><div><button type="button" class="btn btn-default btn-sm" data-schedule-template>${__("下载基础模板")}</button><button type="button" class="btn btn-default btn-sm" data-schedule-import>${__("导入参训名单")}</button></div><span>${__("已添加 {0} 人", [participantState.participants.length])}</span></div><div class="hrms-training-employee-search"><input class="form-control" data-schedule-search placeholder="${__("输入公司工号或姓名")}"><button type="button" class="btn btn-primary" data-schedule-search-button>${__("搜索并添加")}</button></div><div class="hrms-training-employee-results">${results}</div>${issueSummary}<div class="table-responsive hrms-training-roster-table"><table class="table"><thead><tr><th>${__("公司工号")}</th><th>${__("姓名")}</th><th>${__("部门")}</th><th>${__("学时")}</th><th>${__("成绩")}</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="6"><div class="hrms-training-empty">${__("可现在添加员工，也可先保存上课安排后再补充")}</div></td></tr>`}</tbody></table></div></div>`);
		}

		function searchParticipants() {
			const query = picker().find("[data-schedule-search]").val()?.trim() || "";
			if (!query) return frappe.msgprint(__("请输入公司工号或姓名。"));
			frappe.call({ method: `${workflowApi}.find_training_employees`, args: { company, query, limit: 20 } }).then(({ message = [] }) => {
				participantState.results = message;
				renderParticipants();
			});
		}

		function importParticipants() {
			new frappe.ui.FileUploader({
				folder: "Home/Attachments", allow_multiple: false, make_attachments_public: false,
				disable_file_browser: true, allow_web_link: false, allow_take_photo: false,
				allow_toggle_private: false, restrictions: { allowed_file_types: [".xlsx"] },
				on_success(file) {
					participantState.importedFile = file.file_url;
					frappe.call({ method: `${workflowApi}.preview_training_roster_import`, args: { file_url: file.file_url, company }, freeze: true, freeze_message: __("正在匹配参训员工…") }).then(({ message = {} }) => {
						participantState.issues = message.issues || [];
						mergeParticipants(message.participants || []);
						frappe.show_alert({ message: __("已匹配并添加 {0} 人，未匹配 {1} 行。", [message.matched_count || 0, participantState.issues.length]), indicator: participantState.issues.length ? "orange" : "green" });
					});
				},
			});
		}

		dialog.show();
		renderParticipants();
		picker().off("click.trainingSchedule").on("click.trainingSchedule", "[data-schedule-search-button]", searchParticipants).on("click.trainingSchedule", "[data-schedule-template]", () => window.open(frappe.urllib.get_full_url(`/api/method/${workflowApi}.download_training_roster_template`), "_blank")).on("click.trainingSchedule", "[data-schedule-import]", importParticipants).on("click.trainingSchedule", "[data-schedule-add]", function () { mergeParticipants([participantState.results[Number(this.dataset.scheduleAdd)]]); participantState.results = []; renderParticipants(); }).on("click.trainingSchedule", "[data-schedule-remove]", function () { collectParticipants(); participantState.participants.splice(Number(this.dataset.scheduleRemove), 1); renderParticipants(); });
		picker().off("keydown.trainingSchedule").on("keydown.trainingSchedule", "[data-schedule-search]", (event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); searchParticipants(); } });
	}

	function open_training_import(reload) {
		if (!window.hrmsCapabilities?.require("training_submit")) return;
		const company = currentCompany();
		if (!company) return frappe.msgprint(__("请先在页面顶部选择当前公司。"));
		const state = get_import_state(company);
		const dialog = new frappe.ui.Dialog({
			title: __("计划课程 / 实际上课分开导入"),
			size: "extra-large",
			fields: [{ fieldtype: "HTML", fieldname: "training_import_body" }],
		});

		const unresolved = () => (state.preview?.identities || []).filter((item) => item.status !== "matched");
		const statusLabel = {
			department_mismatch: __("部门不一致"),
			ambiguous: __("存在同名候选"),
			unmatched: __("主档未找到"),
			missing_code: __("缺少公司工号"),
		};

		function upload(kind) {
			new frappe.ui.FileUploader({
				folder: "Home/Attachments",
				allow_multiple: false,
				make_attachments_public: false,
				disable_file_browser: true,
				allow_web_link: false,
				allow_take_photo: false,
				allow_toggle_private: false,
				restrictions: { allowed_file_types: [".xlsx"] },
				on_success(file) {
					state[kind] = file.file_url;
					state.active_type = kind === "plan_file_url" ? "plan" : "records";
					state.preview = null;
					render();
					reload?.();
					preview(state.active_type);
				},
			});
		}

		function clearSelection() {
			state.plan_file_url = "";
			state.record_file_url = "";
			state.preview = null;
			render();
			reload?.();
		}

		function preview(type = state.active_type) {
			state.active_type = type;
			const isPlan = type === "plan";
			frappe.call({
				method: `${importApi}.${isPlan ? "preview_training_plan" : "preview_training_records"}`,
				args: isPlan ? { plan_file_url: state.plan_file_url, company } : { record_file_url: state.record_file_url, company },
				freeze: true,
				freeze_message: isPlan ? __("正在读取年度计划课程…") : __("正在匹配实际上课、现有课程和员工公司工号…"),
			}).then((response) => {
				state.preview = response.message || {};
				render();
				reload?.();
			});
		}

		function identityRows() {
			return unresolved().map((item) => {
				const candidates = (item.candidates || []).filter((candidate) => candidate.employee_code);
				const candidateControl = candidates.length
					? `<select class="form-control input-sm" data-training-identity="${escape(item.identity_key)}"><option value="">${escape(__("请选择候选员工"))}</option>${candidates.map((candidate) => `<option value="${escape(candidate.employee_code)}">${escape([candidate.employee_code, candidate.employee_name, candidate.department, candidate.status, candidate.date_of_joining ? `${candidate.date_of_joining} 入职` : "", candidate.relieving_date ? `${candidate.relieving_date} 离职` : ""].filter(Boolean).join(" · "))}</option>`).join("")}</select>`
					: `<input class="form-control input-sm" data-training-identity="${escape(item.identity_key)}" value="" placeholder="${escape(__("输入当前公司工号"))}">`;
				const searchText = [item.employee_name, item.source_department, statusLabel[item.status], ...candidates.map((candidate) => candidate.employee_code)].join(" ").toLowerCase();
				return `<tr data-training-match-row data-status="${escape(item.status)}" data-search="${escape(searchText)}"><td><strong>${escape(item.employee_name)}</strong><small>${escape(__("来源部门：{0}", [item.source_department]))}</small></td><td>${escape(item.record_count)}</td><td><span class="hrms-training-match-status ${escape(item.status)}">${escape(statusLabel[item.status] || item.status)}</span></td><td>${candidateControl}</td><td>${candidates.length ? escape(candidates.map((candidate) => candidate.department || __("无部门")).join("；")) : `<span class="text-muted">${escape(__("请根据原表姓名核对工号"))}</span>`}</td></tr>`;
			}).join("");
		}

		function updateMatchProgress() {
			const inputs = dialog.$wrapper.find("[data-training-identity]");
			const completed = inputs.toArray().filter((input) => input.value.trim()).length;
			const sourceErrors = (state.preview?.plan?.error_count || 0) + (state.preview?.records?.error_count || 0);
			const pending = inputs.length - completed;
			dialog.$wrapper.find("[data-training-match-progress]").text(__("已确认 {0} / {1} 组", [completed, inputs.length]));
			dialog.$wrapper.find("[data-training-progress-fill]").css("width", `${inputs.length ? Math.round(completed / inputs.length * 100) : 100}%`);
			dialog.get_primary_btn()
				.prop("disabled", Boolean(sourceErrors || pending))
				.attr("title", pending ? __("请先完成剩余 {0} 组员工公司工号匹配。", [pending]) : "");
		}

		function bindMatchingTools() {
			const wrapper = dialog.$wrapper;
			wrapper.find("[data-training-identity]").on("change input", updateMatchProgress);
			wrapper.find("[data-training-match-search], [data-training-match-filter]").on("input change", () => {
				const query = String(wrapper.find("[data-training-match-search]").val() || "").trim().toLowerCase();
				const filter = wrapper.find("[data-training-match-filter]").val() || "";
				wrapper.find("[data-training-match-row]").each((_index, row) => {
					const matchesQuery = !query || String(row.dataset.search || "").includes(query);
					const matchesFilter = !filter || row.dataset.status === filter;
					row.hidden = !(matchesQuery && matchesFilter);
				});
			});
			wrapper.find("[data-training-reselect]").on("click", () => {
				if (state.active_type === "records") state.record_file_url = "";
				else state.plan_file_url = "";
				state.preview = null;
				state.active_type = "";
				render();
				reload?.();
			});
			updateMatchProgress();
		}

		function importData() {
			if (state.preview?.import_type === "plan") {
				return frappe.confirm(
					__("将建立或更新 {0} 条年度计划课程，不会写入实际上课明细。是否继续？", [state.preview.plan.row_count]),
					() => frappe.call({
						method: `${importApi}.import_training_plan`,
						args: { plan_file_url: state.plan_file_url, company, plan_token: state.preview.plan_token, confirm_import: 1 },
						freeze: true,
						freeze_message: __("正在建立年度计划课程…"),
					}).then(({ message: result = {} }) => {
						state.plan_file_url = ""; state.preview = null; state.active_type = "";
						dialog.hide();
						frappe.msgprint({ title: __("计划课程导入完成"), indicator: "green", message: `${escape(result.message || "")}<br>${escape(__("新增 {0}，更新草稿 {1}，保留已审批 {2}。", [result.programs_created || 0, result.programs_updated || 0, result.programs_locked || 0]))}` });
						reload?.();
					}),
				);
			}
			const identity_map = {};
			dialog.$wrapper.find("[data-training-identity]").each((_index, input) => {
				identity_map[input.dataset.trainingIdentity] = input.value.trim();
			});
			const missing = Object.entries(identity_map).filter(([, value]) => !value);
			if (missing.length) return frappe.msgprint(__("仍有 {0} 组姓名/部门没有填写公司工号，不能导入。", [missing.length]));
			frappe.confirm(
				__("将导入 {0} 场实际上课和 {1} 条逐人明细；无已建课程的 {2} 场将自动建立临时课程。是否继续？", [state.preview.records.event_count, state.preview.records.row_count, state.preview.course_match_summary?.temporary || 0]),
				() => frappe.call({
					method: `${importApi}.import_training_records`,
					args: {
						record_file_url: state.record_file_url,
						company,
						plan_token: state.preview.plan_token,
						identity_map: JSON.stringify(identity_map),
						confirm_import: 1,
					},
					freeze: true,
					freeze_message: __("正在写入实际明细、匹配课程并补建临时课程…"),
				}).then((response) => {
					const result = response.message || {};
					state.record_file_url = ""; state.preview = null; state.active_type = "";
					dialog.hide();
					frappe.msgprint({
						title: __("实际上课导入完成"),
						indicator: "green",
						message: `${escape(result.message || "")}<br>${escape(__("新增实际上课 {0}，结果草稿 {1}，自动补建临时课程 {2}。", [result.events_created || 0, result.results_created_as_draft || 0, result.temporary_programs_created || 0]))}`,
					});
					reload?.();
				}),
			);
		}

		function render() {
			const body = dialog.fields_dict.training_import_body.$wrapper;
			if (!state.preview) {
				body.html(`<div class="hrms-training-import"><div class="hrms-training-import-steps"><span class="active"><b>1</b>${escape(__("选择一类原表"))}</span><span><b>2</b>${escape(__("独立校验"))}</span><span><b>3</b>${escape(__("课程处理"))}</span><span><b>4</b>${escape(__("确认入库"))}</span></div><div class="hrms-training-import-note"><strong>${escape(__("当前公司：{0}", [company]))}</strong><span>${escape(__("两张表可分开提交：计划表只建课；登记表只导入实际上课，并在无已建课程时自动补建临时课程。"))}</span></div><div class="hrms-training-upload-grid"><button class="hrms-training-upload-card ${state.plan_file_url ? "selected" : ""}" data-upload-plan><span>01</span><strong>${escape(__("年度教育训练计划"))}</strong><small>${escape(state.plan_file_url || __("上传后独立建立计划课程"))}</small><i>${state.plan_file_url ? "✓" : "+"}</i></button><button class="hrms-training-upload-card ${state.record_file_url ? "selected" : ""}" data-upload-record><span>02</span><strong>${escape(__("教育训练登记表"))}</strong><small>${escape(state.record_file_url || __("上传后独立匹配实际上课"))}</small><i>${state.record_file_url ? "✓" : "+"}</i></button></div>${state.plan_file_url || state.record_file_url ? `<div class="text-right"><button class="btn btn-link text-danger" data-training-clear>${escape(__("清除已选文件"))}</button></div>` : ""}</div>`);
				body.find("[data-upload-plan]").on("click", () => upload("plan_file_url"));
				body.find("[data-upload-record]").on("click", () => upload("record_file_url"));
				body.find("[data-training-clear]").on("click", clearSelection);
				dialog.set_primary_action(state.active_type === "plan" ? __("校验计划表") : __("校验登记表"), () => preview(state.active_type));
				dialog.get_primary_btn().prop("disabled", !state.active_type).attr("title", "");
				return;
			}
			if (state.preview.import_type === "plan") {
				const plan = state.preview.plan || {};
				body.html(`<div class="hrms-training-import"><div class="hrms-training-import-steps"><span class="done"><b>✓</b>${escape(__("选择计划表"))}</span><span class="done"><b>✓</b>${escape(__("独立校验"))}</span><span class="active"><b>3</b>${escape(__("确认建课"))}</span></div><div class="hrms-training-import-summary"><div><span>${escape(__("计划课程"))}</span><strong>${number(plan.planned_count)}</strong><small>${escape(__("共 {0} 行", [plan.row_count || 0]))}</small></div><div><span>${escape(__("原表工作表"))}</span><strong>${escape(plan.sheet_name || "—")}</strong><small>${escape(__("按表头结构识别"))}</small></div><div class="${plan.error_count ? "warning" : "success"}"><span>${escape(__("数据错误"))}</span><strong>${number(plan.error_count)}</strong><small>${escape(plan.error_count ? __("需先修正原表") : __("可独立导入"))}</small></div></div><div class="hrms-training-match-complete"><span>✓</span><div><strong>${escape(__("本次只建立计划课程"))}</strong><p>${escape(__("不会要求登记表，也不会创建实际上课或参训结果。"))}</p></div></div><div class="text-right"><button class="btn btn-default" data-training-reselect>${escape(__("重新选择计划表"))}</button></div></div>`);
				dialog.set_primary_action(__("确认建立计划课程"), importData);
				dialog.get_primary_btn().prop("disabled", Boolean(plan.error_count));
				body.find("[data-training-reselect]").on("click", () => { state.plan_file_url = ""; state.preview = null; state.active_type = ""; render(); });
				return;
			}
			const sourceErrors = (state.preview.plan?.error_count || 0) + (state.preview.records?.error_count || 0);
			const unresolvedIdentities = unresolved().length;
			const periodMatched = (state.preview.identities || []).filter((item) => item.match_basis === "employment_period").reduce((total, item) => total + item.record_count, 0);
			const automaticMatched = state.preview.records.row_count - state.preview.unresolved_record_count;
			const strictMatched = automaticMatched - periodMatched;
			const courseSummary = state.preview.course_match_summary || {};
			body.html(`<div class="hrms-training-import"><div class="hrms-training-import-steps"><span class="done"><b>✓</b>${escape(__("选择登记表"))}</span><span class="done"><b>✓</b>${escape(__("独立校验"))}</span><span class="done"><b>✓</b>${escape(__("课程匹配"))}</span><span class="active"><b>4</b>${escape(__("员工匹配与入库"))}</span></div><div class="hrms-training-import-summary"><div><span>${escape(__("实际上课"))}</span><strong>${number(state.preview.records.event_count)}</strong><small>${escape(__("{0} 条逐人明细", [state.preview.records.row_count]))}</small></div><div class="success"><span>${escape(__("匹配已建课程"))}</span><strong>${number((courseSummary.matched_planned || 0) + (courseSummary.matched_temporary || 0))}</strong><small>${escape(__("按名称、部门、月份、方式和课时"))}</small></div><div><span>${escape(__("自动补建课程"))}</span><strong>${number(courseSummary.temporary)}</strong><small>${escape(__("无已建课程时创建临时课程"))}</small></div><div class="warning"><span>${escape(__("课程待确认"))}</span><strong>${number(courseSummary.review)}</strong><small>${escape(__("有相似课程，避免自动重复建课"))}</small></div><div class="success"><span>${escape(__("员工已匹配"))}</span><strong>${number(automaticMatched)}</strong><small>${escape(__("姓名部门 {0} / 任职期间 {1}", [strictMatched, periodMatched]))}</small></div></div>${sourceErrors ? `<div class="alert alert-danger">${escape(__("原表存在 {0} 条结构或数据错误，需先修正。", [sourceErrors]))}</div>` : ""}${unresolvedIdentities ? `<div class="hrms-training-match-heading"><div><h5>${escape(__("员工公司工号匹配"))}</h5><p>${escape(__("只显示未能自动唯一匹配的记录；必须逐组确认，不使用 Frappe 员工编号。"))}</p></div><div class="hrms-training-match-progress"><strong data-training-match-progress></strong><span><i data-training-progress-fill></i></span></div></div><div class="hrms-training-match-toolbar"><input class="form-control" data-training-match-search placeholder="${escape(__("搜索姓名、部门或公司工号"))}"><select class="form-control" data-training-match-filter><option value="">${escape(__("全部差异"))}</option><option value="department_mismatch">${escape(statusLabel.department_mismatch)}</option><option value="ambiguous">${escape(statusLabel.ambiguous)}</option><option value="unmatched">${escape(statusLabel.unmatched)}</option><option value="missing_code">${escape(statusLabel.missing_code)}</option></select><button class="btn btn-default" data-training-reselect>${escape(__("重新选择登记表"))}</button></div><div class="table-responsive hrms-training-identity-table"><table class="table table-bordered table-sm"><thead><tr><th>${escape(__("来源人员"))}</th><th>${escape(__("记录数"))}</th><th>${escape(__("差异类型"))}</th><th>${escape(__("公司工号 / 候选员工"))}</th><th>${escape(__("当前主档部门"))}</th></tr></thead><tbody>${identityRows()}</tbody></table></div>` : `<div class="hrms-training-match-complete"><span>✓</span><div><strong>${escape(__("员工匹配已全部完成"))}</strong><p>${escape(__("所有逐人培训记录均已匹配当前公司的公司工号。"))}</p></div></div>`}</div>`);
			dialog.set_primary_action(unresolvedIdentities ? __("确认匹配并导入") : __("确认导入"), importData);
			dialog.get_primary_btn().prop("disabled", Boolean(sourceErrors));
			bindMatchingTools();
		}

		dialog.show();
		render();
	}

	function event_time(value) {
		return value ? frappe.datetime.str_to_user(value) : __("待安排");
	}

	function ensure_dashboard(listview) {
		const main = listview.page.main?.[0];
		if (!main) return null;
		let workspace = main.querySelector(".hrms-training-learning-workspace");
		if (!workspace) {
			workspace = document.createElement("section");
			workspace.className = "hrms-training-learning-workspace";
			main.prepend(workspace);
		}
		Array.from(main.children).forEach((child) => {
			child.classList.toggle("hrms-training-native-list-hidden", child !== workspace);
		});
		document.body.classList.add("hrms-training-learning-view");
		return workspace;
	}

	function compare_plan_rows(left, right) {
		const key = planTableState.sort;
		const leftValue = key === "actual" ? (left.actual_dates || "") : key === "events" ? Number(left.event_count || 0) : String(left[key] || "");
		const rightValue = key === "actual" ? (right.actual_dates || "") : key === "events" ? Number(right.event_count || 0) : String(right[key] || "");
		const result = typeof leftValue === "number" ? leftValue - rightValue : leftValue.localeCompare(rightValue, "zh-CN", { numeric: true });
		return planTableState.direction === "desc" ? -result : result;
	}

	function department_matches_filter(value, filter) {
		const normalize = (department) => String(department || "")
			.replace(/\s+/g, "")
			.toLowerCase()
			.replace(/办公室$/, "办")
			.replace(/[课组室]$/, "");
		const normalizedValue = normalize(value);
		const normalizedFilter = normalize(filter);
		if (!normalizedFilter) return true;
		return normalizedValue === normalizedFilter;
	}

	function plan_table_rows(rows) {
		const query = planTableState.query.trim().toLowerCase();
		const person = planTableState.person.trim().toLowerCase();
		return rows.filter((row) => {
			const haystack = [row.status, row.course, row.actual_courses, row.department, row.classification, row.training_type, row.training_mode, row.convener, row.convener_department, row.location, row.target, row.planned_month, row.actual_dates, row.match_basis].join(" ").toLowerCase();
			const people = [row.convener, row.target].join(" ").toLowerCase();
			return (!query || haystack.includes(query))
				&& (!person || people.includes(person))
				&& (planTableState.status === "全部" || row.status === planTableState.status)
				&& department_matches_filter(row.department, planTableState.department)
				&& (!planTableState.trainingType || row.training_type === planTableState.trainingType)
				&& (!planTableState.month || row.planned_month === planTableState.month);
		}).sort(compare_plan_rows);
	}

	function filter_options(rows, key, label) {
		const values = [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "zh-CN", { numeric: true }));
		const stateKey = key === "training_type" ? "trainingType" : key === "planned_month" ? "month" : key;
		return `<option value="">${escape(label)}</option>${values.map((value) => `<option value="${escape(value)}" ${planTableState[stateKey] === value ? "selected" : ""}>${escape(value)}</option>`).join("")}`;
	}

	function sort_header(label, key) {
		const active = planTableState.sort === key;
		return `<button class="hrms-training-sort ${active ? "active" : ""}" data-training-sort="${escape(key)}">${escape(label)}<span>${active ? (planTableState.direction === "asc" ? "↑" : "↓") : "↕"}</span></button>`;
	}

	function plan_management_html(management = {}, loading = false) {
		const rows = management.rows || [];
		if (loading) return `<div class="hrms-training-panel hrms-training-plan-panel"><div class="hrms-training-empty">${__("正在核对计划与实际上课…")}</div></div>`;
		const statuses = ["全部", "已实施", "待实施", "待确认", "临时新增", "临时课程"];
		const filtered = plan_table_rows(rows);
		const totalPages = Math.max(1, Math.ceil(filtered.length / planTableState.pageSize));
		planTableState.page = Math.min(planTableState.page, totalPages);
		const start = (planTableState.page - 1) * planTableState.pageSize;
		const visible = filtered.slice(start, start + planTableState.pageSize);
		const body = visible.map((row, index) => {
			const actualDetail = row.actual_courses && row.actual_courses !== row.course ? `<small>${escape(__("实际：{0}", [row.actual_courses]))}</small>` : "";
			return `<tr><td class="sticky-status"><span class="hrms-training-plan-status status-${escape(row.status)}">${escape(row.status)}</span></td><td class="sticky-course"><button type="button" class="hrms-training-course-link" data-training-open-detail="${escape(index)}">${escape(row.course || __("未命名课程"))}</button>${actualDetail}</td><td>${escape(row.department || "—")}</td><td>${escape(row.classification || "—")}</td><td>${escape(row.training_type || "—")}</td><td>${escape(row.training_mode || "—")}</td><td>${escape(row.course_hours ?? "—")}</td><td>${escape(row.convener || "—")}</td><td>${escape(row.convener_department || "—")}</td><td>${escape(row.location || "—")}</td><td class="target-cell">${escape(row.target || "—")}</td><td>${escape(row.planned_month || "—")}</td><td class="actual-cell"><strong>${escape(row.actual_dates || "—")}</strong><small>${escape(__("{0} 场 / {1} 人次", [row.event_count || 0, row.participant_count || 0]))}</small></td></tr>`;
		}).join("");
		return `<div class="hrms-training-panel hrms-training-plan-panel" data-training-plan-management><div class="hrms-training-panel-heading"><div><p>${__("计划管理")}</p><h2>${__("计划与实际上课对照")}</h2></div><button class="btn btn-default btn-sm" data-training-action="reconcile">${__("重新匹配")}</button></div><div class="hrms-training-plan-tools"><div>${statuses.map((status) => `<button class="btn btn-xs ${planTableState.status === status ? "active" : ""}" data-training-plan-filter="${escape(status)}">${escape(status)}</button>`).join("")}</div><label class="hrms-training-search"><span>⌕</span><input class="form-control input-sm" data-training-plan-search value="${escape(planTableState.query)}" placeholder="${__("搜索课程、地点或日期")}"></label></div><div class="hrms-training-column-filters"><select class="form-control input-sm" data-training-column-filter="department">${filter_options(rows, "department", __("请选择部门"))}</select><label class="hrms-training-person-filter"><span>${__("人名")}</span><input class="form-control input-sm" data-training-person-search value="${escape(planTableState.personInput)}" placeholder="${__("输入人员姓名")}"></label><select class="form-control input-sm" data-training-column-filter="trainingType">${filter_options(rows, "training_type", __("全部培训类型"))}</select><select class="form-control input-sm" data-training-column-filter="month">${filter_options(rows, "planned_month", __("全部计划月份"))}</select><span class="hrms-training-result-count">${__("已找到 {0} 条", [filtered.length])}</span></div><div class="table-responsive hrms-training-plan-table"><table class="table"><thead><tr><th class="sticky-status">${sort_header(__("执行状态"), "status")}</th><th class="sticky-course">${sort_header(__("计划课程 / 实际课程"), "course")}</th><th>${sort_header(__("归属部门"), "department")}</th><th>${sort_header(__("分类"), "classification")}</th><th>${sort_header(__("培训类型"), "training_type")}</th><th>${sort_header(__("内/外"), "training_mode")}</th><th>${sort_header(__("课时"), "course_hours")}</th><th>${sort_header(__("召集人员"), "convener")}</th><th>${sort_header(__("召集部门"), "convener_department")}</th><th>${sort_header(__("地点"), "location")}</th><th>${sort_header(__("主要培训岗位/人员"), "target")}</th><th>${sort_header(__("计划月份"), "planned_month")}</th><th>${sort_header(__("实际执行"), "actual")}</th></tr></thead><tbody>${body || `<tr><td colspan="13"><div class="hrms-training-empty">${__("没有符合条件的课程")}</div></td></tr>`}</tbody></table></div><div class="hrms-training-pagination"><span>${__("第 {0} / {1} 页", [planTableState.page, totalPages])}</span><div><button class="btn btn-xs btn-default" data-training-page="prev" ${planTableState.page <= 1 ? "disabled" : ""}>← ${__("上一页")}</button><button class="btn btn-xs btn-default" data-training-page="next" ${planTableState.page >= totalPages ? "disabled" : ""}>${__("下一页")} →</button></div></div></div>`;
	}

	function open_event_plan_match(row, reload) {
		const dialog = new frappe.ui.Dialog({
			title: __("确认实际上课归属"),
			fields: [
				{ fieldtype: "HTML", fieldname: "match_summary" },
				{ fieldtype: "Link", fieldname: "training_program", label: __("匹配培训计划"), options: "Training Program", get_query: () => ({ filters: { company: currentCompany() } }) },
				{ fieldtype: "Check", fieldname: "mark_temporary", label: __("确认是临时新增课程") },
			],
			primary_action_label: __("保存归属"),
			primary_action(values) {
				if (!values.mark_temporary && !values.training_program) return frappe.msgprint(__("请选择培训计划，或勾选临时新增课程。"));
				frappe.call({
					method: "hrms.hr.doctype.training_program.training_program.set_training_event_plan_match",
					args: { event_name: row.event, training_program: values.training_program || "", mark_temporary: values.mark_temporary ? 1 : 0 },
					freeze: true,
				}).then(() => { dialog.hide(); reload(); });
			},
		});
		const candidates = row.candidates || [];
		dialog.fields_dict.match_summary.$wrapper.html(`<div class="hrms-training-match-dialog"><strong>${escape(row.course)}</strong><small>${escape([row.department, row.actual_dates].filter(Boolean).join(" · "))}</small>${candidates.length ? `<p>${__("系统建议")}</p>${candidates.map((candidate) => `<button class="btn btn-default btn-sm" data-candidate-program="${escape(candidate.program)}"><b>${escape(candidate.content)}</b><span>${escape([candidate.department, candidate.planned_month, `${candidate.score}分`].filter(Boolean).join(" · "))}</span></button>`).join("")}` : `<p>${__("没有可靠候选计划，可搜索选择计划或标记为临时新增。")}</p>`}</div>`);
		dialog.fields_dict.match_summary.$wrapper.find("[data-candidate-program]").on("click", (event) => dialog.set_value("training_program", event.currentTarget.dataset.candidateProgram));
		dialog.show();
	}

	function detail_field(label, value, wide = false) {
		return `<div class="hrms-training-detail-field ${wide ? "wide" : ""}"><span>${escape(label)}</span><strong>${escape(value === null || value === undefined || value === "" ? "—" : value)}</strong></div>`;
	}

	function participant_rows(events) {
		return events.flatMap((event) => (event.participants || []).map((participant) => ({ ...participant, event_name: event.course || event.event_name, event_date: event.source_actual_dates || event.start_time })));
	}

	function roster_rows_from_dom(workspace) {
		return [...workspace.querySelectorAll("[data-training-roster-row]")].map((row) => ({
			employee: row.dataset.employee,
			employee_code: row.dataset.employeeCode,
			employee_name: row.dataset.employeeName,
			department: row.dataset.department,
			attendance: row.querySelector("[data-roster-field='attendance']")?.value || "Present",
			hours: row.querySelector("[data-roster-field='hours']")?.value ?? "",
			score: row.querySelector("[data-roster-field='score']")?.value ?? "",
			grade: row.querySelector("[data-roster-field='grade']")?.value ?? "",
			needs_retraining: row.querySelector("[data-roster-field='needs_retraining']")?.checked ? 1 : 0,
			comments: row.querySelector("[data-roster-field='comments']")?.value ?? "",
		}));
	}

	function render_roster_editor(workspace) {
		const state = workspace.__trainingRoster;
		const wrapper = workspace.querySelector("[data-training-roster-editor]");
		if (!state || !wrapper) return;
		wrapper.hidden = false;
		const editable = !state.has_submitted_result;
		const rows = (state.participants || []).map((row, index) => `
			<tr data-training-roster-row data-employee="${escape(row.employee)}" data-employee-code="${escape(row.employee_code)}" data-employee-name="${escape(row.employee_name)}" data-department="${escape(row.department || "")}">
				<td><strong>${escape(row.employee_code)}</strong></td><td>${escape(row.employee_name)}</td><td>${escape(row.department || "—")}</td>
				<td><select class="form-control input-sm" data-roster-field="attendance" ${editable ? "" : "disabled"}><option value="Present" ${row.attendance !== "Absent" ? "selected" : ""}>${__("出席")}</option><option value="Absent" ${row.attendance === "Absent" ? "selected" : ""}>${__("缺席")}</option></select></td>
				<td><input class="form-control input-sm" inputmode="decimal" data-roster-field="hours" value="${escape(row.hours ?? "")}" ${editable ? "" : "disabled"}></td>
				<td><input class="form-control input-sm" inputmode="decimal" data-roster-field="score" value="${escape(row.score ?? "")}" ${editable ? "" : "disabled"}></td>
				<td><input class="form-control input-sm" data-roster-field="grade" value="${escape(row.grade || "")}" ${editable ? "" : "disabled"}></td>
				<td class="check-cell"><input type="checkbox" data-roster-field="needs_retraining" ${row.needs_retraining ? "checked" : ""} ${editable ? "" : "disabled"}></td>
				<td><input class="form-control input-sm" data-roster-field="comments" value="${escape(row.comments || "")}" placeholder="${__("选填")}" ${editable ? "" : "disabled"}></td>
				<td>${editable ? `<button class="btn btn-xs btn-default" data-training-roster-remove="${index}">${__("移除")}</button>` : "—"}</td>
			</tr>`).join("");
		wrapper.innerHTML = `
			<div class="hrms-training-detail-title"><div><p>EMPLOYEE RESULTS</p><h2>${__("参训员工与成绩")}</h2></div><button class="btn btn-default btn-sm" data-training-action="roster-close">${__("收起")}</button></div>
			<div class="hrms-training-roster-summary"><strong>${escape(state.course || state.name)}</strong><span>${state.has_submitted_result ? __("已归档，下方仅供查看") : __("先按公司工号搜索员工，学时、成绩和备注可留空后补")}</span></div>
			${editable ? `<div class="hrms-training-employee-search"><input class="form-control" data-training-roster-search-input placeholder="${__("输入公司工号，也可输入姓名或部门")}"><button class="btn btn-primary" data-training-action="roster-search">${__("搜索员工")}</button></div><div class="hrms-training-employee-results" data-training-employee-results></div>` : ""}
			<div class="table-responsive hrms-training-roster-table"><table class="table"><thead><tr><th>${__("公司工号")}</th><th>${__("姓名")}</th><th>${__("部门")}</th><th>${__("出席")}</th><th>${__("学时")}</th><th>${__("成绩")}</th><th>${__("等级/结果")}</th><th>${__("补训")}</th><th>${__("备注（选填）")}</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="10"><div class="hrms-training-empty">${__("尚未添加参训员工")}</div></td></tr>`}</tbody></table></div>
			${editable ? `<div class="hrms-training-roster-actions">${state.docstatus === 0 ? `<button class="btn btn-default" data-training-action="roster-save">${__("保存草稿")}</button>` : ""}<button class="btn btn-primary" data-training-action="roster-submit">${__("确认完成并写入员工档案")}</button></div>` : ""}`;
	}

	function open_training_roster_editor(eventName, workspace) {
		frappe.call({ method: `${workflowApi}.get_training_activity_roster`, args: { event_name: eventName }, freeze: true }).then(({ message = {} }) => {
			workspace.__trainingRoster = message;
			render_roster_editor(workspace);
		});
	}

	function search_training_roster_employee(workspace) {
		const input = workspace.querySelector("[data-training-roster-search-input]");
		const query = input?.value.trim() || "";
		if (!query) return frappe.msgprint(__("请先输入公司工号。"));
		frappe.call({ method: `${workflowApi}.find_training_employees`, args: { company: currentCompany(), query, limit: 20 } }).then(({ message = [] }) => {
			const results = workspace.querySelector("[data-training-employee-results]");
			if (!results) return;
			results.innerHTML = message.length ? message.map((row, index) => `<button class="hrms-training-employee-result" data-training-roster-add="${index}"><strong>${escape(row.employee_code)}</strong><span>${escape(row.employee_name)}</span><small>${escape(row.department || "未分配部门")}</small></button>`).join("") : `<div class="hrms-training-empty">${__("未找到符合工号的在职员工")}</div>`;
			workspace.__trainingEmployeeResults = message;
		});
	}

	function save_training_roster(workspace, submit = false, refresh_detail = null) {
		const state = workspace.__trainingRoster;
		const participants = roster_rows_from_dom(workspace);
		if (submit && !participants.length) return frappe.msgprint(__("请至少添加一名实际参训员工。"));
		const run = () => frappe.call({
			method: `${workflowApi}.${submit ? "record_training_completion" : "save_training_activity_roster"}`,
			args: { payload: JSON.stringify({ training_event: state.name, participants }) },
			freeze: true,
			freeze_message: submit ? __("正在写入员工档案…") : __("正在保存参训草稿…"),
		}).then(() => {
			frappe.show_alert({ message: submit ? __("培训结果已写入员工档案。") : __("参训员工与成绩草稿已保存。"), indicator: "green" });
			refresh_detail?.();
		});
		if (submit) return frappe.confirm(__("提交后将完成本场培训并写入员工档案，是否继续？"), run);
		return run();
	}

	function event_detail_html(event, index) {
		const rosterAction = event.has_submitted_result
			? `<span class="hrms-training-archive-label">${__("已写入员工档案")}</span>`
			: `<button class="btn btn-primary btn-sm" data-training-edit-roster="${escape(event.name)}">${__("添加人员 / 学时 / 成绩")}</button>`;
		return `<article class="hrms-training-execution"><div class="hrms-training-execution-index">${String(index + 1).padStart(2, "0")}</div><div class="hrms-training-execution-main"><div class="hrms-training-execution-heading"><div><strong>${escape(event.course || event.event_name)}</strong><span>${escape(event.source_actual_dates || event.start_time || "日期未记录")}</span></div><span class="hrms-training-plan-status status-${escape(event.plan_match_status || "已实施")}">${escape(event.plan_match_status || event.event_status || "已实施")}</span></div><div class="hrms-training-execution-grid">${detail_field(__("课程归属部门"), event.source_owner_department || event.owner_department)}${detail_field(__("课程类型"), event.source_course_type || event.training_category)}${detail_field(__("课件方式"), event.source_courseware || event.delivery_method)}${detail_field(__("培训方式"), event.training_mode)}${detail_field(__("课时"), event.source_course_hours || event.course_hours)}${detail_field(__("授课人"), event.trainer_name)}${detail_field(__("地点"), event.location)}${detail_field(__("培训对象"), event.source_target || event.target_audience, true)}</div><div class="hrms-training-execution-meta"><span>${escape(__("{0} 人次", [event.participant_count || 0]))}</span><span>${escape(event.plan_match_basis || __("未记录匹配依据"))}</span>${event.plan_match_score ? `<span>${escape(__("匹配分数 {0}", [event.plan_match_score]))}</span>` : ""}${rosterAction}</div></div></article>`;
	}

	function render_training_detail(workspace, detail) {
		const events = detail.events || [];
		const participants = participant_rows(events);
		const audience = detail.audience_matrix || [];
		workspace.innerHTML = `<section class="hrms-training-detail-page"><div class="hrms-training-detail-nav"><button class="btn btn-default btn-sm" data-training-action="detail-back">← ${__("返回计划管理")}</button><span>${escape(detail.kind === "plan" ? __("计划课程详情") : __("实际上课详情"))}</span></div><header class="hrms-training-detail-hero"><div><span class="hrms-training-plan-status status-${escape(detail.status)}">${escape(detail.status)}</span><p>${escape([detail.department, detail.classification, detail.training_type].filter(Boolean).join(" · "))}</p><h1>${escape(detail.title)}</h1><small>${escape(detail.kind === "plan" ? __("来自年度计划表，下方汇总已匹配的实际上课。") : __("来自培训登记表，并显示计划匹配结果。"))}</small></div><div class="hrms-training-detail-metrics"><div><span>${__("实际场次")}</span><strong>${number(detail.event_count)}</strong></div><div><span>${__("参训人次")}</span><strong>${number(detail.participant_count)}</strong></div><div><span>${__("计划月份")}</span><strong>${escape(detail.planned_month || "—")}</strong></div></div></header><div class="hrms-training-detail-layout"><main><section class="hrms-training-detail-card"><div class="hrms-training-detail-title"><div><p>PLAN INFORMATION</p><h2>${__("计划与课程信息")}</h2></div>${detail.status === "待确认" ? `<button class="btn btn-primary btn-sm" data-training-action="detail-match">${__("确认计划归属")}</button>` : ""}</div><div class="hrms-training-detail-fields">${detail_field(__("归属部门"), detail.department)}${detail_field(__("分类"), detail.classification)}${detail_field(__("培训类型"), detail.training_type)}${detail_field(__("内/外训"), detail.training_mode)}${detail_field(__("课时"), detail.course_hours)}${detail_field(__("召集/授课人员"), detail.convener)}${detail_field(__("召集部门"), detail.convener_department)}${detail_field(__("地点"), detail.location)}${detail_field(__("主要培训岗位/人员"), detail.target, true)}${detail_field(__("计划月份"), detail.planned_month)}${detail_field(__("原表实际日期"), detail.source_actual_dates)}</div>${audience.length ? `<div class="hrms-training-audience"><span>${__("课程对象矩阵")}</span><div>${audience.map((item) => `<span><b>${escape(item.unit)}</b>${escape(item.requirement)}</span>`).join("")}</div></div>` : ""}${detail.matched_program ? `<div class="hrms-training-match-summary"><span>${__("已关联计划")}</span><strong>${escape(detail.matched_program.source_content || detail.matched_program.name)}</strong><small>${escape([detail.matched_program.source_department, detail.matched_program.source_planned_month, detail.match_basis].filter(Boolean).join(" · "))}</small></div>` : ""}</section><section class="hrms-training-detail-card"><div class="hrms-training-detail-title"><div><p>ACTUAL EXECUTION</p><h2>${__("实际上课记录")}</h2></div><div class="hrms-training-detail-actions"><span>${escape(__("{0} 场", [events.length]))}</span>${detail.kind === "plan" ? `<button class="btn btn-primary btn-sm" data-training-action="detail-schedule">${__("安排上课")}</button>` : ""}</div></div><div class="hrms-training-executions">${events.length ? events.map(event_detail_html).join("") : `<div class="hrms-training-empty">${__("暂无实际上课记录")}</div>`}</div></section><section class="hrms-training-detail-card hrms-training-roster-editor" data-training-roster-editor hidden></section><section class="hrms-training-detail-card"><div class="hrms-training-detail-title"><div><p>PARTICIPANTS</p><h2>${__("已保存参训员工")}</h2></div><label class="hrms-training-search"><span>⌕</span><input class="form-control input-sm" data-training-participant-search placeholder="${__("搜索工号、姓名或部门")}"></label></div><div class="table-responsive hrms-training-participant-table"><table class="table"><thead><tr><th>${__("公司工号")}</th><th>${__("姓名")}</th><th>${__("部门")}</th><th>${__("实际课程")}</th><th>${__("日期")}</th><th>${__("出席")}</th><th>${__("学时")}</th><th>${__("成绩/结论")}</th></tr></thead><tbody>${participants.map((row) => { const search = [row.employee_code, row.employee_name, row.department, row.event_name].join(" ").toLowerCase(); return `<tr data-training-participant data-search="${escape(search)}"><td>${escape(row.employee_code || "—")}</td><td><strong>${escape(row.employee_name || "—")}</strong></td><td>${escape(row.department || "—")}</td><td>${escape(row.event_name || "—")}</td><td>${escape(row.event_date || "—")}</td><td>${escape(row.attendance || row.status || "—")}</td><td>${escape(row.study_hours ?? "—")}</td><td>${escape([row.score, row.assessment_result].filter((value) => value !== null && value !== undefined && value !== "").join(" / ") || "—")}</td></tr>`; }).join("") || `<tr><td colspan="8"><div class="hrms-training-empty">${__("暂无参训员工明细")}</div></td></tr>`}</tbody></table></div></section></main><aside><section class="hrms-training-detail-card"><div class="hrms-training-detail-title"><div><p>SOURCE TRACE</p><h2>${__("数据来源")}</h2></div></div><div class="hrms-training-source-list">${detail_field(__("来源文件"), detail.source?.file)}${detail_field(__("工作表"), detail.source?.sheet)}${detail_field(__("原表行号"), detail.source?.row)}${detail_field(__("导入人"), detail.source?.imported_by)}${detail_field(__("导入时间"), detail.source?.imported_on)}</div></section><section class="hrms-training-detail-card hrms-training-detail-help"><strong>${__("这是自定义培训详情页")}</strong><p>${__("计划信息和实际上课保持分离，参训员工与成绩在本页完成，不再使用 Frappe 原生子表。")}</p></section></aside></div></section>`;
		workspace.querySelector(".hrms-training-detail-hero small")?.remove();
		const auditList = workspace.querySelector(".hrms-training-source-list");
		if (auditList) auditList.innerHTML = `${detail_field(__("创建人"), detail.source?.created_by)}${detail_field(__("创建时间"), detail.source?.created_on)}`;
		const auditCard = auditList?.closest(".hrms-training-detail-card");
		if (auditCard) {
			auditCard.querySelector(".hrms-training-detail-title p").textContent = "RECORD INFO";
			auditCard.querySelector(".hrms-training-detail-title h2").textContent = __("创建信息");
		}
		workspace.querySelector(".hrms-training-detail-help")?.remove();
	}

	function open_training_detail(row, workspace, reload) {
		workspace.__trainingDetailRow = row;
		workspace.innerHTML = `<div class="hrms-training-panel"><div class="hrms-training-empty">${__("正在读取课程详情…")}</div></div>`;
		frappe.call({
			method: "hrms.hr.doctype.training_program.training_program.get_training_plan_detail",
			args: { kind: row.kind, name: row.program || row.event, company: currentCompany() },
		}).then(({ message }) => render_training_detail(workspace, message || {})).catch(() => reload());
	}

	function render_dashboard(workspace, dashboard = {}, loading = false) {
		const management = dashboard.plan_management || {};
		if (!loading) workspace.__trainingDashboard = dashboard;
		workspace.__trainingPlanRows = management.rows || [];
		const state = get_import_state(currentCompany());
		const pendingIdentities = (state.preview?.identities || []).filter((item) => item.status !== "matched").length;
		const importActionLabel = state.preview
			? pendingIdentities ? __("继续匹配 {0} 组员工", [pendingIdentities]) : __("查看校验结果并导入")
			: state.plan_file_url || state.record_file_url ? __("继续独立导入") : __("分开导入计划 / 实际");

		workspace.innerHTML = `
			<div class="hrms-training-hero hrms-training-plan-hero">
				<div>
					<p class="hrms-training-eyebrow">TRAINING PLAN</p>
					<h1>${__("培训计划")}</h1>
					<p>${__("计划表独立建立课程；登记表独立匹配实际上课，缺少课程时自动补建。")}</p>
				</div>
				<div class="hrms-training-hero-actions">
					<button class="btn btn-primary" data-training-action="new-plan">${__("创建课程")}</button>
					<button class="btn btn-link" data-training-action="import">${importActionLabel}</button>
				</div>
			</div>
			${plan_management_html(management, loading)}
			`;
	}

	function bind_dashboard_actions(workspace, reload) {
		const management = () => workspace.__trainingDashboard?.plan_management || { rows: [] };
		const visibleRows = () => {
			const filtered = plan_table_rows(management().rows || []);
			const start = (planTableState.page - 1) * planTableState.pageSize;
			return filtered.slice(start, start + planTableState.pageSize);
		};
		const refreshPlanPanel = (focusSelector = "") => {
			const panel = workspace.querySelector("[data-training-plan-management]");
			if (!panel) return;
			const pageScroll = { x: window.scrollX, y: window.scrollY };
			const table = panel.querySelector(".hrms-training-plan-table");
			const tableScroll = { left: table?.scrollLeft || 0, top: table?.scrollTop || 0 };
			panel.outerHTML = plan_management_html(management());
			const nextTable = workspace.querySelector(".hrms-training-plan-table");
			if (nextTable) {
				nextTable.scrollLeft = tableScroll.left;
				nextTable.scrollTop = tableScroll.top;
			}
			window.scrollTo({ left: pageScroll.x, top: pageScroll.y, behavior: "auto" });
			if (focusSelector) {
				const input = workspace.querySelector(focusSelector);
				input?.focus();
				input?.setSelectionRange(input.value.length, input.value.length);
			}
		};
		workspace.oninput = (event) => {
			if (event.target.matches("[data-training-plan-search]")) {
				planTableState.query = event.target.value;
				planTableState.page = 1;
				return refreshPlanPanel("[data-training-plan-search]");
			}
			if (event.target.matches("[data-training-person-search]")) {
				planTableState.personInput = event.target.value;
				return;
			}
			if (event.target.matches("[data-training-participant-search]")) {
				const query = event.target.value.trim().toLowerCase();
				workspace.querySelectorAll("[data-training-participant]").forEach((row) => { row.hidden = Boolean(query && !row.dataset.search.includes(query)); });
			}
		};
		workspace.onkeydown = (event) => {
			if (event.target.matches("[data-training-roster-search-input]") && event.key === "Enter" && !event.isComposing) {
				event.preventDefault();
				return search_training_roster_employee(workspace);
			}
			if (!event.target.matches("[data-training-person-search]") || event.key !== "Enter" || event.isComposing) return;
			event.preventDefault();
			planTableState.personInput = event.target.value;
			planTableState.person = event.target.value;
			planTableState.page = 1;
			refreshPlanPanel("[data-training-person-search]");
		};
		workspace.onchange = (event) => {
			const key = event.target.dataset.trainingColumnFilter;
			if (!key) return;
			planTableState[key] = event.target.value;
			planTableState.page = 1;
			refreshPlanPanel();
		};
		workspace.onclick = (event) => {
			const action = event.target.closest("[data-training-action]")?.dataset.trainingAction;
			if (action === "import") return open_training_import(reload);
			if (action === "new-plan") return new_training_program(reload);
			if (action === "detail-back") return render_dashboard(workspace, workspace.__trainingDashboard || {});
			if (action === "detail-schedule") return schedule_training_activity(reload, workspace.__trainingDetailRow?.program || "", () => open_training_detail(workspace.__trainingDetailRow || {}, workspace, reload));
			if (action === "roster-close") {
				const editor = workspace.querySelector("[data-training-roster-editor]");
				if (editor) editor.hidden = true;
				return;
			}
			if (action === "roster-search") return search_training_roster_employee(workspace);
			if (action === "roster-save") return save_training_roster(workspace, false, () => open_training_detail(workspace.__trainingDetailRow || {}, workspace, reload));
			if (action === "roster-submit") return save_training_roster(workspace, true, () => open_training_detail(workspace.__trainingDetailRow || {}, workspace, reload));
			if (action === "detail-match") return open_event_plan_match(workspace.__trainingDetailRow || {}, reload);
			if (action === "reconcile") return frappe.confirm(__("将重新计算课程名称、归属部门、计划月份、培训方式和课时的匹配关系。人工确认过的归属不会被覆盖。是否继续？"), () => frappe.call({
				method: "hrms.hr.doctype.training_program.training_program.reconcile_training_plan_matches",
				args: { company: currentCompany(), confirm: 1 },
				freeze: true,
				freeze_message: __("正在重新匹配计划与实际上课…"),
			}).then(({ message }) => {
				frappe.show_alert({ message: __("匹配完成：计划 {0}，待确认 {1}，临时新增 {2}", [message?.matched || 0, message?.review || 0, message?.temporary || 0]), indicator: "green" });
				reload();
			}));
			const planFilter = event.target.closest("[data-training-plan-filter]")?.dataset.trainingPlanFilter;
			if (planFilter) {
				planTableState.status = planFilter;
				planTableState.page = 1;
				return refreshPlanPanel();
			}
			const sort = event.target.closest("[data-training-sort]")?.dataset.trainingSort;
			if (sort) {
				planTableState.direction = planTableState.sort === sort && planTableState.direction === "asc" ? "desc" : "asc";
				planTableState.sort = sort;
				planTableState.page = 1;
				return refreshPlanPanel();
			}
			const page = event.target.closest("[data-training-page]")?.dataset.trainingPage;
			if (page) {
				planTableState.page += page === "next" ? 1 : -1;
				return refreshPlanPanel();
			}
			const matchIndex = event.target.closest("[data-training-match-event]")?.dataset.trainingMatchEvent;
			if (matchIndex !== undefined) return open_event_plan_match(visibleRows()[Number(matchIndex)] || {}, reload);
			const detailIndex = event.target.closest("[data-training-open-detail]")?.dataset.trainingOpenDetail;
			if (detailIndex !== undefined) return open_training_detail(visibleRows()[Number(detailIndex)] || {}, workspace, reload);
			const rosterEvent = event.target.closest("[data-training-edit-roster]")?.dataset.trainingEditRoster;
			if (rosterEvent) return open_training_roster_editor(rosterEvent, workspace);
			const removeIndex = event.target.closest("[data-training-roster-remove]")?.dataset.trainingRosterRemove;
			if (removeIndex !== undefined) {
				workspace.__trainingRoster.participants = roster_rows_from_dom(workspace).filter((row, index) => index !== Number(removeIndex));
				return render_roster_editor(workspace);
			}
			const addIndex = event.target.closest("[data-training-roster-add]")?.dataset.trainingRosterAdd;
			if (addIndex !== undefined) {
				const current = roster_rows_from_dom(workspace);
				const candidate = workspace.__trainingEmployeeResults?.[Number(addIndex)];
				if (!candidate) return;
				if (current.some((row) => row.employee_code === candidate.employee_code)) return frappe.show_alert({ message: __("该员工已在参训名单中。"), indicator: "orange" });
				workspace.__trainingRoster.participants = [...current, { ...candidate, attendance: "Present", hours: "", score: "", grade: "", needs_retraining: 0, comments: "" }];
				return render_roster_editor(workspace);
			}
			const route_key = event.target.closest("[data-training-route]")?.dataset.trainingRoute;
			if (route_key) return route(route_key);
			const event_name = event.target.closest("[data-training-event]")?.dataset.trainingEvent;
			if (event_name) open_training_detail({ kind: "actual", event: event_name }, workspace, reload);
		};
	}

	function load_dashboard(listview, workspace) {
		render_dashboard(workspace, {}, true);
		bind_dashboard_actions(workspace, () => load_dashboard(listview, workspace));
		frappe.call({
			method: "hrms.hr.doctype.training_program.training_program.get_training_plan_management",
			args: { company: window.hrmsCompanyContext?.getCurrentCompany?.() || "" },
			callback: ({ message }) => {
				render_dashboard(workspace, { plan_management: message || {} });
				bind_dashboard_actions(workspace, () => load_dashboard(listview, workspace));
			},
			error: () => {
				render_dashboard(workspace, { risks: [{ tone: "warning", title: __("数据暂不可用"), value: "!", detail: __("请刷新后重试，原培训计划清单不受影响。") }] });
				bind_dashboard_actions(workspace, () => load_dashboard(listview, workspace));
			},
		});
	}

	frappe.listview_settings["Training Program"] = {
		add_fields: ["status", "approval_status", "training_category", "plan_period", "owner_department", "trainer_name"],
		onload(listview) {
			if (listview.page.__training_learning_ready) return;
			listview.page.__training_learning_ready = true;
			listview.page.set_title(__("培训计划"));
			listview.page.wrapper?.addClass("hrms-training-plan-page");
			listview.$result?.hide();
			listview.$paging_area?.hide();
			listview.page.main.find(".list-paging-area, .list-count").hide();
			const workspace = ensure_dashboard(listview);
			if (workspace) load_dashboard(listview, workspace);
		},
		get_indicator(doc) {
			const status = doc.approval_status || doc.status;
			const colour = status === "Closed" || status === "Completed" ? "green" : status === "Approved" || status === "In Progress" ? "blue" : status === "Cancelled" ? "red" : "orange";
			return [__(status), colour, `status,=,${doc.status}`];
		},
		formatters: {
			training_category(value) { return value ? `<span class="indicator-pill blue">${escape(value)}</span>` : ""; },
			approval_status(value) { return value ? `<span class="indicator-pill ${value === "Approved" ? "green" : "orange"}">${escape(value)}</span>` : ""; },
		},
	};
})();
