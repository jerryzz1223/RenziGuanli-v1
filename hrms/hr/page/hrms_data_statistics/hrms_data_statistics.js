function set_data_statistics_layout(enabled) {
	document.body.classList.toggle("hrms-data-statistics-page", enabled);
}

frappe.pages["hrms-data-statistics"].on_page_load = function (wrapper) {
	set_data_statistics_layout(true);
	$(wrapper).closest(".page-container").addClass("hrms-data-statistics-wide-layout");
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("数据统计"),
		single_column: true,
	});
	page.set_primary_action(__("刷新数据"), () => load(), "refresh");

	const state = {
		data: null,
		month: "",
		search: "",
		view: "forms",
		operatorData: null,
		operatorSearch: "",
		activity: null,
		activityType: "all",
	};
	const escape = (value) => frappe.utils.escape_html(value == null ? "" : String(value));
	const person = (label, account, emptyLabel = __("未记录")) => label || account
		? `<strong class="hrms-data-statistics__person">${escape(label || account)}</strong>${label && account && label !== account ? `<small>${escape(account)}</small>` : ""}`
		: `<span class="text-muted">${escape(emptyLabel)}</span>`;
	const approval = (table) => table.approved_by
		? person(table.approved_by_label, table.approved_by)
		: `<span class="text-muted">${table.approval_status === "pending" ? __("暂无审批") : __("未配置审批")}</span>`;

	function visibleTables() {
		const keyword = state.search.trim().toLowerCase();
		const tables = (state.data?.groups || []).flatMap((group) => group.tables || []);
		if (!keyword) return tables;
		return tables.filter((table) =>
			`${table.label || ""} ${table.doctype || ""}`.toLowerCase().includes(keyword),
		);
	}

	function operationSummary(counts = {}) {
		return [["imported", __("导入")], ["modified", __("修改")], ["submitted", __("提交")], ["approved", __("审批")], ["cancelled", __("取消")]]
			.filter(([key]) => counts[key])
			.map(([key, label]) => `${label} ${counts[key]}`)
			.join(" · ") || __("暂无操作");
	}

	function reviewSignal(audit = {}) {
		const counts = audit.operation_types || {};
		const signals = [];
		if (counts.cancelled) signals.push(__("有取消提交"));
		if ((counts.modified || 0) >= 10 && (counts.modified || 0) > (counts.imported || 0) * 2) signals.push(__("修改次数偏高"));
		if ((audit.daily_average || 0) >= 100) signals.push(__("单日高频"));
		return signals.length ? { label: __("待复核：{0}", [signals.join("、")]), level: "warning" } : { label: __("暂无明显提示"), level: "normal" };
	}

	function renderFormAudit(monthLabel) {
		const audits = new Map((state.operatorData?.forms || []).map((form) => [form.doctype, form]));
		const tables = visibleTables();
		if (!tables.length) return `<div class="hrms-data-statistics__empty">${__("没有找到匹配的表单")}</div>`;
		return `
			<section class="hrms-data-statistics__group">
				<div class="hrms-data-statistics__group-head">
					<div><h4>${__("表单操作审计")}</h4><p>${__("按表单查看操作人、操作频率与待复核信号；记录数和更新时间仅作辅助信息。")}</p></div>
					<span>${__("{0} 张表", [tables.length])}</span>
				</div>
				<div class="table-responsive">
					<table class="table hrms-data-statistics__data-table hrms-data-statistics__audit-form-table">
						<thead><tr><th>${__("表单名称")}</th><th>${__("操作人员")}</th><th>${__("导入批次")}</th><th>${__("导入数据量")}</th><th>${__("修改")}</th><th>${__("提交")}</th><th>${__("审批")}</th><th>${__("取消提交")}</th><th>${__("操作总数")}</th><th>${__("活跃天数")}</th><th>${__("日均频率")}</th><th>${__("最近操作时间")}</th><th>${__("复核提示")}</th><th>${__("当前记录数")}</th><th>${__("最后更新时间")}</th><th>${__("{0}更新记录数", [escape(monthLabel)])}</th></tr></thead>
						<tbody>${tables.map((table) => {
							const audit = audits.get(table.doctype) || {};
							const counts = audit.operation_types || {};
							const signal = reviewSignal(audit);
							const operators = (audit.operators || []).map((operator) => `<button type="button" class="hrms-data-statistics__operator-link" data-open-person-form="${escape(table.doctype)}" data-person-user="${escape(operator.user)}">${escape(operator.user_label)} <small>${escape(operator.operation_count)}</small></button>`).join("");
							return `
							<tr>
								<td>
									<button class="hrms-data-statistics__table-link" type="button" data-open-form-audit="${escape(table.doctype)}" ${table.missing ? "disabled" : ""}>${escape(table.label)} <span aria-hidden="true">→</span></button>
									<small>${escape(table.doctype)}</small>
								</td>
								<td>${operators || `<span class="text-muted">${__("本月无操作")}</span>`}</td>
								<td><button type="button" class="hrms-data-statistics__audit-action is-imported" data-open-form-audit="${escape(table.doctype)}" data-operation-type="imported" ${counts.imported ? "" : "disabled"}>${__("导入记录")} <strong>${escape(counts.imported || 0)}</strong></button></td>
								<td>${escape(audit.imported_record_count || 0)}</td>
								<td><button type="button" class="hrms-data-statistics__audit-action is-modified" data-open-form-audit="${escape(table.doctype)}" data-operation-type="modified" ${counts.modified ? "" : "disabled"}>${__("修改记录")} <strong>${escape(counts.modified || 0)}</strong></button></td>
								<td>${escape(counts.submitted || 0)}</td><td>${escape(counts.approved || 0)}</td><td>${escape(counts.cancelled || 0)}</td>
								<td><strong>${escape(audit.operation_count || 0)}</strong></td><td>${escape(audit.active_day_count || 0)}</td><td>${escape(audit.daily_average || 0)} ${__("次/天")}</td><td>${escape(audit.last_operated_at || "-")}</td>
								<td><span class="hrms-data-statistics__review-signal is-${signal.level}">${escape(signal.label)}</span></td><td>${escape(table.record_count)}</td><td>${escape(table.last_modified_at || __("未记录"))}</td><td>${escape(table.monthly_update_count)}</td>
							</tr>`;
						}).join("")}</tbody>
					</table>
				</div>
			</section>`;
	}

	function visiblePeople() {
		const keyword = state.operatorSearch.trim().toLowerCase();
		const people = state.operatorData?.people || [];
		if (!keyword) return people;
		return people.filter((personRow) =>
			`${personRow.user_label || ""} ${personRow.user || ""} ${(personRow.forms || []).map((form) => `${form.label} ${form.doctype}`).join(" ")}`.toLowerCase().includes(keyword),
		);
	}

	function renderPeople() {
		if (!state.operatorData) return `<div class="hrms-data-statistics__empty">${__("正在汇总人员操作记录…")}</div>`;
		const people = visiblePeople();
		if (!people.length) return `<div class="hrms-data-statistics__empty">${__("没有找到匹配的人员操作记录")}</div>`;
		const forms = state.operatorData?.forms || [];
		return `
			<section class="hrms-data-statistics__group">
				<div class="hrms-data-statistics__group-head"><div><h4>${__("人员操作汇总")}</h4><p>${__("点击人员操作过的表单，查看该人员对此表单的完整历史操作记录。")}</p></div><span>${__("{0} 人", [people.length])}</span></div>
				<div class="table-responsive">
					<table class="table hrms-data-statistics__operator-table hrms-data-statistics__operator-matrix">
						<thead><tr><th>${__("操作人员")}</th><th>${__("操作总数")}</th><th>${__("活跃天数")}</th><th>${__("日均频率")}</th><th>${__("最近操作时间")}</th>${forms.map((form) => `<th>${escape(form.label)}<small>${escape(form.doctype)}</small></th>`).join("")}</tr></thead>
						<tbody>${people.map((personRow) => {
							const formMap = new Map((personRow.forms || []).map((form) => [form.doctype, form]));
							return `<tr><td class="hrms-data-statistics__operator-person-cell">${person(personRow.user_label, personRow.user)}</td><td><strong>${escape(personRow.operation_count)}</strong></td><td>${escape(personRow.active_day_count)}</td><td>${escape(personRow.daily_average)} ${__("次/天")}</td><td>${escape(personRow.last_operated_at || "-")}</td>${forms.map((form) => {
								const personForm = formMap.get(form.doctype);
								if (!personForm) return `<td class="text-muted">-</td>`;
								const counts = personForm.operation_types || {};
								const otherOperations = operationSummary({ submitted: counts.submitted, approved: counts.approved, cancelled: counts.cancelled });
								return `<td><div class="hrms-data-statistics__matrix-actions">
									<button type="button" data-open-person-form="${escape(form.doctype)}" data-person-user="${escape(personRow.user)}" data-operation-type="imported" ${counts.imported ? "" : "disabled"}><strong>${__("导入记录")}</strong><span>${__("{0} 批 · {1} 条数据", [counts.imported || 0, personForm.imported_record_count || 0])}</span></button>
									<button type="button" data-open-person-form="${escape(form.doctype)}" data-person-user="${escape(personRow.user)}" data-operation-type="modified" ${counts.modified ? "" : "disabled"}><strong>${__("修改记录")}</strong><span>${__("{0} 次", [counts.modified || 0])}</span></button>
									<small>${otherOperations === __("暂无操作") ? __("日均 {0} 次操作", [personForm.daily_average]) : `${escape(otherOperations)} · ${__("日均 {0} 次操作", [personForm.daily_average])}`}</small>
								</div></td>`;
							}).join("")}</tr>`;
						}).join("")}</tbody>
					</table>
				</div>
			</section>`;
	}

	function changeValue(value) {
		if (value === null || value === undefined || value === "") return `<span class="text-muted">${__("空")}</span>`;
		return escape(typeof value === "object" ? JSON.stringify(value) : value);
	}

	function renderActivity() {
		const activity = state.activity || {};
		const events = activity.events || [];
		const formScope = activity.scope === "form";
		return `
			<section class="hrms-data-statistics__activity">
				<div class="hrms-data-statistics__activity-head">
					<button type="button" class="btn btn-default btn-sm" data-close-activity>← ${formScope ? __("返回表单列表") : __("返回人员列表")}</button>
					<div><h4>${formScope ? escape(activity.doctype_label || activity.doctype) : `${escape(activity.user_label || activity.user)} · ${escape(activity.doctype_label || activity.doctype)}`}</h4><p>${formScope ? __("汇总全部操作人员，共 {0} 条可追溯操作，当前分类 {1} 条", [activity.all_total || 0, activity.total || 0]) : __("共 {0} 条可追溯操作，当前分类 {1} 条", [activity.all_total || 0, activity.total || 0])}</p></div>
				</div>
				<div class="hrms-data-statistics__activity-filters"><strong>${__("记录类型")}</strong><div>${(activity.operation_groups || []).map((group) => `<button type="button" class="${group.key === activity.operation_type ? "is-active" : ""}" data-activity-filter="${escape(group.key)}"><span>${escape(group.label)}</span><strong>${escape(group.count)}</strong></button>`).join("")}</div></div>
				<section class="hrms-data-statistics__group hrms-data-statistics__activity-table-wrap">
					<div class="table-responsive">
						<table class="table hrms-data-statistics__activity-table">
							<thead><tr><th>${__("操作类型")}</th><th>${__("记录")}</th><th>${__("操作摘要")}</th><th>${__("操作人")}</th><th>${__("操作时间")}</th><th>${__("操作")}</th></tr></thead>
							<tbody>${events.length ? events.map((event, index) => renderEventRows(event, activity, index)).join("") : `<tr><td colspan="6" class="text-muted text-center">${__("该分类下暂无操作记录")}</td></tr>`}</tbody>
						</table>
					</div>
					${activity.has_more ? `<div class="hrms-data-statistics__load-more"><button type="button" class="btn btn-default" data-load-more-activity>${__("加载更多")}</button></div>` : ""}
				</section>
			</section>`;
	}

	function renderEventRows(event, activity, index) {
		const changedLabels = (event.changes || []).slice(0, 3).map((change) => change.label || change.fieldname);
		const summary = event.operation_type === "imported"
			? __("导入批次共写入 {0} 条{1}数据", [event.record_count || 0, activity.doctype_label || activity.doctype])
			: event.operation_type === "submitted" ? __("提交了这条记录")
			: event.operation_type === "approved" ? __("完成了这条记录的审批")
			: event.operation_type === "cancelled" ? __("取消提交了这条记录")
			: __("修改了 {0} 个字段{1}", [event.changes?.length || 0, changedLabels.length ? `：${changedLabels.join("、")}${event.changes.length > 3 ? "…" : ""}` : ""]);
		const recordLabel = event.record_title && event.record_title !== event.record_name ? `${event.record_title}（${event.record_name}）` : event.record_name;
		const operatorLabel = event.operator_label || event.operator || activity.user_label || activity.user || __("未记录");
		return `
			<tr class="hrms-data-statistics__event-row">
				<td><span class="hrms-data-statistics__event-badge is-${escape(event.operation_type)}">${escape(event.operation)}</span></td>
				<td><strong>${escape(recordLabel)}</strong></td>
				<td>${escape(summary)}</td>
				<td>${escape(operatorLabel)}</td>
				<td>${escape(event.operated_at)}</td>
				<td><button type="button" class="hrms-data-statistics__detail-toggle" data-toggle-event="${index}" aria-expanded="false">${__("查看详情")}</button></td>
			</tr>
			<tr class="hrms-data-statistics__event-detail-row" data-event-detail="${index}" hidden><td colspan="6"><div class="hrms-data-statistics__event-detail">
					<div class="hrms-data-statistics__event-actions"><span>${__("操作人：")}${escape(operatorLabel)}</span>${event.record_exists ? `<button type="button" data-open-record="${escape(event.open_doctype || activity.doctype)}" data-record-name="${escape(event.open_name || event.record_name)}">${event.operation_type === "imported" ? __("打开导入批次") : __("打开当前完整记录")}</button>` : ""}</div>
					${event.changes?.length ? `<div class="table-responsive"><table class="table"><thead><tr><th>${__("变更字段")}</th><th>${__("修改前")}</th><th>${__("修改后")}</th></tr></thead><tbody>${event.changes.map((change) => `<tr><td>${escape(change.label || change.fieldname)}</td><td>${changeValue(change.old_value)}</td><td>${changeValue(change.new_value)}</td></tr>`).join("")}</tbody></table></div>` : event.operation_type === "imported" ? `<div class="hrms-data-statistics__import-detail"><strong>${__("本批次写入 {0} 条数据", [event.record_count || 0])}</strong><p>${event.batch_name ? `${__("批次编号：")}${escape(event.batch_name)}` : __("旧数据未保存批次编号，已按连续写入时间合并。")}</p>${event.record_names?.length ? `<p>${__("记录示例：")}${event.record_names.map(escape).join("、")}${event.record_count > event.record_names.length ? "…" : ""}</p>` : ""}</div>` : `<p class="text-muted hrms-data-statistics__created-note">${event.operation_type === "approved" ? __("此处记录的是审批动作；如同时修改字段，字段差异会单独出现在修改记录中。") : __("此操作没有字段修改明细。")}</p>`}
				</div></td></tr>`;
	}

	function render() {
		const data = state.data || {};
		const monthLabel = data.activity_month_label || data.activity_month || "";
		const operatorSummary = state.operatorData?.summary || {};
		const formsView = state.view === "forms";
		$(page.body).html(`
			<div class="hrms-data-statistics">
				<section class="hrms-data-statistics__view-tabs" role="tablist" aria-label="${__("统计分类方式")}">
					<button type="button" role="tab" aria-selected="${formsView}" class="${formsView ? "is-active" : ""}" data-statistics-view="forms">${__("按表单分类")}</button>
					<button type="button" role="tab" aria-selected="${!formsView}" class="${!formsView ? "is-active" : ""}" data-statistics-view="people">${__("按人员分类")}</button>
				</section>
				${formsView ? `
					<section class="hrms-data-statistics__controls">
						<label><span>${__("统计月份")}</span><input class="form-control" type="month" data-statistics-month value="${escape(data.activity_month || "")}"></label>
						<label class="is-search"><span>${__("搜索数据表")}</span><input class="form-control" data-statistics-search value="${escape(state.search)}" placeholder="${__("输入中文或英文表名")}"></label>
					</section>
					<section class="hrms-data-statistics__summary">
						<article><strong>${escape(operatorSummary.operator_count || 0)}</strong><span>${__("本月有操作的人员")}</span></article>
						<article><strong>${escape(operatorSummary.operation_count || 0)}</strong><span>${__("本月可追溯操作总数")}</span></article>
						<article><strong>${escape(operatorSummary.active_day_count || 0)}</strong><span>${__("本月活跃天数")}</span></article>
						<article><strong>${escape(operatorSummary.daily_average || 0)}</strong><span>${__("活跃日日均操作数")}</span></article>
					</section>
					<div data-statistics-groups>${state.activity ? renderActivity() : renderFormAudit(monthLabel)}</div>` : `
					<section class="hrms-data-statistics__controls"><label><span>${__("统计月份")}</span><input class="form-control" type="month" data-statistics-month value="${escape(data.activity_month || "")}"></label><label class="is-search"><span>${__("搜索人员或其操作过的表单")}</span><input class="form-control" data-operator-search value="${escape(state.operatorSearch)}" placeholder="${__("输入姓名、账号或表单名称")}"></label></section>
					<section class="hrms-data-statistics__summary"><article><strong>${escape(operatorSummary.operator_count || 0)}</strong><span>${__("本月有操作的人员")}</span></article><article><strong>${escape(operatorSummary.operation_count || 0)}</strong><span>${__("本月可追溯操作总数")}</span></article><article><strong>${escape(operatorSummary.active_day_count || 0)}</strong><span>${__("本月活跃天数")}</span></article><article><strong>${escape(operatorSummary.daily_average || 0)}</strong><span>${__("活跃日日均操作数")}</span></article></section>
					<div data-operator-content>${state.activity ? renderActivity() : renderPeople()}</div>`}
			</div>`);
		bindEvents();
	}

	function bindEvents() {
		const body = page.body[0] || page.body;
		bindRecordLinks(body);
		body.querySelectorAll("[data-statistics-view]").forEach((button) => button.addEventListener("click", () => {
			state.view = button.dataset.statisticsView;
			state.activity = null;
			render();
			if (state.view === "people" && !state.operatorData) loadOperators();
		}));
		body.querySelector("[data-statistics-month]")?.addEventListener("change", (event) => load(event.target.value));
		body.querySelector("[data-statistics-search]")?.addEventListener("input", (event) => {
			state.search = event.target.value || "";
			state.activity = null;
			const monthLabel = state.data?.activity_month_label || state.data?.activity_month || "";
			const groupContainer = body.querySelector("[data-statistics-groups]");
			groupContainer.innerHTML = renderFormAudit(monthLabel);
			bindRecordLinks(groupContainer);
			bindOperatorLinks(groupContainer);
		});
		body.querySelector("[data-operator-search]")?.addEventListener("input", (event) => {
			state.operatorSearch = event.target.value || "";
			state.activity = null;
			body.querySelector("[data-operator-content]").innerHTML = renderPeople();
			bindOperatorLinks(body.querySelector("[data-operator-content]"));
		});
		bindOperatorLinks(body);
	}

	function bindOperatorLinks(root) {
		root.querySelectorAll("[data-open-form-audit]").forEach((button) => button.addEventListener("click", () => {
			state.view = "forms";
			state.activityType = button.dataset.operationType || "all";
			loadActivity("", button.dataset.openFormAudit, 0, false, state.activityType);
		}));
		root.querySelectorAll("[data-open-person-form]").forEach((button) => button.addEventListener("click", () => {
			state.view = "people";
			state.activityType = button.dataset.operationType || "all";
			loadActivity(button.dataset.personUser, button.dataset.openPersonForm);
		}));
		root.querySelector("[data-close-activity]")?.addEventListener("click", () => {
			state.activity = null;
			state.activityType = "all";
			render();
		});
		root.querySelectorAll("[data-activity-filter]").forEach((button) => button.addEventListener("click", () => {
			state.activityType = button.dataset.activityFilter;
			loadActivity(state.activity.user, state.activity.doctype, 0, false, state.activityType);
		}));
		root.querySelectorAll("[data-toggle-event]").forEach((button) => button.addEventListener("click", () => {
			const detail = root.querySelector(`[data-event-detail="${button.dataset.toggleEvent}"]`);
			if (!detail) return;
			const expanded = button.getAttribute("aria-expanded") === "true";
			detail.hidden = expanded;
			button.setAttribute("aria-expanded", expanded ? "false" : "true");
			button.textContent = expanded ? __("查看详情") : __("收起详情");
		}));
		root.querySelector("[data-load-more-activity]")?.addEventListener("click", () => loadActivity(state.activity.user, state.activity.doctype, state.activity.events.length, true, state.activityType));
	}

	function bindRecordLinks(root) {
		root.querySelectorAll("[data-open-record]").forEach((button) => button.addEventListener("click", () => {
			if (button.dataset.openRecord && button.dataset.recordName) {
				frappe.route_options = {};
				frappe.set_route("Form", button.dataset.openRecord, button.dataset.recordName);
			}
		}));
	}

	function load(month = state.month) {
		$(page.body).html(`<div class="text-muted">${__("正在汇总操作员审计数据…")}</div>`);
		const company = window.hrmsCompanyContext?.getCurrentCompany?.() || "";
		return Promise.all([
			frappe.call("hrms.api.data_statistics.get_hrms_data_statistics", { month: month || undefined, company }),
			frappe.call("hrms.api.data_statistics.get_hrms_operator_statistics", { month: month || undefined, company }),
		]).then(([dataResponse, operatorResponse]) => {
			state.data = dataResponse.message || {};
			state.month = state.data.activity_month || month || "";
			state.operatorData = operatorResponse.message || { people: [], forms: [], summary: {} };
			state.activity = null;
			state.activityType = "all";
			render();
		}).catch(() => $(page.body).html(`<div class="alert alert-danger">${__("操作审计数据加载失败，请确认当前账户拥有系统管理员权限。")}</div>`));
	}

	function loadOperators() {
		const company = window.hrmsCompanyContext?.getCurrentCompany?.() || "";
		return frappe.call("hrms.api.data_statistics.get_hrms_operator_statistics", { company, month: state.month || undefined }).then((response) => {
			state.operatorData = response.message || { people: [], summary: {} };
			render();
		}).catch(() => $(page.body).html(`<div class="alert alert-danger">${__("人员操作记录加载失败，请确认当前账户拥有系统管理员权限。")}</div>`));
	}

	function loadActivity(user, doctype, start = 0, append = false, operationType = state.activityType) {
		const company = window.hrmsCompanyContext?.getCurrentCompany?.() || "";
		return frappe.call("hrms.api.data_statistics.get_hrms_operator_activity", { user, doctype, company, month: state.month || undefined, operation_type: operationType, start }).then((response) => {
			const next = response.message || {};
			if (append && state.activity) next.events = [...state.activity.events, ...(next.events || [])];
			state.activity = next;
			render();
		});
	}

	load();
};

frappe.pages["hrms-data-statistics"].on_page_show = function () {
	set_data_statistics_layout(true);
};

frappe.pages["hrms-data-statistics"].on_page_hide = function () {
	set_data_statistics_layout(false);
};
