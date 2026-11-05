frappe.pages["dingtalk-roster-review"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("钉钉资料核对"), single_column: true });
	const api = "hrms.api.dingtalk_roster_tasks.";
	const integration = "hrms.api.dingtalk_integration.";
	const esc = value => frappe.utils.escape_html(String(value ?? ""));
	const display = value => typeof value === "object" && value !== null ? JSON.stringify(value, null, 2) : String(value ?? "");
	const company = () => window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults.get_user_default("Company") || "";
	const state = { company: "", sync: "", start: 0, rows: [], detail: null, request: 0, detailRequest: 0, timer: null, active: false, busy: false, query: "", filter: "all", sortBy: "employee_code", sortOrder: "asc", selected: new Set(), dirty: false, running: false };
	const body = $(page.body);
	body.html(`<div class="dingtalk-review"><div class="review-status"></div><div class="review-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0"></div><div class="review-list"></div><div class="review-detail" hidden></div></div>`);
	const status = body.find(".review-status")[0], actions = body.find(".review-actions")[0];
	const list = body.find(".review-list")[0], detail = body.find(".review-detail")[0];
	page.set_secondary_action(__("返回花名册"), () => leave(() => frappe.set_route("List", "Employee")));
	function leave(fn) {
		if (state.busy) return;
		if (state.dirty) frappe.confirm(__("本次核对尚未保存，确定放弃这些选择吗？"), () => { state.dirty = false; fn(); });
		else fn();
	}
	function showList() {
		state.detailRequest++; state.detail = null; detail.hidden = true;
		status.hidden = false; actions.hidden = false; list.hidden = false;
		page.set_title?.(__("钉钉资料核对"));
	}
	function badge(value) {
		const tone = /待人工|差异|失败|冲突/.test(value || "") ? "conflict" : /待匹配|待导入/.test(value || "") ? "pending" : "neutral";
		return `<span class="review-badge review-badge--${tone}">${esc(value || "待核对")}</span>`;
	}
	function valid(c) { return state.active && c === company() && c === state.company; }
	function call(method, args) { return Promise.resolve(frappe.call({ method, args })).then(r => r.message); }
	function failure(error) { if (state.active) frappe.msgprint(__("操作失败，请查看服务器提示。您可以刷新后重试。")); }
	function button(parent, label, fn, disabled = false) {
		const el = document.createElement("button"); el.type = "button"; el.className = "btn btn-default btn-sm";
		el.textContent = __(label); el.disabled = disabled; el.onclick = fn; parent.appendChild(el); return el;
	}
	function progressView(result) {
		if (!["已排队", "运行中"].includes(result.status)) return "";
		const p = result.progress || {}, completed = Math.max(0, Number(p.completed) || 0);
		const known = p.total !== null && p.total !== undefined && Number(p.total) > 0;
		const total = known ? Number(p.total) : 0;
		const percent = known ? Math.min(100, Math.floor(completed / total * 100)) : null;
		const stage = p.stage || (result.status === "已排队" ? "等待后台任务启动" : "正在拉取全员资料，等待后台报告进度");
		const count = known ? `已处理 ${completed} / ${total} 人（${percent}%）` : completed ? `已发现 ${completed} 人，总人数仍在统计` : "正在统计人数";
		return `<div role="status" aria-live="polite" style="padding:16px;background:var(--subtle-fg,#f5f7fa);border-radius:8px;margin:12px 0"><strong>${esc(stage)}</strong><p style="margin:8px 0">${esc(count)} · 失败 ${esc(p.failed || 0)} 人</p><progress aria-label="全员拉取当前阶段进度" ${known ? `max="${total}" value="${Math.min(completed, total)}"` : ""} style="display:block;width:100%;height:14px"></progress><p class="text-muted" style="margin:8px 0 0">每 3 秒自动刷新。拉取与比对完成后，名单会统一显示。${Number(p.stale_seconds) >= 90 ? `已有 ${esc(p.stale_seconds)} 秒未收到新进度，请检查后台队列或钉钉接口；这不代表任务已完成。` : ""}</p></div>`;
	}

	async function load(preserveScroll = false) {
		const grid = preserveScroll === true ? list.querySelector(".review-grid-scroll") : null;
		const position = grid ? { top: grid.scrollTop, left: grid.scrollLeft } : null;
		const ancestors = [];
		if (preserveScroll === true) for (let el = list.parentElement; el; el = el.parentElement) ancestors.push([el, el.scrollTop, el.scrollLeft]);
		clearTimeout(state.timer);
		const c = company();
		if (!state.active) return;
		if (!c) { showList(); state.detailRequest++; state.request++; state.dirty = false; list.innerHTML = ""; actions.innerHTML = ""; status.textContent = __("请先选择公司。"); return; }
		if (state.company !== c) { state.company = c; state.selected.clear(); state.sync = ""; state.start = 0; state.detail = null; state.detailRequest++; state.dirty = false; detail.innerHTML = ""; showList(); list.innerHTML = ""; }
		status.querySelector("[data-progress-error]")?.remove?.();
		const request = ++state.request;
		try {
			const result = await call(api + "list_roster_employees", { company: c, sync_log: state.sync, start: state.start, page_length: 100, query: state.query, review_filter: state.filter, sort_by: state.sortBy, sort_order: state.sortOrder });
			if (!valid(c) || request !== state.request) return;
			if (state.sync !== (result.sync_log || "")) state.selected.clear();
			state.sync = result.sync_log || ""; state.rows = result.rows || [];
			const running = ["已排队", "运行中"].includes(result.status);
			state.running = running;
			status.innerHTML = `<p>${esc(c)} · ${esc(result.status || "尚未拉取")} · ${esc(result.total || 0)} 人 · ${esc(result.failed || 0)} 人失败</p><p class="text-muted">批次：${esc(state.sync || "—")}。全量拉取仅供核对；更新花名册可选全部或勾选员工。已有值差异需逐项核对，未返回的资料不会自动补造。</p>${progressView(result)}${result.error_message ? `<p class="text-danger">${esc(result.error_message)}</p>` : ""}`;
			actions.innerHTML = "";
			button(actions, running ? "正在拉取…" : "拉取钉钉全员", pull, running || state.busy);
			button(actions, "刷新名单", load, state.busy);
			button(actions, "全部更新预检", () => preview(false), result.status !== "已完成" || state.busy);
			const selectedButton = button(actions, "所选员工更新预检", () => preview(true), true);
			const filter = document.createElement("select"); filter.className = "form-control input-sm review-filter";
			filter.setAttribute?.("aria-label", "核对状态筛选（整个批次）");
			filter.innerHTML = '<option value="all">全部核对状态</option><option value="conflict">待处理 / 异常</option><option value="same">无变更</option>';
			filter.value = state.filter; actions.appendChild(filter);
			const search = document.createElement("input"); search.value = state.query; search.setAttribute?.("aria-label", "查询整个批次员工"); search.className = "form-control input-sm"; search.style.maxWidth = "260px"; search.placeholder = __("查询工号、姓名、部门、职位、状态"); actions.appendChild(search);
			button(actions, "查询", () => { state.query = search.value; state.start = 0; load(); }, state.busy);
			button(actions, "重置查询", () => { state.query = ""; state.filter = "all"; state.start = 0; load(); }, state.busy);
			const sorting = document.createElement("select"); sorting.className = "form-control input-sm"; sorting.style.maxWidth = "170px";
			sorting.setAttribute?.("aria-label", "排序字段");
			sorting.innerHTML = [["employee_code", "工号"], ["employee_name", "姓名"], ["department", "部门"], ["designation", "职位"], ["date_of_joining", "入职日期"], ["matched_employee", "系统员工"], ["import_status", "核对状态"]].map(([key, label]) => `<option value="${key}">按${label}排序</option>`).join("");
			sorting.value = state.sortBy; actions.appendChild(sorting);
			sorting.onchange = () => { state.query = search.value; state.sortBy = sorting.value; state.start = 0; load(); };
			button(actions, state.sortOrder === "asc" ? "升序 ↑" : "降序 ↓", () => { state.query = search.value; state.sortOrder = state.sortOrder === "asc" ? "desc" : "asc"; state.start = 0; load(); }, state.busy);

			function renderRows() {
				const rows = state.rows;
				selectedButton.textContent = __("所选员工更新预检（{0}）", [state.selected.size]);
				selectedButton.disabled = !state.selected.size || result.status !== "已完成" || state.busy;
				const pending = state.rows.filter(row => row.import_status !== "无变更").length;
				list.innerHTML = `<div class="review-list-summary"><strong>员工资料核对工作台</strong><span>批次共 ${esc(result.total || 0)} 人 · 查询匹配 ${esc(result.filtered_total ?? result.total ?? 0)} 人 · 本页 ${esc(rows.length)} 人 · 本页待处理 / 异常 ${esc(pending)} 人 · <span data-selection-count>已选 ${esc(state.selected.size)} 人（跨页保留）</span></span></div><div class="review-grid-scroll"><table class="table review-grid"><thead><tr><th scope="col"><input type="checkbox" data-select-visible="all" aria-label="选择当前显示员工" ${state.busy ? "disabled" : ""}></th>${["工号", "姓名", "部门", "职位", "入职日期", "系统员工", "核对状态", "说明", "操作"].map(t => `<th scope="col">${esc(t)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, i) => `<tr class="${row.import_status === "待人工比对" ? "review-row-conflict" : ""}"><td><input type="checkbox" data-select-row="${i}" aria-label="选择${esc(row.employee_name || row.employee_code || row.name)}" ${state.selected.has(row.name) ? "checked" : ""} ${state.busy ? "disabled" : ""}></td>${[row.employee_code, row.employee_name, row.department, row.designation, row.date_of_joining, row.matched_employee].map(v => `<td>${esc(v || "—")}</td>`).join("")}<td>${badge(row.import_status)}</td><td class="review-explanation">${esc(row.error_message || "—")}</td><td><button class="btn btn-default btn-sm" data-detail="${i}">${row.import_status === "无变更" ? "查看资料" : "进入核对"}</button></td></tr>`).join("") || `<tr><td colspan="10">${running ? "正在拉取和比对员工资料，完成后显示名单…" : "没有符合条件的记录"}</td></tr>`}</tbody></table></div><div class="review-selection-bar" style="position:sticky;bottom:0;z-index:2;background:var(--card-bg,#fff);padding:12px 0;display:flex;align-items:center;gap:12px;border-top:1px solid var(--border-color,#ddd)"><strong data-selection-action-count></strong><div data-direct-selected></div><span class="text-muted">跨页保留勾选</span><span data-direct-feedback role="status" aria-live="polite"></span></div><div class="review-pager"><span>第 ${esc(Math.floor(state.start / 100) + 1)} 页 · 查询、筛选及排序作用于整个批次</span></div>`;
				list.querySelectorAll("[data-detail]").forEach(el => { el.onclick = () => openDetail(rows[Number(el.dataset.detail)].name); });
				const selectVisible = list.querySelector("[data-select-visible]");
				selectVisible.checked = rows.length > 0 && rows.every(row => state.selected.has(row.name));
				selectVisible.indeterminate = !selectVisible.checked && rows.some(row => state.selected.has(row.name));
				selectVisible.disabled = state.busy || !rows.length;
				selectVisible.onchange = () => { if (state.busy) return; rows.forEach(row => selectVisible.checked ? state.selected.add(row.name) : state.selected.delete(row.name)); updateSelection(); };
				list.querySelectorAll("[data-select-row]").forEach(el => { el.onchange = () => { if (state.busy) return; const name = rows[Number(el.dataset.selectRow)].name; if (el.checked) state.selected.add(name); else state.selected.delete(name); updateSelection(); }; });
				const directButton = button(list.querySelector("[data-direct-selected]"), "直接更新所选员工", directUpdate, true);
				const pager = list.querySelector(".review-pager");
				const clearButton = button(pager, "清空选择", () => { state.selected.clear(); updateSelection(); }, !state.selected.size || state.busy);
				button(pager, "上一页", () => { state.start = Math.max(0, state.start - 100); load(); }, !state.start);
				button(pager, "下一页", () => { state.start = result.next_start; load(); }, !result.has_more);
				function updateSelection() {
					// Update controls in place: keep the table, focus and scroll containers intact.
					const count = state.selected.size;
					selectedButton.textContent = __("所选员工更新预检（{0}）", [count]);
					selectedButton.disabled = directButton.disabled = !count || result.status !== "已完成" || state.busy;
					directButton.textContent = __("直接更新所选员工（{0}）", [count]);
					list.querySelector("[data-selection-count]").textContent = __("已选 {0} 人（跨页保留）", [count]);
					list.querySelector("[data-selection-action-count]").textContent = __("已选 {0} 人", [count]);
					selectVisible.checked = rows.length > 0 && rows.every(row => state.selected.has(row.name));
					selectVisible.indeterminate = !selectVisible.checked && rows.some(row => state.selected.has(row.name));
					list.querySelectorAll("[data-select-row]").forEach(el => { el.checked = state.selected.has(rows[Number(el.dataset.selectRow)].name); el.disabled = state.busy; });
					selectVisible.disabled = state.busy || !rows.length;
					clearButton.disabled = !count || state.busy;
				}
				state.updateSelection = updateSelection;
				updateSelection();
			}
			search.oninput = () => { state.query = search.value; }; search.onkeydown = event => { if (event.key === "Enter" && !event.isComposing) { state.query = search.value; state.start = 0; load(); } }; filter.onchange = () => { state.query = search.value; state.filter = filter.value; state.start = 0; load(); }; renderRows();
			if (position) { const currentGrid = list.querySelector(".review-grid-scroll"); currentGrid.scrollTop = position.top; currentGrid.scrollLeft = position.left; }
			ancestors.forEach(([el, top, left]) => { el.scrollTop = top; el.scrollLeft = left; });
			if (running) state.timer = setTimeout(load, 3000);
		} catch (error) { if (valid(c) && request === state.request) { status.innerHTML += '<p class="text-danger" data-progress-error>读取进度失败，5 秒后自动重试，也可点击刷新名单。</p>'; state.timer = setTimeout(load, 5000); } }
	}
	async function directUpdate() {
		if (!valid(state.company) || state.busy || !state.selected.size) return;
		const c = state.company, sync = state.sync;
		const args = { company: c, sync_log: sync, import_names_json: JSON.stringify(Array.from(state.selected).sort()) };
		const feedback = list.querySelector("[data-direct-feedback]");
		feedback.textContent = __("正在检查所选员工的资料差异…");
		state.busy = true; state.updateSelection?.();
		try {
			const result = await call(api + "preview_direct_roster_update", args);
			if (!valid(c) || sync !== state.sync) return;
			if (!result.can_update) { feedback.textContent = (result.issues || []).join("；"); frappe.msgprint({ title: __("请先处理以下问题"), message: (result.issues || []).map(issue => `<p>${esc(issue)}</p>`).join("") }); return; }
			const fields = (result.rows || []).flatMap(row => row.fields.map(f => ({ ...f, import_name: row.name, employee_name: row.employee_name || row.employee })));
			if (!fields.length) { feedback.textContent = __("所选员工没有可更新的差异字段，无需更新。"); return; }
			feedback.textContent = __("有 {0} 项差异，请选择后确认更新。", [fields.length]);
			const dialog = new frappe.ui.Dialog({ title: __("核对并更新所选员工"), size: "extra-large", fields: [{ fieldtype: "HTML", fieldname: "comparisons", options: `<p>请逐项选择保留系统值、采用钉钉值或手动录入。确认后统一保存，无需填写原因。</p><div style="max-height:60vh;overflow:auto"><table class="table table-bordered"><thead><tr><th>员工 / 字段</th><th>系统值</th><th>钉钉值</th><th>处理方式</th><th>保存结果预览</th></tr></thead><tbody>${fields.map((f, i) => `<tr><th>${esc(f.employee_name)}<br>${esc(f.label)}</th><td>${esc(display(f.system_value)) || "空值"}</td><td>${esc(display(f.dingtalk_value))}${f.validation_message ? `<p class="text-danger">${esc(f.validation_message)}</p>` : ""}</td><td><select class="form-control input-sm" data-bulk-choice="${i}" aria-label="${esc(f.employee_name)} ${esc(f.label)}处理方式"><option value="pending">请选择处理方式</option><option value="keep">保留系统值</option><option value="dingtalk" ${f.can_apply ? "" : "disabled"}>采用钉钉值</option><option value="custom">手动录入新值</option></select><div data-bulk-custom="${i}" hidden></div></td><td data-bulk-result="${i}">待选择</td></tr>`).join("")}</tbody></table></div>` }], primary_action_label: __("确认并更新所选员工"), primary_action: async () => {
				if (!valid(c) || sync !== state.sync || state.busy) return;
				const decisions = {};
				for (const el of root.querySelectorAll("[data-bulk-choice]")) {
					if (el.value === "pending") { frappe.msgprint(__("请先为每个差异字段选择处理方式。")); return; }
					const i = Number(el.dataset.bulkChoice), f = fields[i];
					(decisions[f.import_name] ||= {})[f.fieldname] = { choice: el.value, ...(el.value === "custom" ? { value: controls.get(i)?.get_value() } : {}) };
				}
				state.busy = true; state.updateSelection?.();
				feedback.textContent = __("正在保存核对结果…");
				try {
					const applied = await call(api + "apply_direct_roster_update", { ...args, preview_token: result.preview_token, decisions_json: JSON.stringify(decisions) });
					dialog.hide();
					if (valid(c) && sync === state.sync) {
						frappe.show_alert(__("已更新 {0} 人、{1} 个字段，其余 {2} 人保留原值或无变更。", [applied.updated, applied.updated_fields, applied.unchanged]));
						state.busy = false; await load(true);
					}
				} catch (error) { if (valid(c)) feedback.textContent = __("保存失败，核对选择已保留，请查看提示后重试。"); failure(error); } finally { state.busy = false; state.updateSelection?.(); }
			} });
			dialog.show();
			const root = dialog.fields_dict.comparisons.$wrapper[0], controls = new Map();
			root.querySelectorAll("[data-bulk-choice]").forEach(select => {
				select.value = "pending";
				select.onchange = () => {
					const i = Number(select.dataset.bulkChoice), f = fields[i], parent = root.querySelector(`[data-bulk-custom="${i}"]`);
					const update = () => { root.querySelector(`[data-bulk-result="${i}"]`).textContent = select.value === "pending" ? "待选择" : display(select.value === "keep" ? f.system_value : select.value === "custom" ? controls.get(i)?.get_value() : f.dingtalk_value) || "空值"; };
					parent.hidden = select.value !== "custom";
					if (select.value === "custom" && !controls.has(i)) {
						const control = frappe.ui.form.make_control({ parent, df: { fieldtype: f.fieldtype, fieldname: f.fieldname, label: f.label, options: f.options, change: update }, render_input: true });
						controls.set(i, control); control.set_value(f.system_value);
					}
					update();
				};
			});
		} catch (error) { if (valid(c)) feedback.textContent = __("读取差异失败，请重试。"); failure(error); } finally { state.busy = false; state.updateSelection?.(); }
	}

	async function pull() {
		if (!valid(state.company)) { load(); return; }
		if (state.busy) return;
		const c = state.company; state.busy = true;
		clearTimeout(state.timer); state.request++;
		actions.querySelectorAll("button").forEach(el => { el.disabled = true; });
		status.innerHTML = `<p role="status">正在提交全员拉取任务，请稍候…</p>${progressView({ status: "已排队" })}`;
		try {
			const result = await call(api + "queue_roster_comparison", { company: c });
			if (!valid(c)) return;
			state.selected.clear(); state.sync = result.sync_log; state.start = 0; state.detailRequest++; state.detail = null; state.dirty = false; detail.innerHTML = ""; showList();
		} catch (error) { failure(error); } finally { state.busy = false; load(); }
	}
	async function preview(selectedOnly = false) {
		if (!valid(state.company)) { load(); return; }
		if (state.busy) return;
		const c = state.company, sync = state.sync;
		const selection = selectedOnly ? JSON.stringify(Array.from(state.selected).sort()) : null;
		if (selectedOnly && !state.selected.size) { frappe.msgprint(__("请至少选择一名员工。")); return; }
		try {
			const result = await call(integration + "preview_dingtalk_roster_initial_import", { company: c, ...(selectedOnly ? { import_names_json: selection } : {}) });
			if (!valid(c) || sync !== state.sync) return;
			if (result.sync_log !== sync) { frappe.msgprint(__("批次已变化，请刷新名单后重新预检。")); return; }
			const review = new frappe.ui.Dialog({ title: __(selectedOnly ? "所选员工更新预检" : "全部员工更新预检"), fields: [{ fieldtype: "HTML", fieldname: "summary", options: `<p>${selectedOnly ? `仅更新所选 ${esc(result.selected_count || 0)} 人` : "更新当前批次全部员工"}。工号为并入花名册的必填项，其他缺失资料经人工审核确认后可先录入、后续补齐。已有资料仅补空值；已有值差异须进入员工核对页处理。</p><p>拟新建 ${esc(result.new || 0)} 人，已有 ${esc(result.existing || 0)} 人，补空字段 ${esc(result.fillable || 0)} 项，保留已有值差异 ${esc(result.manual_comparisons || 0)} 项。</p>${(result.warnings || []).length ? `<div class="text-warning" style="max-height:240px;overflow:auto"><strong>以下资料缺失不阻止录入，请人工核对：</strong>${result.warnings.map(w => `<p>${esc(w)}</p>`).join("")}</div>` : ""}${(result.issues || []).map(i => `<p class="text-danger">${esc(i)}</p>`).join("")}` }], primary_action_label: __(result.can_import ? "人工审核确认并更新花名册" : "关闭"), primary_action: async () => {
				if (!result.can_import) { review.hide(); return; }
				if (!valid(c) || state.busy || sync !== state.sync) return;
				state.busy = true;
				try { const applied = await call(integration + "apply_dingtalk_roster_initial_import", { company: c, sync_log: sync, preview_token: result.preview_token, ...(selectedOnly ? { import_names_json: selection } : {}) }); review.hide(); if (valid(c)) frappe.msgprint(__("导入任务已提交：{0}。请在同步记录中查看完成情况。", [applied.operation_log])); }
				catch (error) { failure(error); } finally { state.busy = false; }
			} }); review.show();
		} catch (error) { failure(error); }
	}
	async function openDetail(name) {
		if (!valid(state.company)) { load(); return; }
		const c = state.company, request = ++state.detailRequest;
		state.dirty = false;
		detail.hidden = false; status.hidden = true; actions.hidden = true; list.hidden = true;
		page.set_title?.(__("员工资料核对"));
		detail.innerHTML = '<div data-detail-back></div><p>正在读取资料…</p>';
		button(detail.querySelector("[data-detail-back]"), "返回核对名单", showList);
		try {
			const result = await call(api + "get_roster_employee_detail", { import_name: name, company: c });
			if (!valid(c) || request !== state.detailRequest) return;
			state.detail = result; renderDetail(result);
		} catch (error) { if (valid(c) && request === state.detailRequest) { detail.innerHTML = '<div data-detail-back></div><p class="text-danger">资料读取失败，请返回后重试。</p>'; button(detail.querySelector("[data-detail-back]"), "返回核对名单", showList); failure(error); } }
	}
	function renderDetail(record) {
		const creating = !record.employee;
		const differences = record.fields.filter(f => f.different).length;
		detail.innerHTML = `<div class="review-detail-header"><div><div data-detail-back></div><h3>${esc(record.employee_name)} <small>${esc(record.employee || "尚未建立系统员工档案")}</small></h3>${badge(record.import_status)}</div><div class="review-conflict-count">${esc(differences)} 项差异</div></div>${record.review_note ? `<p class="text-muted">上次核对：${esc(record.review_note)}</p>` : ""}<p class="review-instructions">${creating ? "请核对新员工资料，右侧预览建档值。公司与初始在职状态由当前建档流程确定；缺失资料可补填或暂不录入。" : "红色标记为资料差异。请逐项选择处理方式，右侧预览最终保存值。公司、员工状态、公司工号等受保护字段只供核对。"}</p>${!record.employee ? '<p class="text-warning">此记录尚未建档。请逐项选择采用钉钉值、手动填写或暂不录入；公司工号必须填写真实值。确认预检后才会新建员工。</p>' : ""}<div class="review-grid-scroll review-editor-scroll"><table class="table review-grid review-editor"><thead><tr><th scope="col">字段 / 状态</th><th scope="col">系统当前值</th><th scope="col">钉钉资料值</th><th scope="col">处理方式 / 编辑</th><th scope="col">保存结果预览</th></tr></thead><tbody>${record.fields.map((f, i) => `<tr class="${f.different ? "review-field-conflict" : ""}"><th scope="row">${esc(f.label)}<br><span class="review-badge review-badge--${f.different ? "conflict" : "neutral"}">${f.different ? "资料有差异" : "一致"}</span></th><td class="review-value">${esc(display(f.system_value)) || '<span class="text-muted">空值</span>'}</td><td class="review-value">${esc(display(f.dingtalk_value)) || '<span class="text-muted">空值</span>'}${f.validation_message ? `<p class="text-danger">${esc(f.validation_message)}</p>` : ""}</td><td>${f.editable ? `<select aria-label="${esc(f.label)}处理方式" class="form-control input-sm" data-choice="${i}">${creating || f.different ? '<option value="pending">请选择处理方式</option>' : ""}${creating ? '<option value="skip">暂不录入（保持空值）</option>' : '<option value="keep">保留系统值</option>'}<option value="dingtalk" ${(!creating && !f.different) || !f.can_apply || f.dingtalk_value === "" || f.dingtalk_value === null || f.dingtalk_value === undefined ? "disabled" : ""}>采用钉钉值</option><option value="custom">${creating ? "手动填写" : "手动编辑"}</option></select><div data-custom="${i}" hidden></div>` : `<span class="text-muted">${creating ? "由建档流程确定" : "只读 · 保留系统值"}</span>`}</td><td class="review-value" data-result="${i}">${(creating || f.different) && f.editable ? "待选择" : esc(display(creating ? f.dingtalk_value : f.system_value)) || "空值"}</td></tr>`).join("")}</tbody></table></div><div class="review-save-bar"><div data-save></div><span class="text-muted">${creating ? "按预检确认的资料新建员工；暂不录入的字段保持空值。" : "仅保存明确选择的字段；只读差异不参与修改。"}</span></div><details class="review-source"><summary>查看钉钉原始资料与附件</summary><h4>钉钉原始资料（接口返回）</h4><div class="table-responsive"><table class="table table-bordered">${record.source_fields.map(f => `<tr><th>${esc(f.label)}<br><small>${esc(f.code)}</small></th><td style="white-space:pre-wrap">${esc(display(f.value))}</td></tr>`).join("") || '<tr><td>无智能人事字段，可能仅返回通讯录资料。</td></tr>'}</table></div><details><summary>查看接口返回的完整资料</summary><pre style="max-height:400px;overflow:auto">${esc(display(record.source_data))}</pre></details><h4>附件与图片 · ${esc(record.attachment_status || "无附件")}</h4><p class="text-muted">列出本次接口返回的全部附件。先验证能否下载，再选择归档。归档后可预览图片；只有附件编号、权限不足或链接失效时会显示原因。</p><div data-attachments></div><div data-file-actions style="display:flex;gap:8px;margin-bottom:16px"></div><div data-file-result></div></details>`;
		button(detail.querySelector("[data-detail-back]"), "返回核对名单", () => leave(showList));
		const controls = new Map();
		detail.querySelectorAll("[data-choice]").forEach(select => {
			select.value = creating || record.fields[Number(select.dataset.choice)].different ? "pending" : "keep";
			select.onchange = () => {
				state.dirty = true;
				const index = Number(select.dataset.choice), f = record.fields[index];
				const parent = detail.querySelector(`[data-custom="${index}"]`); parent.hidden = select.value !== "custom";
				if (!controls.has(index) && select.value === "custom") {
					const control = frappe.ui.form.make_control({ parent, df: { fieldtype: f.fieldtype, fieldname: f.fieldname, label: f.label, options: f.options, change: () => {
						state.dirty = true;
						if (select.value === "custom") detail.querySelector(`[data-result="${index}"]`).textContent = display(controls.get(index)?.get_value()) || "空值";
					} }, render_input: true });
					controls.set(index, control); control.set_value(creating ? f.dingtalk_value : f.system_value);
				}
				detail.querySelector(`[data-result="${index}"]`).textContent = select.value === "pending" ? "待选择" : display(select.value === "dingtalk" ? f.dingtalk_value : select.value === "custom" ? controls.get(index).get_value() : select.value === "skip" ? "" : f.system_value) || "空值";
			};
		});
		button(detail.querySelector("[data-save]"), creating ? "预检并新建员工" : "保存所选字段", () => creating ? createEmployee(record, controls) : save(record, controls));
		const files = detail.querySelector("[data-attachments]");
		files.innerHTML = record.attachments.map(f => `<div style="border:1px solid #ddd;padding:12px;margin:8px 0"><label><input type="checkbox" data-file="${f.index}"> ${esc(f.field_name)} · ${esc(f.file_name)}</label><p>${esc(f.sync_status || (f.download_available ? "可尝试下载验证" : "接口未提供下载信息"))} ${esc(f.sync_message || "")}</p>${f.file_url ? `<a href="${esc(f.file_url)}" target="_blank" rel="noopener noreferrer">查看已归档附件</a>${f.is_image ? `<div><img src="${esc(f.file_url)}" alt="${esc(f.file_name)}" loading="lazy" style="max-width:240px;max-height:180px;margin:8px 0"></div>` : ""}` : ""}</div>`).join("") || "<p>本次接口没有返回附件或图片。</p>";
		button(detail.querySelector("[data-file-actions]"), "验证所选附件能否下载", () => fileAction(record, true), !record.attachments.length);
		button(detail.querySelector("[data-file-actions]"), "归档所选附件到员工", () => leave(() => fileAction(record, false)), !record.employee || !record.attachments.length);
	}
	async function createEmployee(record, controls) {
		if (!valid(state.company) || state.busy) return;
		const c = state.company, request = state.detailRequest;
		const decisions = {};
		for (const el of detail.querySelectorAll("[data-choice]")) {
			if (el.value === "pending") { frappe.msgprint(__("请先为每个字段选择处理方式。")); return; }
			const i = Number(el.dataset.choice), f = record.fields[i];
			decisions[f.fieldname] = { choice: el.value, ...(el.value === "custom" ? { value: controls.get(i)?.get_value() } : {}) };
		}
		const args = { import_name: record.name, company: c, decisions_json: JSON.stringify(decisions) };
		state.busy = true;
		try {
			const result = await call(api + "preview_roster_new_employee", args);
			if (!valid(c) || request !== state.detailRequest) return;
			const dialog = new frappe.ui.Dialog({ title: __("新员工建档预检"), fields: [{ fieldtype: "HTML", fieldname: "preview", options: `<p>确认后将按以下资料新建一名员工。</p><table class="table table-bordered">${Object.entries(result.values || {}).map(([name, value]) => `<tr><th>${esc(result.labels?.[name] || name)}</th><td>${esc(display(value))}</td></tr>`).join("")}</table>${(result.issues || []).map(issue => `<p class="text-danger">${esc(issue)}</p>`).join("")}${(result.warnings || []).length ? `<p class="text-warning">以下资料未填写：${esc(result.warnings.join("、"))}。确认后保持空值，后续补齐。</p>` : ""}` }], primary_action_label: __(result.can_create ? "确认资料并新建员工" : "返回修改"), primary_action: async () => {
				if (!result.can_create) { dialog.hide(); return; }
				if (!valid(c) || request !== state.detailRequest || state.busy) return;
				state.busy = true;
				try {
					const created = await call(api + "create_roster_new_employee", { ...args, preview_token: result.preview_token });
					dialog.hide();
					if (valid(c) && request === state.detailRequest) { state.dirty = false; frappe.show_alert(__("员工档案已建立：{0}", [created.employee])); await openDetail(record.name); load(); }
				} catch (error) { failure(error); } finally { state.busy = false; }
			} }); dialog.show();
		} catch (error) { failure(error); } finally { state.busy = false; }
	}

	async function save(record, controls) {
		if (!valid(state.company)) { load(); return; }
		if (state.busy) return;
		const c = state.company, request = state.detailRequest, selected = [], kept = [], custom = {};
		if (Array.from(detail.querySelectorAll("[data-choice]")).some(el => el.value === "pending")) { frappe.msgprint(__("请先为每个可编辑的差异字段选择处理方式。")); return; }
		detail.querySelectorAll("[data-choice]").forEach(el => { const i = Number(el.dataset.choice), f = record.fields[i]; if (el.value !== "keep") selected.push(f.fieldname); else if (f.different && f.editable) kept.push(f.fieldname); if (el.value === "custom") custom[f.fieldname] = controls.get(i).get_value(); });
		if (!selected.length && !kept.length) { frappe.msgprint(__("请选择需要修改或确认保留的差异字段。")); return; }
		state.busy = true;
		try { await call(integration + "apply_dingtalk_employee_comparison", { import_name: record.name, fieldnames_json: JSON.stringify(selected), custom_values_json: JSON.stringify(custom), expected_modified: record.employee_modified, expected_import_modified: record.import_modified, keep_fieldnames_json: JSON.stringify(kept) }); if (valid(c) && request === state.detailRequest) { state.dirty = false; frappe.show_alert(__("所选字段已保存")); await openDetail(record.name); load(); } }
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
