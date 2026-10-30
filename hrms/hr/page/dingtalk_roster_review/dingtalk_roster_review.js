frappe.pages["dingtalk-roster-review"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("钉钉资料核对"), single_column: true });
	const api = "hrms.api.dingtalk_roster_tasks.";
	const integration = "hrms.api.dingtalk_integration.";
	const esc = value => frappe.utils.escape_html(String(value ?? ""));
	const display = value => typeof value === "object" && value !== null ? JSON.stringify(value, null, 2) : String(value ?? "");
	const company = () => window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults.get_user_default("Company") || "";
	const state = { company: "", sync: "", start: 0, rows: [], detail: null, request: 0, detailRequest: 0, timer: null, active: false, busy: false };
	const body = $(page.body);
	body.html(`<div class="dingtalk-review"><div class="review-status"></div><div class="review-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0"></div><div class="review-list"></div><div class="review-detail" style="margin-top:24px"></div></div>`);
	const status = body.find(".review-status")[0], actions = body.find(".review-actions")[0];
	const list = body.find(".review-list")[0], detail = body.find(".review-detail")[0];
	page.set_secondary_action(__("返回花名册"), () => frappe.set_route("List", "Employee"));
	function valid(c) { return state.active && c === company() && c === state.company; }
	function call(method, args) { return Promise.resolve(frappe.call({ method, args })).then(r => r.message); }
	function failure(error) { if (state.active) frappe.msgprint(__("操作失败，请查看服务器提示。您可以刷新后重试。")); }
	function button(parent, label, fn, disabled = false) {
		const el = document.createElement("button"); el.type = "button"; el.className = "btn btn-default btn-sm";
		el.textContent = __(label); el.disabled = disabled; el.onclick = fn; parent.appendChild(el); return el;
	}
	async function load() {
		clearTimeout(state.timer);
		const c = company();
		if (!state.active) return;
		if (!c) { status.textContent = __("请先选择公司。"); return; }
		if (state.company !== c) { state.company = c; state.sync = ""; state.start = 0; state.detail = null; state.detailRequest++; detail.innerHTML = ""; }
		const request = ++state.request;
		try {
			const result = await call(api + "list_roster_employees", { company: c, sync_log: state.sync, start: state.start, page_length: 100 });
			if (!valid(c) || request !== state.request) return;
			state.sync = result.sync_log || ""; state.rows = result.rows || [];
			const running = ["已排队", "运行中"].includes(result.status);
			status.innerHTML = `<p>${esc(c)} · ${esc(result.status || "尚未拉取")} · ${esc(result.total || 0)} 人 · ${esc(result.failed || 0)} 人失败</p><p class="text-muted">批次：${esc(state.sync || "—")}。展示通讯录与智能人事接口返回的资料；未返回的资料不会自动补造。</p>${result.error_message ? `<p class="text-danger">${esc(result.error_message)}</p>` : ""}`;
			actions.innerHTML = "";
			button(actions, "拉取钉钉全员", pull, running || state.busy);
			button(actions, "刷新名单", load, state.busy);
			button(actions, "预检导入花名册", preview, result.status !== "已完成" || state.busy);
			const search = document.createElement("input"); search.className = "form-control input-sm"; search.style.maxWidth = "260px"; search.placeholder = __("搜索本页工号、姓名、部门、状态"); actions.appendChild(search);
			function renderRows() {
				const q = search.value.trim().toLowerCase();
				const rows = state.rows.filter(row => [row.employee_code, row.employee_name, row.department, row.import_status].some(v => String(v || "").toLowerCase().includes(q)));
				list.innerHTML = `<div class="table-responsive"><table class="table table-bordered table-hover"><thead><tr>${["工号", "姓名", "部门", "职位", "入职日期", "系统员工", "核对状态", "说明", "操作"].map(t => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, i) => `<tr>${[row.employee_code, row.employee_name, row.department, row.designation, row.date_of_joining, row.matched_employee, row.import_status, row.error_message].map(v => `<td>${esc(v)}</td>`).join("")}<td><button class="btn btn-default btn-xs" data-detail="${i}">查看 / 核对</button></td></tr>`).join("") || '<tr><td colspan="9">暂无记录</td></tr>'}</tbody></table></div><div class="review-pager"></div>`;
				list.querySelectorAll("[data-detail]").forEach(el => { el.onclick = () => openDetail(rows[Number(el.dataset.detail)].name); });
				const pager = list.querySelector(".review-pager");
				button(pager, "上一页", () => { state.start = Math.max(0, state.start - 100); load(); }, !state.start);
				button(pager, "下一页", () => { state.start = result.next_start; load(); }, !result.has_more);
			}
			search.oninput = renderRows; renderRows();
			if (running) state.timer = setTimeout(load, 3000);
		} catch (error) { if (valid(c) && request === state.request) { status.textContent = __("读取失败，请刷新重试。"); failure(error); } }
	}
	async function pull() {
		if (!valid(state.company)) { load(); return; }
		if (state.busy) return;
		const c = state.company; state.busy = true;
		try {
			const result = await call(api + "queue_roster_comparison", { company: c });
			if (!valid(c)) return;
			state.sync = result.sync_log; state.start = 0; state.detailRequest++; state.detail = null; detail.innerHTML = "";
		} catch (error) { failure(error); } finally { state.busy = false; load(); }
	}
	async function preview() {
		if (!valid(state.company)) { load(); return; }
		const c = state.company, sync = state.sync;
		try {
			const result = await call(integration + "preview_dingtalk_roster_initial_import", { company: c });
			if (!valid(c) || sync !== state.sync) return;
			if (result.sync_log !== sync) { frappe.msgprint(__("批次已变化，请刷新名单后重新预检。")); return; }
			const review = new frappe.ui.Dialog({ title: __("全员导入预检"), fields: [{ fieldtype: "HTML", fieldname: "summary", options: `<p>拟新建 ${esc(result.new || 0)} 人，已有 ${esc(result.existing || 0)} 人，补空字段 ${esc(result.fillable || 0)} 项，保留已有值差异 ${esc(result.manual_comparisons || 0)} 项。</p>${(result.issues || []).map(i => `<p class="text-danger">${esc(i)}</p>`).join("")}` }], primary_action_label: __(result.can_import ? "确认导入花名册" : "关闭"), primary_action: async () => {
				if (!result.can_import) { review.hide(); return; }
				if (!valid(c) || state.busy || sync !== state.sync) return;
				state.busy = true;
				try { const applied = await call(integration + "apply_dingtalk_roster_initial_import", { company: c, sync_log: sync, preview_token: result.preview_token }); review.hide(); if (valid(c)) frappe.msgprint(__("导入任务已提交：{0}。请在同步记录中查看完成情况。", [applied.operation_log])); }
				catch (error) { failure(error); } finally { state.busy = false; }
			} }); review.show();
		} catch (error) { failure(error); }
	}
	async function openDetail(name) {
		if (!valid(state.company)) { load(); return; }
		const c = state.company, request = ++state.detailRequest;
		detail.textContent = __("正在读取资料…");
		try {
			const result = await call(api + "get_roster_employee_detail", { import_name: name, company: c });
			if (!valid(c) || request !== state.detailRequest) return;
			state.detail = result; renderDetail(result);
		} catch (error) { if (valid(c) && request === state.detailRequest) { detail.textContent = __("资料读取失败，请重新点击查看。"); failure(error); } }
	}
	function renderDetail(record) {
		detail.innerHTML = `<hr><h3>${esc(record.employee_name)} · 资料核对</h3><p>${esc(record.employee || "尚未建立系统员工档案")} · ${esc(record.import_status)}</p>${record.review_note ? `<p class="text-muted">上次核对：${esc(record.review_note)}</p>` : ""}<p class="text-muted">逐项保留系统值、采用钉钉值或自定义。公司、员工状态、公司工号等受保护字段只供核对。保存前需填写原因。</p><div class="table-responsive"><table class="table table-bordered"><thead><tr><th>字段</th><th>系统值</th><th>钉钉值</th><th>处理选择</th><th>自定义值</th></tr></thead><tbody>${record.fields.map((f, i) => `<tr ${f.different ? 'class="warning"' : ""}><td>${esc(f.label)}${f.different ? '<br><span class="text-warning">有差异</span>' : ""}</td><td style="white-space:pre-wrap">${esc(display(f.system_value))}</td><td style="white-space:pre-wrap">${esc(display(f.dingtalk_value))}${f.validation_message ? `<p class="text-danger">${esc(f.validation_message)}</p>` : ""}</td><td>${f.editable ? `<select class="form-control input-sm" data-choice="${i}"><option value="keep">保留系统值</option><option value="dingtalk" ${!f.different || !f.can_apply ? "disabled" : ""}>采用钉钉值</option><option value="custom">自定义</option></select>` : "只读"}</td><td><div data-custom="${i}" hidden></div></td></tr>`).join("")}</tbody></table></div><textarea class="form-control" data-reason placeholder="填写本次核对修改原因"></textarea><div data-save style="margin:12px 0"></div><h4>钉钉原始资料（接口返回）</h4><div class="table-responsive"><table class="table table-bordered">${record.source_fields.map(f => `<tr><th>${esc(f.label)}<br><small>${esc(f.code)}</small></th><td style="white-space:pre-wrap">${esc(display(f.value))}</td></tr>`).join("") || '<tr><td>无智能人事字段，可能仅返回通讯录资料。</td></tr>'}</table></div><details><summary>查看接口返回的完整资料</summary><pre style="max-height:400px;overflow:auto">${esc(display(record.source_data))}</pre></details><h4>附件与图片 · ${esc(record.attachment_status || "无附件")}</h4><p class="text-muted">列出本次接口返回的全部附件。先验证能否下载，再选择归档。归档后可预览图片；只有附件编号、权限不足或链接失效时会显示原因。</p><div data-attachments></div><div data-file-actions style="display:flex;gap:8px;margin-bottom:16px"></div><div data-file-result></div>`;
		const controls = new Map();
		detail.querySelectorAll("[data-choice]").forEach(select => {
			select.onchange = () => {
				const index = Number(select.dataset.choice), f = record.fields[index];
				const parent = detail.querySelector(`[data-custom="${index}"]`); parent.hidden = select.value !== "custom";
				if (!controls.has(index) && select.value === "custom") {
					const control = frappe.ui.form.make_control({ parent, df: { fieldtype: f.fieldtype, fieldname: f.fieldname, label: f.label, options: f.options }, render_input: true });
					control.set_value(f.system_value); controls.set(index, control);
				}
			};
		});
		button(detail.querySelector("[data-save]"), "保存所选字段", () => save(record, controls), !record.employee);
		const files = detail.querySelector("[data-attachments]");
		files.innerHTML = record.attachments.map(f => `<div style="border:1px solid #ddd;padding:12px;margin:8px 0"><label><input type="checkbox" data-file="${f.index}"> ${esc(f.field_name)} · ${esc(f.file_name)}</label><p>${esc(f.sync_status || (f.download_available ? "可尝试下载验证" : "接口未提供下载信息"))} ${esc(f.sync_message || "")}</p>${f.file_url ? `<a href="${esc(f.file_url)}" target="_blank" rel="noopener noreferrer">查看已归档附件</a>${f.is_image ? `<div><img src="${esc(f.file_url)}" alt="${esc(f.file_name)}" loading="lazy" style="max-width:240px;max-height:180px;margin:8px 0"></div>` : ""}` : ""}</div>`).join("") || "<p>本次接口没有返回附件或图片。</p>";
		button(detail.querySelector("[data-file-actions]"), "验证所选附件能否下载", () => fileAction(record, true), !record.attachments.length);
		button(detail.querySelector("[data-file-actions]"), "归档所选附件到员工", () => fileAction(record, false), !record.employee || !record.attachments.length);
	}
	async function save(record, controls) {
		if (!valid(state.company)) { load(); return; }
		if (state.busy) return;
		const c = state.company, request = state.detailRequest, selected = [], kept = [], custom = {};
		detail.querySelectorAll("[data-choice]").forEach(el => { const i = Number(el.dataset.choice), f = record.fields[i]; if (el.value !== "keep") selected.push(f.fieldname); else if (f.different) kept.push(f.fieldname); if (el.value === "custom") custom[f.fieldname] = controls.get(i).get_value(); });
		const reason = detail.querySelector("[data-reason]").value.trim();
		if ((!selected.length && !kept.length) || !reason) { frappe.msgprint(__("请选择需要修改的字段并填写原因。")); return; }
		state.busy = true;
		try { await call(integration + "apply_dingtalk_employee_comparison", { import_name: record.name, fieldnames_json: JSON.stringify(selected), custom_values_json: JSON.stringify(custom), expected_modified: record.employee_modified, expected_import_modified: record.import_modified, keep_fieldnames_json: JSON.stringify(kept), reason }); if (valid(c) && request === state.detailRequest) { frappe.show_alert(__("所选字段已保存")); await openDetail(record.name); load(); } }
		catch (error) { failure(error); } finally { state.busy = false; }
	}
	async function fileAction(record, verify) {
		if (!valid(state.company)) { load(); return; }
		if (state.busy) return;
		const c = state.company, request = state.detailRequest;
		const indexes = Array.from(detail.querySelectorAll("[data-file]:checked")).map(el => Number(el.dataset.file));
		if (!indexes.length) { frappe.msgprint(__("请先选择附件。")); return; }
		state.busy = true;
		try {
			const result = await call(api + "import_roster_employee_attachments", { import_name: record.name, company: c, indexes_json: JSON.stringify(indexes), verify_only: verify ? 1 : 0 });
			if (!valid(c) || request !== state.detailRequest) return;
			if (verify) detail.querySelector("[data-file-result]").innerHTML = result.results.map(r => `<p>${esc(record.attachments[r.index].file_name)}：${esc(r.verified ? `可下载（${r.bytes} 字节）` : r.reason || "下载失败")}</p>`).join("");
			else { frappe.msgprint(__("已归档 {0} 个，无法下载 {1} 个，失败 {2} 个。", [result.downloaded || 0, result.unavailable || 0, result.failed || 0])); await openDetail(record.name); }
		} catch (error) { failure(error); } finally { state.busy = false; }
	}
	button(actions, "刷新名单", load);
	wrapper.__dingtalkReview = { show() { state.active = true; load(); }, hide() { state.active = false; state.request++; state.detailRequest++; clearTimeout(state.timer); } };
};
frappe.pages["dingtalk-roster-review"].on_page_show = wrapper => wrapper.__dingtalkReview?.show();
frappe.pages["dingtalk-roster-review"].on_page_hide = wrapper => wrapper.__dingtalkReview?.hide();
