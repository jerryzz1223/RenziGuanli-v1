frappe.pages["recruitment-center"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("招聘中心"), single_column: true });
	const view = new RecruitmentCenter(page);
	wrapper.recruitment_center = view;
	view.show();
};

frappe.pages["recruitment-center"].on_page_show = function (wrapper) {
	wrapper.recruitment_center?.refresh({ reuse: true });
};

class RecruitmentCenter {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.mode = "register";
		this.start = 0;
		this.request_id = 0;
		this.register_view = "list";
		window.addEventListener("hrms:company-context-changed", () => {
			if (this.mode !== "register") return;
			this.start = 0;
			this.refresh();
		});
	}

	show() {
		this.render_register_shell();
		this.refresh();
	}

	refresh(options = {}) {
		return this.refresh_register(options);
	}

	current_company() {
		return window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	}

	register_columns() {
		return [
			["registration_month", "月份"], ["source_sequence", "序号"], ["candidate_name", "姓名"],
			["native_place", "籍贯"], ["source", "招聘渠道"], ["phone", "联系电话"],
			["gender", "性别"], ["education", "学历"], ["marital_status", "婚姻状况"], ["age", "年龄"],
			["interview_date", "面试日期"], ["interview_position", "应聘岗位"], ["referrer", "介绍人"],
			["interviewer", "面试官"], ["hired", "录用结果"], ["assigned_department", "分配部门"],
			["assigned_position", "分配岗位"], ["rejection_reason", "未录用原因 / 备注"],
			["expected_start_date", "预计到岗日期"], ["arrival_status", "报到状态"], ["no_show_reason", "未报到原因"],
		];
	}

	render_register_shell() {
		this.mode = "register";
		this.page.clear_primary_action();
		this.page.clear_secondary_action?.();
		this.wrapper.innerHTML = `<section class="recruitment-center interview-register">
			<header class="interview-register__hero"><div><p class="interview-register__eyebrow">招聘 · 面试登记</p><h1>面试人员登记</h1><p class="interview-register__description">查询面试记录，跟进录用结果与报到情况。</p></div><div class="interview-register__actions"><button class="btn btn-primary" data-register-new disabled>导入 Excel</button><button class="btn btn-default" data-refresh>刷新数据</button></div></header>
			<section class="interview-register__panel">
			<div class="interview-register__panel-heading"><h2>筛选登记</h2><span class="interview-register__hint">不填条件时查询全部记录</span></div>
			<div class="interview-register__filters">
				<label>面试月份<input class="form-control" type="month" data-month></label>
				<label>关键词<input class="form-control" type="search" data-search placeholder="姓名、联系电话或应聘岗位"></label>
				<label>录用结果<select class="form-control" data-hired><option value="">全部</option><option value="是">已录用</option><option value="否">未录用</option></select></label>
				<label>报到状态<select class="form-control" data-arrival><option value="">全部</option><option>待报到</option><option>已报到</option><option>未报到</option></select></label>
				<div class="interview-register__filter-actions"><button class="btn btn-primary" data-query>查询</button><button class="btn btn-default" data-clear>重置</button></div>
			</div>
			</section>
			<section class="interview-register__panel interview-register__list-panel">
			<div class="interview-register__panel-heading"><div><h2>面试登记清单</h2><p class="interview-register__hint" data-view-hint></p></div><div class="interview-register__view-switch" role="group" aria-label="清单显示方式"><button data-view="list">日常清单</button><button data-view="template">完整字段</button></div></div>
			<div data-register-results aria-live="polite"></div>
			<div class="interview-register__footer"><span data-page-info></span><div><button class="btn btn-default btn-sm" data-prev>上一页</button> <button class="btn btn-default btn-sm" data-next>下一页</button></div></div>
			</section>
		</section>`;
		this.wrapper.querySelector("[data-register-new]").addEventListener("click", () => this.import_workbook());
		this.wrapper.querySelector("[data-refresh]").addEventListener("click", () => this.refresh_register());
		this.wrapper.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
			this.register_view = button.dataset.view;
			this.update_register_view();
			if (this.register_data) this.render_register_rows(this.register_data);
		}));
		this.update_register_view();
		const query = () => { this.start = 0; this.refresh_register(); };
		this.wrapper.querySelector("[data-query]").addEventListener("click", query);
		this.wrapper.querySelector("[data-search]").addEventListener("keydown", (event) => { if (event.key === "Enter") query(); });
		this.wrapper.querySelector("[data-clear]").addEventListener("click", () => {
			for (const selector of ["month", "search", "hired", "arrival"]) this.wrapper.querySelector(`[data-${selector}]`).value = "";
			query();
		});
		this.wrapper.querySelector("[data-prev]").addEventListener("click", () => { this.start = Math.max(0, this.start - 50); this.refresh_register(); });
		this.wrapper.querySelector("[data-next]").addEventListener("click", () => { this.start += 50; this.refresh_register(); });
	}

	import_workbook() {
		const company = this.current_company();
		if (!company) return frappe.msgprint("未获取到公司设置，请联系管理员配置默认公司。");
		new frappe.ui.FileUploader({
			is_private: 1,
			restrictions: { allowed_file_types: [".xlsx"], max_file_size: 10 * 1024 * 1024 },
			on_success: (file) => this.preview_workbook({ file_url: file.file_url, company }, []),
		});
	}

	preview_workbook(args, corrections, previous_dialog = null) {
		previous_dialog?.get_primary_btn().prop("disabled", true);
		return Promise.resolve(frappe.call({
			method: "hrms.api.interview_registration.preview_import",
			args: { ...args, corrections: JSON.stringify(corrections) },
			freeze: true, freeze_message: "正在校验面试清单…",
		})).then((response) => {
			const data = response.message || {};
			const safe = (value) => frappe.utils.escape_html(String(value ?? ""));
			const errors = data.errors || [];
			const applied = data.corrections || [];
			const editable = errors.filter((error) => error.field);
			const suggested = editable.filter((error) => error.suggestion != null);
			const dialog = new frappe.ui.Dialog({
				title: errors.length ? "修正面试清单后继续导入" : "确认导入面试清单",
				size: "extra-large",
				fields: [{ fieldtype: "HTML", fieldname: "review" }],
				primary_action_label: errors.length ? "重新校验并继续" : "确认导入",
				primary_action: () => {
					if (errors.length) {
						const edits = new Map(corrections.map((edit) => [`${edit.row}:${edit.field}`, edit]));
						editable.forEach((error, index) => {
							const value = dialog.fields_dict.review.$wrapper[0].querySelector(`[data-import-edit="${index}"]`).value;
							edits.set(`${error.row}:${error.field}`, { row: error.row, field: error.field, value });
						});
						return this.preview_workbook(args, [...edits.values()], dialog);
					}
					dialog.get_primary_btn().prop("disabled", true);
					return Promise.resolve(frappe.call({
						method: "hrms.api.interview_registration.import_registrations",
						args: { ...args, corrections: JSON.stringify(corrections), fingerprint: data.fingerprint },
						freeze: true, freeze_message: "正在导入面试清单…",
					})).then((result) => {
						dialog.hide();
						frappe.msgprint(`导入完成：新增 ${safe(result.message.imported)} 条，跳过重复 ${safe(result.message.skipped)} 条。`);
						this.start = 0;
						this.register_loading_key = "";
						this.refresh_register();
					}).catch(() => {
						frappe.msgprint("导入未完成，本次写入已回滚。修正内容已保留，可重新校验后重试。");
						this.preview_workbook(args, corrections, dialog);
					}).finally(() => dialog.get_primary_btn().prop("disabled", false));
				},
			});
			const review = dialog.fields_dict.review.$wrapper[0];
			const summary = `<p>导入公司：${safe(args.company)}；共 ${safe(data.total)} 条，将新增 ${safe(data.pending)} 条，跳过重复 ${safe(data.skipped)} 条。</p>`;
			if (errors.length) {
				review.innerHTML = summary + `<p>发现 ${safe(errors.length)} 处问题。可直接修改下表，无需重新上传 Excel。修正只用于本次导入。</p>` +
					(suggested.length ? `<button type="button" class="btn btn-default btn-sm" data-apply-suggestions>一键填入建议修正（${safe(suggested.length)} 处）</button>` : "") +
					`<div style="overflow:auto;max-height:55vh;margin-top:12px"><table class="table table-bordered"><thead><tr><th>原表行 / 姓名</th><th>字段 / 问题</th><th>当前值</th><th>修正值</th></tr></thead><tbody>` +
					editable.map((error, index) => {
						const options = error.options;
						const input = options ? `<select class="form-control" data-import-edit="${index}">${[...new Set([error.value, ...options])].map((value) => `<option value="${safe(value)}"${value === error.value ? " selected" : ""}>${safe(value || "（空白）")}</option>`).join("")}</select>` :
							`<input class="form-control" data-import-edit="${index}" value="${safe(error.value)}">`;
						return `<tr><td>第 ${safe(error.row)} 行<br>${safe(error.candidate_name)}</td><td>${safe(error.message)}</td><td>${safe(error.value)}</td><td>${input}${error.suggestion != null ? `<small>建议：${safe(error.suggestion)}</small>` : ""}</td></tr>`;
					}).join("") + `</tbody></table></div>` + errors.filter((error) => !error.field).map((error) => `<p>${safe(error.message)}</p>`).join("");
				review.querySelector("[data-apply-suggestions]")?.addEventListener("click", () => {
					editable.forEach((error, index) => {
						if (error.suggestion != null) review.querySelector(`[data-import-edit="${index}"]`).value = error.suggestion;
					});
				});
				if (!editable.length) dialog.get_primary_btn().prop("disabled", true);
			} else {
				review.innerHTML = summary + `<p>校验通过。已确认 ${safe(corrections.length)} 处单元格修正，请核对后导入。</p>` +
					(corrections.length ? `<div style="overflow:auto;max-height:45vh"><table class="table table-bordered"><thead><tr><th>原表行</th><th>字段</th><th>原值</th><th>修正值</th></tr></thead><tbody>${applied.map((edit) => `<tr><td>${safe(edit.row)}</td><td>${safe(edit.label)}</td><td>${safe(edit.original)}</td><td>${safe(edit.value)}</td></tr>`).join("")}</tbody></table></div>` : "");
			}
			previous_dialog?.hide();
			dialog.show();
		}).catch(() => {
			if (previous_dialog) {
				frappe.msgprint("表格校验失败，当前文件和修正内容仍保留，可点击原窗口按钮重试。");
				return;
			}
			// Keep a concrete retry action even when the first preview fails before an editor exists.
			const retry = new frappe.ui.Dialog({
				title: "面试清单校验未完成",
				fields: [{ fieldtype: "HTML", fieldname: "retry_info", options: "<p>已上传文件仍保留。请点击重新校验，无需再次上传 Excel。</p>" }],
				primary_action_label: "重新校验",
				primary_action: () => this.preview_workbook(args, corrections, retry),
			});
			retry.show();
		}).finally(() => previous_dialog?.get_primary_btn().prop("disabled", false));
	}

	update_register_view() {
		const hint = this.wrapper.querySelector("[data-view-hint]");
		if (hint) hint.textContent = this.register_view === "template" ? "保留原表全部字段；可左右滚动，姓名列固定显示。" : "集中查看岗位、面试安排及跟进状态；点击姓名查看详情。";
		this.wrapper.querySelectorAll("[data-view]").forEach((button) => {
			const active = button.dataset.view === this.register_view;
			button.classList.toggle("is-active", active);
			button.setAttribute("aria-pressed", String(active));
		});
	}

	refresh_register({ reuse = false } = {}) {
		const results = this.wrapper.querySelector("[data-register-results]");
		if (!results) return;
		const filters = {
			company: this.current_company(), month: this.wrapper.querySelector("[data-month]").value,
			search: this.wrapper.querySelector("[data-search]").value, hired: this.wrapper.querySelector("[data-hired]").value,
			arrival_status: this.wrapper.querySelector("[data-arrival]").value,
		};
		const key = JSON.stringify(filters);
		if (key !== this.register_filter_key) this.start = 0;
		this.register_filter_key = key;
		const requestKey = JSON.stringify([frappe.session?.user || "", filters, this.start]);
		if (this.register_loading_key === requestKey && this.register_load_promise) return this.register_load_promise;
		if (reuse && this.register_data && requestKey === this.register_loaded_key && Date.now() - this.register_loaded_at < 15_000) return Promise.resolve(this.register_data);
		const request_id = ++this.request_id;
		const keepRows = Boolean(this.register_data && requestKey === this.register_loaded_key);
		this.register_loading_key = requestKey;
		if (!keepRows) this.register_data = null;
		this.wrapper.querySelectorAll("[data-view]").forEach((button) => { button.disabled = true; });
		if (!keepRows) results.innerHTML = this.empty("正在读取面试人员登记…");
		results.setAttribute?.("aria-busy", "true");
		for (const key of ["prev", "next"]) this.wrapper.querySelector(`[data-${key}]`).disabled = true;
		this.wrapper.querySelector("[data-page-info]").textContent = "";
		this.register_load_promise = Promise.resolve().then(() => frappe.call({
			method: "hrms.api.interview_registration.get_registrations",
			args: { ...filters, start: this.start },
		})).then((response) => {
			if (request_id !== this.request_id || this.mode !== "register") return;
			const data = response.message || {};
			this.register_loaded_key = requestKey;
			this.register_loaded_at = Date.now();
			this.wrapper.querySelector("[data-register-new]").hidden = !data.can_create;
			this.wrapper.querySelector("[data-register-new]").disabled = false;
			this.wrapper.querySelectorAll("[data-view]").forEach((button) => { button.disabled = false; });
			this.render_register_rows(data);
		}).catch(() => {
			if (request_id !== this.request_id || this.mode !== "register") return;
			this.wrapper.querySelector("[data-register-new]").disabled = true;
			if (keepRows) {
				this.render_register_rows(this.register_data);
				frappe.show_alert?.({ message: "刷新失败，已保留上次清单，请重试。", indicator: "orange" });
			} else results.innerHTML = this.empty("面试登记读取失败，请确认权限或稍后点击查询重试。");
		}).finally(() => {
			if (request_id !== this.request_id) return;
			this.register_loading_key = "";
			this.register_load_promise = null;
			results.removeAttribute?.("aria-busy");
			this.wrapper.querySelectorAll("[data-view]").forEach((button) => { button.disabled = !this.register_data; });
		});
		return this.register_load_promise;
	}

	render_register_rows(data) {
		this.register_data = data;
		const rows = data.rows || [];
		const safe = (value) => frappe.utils.escape_html(String(value ?? ""));
		const columns = this.register_columns();
		const template = `<div class="interview-register__scroll" tabindex="0" aria-label="面试人员清单，可左右滚动"><table class="interview-register__table"><thead>
			<tr><th rowspan="2">月份</th><th rowspan="2">序号</th><th rowspan="2">姓名</th><th colspan="7">应聘人员信息</th>${columns.slice(10).map(([, label]) => `<th rowspan="2">${label}</th>`).join("")}</tr>
			<tr>${columns.slice(3, 10).map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rows.map((row, index) => `<tr>${columns.map(([key]) => {
				if (key === "candidate_name") return `<td><button class="interview-register__name" data-registration="${safe(row.name)}">${safe(row[key])}</button></td>`;
				const value = key === "source_sequence" ? (row[key] || this.start + index + 1) : key === "registration_month" ? (row.source_month || row[key]) : key === "hired" ? (row[key] === "是" ? "已录用" : row[key] === "否" ? "未录用" : "未填写") : row[key];
				return `<td>${safe(value === null || value === undefined || value === "" ? "—" : value)}</td>`;
			}).join("")}</tr>`).join("")}</tbody></table></div>`;
		this.wrapper.querySelector("[data-register-results]").innerHTML = rows.length
			? (this.register_view === "template" ? template : this.render_daily_rows(rows))
			: `<div class="interview-register__empty"><span aria-hidden="true">○</span><strong>暂无面试登记</strong><p>可调整查询条件，或点击上方“导入 Excel”上传面试人员清单。</p></div>`;
		this.wrapper.querySelectorAll("[data-registration]").forEach((button) => button.addEventListener("click", () => frappe.set_route("Form", "Interview Registration", button.dataset.registration)));
		this.wrapper.querySelector("[data-page-info]").textContent = rows.length ? `第 ${this.start + 1}–${this.start + rows.length} 条，每页 50 条` : "暂无记录";
		this.wrapper.querySelector("[data-prev]").disabled = this.start === 0;
		this.wrapper.querySelector("[data-next]").disabled = !data.has_more;
	}

	render_daily_rows(rows) {
		const safe = (value) => frappe.utils.escape_html(String(value ?? ""));
		const text = (value) => safe(value || "—");
		return `<div class="interview-register__daily-scroll"><table class="interview-register__daily"><thead><tr><th>面试人员</th><th>应聘岗位 / 渠道</th><th>面试安排</th><th>录用结果</th><th>分配部门 / 岗位</th><th>报到跟进</th><th>操作</th></tr></thead><tbody>${rows.map((row) => {
			const hired_label = row.hired === "是" ? "已录用" : row.hired === "否" ? "未录用" : "未填写";
			const hired_tone = row.hired === "是" ? "green" : row.hired === "否" ? "neutral" : "amber";
			const arrival = row.arrival_status || "未填写";
			return `<tr><td data-label="面试人员"><button class="interview-register__name" data-registration="${safe(row.name)}">${text(row.candidate_name)}</button><small>${text(row.phone)}</small></td>
				<td data-label="应聘岗位 / 渠道"><strong>${text(row.interview_position)}</strong><small>${text(row.source)}</small></td>
				<td data-label="面试安排"><strong>${text(row.interview_date)}</strong><small>面试官：${text(row.interviewer)}</small></td>
				<td data-label="录用结果"><span class="interview-register__badge interview-register__badge--${hired_tone}">${hired_label}</span></td>
				<td data-label="分配部门 / 岗位"><strong>${text(row.assigned_department)}</strong><small>${text(row.assigned_position)}</small></td>
				<td data-label="报到跟进"><span class="interview-register__badge interview-register__badge--${arrival === "已报到" ? "green" : arrival === "未报到" ? "amber" : "neutral"}">${text(arrival)}</span><small>${row.expected_start_date ? `预计 ${safe(row.expected_start_date)}` : "到岗日期未填写"}</small></td>
				<td data-label="操作"><button class="interview-register__open" data-registration="${safe(row.name)}">查看登记 <span aria-hidden="true">→</span></button></td></tr>`;
		}).join("")}</tbody></table></div>`;
	}

	empty(message) {
		return `<div class="recruitment-center__empty">${frappe.utils.escape_html(message)}</div>`;
	}
}
