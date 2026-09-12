frappe.pages["apple-tree-center"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("苹果树统计"), single_column: true });
	wrapper.apple_tree_center = new AppleTreeCenter(page);
	wrapper.apple_tree_center.show();
};

frappe.pages["apple-tree-center"].on_page_show = function (wrapper) {
	wrapper.apple_tree_center?.refreshFromRoute();
};

class AppleTreeCenter {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.year = String(new Date().getFullYear());
		this.month = "";
		this.startDate = "";
		this.endDate = "";
		this.search = "";
		this.data = null;
		this.activePerson = "";
		this.personData = null;
		this.table = { page: 1, pageSize: 20, sortKey: "net_apples", sortOrder: "desc", filters: {} };
		this.requestId = 0;
		this.view = this.viewFromRoute();
	}

	show() {
		this.refreshFromRoute();
		if (this.view !== "person") this.load();
	}

	viewFromRoute() {
		const route = frappe.get_route?.() || [];
		if (route[1] === "person") return "person";
		return route[1] === "monthly-detail" ? "monthly-detail" : "annual-summary";
	}

	refreshFromRoute() {
		const nextView = this.viewFromRoute();
		const route = frappe.get_route?.() || [];
		if (nextView === "person") {
			const person = String(route[2] || "");
			const year = /^\d{4}$/.test(String(route[3] || "")) ? String(route[3]) : this.year;
			if (nextView !== this.view || person !== this.activePerson || year !== this.year || (!this.personData && !this.personRequestKey)) {
				this.view = nextView;
				this.activePerson = person;
				this.year = year;
				this.loadPerson();
			}
			return;
		}
		if (nextView === this.view) return;
		this.view = nextView;
		this.activePerson = "";
		this.requestId++;
		this.personRequestKey = "";
		if (this.data && String(this.data.filters?.year) === this.year) this.render();
		else {
			this.month = "";
			this.resetTable();
			this.load();
		}
	}

	setView(view) {
		if (view === "monthly-detail") frappe.set_route("apple-tree-center", "monthly-detail");
		else frappe.set_route("apple-tree-center");
	}

	company() {
		return window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	}

	load() {
		if (this.view === "person") return this.loadPerson();
		const requestId = ++this.requestId;
		this.wrapper.innerHTML = `<section class="apple-tree-center apple-tree-center--state">${__("正在加载苹果树统计...")}</section>`;
		return frappe.call({
			method: "hrms.hr.page.apple_tree_center.apple_tree_center.get_data",
			args: { year: this.year, month: this.month, search: this.search, company: this.company(), start_date: this.startDate, end_date: this.endDate },
		}).then((response) => {
			if (requestId !== this.requestId) return;
			this.data = response.message || {};
			this.year = this.data.filters?.year || this.year;
			this.month = this.data.filters?.month || this.month;
			this.startDate = this.data.filters?.start_date || "";
			this.endDate = this.data.filters?.end_date || "";
			if (this.activePerson && !(this.data.people || []).some((person) => this.personKey(person) === this.activePerson)) this.activePerson = "";
			this.render();
		}).catch(() => {
			if (requestId !== this.requestId) return;
			this.wrapper.innerHTML = `<section class="apple-tree-center apple-tree-center--state"><p>${__("苹果树统计暂时无法读取。")}</p><button class="btn btn-default" data-apple-refresh>${__("重新加载")}</button></section>`;
			this.wrapper.querySelector("[data-apple-refresh]")?.addEventListener("click", () => this.load());
		});
	}

	personKey(person) {
		return String(person.employee || person.employee_code || person.employee_name || "");
	}

	resetTable() {
		this.table = { ...this.table, page: 1, filters: {} };
	}

	number(value) {
		return frappe.utils.escape_html(String(value ?? 0));
	}

	escape(value) {
		return frappe.utils.escape_html(String(value || ""));
	}

	render() {
		if (this.view === "person") return this.renderPerson();
		const summary = this.data.summary || {};
		const isMonthlyDetail = this.view === "monthly-detail";
		const title = isMonthlyDetail ? __("每月明细") : this.month.includes("-Q") ? __("个人季度汇总") : __("个人年度汇总");
		const subtitle = isMonthlyDetail
			? __("按月份和员工查看苹果树月度记录")
			: __("按员工汇总所选年度、季度或月份内的苹果树记录");
		this.page.set_title(__("苹果树统计"));
		this.wrapper.innerHTML = `
			<section class="apple-tree-center">
				<header class="apple-tree-center__header"><div><p>${__("按人员、月份和年份查看苹果树明细")}</p><h2>${__("苹果树统计")}</h2><span>${this.escape(this.data.notice)}</span></div><div class="apple-tree-center__header-actions"><nav class="apple-tree-center__view-tabs" aria-label="${__("苹果树统计表")}"><button class="btn btn-sm ${isMonthlyDetail ? "btn-default" : "btn-primary"}" data-apple-view="annual-summary">${__("个人年度汇总")}</button><button class="btn btn-sm ${isMonthlyDetail ? "btn-primary" : "btn-default"}" data-apple-view="monthly-detail">${__("每月明细")}</button></nav><button class="btn btn-default" data-apple-history-import>${__("历史数据导入")}</button><button class="btn btn-default" data-apple-refresh>${__("刷新数据")}</button></div></header>
				<section class="apple-tree-center__filters">
					<label>${__("统计年份")}<select class="form-control" data-apple-year>${(this.data.available_years || [this.year]).map((year) => `<option value="${this.escape(year)}" ${String(year) === this.year ? "selected" : ""}>${this.escape(year)}${__("年")}</option>`).join("")}</select></label>
					<label>${__("统计期间")}<select class="form-control" data-apple-month><option value="">${__("全年")}</option><optgroup label="${__("季度")}">${[1, 2, 3, 4].map(quarter => {
						const value = `${this.year}-Q${quarter}`;
						return `<option value="${value}" ${value === this.month ? "selected" : ""}>第${["一", "二", "三", "四"][quarter - 1]}季度（${quarter * 3 - 2}–${quarter * 3}月）</option>`;
					}).join("")}</optgroup><optgroup label="${__("月份")}">${Array.from({ length: 12 }, (_, index) => {
						const value = `${this.year}-${String(index + 1).padStart(2, "0")}`;
						return `<option value="${value}" ${value === this.month ? "selected" : ""}>${index + 1}${__("月")}</option>`;
					}).join("")}</optgroup></select></label>
					<div class="apple-tree-center__date-range"><label>${__("开始日期")}<input type="date" class="form-control" data-apple-start-date value="${this.escape(this.startDate)}"></label><span>${__("至")}</span><label>${__("结束日期")}<input type="date" class="form-control" data-apple-end-date value="${this.escape(this.endDate)}"></label><button class="btn btn-default" data-apple-date-apply>${__("按日期查询")}</button>${this.startDate ? `<button class="btn btn-link" data-apple-date-clear>${__("清除")}</button>` : ""}</div>
					<label class="apple-tree-center__search">${__("检索员工或项目")}<input class="form-control" data-apple-search value="${this.escape(this.search)}" placeholder="${__("姓名、工号、部门或项目")}"></label>
				</section>
				<section class="apple-tree-center__metrics">
					${this.metric(__("员工数"), summary.employee_count, __("当前统计范围内有记录的员工"))}
					${this.metric(__("绿苹果"), summary.green_apples, `${__("红苹果")} ${this.number(summary.red_apples)}`)}
					${this.metric(__("净苹果"), summary.net_apples, __("绿苹果减红苹果"))}
					${this.metric(__("记录数"), summary.record_count, `${__("金额合计")} ${this.number(summary.reward_amount)}`)}
				</section>
				<section class="apple-tree-center__card apple-tree-center__primary-table"><header><div><h3>${title}</h3><p>${subtitle}</p></div></header>${isMonthlyDetail ? this.monthlyDetailTable() : this.annualSummaryTable()}</section>
			</section>`;
		this.bind();
	}

	metric(label, value, note) {
		return `<article class="apple-tree-center__metric"><span>${label}</span><b>${this.number(value)}</b><small>${note}</small></article>`;
	}


	tableColumns() {
		return [
			{ key: "department", label: __("部门") },
			{ key: "employee_name", label: __("姓名") },
			{ key: "employee_code", label: __("工号") },
			{ key: "green_apples", label: __("绿苹果"), numeric: true },
			{ key: "red_apples", label: __("红苹果"), numeric: true },
			{ key: "net_apples", label: __("净苹果"), numeric: true },
			{ key: "reward_amount", label: __("苹果金额"), numeric: true },
		];
	}

	tableRows() {
		const columns = this.tableColumns();
		const filters = this.table.filters || {};
		const rows = (this.data.people || []).filter((person) => columns.every((column) => {
			const query = String(filters[column.key] || "").trim().toLowerCase();
			return !query || String(person[column.key] ?? "").toLowerCase().includes(query);
		}));
		const { sortKey, sortOrder } = this.table;
		return rows.sort((left, right) => {
			const column = columns.find((item) => item.key === sortKey);
			const multiplier = sortOrder === "asc" ? 1 : -1;
			if (column?.numeric) return (Number(left[sortKey] || 0) - Number(right[sortKey] || 0)) * multiplier;
			return String(left[sortKey] || "").localeCompare(String(right[sortKey] || ""), "zh-Hans-CN") * multiplier;
		});
	}

	monthlyDetailColumns() {
		return [
			{ key: "attendance_month", label: __("月份") },
			{ key: "department", label: __("部门") },
			{ key: "employee_name", label: __("姓名") },
			{ key: "employee_code", label: __("工号") },
			{ key: "green_apples", label: __("绿苹果"), numeric: true },
			{ key: "red_apples", label: __("红苹果"), numeric: true },
			{ key: "net_apples", label: __("净苹果"), numeric: true },
			{ key: "reward_amount", label: __("苹果金额"), numeric: true },
			{ key: "reward_item", label: __("来源") },
			{ key: "final_status", label: __("终稿状态") },
		];
	}

	monthlyDetailValue(row, key) {
		if (key === "attendance_month") return row.attendance_month || String(row.reward_date || "").slice(0, 7);
		if (key === "net_apples") return Number(row.green_apples || 0) - Number(row.red_apples || 0);
		if (key === "final_status") return row.approval_result || row.approval_status
			? `${row.approval_result || "-"} / ${row.approval_status || "-"}`
			: __("未提供");
		return row[key];
	}

	monthlyDetailRows() {
		const columns = this.monthlyDetailColumns();
		const filters = this.table.filters || {};
		const rows = [...(this.data.records || [])].filter((row) => columns.every((column) => {
			const query = String(filters[column.key] || "").trim().toLowerCase();
			return !query || String(this.monthlyDetailValue(row, column.key) ?? "").toLowerCase().includes(query);
		}));
		const { sortKey, sortOrder } = this.table;
		const column = columns.find((item) => item.key === sortKey);
		if (!column) return rows;
		const multiplier = sortOrder === "asc" ? 1 : -1;
		return rows.sort((left, right) => {
			const leftValue = this.monthlyDetailValue(left, sortKey);
			const rightValue = this.monthlyDetailValue(right, sortKey);
			if (column.numeric) return (Number(leftValue || 0) - Number(rightValue || 0)) * multiplier;
			return String(leftValue || "").localeCompare(String(rightValue || ""), "zh-Hans-CN", { numeric: true }) * multiplier;
		});
	}

	tablePager(total, page) {
		const pageSize = this.table.pageSize;
		const pageCount = Math.max(1, Math.ceil(total / pageSize));
		const start = Math.max(1, Math.min(page - 2, pageCount - 4));
		const end = Math.min(pageCount, start + 4);
		const pageButtons = Array.from({ length: end - start + 1 }, (_, index) => {
			const value = start + index;
			return `<button class="btn btn-xs ${value === page ? "btn-primary" : "btn-default"}" data-apple-table-page="${value}">${value}</button>`;
		}).join("");
		return `<footer class="apple-tree-center__table-footer"><span>${__("共")} ${total} ${__("条，第")} ${page} / ${pageCount} ${__("页")}</span><div><button class="btn btn-xs btn-default" data-apple-table-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>${__("上一页")}</button>${pageButtons}<button class="btn btn-xs btn-default" data-apple-table-page="${page + 1}" ${page >= pageCount ? "disabled" : ""}>${__("下一页")}</button></div></footer>`;
	}

	annualSummaryTable() {
		const allPeople = this.data.people || [];
		if (!allPeople.length) return `<p class="apple-tree-center__empty">${__("当前筛选条件下没有苹果树记录。")}</p>`;
		const columns = this.tableColumns();
		const rows = this.tableRows();
		const pageCount = Math.max(1, Math.ceil(rows.length / this.table.pageSize));
		const page = Math.min(this.table.page, pageCount);
		this.table.page = page;
		const start = (page - 1) * this.table.pageSize;
		const visibleRows = rows.slice(start, start + this.table.pageSize);
		const direction = (key) => this.table.sortKey === key ? (this.table.sortOrder === "asc" ? "↑" : "↓") : "↕";
		return `<div class="apple-tree-center__table-wrap"><table class="table apple-tree-center__data-table"><thead><tr><th>${__("序号")}</th>${columns.map((column) => `<th><button class="apple-tree-center__sort" data-apple-table-sort="${column.key}">${column.label}<span>${direction(column.key)}</span></button></th>`).join("")}<th>${__("操作")}</th></tr><tr class="apple-tree-center__filter-row"><th></th>${columns.map((column) => `<th><input class="form-control input-xs" data-apple-table-filter="${column.key}" value="${this.escape(this.table.filters[column.key])}" placeholder="${__("搜索")}"></th>`).join("")}<th></th></tr></thead><tbody>${visibleRows.length ? visibleRows.map((person, index) => `<tr class="${this.personKey(person) === this.activePerson ? "is-selected" : ""}"><td>${start + index + 1}</td><td>${this.escape(person.department)}</td><td><a class="apple-tree-center__name-link" href="/desk/apple-tree-center/person/${encodeURIComponent(this.personKey(person))}/${this.year}" data-apple-person="${this.escape(this.personKey(person))}">${this.escape(person.employee_name)}</a></td><td>${this.escape(person.employee_code)}</td><td>${this.number(person.green_apples)}</td><td>${this.number(person.red_apples)}</td><td>${this.number(person.net_apples)}</td><td>${this.number(person.reward_amount)}</td><td><button class="btn btn-xs btn-default" data-apple-person="${this.escape(this.personKey(person))}">${__("查看明细")} (${this.number(person.record_count)})</button></td></tr>`).join("") : `<tr><td class="apple-tree-center__empty-cell" colspan="${columns.length + 2}">${__("没有符合列筛选条件的员工。")}</td></tr>`}</tbody></table></div>${this.tablePager(rows.length, page)}`;
	}

	monthlyDetailTable() {
		const records = this.data.records || [];
		if (!records.length) return `<p class="apple-tree-center__empty">${__("当前筛选条件下没有苹果树记录。")}</p>`;
		const columns = this.monthlyDetailColumns();
		const rows = this.monthlyDetailRows();
		const direction = (key) => this.table.sortKey === key ? (this.table.sortOrder === "asc" ? "↑" : "↓") : "↕";
		return `<div class="apple-tree-center__table-wrap"><table class="table apple-tree-center__monthly-table"><thead><tr>${columns.map((column) => `<th><button class="apple-tree-center__sort" data-apple-table-sort="${column.key}">${column.label}<span>${direction(column.key)}</span></button></th>`).join("")}</tr><tr class="apple-tree-center__filter-row">${columns.map((column) => `<th><input class="form-control input-xs" data-apple-table-filter="${column.key}" value="${this.escape(this.table.filters[column.key])}" placeholder="${__("搜索")}"></th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td>${this.escape(this.monthlyDetailValue(row, "attendance_month"))}</td><td>${this.escape(row.department)}</td><td><a class="apple-tree-center__name-link" href="/desk/apple-tree-center/person/${encodeURIComponent(this.personKey(row))}/${this.year}" data-apple-person="${this.escape(this.personKey(row))}">${this.escape(row.employee_name)}</a></td><td>${this.escape(row.employee_code)}</td><td>${this.number(row.green_apples)}</td><td>${this.number(row.red_apples)}</td><td>${this.number(this.monthlyDetailValue(row, "net_apples"))}</td><td>${this.number(row.reward_amount)}</td><td>${this.escape(row.reward_item)}</td><td>${this.escape(this.monthlyDetailValue(row, "final_status"))}</td></tr>`).join("") : `<tr><td class="apple-tree-center__empty-cell" colspan="${columns.length}">${__("没有符合列筛选条件的明细记录。")}</td></tr>`}</tbody></table></div>`;
	}

	loadPerson() {
		const requestId = ++this.requestId;
		this.personSort = { field: "attendance_month", direction: "asc" };
		this.personRequestKey = this.activePerson + "/" + this.year;
		this.personData = null;
		this.wrapper.innerHTML = `<section class="apple-tree-center apple-tree-center--state">正在加载个人明细…</section>`;
		return frappe.call({
			method: "hrms.hr.page.apple_tree_center.apple_tree_center.get_person_detail",
			timeout: 30000,
			args: { person: this.activePerson, year: this.year, company: this.company() },
		}).then((response) => {
			if (requestId !== this.requestId) return;
			this.personRequestKey = "";
			this.personData = response.message || {};
			this.renderPerson();
		}).catch(() => {
			if (requestId !== this.requestId) return;
			this.personRequestKey = "";
			this.personData = { available: false, reason: "个人明细暂时无法读取，请重试。" };
			this.renderPerson();
		});
	}

	detailValue(value, numeric = false) {
		if (value === null || value === undefined || value === "") return `<span class="apple-tree-center__unavailable" title="当前终稿未提供此项数据">—</span>`;
		return numeric ? this.number(value) : this.escape(value);
	}

	personMonthRows() {
		const data = this.personData || {};
		const source = data.rows || [];
		const person = data.person || {};
		return Array.from({ length: 12 }, (_, index) => {
			const month = this.year + "-" + String(index + 1).padStart(2, "0");
			return source.find((row) => row.attendance_month === month) || {
				attendance_month: month, department: person.department,
				employee_name: person.employee_name, employee_code: person.employee_code,
				date_of_joining: source[0]?.date_of_joining, __placeholder: true,
			};
		});
	}

	personCellText(row, column) {
		const value = row[column.field];
		if (column.field === "attendance_month") return String(value || "").replace("-", "").slice(2);
		return value === null || value === undefined ? "" : String(value);
	}

	sortPersonRows(rows, columns) {
		const sort = this.personSort || { field: "attendance_month", direction: "asc" };
		const numeric = columns.find((column) => column.field === sort.field)?.numeric;
		return [...rows].sort((left, right) => {
			const a = left[sort.field], b = right[sort.field];
			const emptyA = a === null || a === undefined || a === "";
			const emptyB = b === null || b === undefined || b === "";
			// Missing values remain last in both directions; zero is a real value.
			if (emptyA !== emptyB) return emptyA ? 1 : -1;
			const compared = emptyA ? 0 : numeric ? Number(a) - Number(b) : String(a).localeCompare(String(b), "zh-Hans-CN", { numeric: true });
			return compared * (sort.direction === "desc" ? -1 : 1) || String(left.attendance_month).localeCompare(String(right.attendance_month));
		});
	}

	personGrid(columns) {
		const calendar = this.personMonthRows();
		const sort = this.personSort || { field: "attendance_month", direction: "asc" };
		const rows = this.sortPersonRows(calendar, columns);
		const recorded = rows.filter((row) => !row.__placeholder);
		const identity = this.personData.person || {};
		const frozenColumns = {
			attendance_month: "is-month",
			department: "is-department",
			employee_name: "is-employee-name",
			employee_code: "is-employee-code",
		};
		const cellClass = (column) => [column.numeric ? "is-numeric" : "", frozenColumns[column.field] ? `is-frozen ${frozenColumns[column.field]}` : "", column.field === "missing_hours" ? "is-absence" : "", column.field === "green_apples" ? "is-green" : "", column.field === "red_apples" ? "is-red" : "", column.field === "review_note" ? "is-note" : ""].filter(Boolean).join(" ");
		const headers = columns.map((column) => {
			const active = sort.field === column.field;
			const arrow = active ? (sort.direction === "asc" ? "↑" : "↓") : "↕";
			const next = active && sort.direction === "asc" ? "降序" : "升序";
			return `<th class="${cellClass(column)}" aria-sort="${active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}"><button class="apple-tree-center__sort ${active ? "is-sorted" : ""}" data-person-sort="${column.field}" aria-label="${this.escape(column.label)}：点击${next}排序"><span>${this.escape(column.label)}</span><span aria-hidden="true">${arrow}</span></button></th>`;
		}).join("");
		const body = rows.map((row) => `<tr class="${row.attendance_month.endsWith("-12") ? "is-year-end" : ""} ${row.__placeholder ? "is-unrecorded" : ""}">${columns.map((column) => `<td class="${cellClass(column)}" title="${column.field === "attendance_month" && row.__placeholder ? "该月份暂无入账数据" : ""}">${column.field === "attendance_month" ? this.escape(this.personCellText(row, column)) : row.__placeholder ? this.escape(row[column.field]) : this.detailValue(row[column.field], column.numeric)}</td>`).join("")}</tr>`).join("");
		const total = columns.map((column, index) => {
			let value = identity[column.field] || (column.field === "date_of_joining" ? calendar[0].date_of_joining : "");
			if (column.numeric) value = recorded.length && recorded.every((row) => row[column.field] !== null && row[column.field] !== undefined && row[column.field] !== "") ? Math.round(recorded.reduce((sum, row) => sum + Number(row[column.field]), 0) * 10000) / 10000 : null;
			return `<td class="${cellClass(column)}">${index === 0 ? "合计" : column.numeric ? this.detailValue(value, true) : this.escape(value)}</td>`;
		}).join("");
		return `<div class="apple-tree-center__table-wrap apple-tree-center__person-scroll"><table class="table apple-tree-center__person-table"><thead><tr>${headers}</tr></thead><tbody>${body || `<tr><td colspan="${columns.length}">没有符合筛选条件的月份。</td></tr>`}</tbody><tfoot><tr>${total}</tr></tfoot></table></div>`;
	}

	renderPerson() {
		if (!this.personData) return;
		const data = this.personData;
		const person = data.person || {};
		const columns = data.columns || [];
		const rows = data.rows || [];
		const title = person.employee_name ? `${person.employee_name} · 苹果树明细` : "个人苹果树明细";
		this.page.set_title(title);
		const table = this.personGrid(columns);
		this.wrapper.innerHTML = `<section class="apple-tree-center apple-tree-center--person">
			<header class="apple-tree-center__header"><div><button class="btn btn-default btn-sm" data-apple-back>返回个人年度汇总</button><h2>${this.escape(title)}</h2><p>${this.escape(person.department)}　工号 ${this.escape(person.employee_code)}　${this.escape(this.year)} 年</p></div><div class="apple-tree-center__header-actions"><label>统计年份 <select class="form-control" data-person-year>${Array.from(new Set([...(data.available_years || this.data?.available_years || []), Number(this.year), new Date().getFullYear()])).sort((a,b) => b-a).map((year) => `<option value="${year}" ${String(year) === this.year ? "selected" : ""}>${year}年</option>`).join("")}</select></label>${person.employee ? `<button class="btn btn-default" data-employee-detail="${this.escape(person.employee)}">打开员工档案</button>` : ""}<button class="btn btn-default" data-person-refresh>刷新数据</button></div></header>
			<section class="apple-tree-center__card"><header><div><h3>个人全年考勤奖惩明细</h3><p>1—12 月逐月列示 · 工时：小时 · 奖金：元</p></div><span class="apple-tree-center__coverage">已入账 ${rows.length} 个月</span></header>${data.available ? table : `<p class="apple-tree-center__empty">${this.escape(data.reason)}</p>`}<p class="apple-tree-center__footnote">月份采用年份后两位＋月份（如 2601）。空白月份尚无入账数据；“—”为已入账记录中未提供的字段。点击表头切换升降序，合计固定在底部。</p></section>
		</section>`;
		this.wrapper.querySelector("[data-apple-back]")?.addEventListener("click", () => this.setView("annual-summary"));
		this.wrapper.querySelector("[data-person-refresh]")?.addEventListener("click", () => this.loadPerson());
		this.wrapper.querySelectorAll("[data-person-sort]").forEach((button) => button.addEventListener("click", () => {
			const field = button.dataset.personSort;
			const current = this.personSort || { field: "attendance_month", direction: "asc" };
			this.personSort = { field, direction: current.field === field && current.direction === "asc" ? "desc" : "asc" };
			const scrollLeft = this.wrapper.querySelector(".apple-tree-center__person-scroll")?.scrollLeft || 0;
			this.renderPerson();
			this.wrapper.querySelector(".apple-tree-center__person-scroll").scrollLeft = scrollLeft;
			this.wrapper.querySelector(`[data-person-sort="${field}"]`)?.focus({ preventScroll: true });
		}));
		this.wrapper.querySelector("[data-person-year]")?.addEventListener("change", (event) => frappe.set_route("apple-tree-center", "person", this.activePerson, event.target.value));
		this.wrapper.querySelector("[data-employee-detail]")?.addEventListener("click", (event) => frappe.set_route("employee-detail", event.currentTarget.dataset.employeeDetail));
	}

	historyImportPreview(data) {
		const issues = data.issues || [];
		const replacement = (data.replaces_batches || []).length;
		return `<section class="apple-tree-center__import-preview">
			<div class="apple-tree-center__import-metrics">
				<div><span>${__("统计月份")}</span><strong>${this.escape(data.attendance_month || "待确定")}</strong></div>
				<div><span>${__("源数据")}</span><strong>${this.number(data.source_row_count)} ${__("行")}</strong></div>
				<div><span>${__("匹配员工")}</span><strong>${this.number(data.employee_count)} ${__("人")}</strong></div>
				<div><span>${__("绿苹果 / 红苹果")}</span><strong>${this.number(data.green_apples)} / ${this.number(data.red_apples)}</strong></div>
			</div>
			<p>${this.escape(__("已识别工作表“{0}”，表头在第 {1} 行。", [data.sheet_name || "-", data.header_row || "-"]))}</p>
			${data.duplicate ? `<div class="alert alert-info">${__("相同文件已导入，确认时不会重复写入。")}</div>` : ""}
			${replacement ? `<div class="alert alert-warning">${this.escape(__("该月已有 {0} 个历史版本，确认后新版本在本统计页生效，旧批次保留追溯。", [replacement]))}</div>` : ""}
			${issues.length ? `<div class="alert alert-danger"><strong>${this.escape(__("共 {0} 条问题，请修正文件后重新上传。", [data.issue_count || issues.length]))}</strong><ul>${issues.slice(0, 20).map((issue) => `<li>${issue.row ? `${__("第")} ${this.number(issue.row)} ${__("行")}：` : ""}${this.escape(issue.employee_name)} ${this.escape(issue.message)}</li>`).join("")}</ul></div>` : `<div class="alert alert-success">${__("预览校验通过。确认后只更新苹果树统计，不修改考勤终稿或薪资。")}</div>`}
		</section>`;
	}

	openHistoryImport() {
		let preview = null;
		let busy = false;
		const dialog = new frappe.ui.Dialog({
			title: __("导入苹果树历史数据"),
			size: "large",
			fields: [
				{ fieldtype: "HTML", options: `<div class="apple-tree-center__template-intro"><div><p>${__("请按“苹果树合计”模板填写：每个文件只填一个月份，1–8 月可逐月上传。")}</p><p class="text-muted">${__("系统优先按“受奖/惩人工号”匹配，并校验姓名。旧文件未填工号时，才按当前公司和姓名匹配。")}</p></div><a class="btn btn-default btn-sm" href="/api/method/hrms.hr.page.apple_tree_center.apple_tree_center.download_history_import_template">${__("下载填写模板")}</a></div>` },
				{ fieldname: "company", fieldtype: "Link", options: "Company", label: __("目标公司"), reqd: 1, default: this.company(), onchange: () => { preview = null; dialog.get_primary_btn().text(__("校验并预览")); } },
				{ fieldname: "file_url", fieldtype: "Attach", label: __("苹果树合计 Excel"), reqd: 1, options: { make_attachments_public: false, disable_file_browser: true, allow_web_link: false, allow_take_photo: false, allow_google_drive: false, allow_toggle_private: false, restrictions: { allowed_file_types: [".xlsx"] } }, onchange: () => { preview = null; dialog.get_primary_btn().text(__("校验并预览")); } },
				{ fieldname: "preview", fieldtype: "HTML" },
			],
			primary_action_label: __("校验并预览"),
			primary_action: () => { void dialog.runHistoryImport().catch(() => {}); },
		});
		dialog.runHistoryImport = async () => {
			if (busy) return;
			busy = true;
			dialog.get_primary_btn().prop("disabled", true);
			try {
				const values = dialog.get_values();
				if (!values) return;
				if (!preview || preview.company !== values.company || preview.file_url !== values.file_url) {
					const response = await frappe.call({
						method: "hrms.hr.page.apple_tree_center.apple_tree_center.preview_history_import",
						args: { company: values.company, file_url: values.file_url },
						freeze: true,
						freeze_message: __("正在校验苹果树历史文件…"),
					});
					const data = response.message || {};
					dialog.fields_dict.preview.$wrapper.html(this.historyImportPreview(data));
					preview = data.can_import ? { ...data, company: values.company, file_url: values.file_url } : null;
					dialog.get_primary_btn().text(preview ? __("确认导入") : __("重新校验"));
					return;
				}
				const response = await frappe.call({
					method: "hrms.hr.page.apple_tree_center.apple_tree_center.import_history",
					args: { company: values.company, file_url: values.file_url, fingerprint: preview.fingerprint },
					freeze: true,
					freeze_message: __("正在写入苹果树历史统计…"),
				});
				const result = response.message || {};
				dialog.hide();
				frappe.msgprint({
					title: result.duplicate ? __("文件未重复写入") : __("历史数据导入完成"),
					indicator: "green",
					message: this.escape(__("{0}：源数据 {1} 行，汇总员工 {2} 人。", [result.attendance_month || "-", result.source_row_count || 0, result.employee_count || 0])),
				});
				this.year = String(result.attendance_month || this.year).slice(0, 4);
				this.month = result.attendance_month || "";
				this.resetTable();
				await this.load();
			} finally {
				busy = false;
				dialog.get_primary_btn().prop("disabled", false);
			}
		};
		dialog.show();
	}

	bind() {
		this.wrapper.querySelector("[data-apple-refresh]")?.addEventListener("click", () => this.load());
		this.wrapper.querySelector("[data-apple-history-import]")?.addEventListener("click", () => this.openHistoryImport());
		this.wrapper.querySelectorAll("[data-apple-view]").forEach((button) => button.addEventListener("click", () => this.setView(button.dataset.appleView)));
		this.wrapper.querySelector("[data-apple-year]")?.addEventListener("change", (event) => { this.year = event.target.value; this.month = ""; this.startDate = ""; this.endDate = ""; this.activePerson = ""; this.resetTable(); this.load(); });
		this.wrapper.querySelector("[data-apple-month]")?.addEventListener("change", (event) => { this.month = event.target.value; this.startDate = ""; this.endDate = ""; this.activePerson = ""; this.resetTable(); this.load(); });
		this.wrapper.querySelector("[data-apple-date-apply]")?.addEventListener("click", () => {
			const startDate = this.wrapper.querySelector("[data-apple-start-date]")?.value || "";
			const endDate = this.wrapper.querySelector("[data-apple-end-date]")?.value || "";
			if (!startDate || !endDate) return frappe.msgprint(__("请选择完整的开始日期和结束日期。"));
			if (startDate > endDate) return frappe.msgprint(__("开始日期不能晚于结束日期。"));
			this.startDate = startDate; this.endDate = endDate; this.month = ""; this.activePerson = ""; this.resetTable(); this.load();
		});
		this.wrapper.querySelector("[data-apple-date-clear]")?.addEventListener("click", () => { this.startDate = ""; this.endDate = ""; this.activePerson = ""; this.resetTable(); this.load(); });
		this.wrapper.querySelector("[data-apple-search]")?.addEventListener("change", (event) => { this.search = event.target.value.trim(); this.activePerson = ""; this.resetTable(); this.load(); });
		this.wrapper.querySelectorAll("[data-apple-table-sort]").forEach((button) => button.addEventListener("click", () => {
			const key = button.dataset.appleTableSort;
			this.table.sortOrder = this.table.sortKey === key && this.table.sortOrder === "desc" ? "asc" : "desc";
			this.table.sortKey = key;
			this.table.page = 1;
			this.render();
		}));
		this.wrapper.querySelectorAll("[data-apple-table-filter]").forEach((input) => input.addEventListener("change", (event) => {
			this.table.filters[event.target.dataset.appleTableFilter] = event.target.value;
			this.table.page = 1;
			this.render();
		}));
		this.wrapper.querySelectorAll("[data-apple-table-page]").forEach((button) => button.addEventListener("click", () => {
			if (button.disabled) return;
			this.table.page = Number(button.dataset.appleTablePage) || 1;
			this.render();
			this.wrapper.querySelector(".apple-tree-center__primary-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
		}));
		this.wrapper.querySelectorAll("[data-apple-person]").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); frappe.set_route("apple-tree-center", "person", button.dataset.applePerson, this.year); }));
	}
}
