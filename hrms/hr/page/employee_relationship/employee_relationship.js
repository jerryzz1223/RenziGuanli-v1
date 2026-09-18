frappe.pages["employee-relationship"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("员工关系"),
		single_column: true,
	});
	wrapper.employee_relationship = new EmployeeRelationshipPage(page);
	wrapper.employee_relationship.show();
};

frappe.pages["employee-relationship"].on_page_show = function (wrapper) {
	wrapper.employee_relationship?.activate();
};

class EmployeeRelationshipPage {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.employee_filter = String(frappe.get_route()[1] || "").trim();
		this.selected = { a: null, b: null };
		this.candidates = { a: [], b: [] };
		this.search_timers = {};
		this.relationship_filters = {};
		this.relationship_sort_field = "submitted_on";
		this.relationship_sort_order = "desc";
		this.list_request_id = 0;
		this.statistics_request_id = 0;
		this.relationship_statistics_data = null;
		this.selected_relationship_statistic = "";
	}

	show() {
		this.page.set_title(__("员工关系"));
		this.render_shell();
		this.bind_events();
		this.load_relationships();
		this.load_relationship_statistics();
	}

	activate() {
		const route_employee = String(frappe.get_route()[1] || "").trim();
		if (route_employee !== this.employee_filter) {
			this.employee_filter = route_employee;
			this.load_relationships();
		}
	}

	render_shell() {
		this.wrapper.innerHTML = `
			<style>
				.hrms-employee-relationship { max-width: 1120px; margin: 0 auto; padding: 18px 0 48px; color: #26323f; }
				.hrms-employee-relationship__intro { margin-bottom: 16px; color: #687385; line-height: 1.7; }
				.hrms-employee-relationship__card { background: #fff; border: 1px solid #e6edf3; border-radius: 8px; padding: 20px 22px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(15,23,42,.03); }
				.hrms-employee-relationship__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
				.hrms-employee-relationship h3 { margin: 0; font-size: 16px; font-weight: 600; }
				.hrms-employee-relationship__head p { margin: 5px 0 0; color: #687385; }
				.hrms-employee-relationship__form-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(220px, .75fr); gap: 14px; align-items: end; }
				.hrms-employee-relationship__field { position: relative; }
				.hrms-employee-relationship__field label { display: block; margin-bottom: 6px; color: #44515e; font-weight: 600; }
				.hrms-employee-relationship__field input { width: 100%; min-height: 38px; border: 1px solid #d9e3eb; border-radius: 6px; padding: 8px 10px; }
				.hrms-employee-relationship__field input:focus { border-color: #10b981; outline: 0; box-shadow: 0 0 0 2px rgba(16,185,129,.12); }
				.hrms-employee-relationship__suggestions { position: absolute; z-index: 8; left: 0; right: 0; top: 68px; display: none; max-height: 230px; overflow: auto; padding: 4px; background: #fff; border: 1px solid #d9e3eb; border-radius: 6px; box-shadow: 0 8px 20px rgba(15,23,42,.12); }
				.hrms-employee-relationship__suggestions.is-visible { display: block; }
				.hrms-employee-relationship__suggestion { display: block; width: 100%; padding: 9px 10px; border: 0; border-radius: 4px; background: #fff; text-align: left; cursor: pointer; }
				.hrms-employee-relationship__suggestion:hover { background: #f0fdf4; }
				.hrms-employee-relationship__suggestion strong { display: block; }
				.hrms-employee-relationship__suggestion small { color: #687385; }
				.hrms-employee-relationship__submit { min-height: 38px; background: #10b981; border-color: #10b981; }
				.hrms-employee-relationship__list-tools { display: flex; align-items: center; gap: 10px; }
				.hrms-employee-relationship__list-tools input { width: 260px; min-height: 34px; border: 1px solid #d9e3eb; border-radius: 6px; padding: 6px 9px; }
				.hrms-employee-relationship__filter-note { margin-bottom: 12px; padding: 8px 10px; background: #f8fbff; border: 1px solid #dbeafe; border-radius: 6px; color: #52657a; }
				.hrms-employee-relationship__table-wrap { overflow-x: auto; }
				.hrms-employee-relationship__table { width: 100%; min-width: 860px; border-collapse: collapse; }
				.hrms-employee-relationship__table th, .hrms-employee-relationship__table td { padding: 11px 10px; border-top: 1px solid #eef1f4; text-align: left; vertical-align: middle; }
				.hrms-employee-relationship__table th { color: #687385; font-size: 12px; font-weight: 600; }
				.hrms-employee-relationship__filter-row th { padding-top: 6px; padding-bottom: 8px; border-top: 0; }
				.hrms-employee-relationship__filter-row input { width: 100%; min-width: 110px; min-height: 32px; border: 1px solid #d9e3eb; border-radius: 5px; padding: 6px 8px; font-weight: 400; color: #26323f; }
				.hrms-employee-relationship__sort { border: 0; padding: 0; background: transparent; color: #52657a; font-weight: 600; cursor: pointer; }
				.hrms-employee-relationship__sort:hover, .hrms-employee-relationship__sort.is-sorted { color: #059669; }
				.hrms-employee-relationship__statistics { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 24px; align-items: start; }
				.hrms-employee-relationship__pie-column { display: grid; gap: 18px; }
				.hrms-employee-relationship__pie { width: 220px; height: 220px; margin: 0 auto; }
				.hrms-employee-relationship__pie svg { display: block; width: 100%; height: 100%; overflow: visible; }
				.hrms-employee-relationship__pie svg .hrms-employee-relationship__pie-hole { pointer-events: none; }
				.hrms-employee-relationship__pie-slice { cursor: pointer; outline: 0; transition: opacity .15s ease, transform .15s ease; transform-origin: 110px 110px; }
				.hrms-employee-relationship__pie-slice:hover, .hrms-employee-relationship__pie-slice:focus { opacity: .82; transform: scale(1.025); }
				.hrms-employee-relationship__pie-slice.is-selected { stroke: #fff; stroke-width: 3; }
				.hrms-employee-relationship__pie-center { pointer-events: none; fill: #26323f; font-size: 24px; font-weight: 700; text-anchor: middle; }
				.hrms-employee-relationship__pie-center-label { pointer-events: none; fill: #687385; font-size: 12px; text-anchor: middle; }
				.hrms-employee-relationship__legend { display: grid; gap: 9px; }
				.hrms-employee-relationship__legend-row { display: grid; grid-template-columns: 12px minmax(90px, 1fr) auto auto; gap: 8px; align-items: center; }
				.hrms-employee-relationship__legend-button { display: contents; }
				.hrms-employee-relationship__legend-label { border: 0; padding: 0; background: transparent; color: #26323f; text-align: left; cursor: pointer; }
				.hrms-employee-relationship__legend-label:hover, .hrms-employee-relationship__legend-label.is-selected { color: #059669; font-weight: 600; }
				.hrms-employee-relationship__legend-swatch { width: 10px; height: 10px; border-radius: 50%; }
				.hrms-employee-relationship__legend-percent { color: #687385; min-width: 48px; text-align: right; }
				.hrms-employee-relationship__statistics-detail { min-height: 220px; padding: 16px 18px; border: 1px solid #dbeafe; border-radius: 8px; background: #f8fbff; }
				.hrms-employee-relationship__statistics-detail-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 12px; }
				.hrms-employee-relationship__statistics-detail-head h4 { margin: 0; font-size: 16px; }
				.hrms-employee-relationship__statistics-detail-head span { color: #52657a; white-space: nowrap; }
				.hrms-employee-relationship__statistics-pairs { display: grid; gap: 8px; }
				.hrms-employee-relationship__statistics-pair { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 10px; padding: 9px 10px; border: 1px solid #e5edf6; border-radius: 6px; background: #fff; }
				.hrms-employee-relationship__statistics-pair > span { color: #9aa4b2; }
				.hrms-employee-relationship__statistics-more { margin-top: 12px; padding: 0; border: 0; background: transparent; color: #2563eb; cursor: pointer; }
				.hrms-employee-relationship__statistics-more:hover { text-decoration: underline; }
				.hrms-employee-relationship__statistics-empty { padding: 34px 0; text-align: center; color: #9aa4b2; }
				.hrms-employee-relationship__employee-link { border: 0; padding: 0; background: transparent; color: #2563eb; text-align: left; cursor: pointer; }
				.hrms-employee-relationship__employee-link small { display: block; color: #687385; }
				.hrms-employee-relationship__empty { padding: 34px 0; text-align: center; color: #9aa4b2; }
				@media (max-width: 800px) { .hrms-employee-relationship__form-grid, .hrms-employee-relationship__statistics { grid-template-columns: 1fr; } .hrms-employee-relationship__list-tools { align-items: stretch; flex-direction: column; } .hrms-employee-relationship__list-tools input { width: 100%; } .hrms-employee-relationship__table { display: block; overflow-x: auto; white-space: nowrap; } }
			</style>
			<section class="hrms-employee-relationship">
				<p class="hrms-employee-relationship__intro">选择两名员工并填写关系，提交后会同步显示在双方员工档案的“员工关系”卡片中，并保留提交记录。</p>
				<section class="hrms-employee-relationship__card">
					<header class="hrms-employee-relationship__head"><div><h3>${__("添加员工关系")}</h3><p>${__("姓名和公司工号都可以用于匹配员工。")}</p></div></header>
					<form data-relationship-form>
						<div class="hrms-employee-relationship__form-grid">
							<div class="hrms-employee-relationship__field"><label>${__("员工一")}</label><input type="text" autocomplete="off" data-employee-input="a" placeholder="${__("输入姓名或公司工号")}"><div class="hrms-employee-relationship__suggestions" data-employee-suggestions="a"></div></div>
							<div class="hrms-employee-relationship__field"><label>${__("员工二")}</label><input type="text" autocomplete="off" data-employee-input="b" placeholder="${__("输入姓名或公司工号")}"><div class="hrms-employee-relationship__suggestions" data-employee-suggestions="b"></div></div>
							<div class="hrms-employee-relationship__field"><label>${__("关系")}</label><input type="text" maxlength="140" data-relationship-value placeholder="${__("例如：直属上级、同部门、亲属")}"></div>
						</div>
						<div style="margin-top:14px;text-align:right"><button type="submit" class="btn btn-primary hrms-employee-relationship__submit">${__("提交关系")}</button></div>
					</form>
				</section>
				<section class="hrms-employee-relationship__card">
					<header class="hrms-employee-relationship__head"><div><h3>${__("关系统计")}</h3><p>${__("按关系字段统计全部已建立关系，新增关系后自动更新。")}</p></div></header>
					<div class="hrms-employee-relationship__statistics" data-relationship-statistics><div class="hrms-employee-relationship__statistics-empty">${__("正在加载…")}</div></div>
				</section>
				<section class="hrms-employee-relationship__card">
					<header class="hrms-employee-relationship__head"><div><h3>${__("员工关系提交记录")}</h3><p data-relationship-count>${__("正在加载…")}</p></div><div class="hrms-employee-relationship__list-tools"><input type="search" data-relationship-search placeholder="${__("搜索员工或关系")}"><button type="button" class="btn btn-default btn-sm" data-relationship-refresh>${__("刷新")}</button></div></header>
					<div data-relationship-filter-note></div><div data-relationship-list></div>
				</section>
			</section>`;
	}

	bind_events() {
		this.wrapper.querySelector("[data-relationship-form]")?.addEventListener("submit", (event) => {
			event.preventDefault();
			this.create_relationship();
		});
		this.wrapper.querySelectorAll("[data-employee-input]").forEach((input) => {
			input.addEventListener("input", () => this.search_candidates(input.dataset.employeeInput, input.value));
			input.addEventListener("focus", () => {
				if (input.value.trim()) this.search_candidates(input.dataset.employeeInput, input.value);
			});
		});
		this.wrapper.querySelector("[data-relationship-search]")?.addEventListener("input", () => {
			clearTimeout(this.search_timers.list);
			this.search_timers.list = setTimeout(() => this.load_relationships(), 220);
		});
		this.wrapper.querySelector("[data-relationship-refresh]")?.addEventListener("click", () => this.load_relationships());
		this.wrapper.addEventListener("click", (event) => {
			if (!event.target.closest("[data-employee-input], [data-employee-suggestions]")) this.close_suggestions();
			const statistic_slice = event.target.closest("[data-relationship-statistic]");
			if (statistic_slice) {
				this.select_relationship_statistic(statistic_slice.dataset.relationshipStatistic);
				return;
			}
			const statistic_legend = event.target.closest("[data-relationship-statistic-legend]");
			if (statistic_legend) {
				this.select_relationship_statistic(statistic_legend.dataset.relationshipStatisticLegend);
				return;
			}
			const statistic_more = event.target.closest("[data-relationship-statistics-more]");
			if (statistic_more) {
				this.show_relationship_statistic_records(statistic_more.dataset.relationshipStatisticsMore);
				return;
			}
			const sort_button = event.target.closest("[data-relationship-sort]");
			if (sort_button) {
				const field = sort_button.dataset.relationshipSort;
				this.relationship_sort_order = this.relationship_sort_field === field && this.relationship_sort_order === "asc" ? "desc" : "asc";
				this.relationship_sort_field = field;
				this.load_relationships();
				return;
			}
			const suggestion = event.target.closest("[data-candidate-index]");
			if (suggestion) this.select_candidate(suggestion.dataset.candidateSide, Number(suggestion.dataset.candidateIndex));
			const employee_link = event.target.closest("[data-employee-route]");
			if (employee_link) frappe.set_route("employee-detail", employee_link.dataset.employeeRoute);
			const clear_filter = event.target.closest("[data-clear-relationship-filter]");
			if (clear_filter) frappe.set_route("employee-relationship");
		});
		this.wrapper.addEventListener("keydown", (event) => {
			const statistic_slice = event.target.closest("[data-relationship-statistic]");
			if (statistic_slice && (event.key === "Enter" || event.key === " ")) {
				event.preventDefault();
				this.select_relationship_statistic(statistic_slice.dataset.relationshipStatistic);
			}
		});
		this.wrapper.addEventListener("input", (event) => {
			const filter = event.target.closest("[data-relationship-filter]");
			if (!filter) return;
			const field = filter.dataset.relationshipFilter;
			this.relationship_filters[field] = filter.value;
			clearTimeout(this.search_timers[`relationship-filter-${field}`]);
			this.search_timers[`relationship-filter-${field}`] = setTimeout(() => this.load_relationships(), 220);
		});
	}

	search_candidates(side, query) {
		this.selected[side] = null;
		clearTimeout(this.search_timers[side]);
		query = String(query || "").trim();
		if (!query) {
			this.render_suggestions(side, []);
			return;
		}
		this.search_timers[side] = setTimeout(() => {
			frappe.call({ method: "hrms.hr.page.employee_relationship.employee_relationship.search_employee_relationship_candidates", args: { query, limit: 20 } }).then((response) => {
				const input = this.wrapper.querySelector(`[data-employee-input="${side}"]`);
				if (input && input.value.trim() === query) {
					this.candidates[side] = response.message || [];
					this.render_suggestions(side, this.candidates[side]);
				}
			});
		}, 180);
	}

	render_suggestions(side, candidates) {
		const container = this.wrapper.querySelector(`[data-employee-suggestions="${side}"]`);
		if (!container) return;
		container.innerHTML = candidates.length ? candidates.map((employee, index) => `<button type="button" class="hrms-employee-relationship__suggestion" data-candidate-side="${side}" data-candidate-index="${index}"><strong>${frappe.utils.escape_html(employee.employee_name || employee.name)}</strong><small>${frappe.utils.escape_html([employee.custom_employee_code, employee.department, employee.designation].filter(Boolean).join(" · ") || employee.name)}</small></button>`).join("") : `<div style="padding:9px 10px;color:#9aa4b2">${__("没有匹配的员工")}</div>`;
		container.classList.add("is-visible");
	}

	select_candidate(side, index) {
		const employee = this.candidates[side][index];
		if (!employee) return;
		this.selected[side] = employee;
		const input = this.wrapper.querySelector(`[data-employee-input="${side}"]`);
		if (input) input.value = this.employee_label(employee);
		this.render_suggestions(side, []);
		this.wrapper.querySelector(`[data-employee-suggestions="${side}"]`)?.classList.remove("is-visible");
	}

	employee_label(employee) {
		return [employee.employee_name, employee.custom_employee_code].filter(Boolean).join(" · ");
	}

	close_suggestions() {
		this.wrapper.querySelectorAll("[data-employee-suggestions]").forEach((container) => container.classList.remove("is-visible"));
	}

	create_relationship() {
		const relationship = this.wrapper.querySelector("[data-relationship-value]")?.value.trim() || "";
		if (!this.selected.a || !this.selected.b) {
			frappe.msgprint(__("请分别从下拉结果中选择员工一和员工二。"));
			return;
		}
		if (!relationship) {
			frappe.msgprint(__("请输入员工关系。"));
			return;
		}
		frappe.call({
			method: "hrms.hr.page.employee_relationship.employee_relationship.create_employee_relationship",
			args: { employee_a: this.selected.a.name, employee_b: this.selected.b.name, relationship },
			freeze: true,
			freeze_message: __("正在保存员工关系…"),
		}).then(() => {
			frappe.show_alert({ message: __("员工关系已提交"), indicator: "green" });
			this.selected = { a: null, b: null };
			this.wrapper.querySelector("[data-relationship-form]")?.reset();
				this.close_suggestions();
				this.load_relationships();
				this.load_relationship_statistics();
			});
	}

	load_relationship_statistics() {
		const request_id = ++this.statistics_request_id;
		frappe.call({
			method: "hrms.hr.page.employee_relationship.employee_relationship.get_employee_relationship_statistics",
		}).then((response) => {
			if (request_id !== this.statistics_request_id) return;
			this.render_relationship_statistics(response.message || {});
		}).catch(() => {
			if (request_id === this.statistics_request_id) {
				const container = this.wrapper.querySelector("[data-relationship-statistics]");
				if (container) container.innerHTML = `<div class="hrms-employee-relationship__statistics-empty">${__("关系统计暂时无法读取，请稍后重试。")}</div>`;
			}
		});
	}

	render_relationship_statistics(data) {
		const container = this.wrapper.querySelector("[data-relationship-statistics]");
		if (!container) return;
		const items = data.items || [];
		const total = Number(data.total || 0);
		this.relationship_statistics_data = data;
		if (!items.length || !total) {
			container.innerHTML = `<div class="hrms-employee-relationship__statistics-empty">${__("暂无关系数据")}</div>`;
			return;
		}
		const palette = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#64748b"];
		const selected = items.find((item) => item.key === this.selected_relationship_statistic) || items[0];
		this.selected_relationship_statistic = selected.key;
		let offset = 0;
		const slices = items.map((item, index) => {
			const start = offset;
			const percentage = Number(item.count || 0) / total;
			offset += percentage;
			const end = index === items.length - 1 ? 1 : offset;
			const slice_attributes = `class="hrms-employee-relationship__pie-slice ${item.key === selected.key ? "is-selected" : ""}" data-relationship-statistic="${frappe.utils.escape_html(item.key)}" fill="${palette[index % palette.length]}" role="button" tabindex="0" aria-label="${frappe.utils.escape_html(`${item.label} ${item.count}${__("条")}`)}"`;
			return end - start >= 0.999999
				? `<circle ${slice_attributes} cx="110" cy="110" r="100"></circle>`
				: `<path ${slice_attributes} d="${this.pie_slice_path(start * 360, end * 360)}"></path>`;
		}).join("");
		const legend = items.map((item, index) => `<div class="hrms-employee-relationship__legend-row"><span class="hrms-employee-relationship__legend-swatch" style="background:${palette[index % palette.length]}"></span><button type="button" class="hrms-employee-relationship__legend-label ${item.key === selected.key ? "is-selected" : ""}" data-relationship-statistic-legend="${frappe.utils.escape_html(item.key)}">${frappe.utils.escape_html(item.label)}</button><strong>${Number(item.count || 0)}${__("条")}</strong><span class="hrms-employee-relationship__legend-percent">${Number(item.percentage || 0).toFixed(1)}%</span></div>`).join("");
		const pairs = selected.pairs || [];
		const visible_pairs = pairs.slice(0, 5);
		const pair_markup = visible_pairs.length
			? visible_pairs.map((pair) => `<div class="hrms-employee-relationship__statistics-pair"><div>${this.employee_link(pair.employee_a, pair.employee_a_name, pair.employee_a_code)}</div><span>↔</span><div>${this.employee_link(pair.employee_b, pair.employee_b_name, pair.employee_b_code)}</div></div>`).join("")
			: `<div class="hrms-employee-relationship__statistics-empty">${__("暂无员工配对")}</div>`;
		const more_markup = pairs.length > visible_pairs.length
			? `<button type="button" class="hrms-employee-relationship__statistics-more" data-relationship-statistics-more="${frappe.utils.escape_html(selected.label)}">${__("查看更多")}（${pairs.length}${__("对")}）</button>`
			: "";
		container.innerHTML = `<div class="hrms-employee-relationship__pie-column"><div class="hrms-employee-relationship__pie"><svg viewBox="0 0 220 220" role="img" aria-label="${frappe.utils.escape_html(__("关系统计饼图"))}">${slices}<circle class="hrms-employee-relationship__pie-hole" cx="110" cy="110" r="62" fill="#fff"></circle><text x="110" y="106" class="hrms-employee-relationship__pie-center">${total}</text><text x="110" y="126" class="hrms-employee-relationship__pie-center-label">${__("条关系")}</text></svg></div><div class="hrms-employee-relationship__legend">${legend}</div></div><div class="hrms-employee-relationship__statistics-detail"><div class="hrms-employee-relationship__statistics-detail-head"><h4>${frappe.utils.escape_html(selected.label)}</h4><span>${selected.count}${__("对")} · ${Number(selected.percentage || 0).toFixed(1)}%</span></div><div class="hrms-employee-relationship__statistics-pairs">${pair_markup}</div>${more_markup}</div>`;
	}

	pie_slice_path(start_degrees, end_degrees) {
		const center = 110;
		const radius = 100;
		const start = (start_degrees - 90) * Math.PI / 180;
		const end = (end_degrees - 90) * Math.PI / 180;
		const start_x = center + radius * Math.cos(start);
		const start_y = center + radius * Math.sin(start);
		const end_x = center + radius * Math.cos(end);
		const end_y = center + radius * Math.sin(end);
		const large_arc = end_degrees - start_degrees > 180 ? 1 : 0;
		return `M ${center} ${center} L ${start_x.toFixed(3)} ${start_y.toFixed(3)} A ${radius} ${radius} 0 ${large_arc} 1 ${end_x.toFixed(3)} ${end_y.toFixed(3)} Z`;
	}

	select_relationship_statistic(key) {
		if (!this.relationship_statistics_data?.items?.some((item) => item.key === key)) return;
		this.selected_relationship_statistic = key;
		this.render_relationship_statistics(this.relationship_statistics_data);
	}

	show_relationship_statistic_records(relationship) {
		this.relationship_filters = { relationship };
		const search = this.wrapper.querySelector("[data-relationship-search]");
		if (search) search.value = "";
		this.load_relationships();
		this.wrapper.querySelector("[data-relationship-list]")?.scrollIntoView({ behavior: "smooth", block: "start" });
	}

	load_relationships() {
		const request_id = ++this.list_request_id;
		const search = this.wrapper.querySelector("[data-relationship-search]")?.value.trim() || "";
		frappe.call({
			method: "hrms.hr.page.employee_relationship.employee_relationship.get_employee_relationships",
			args: {
				search,
				employee: this.employee_filter,
				filters: JSON.stringify(this.relationship_filters),
				sort_field: this.relationship_sort_field,
				sort_order: this.relationship_sort_order,
				limit: 100,
			},
		}).then((response) => {
			if (request_id !== this.list_request_id) return;
			this.render_relationship_list(response.message || {});
		}).catch(() => {
			if (request_id === this.list_request_id) this.wrapper.querySelector("[data-relationship-list]").innerHTML = `<div class="hrms-employee-relationship__empty">${__("员工关系暂时无法读取，请稍后重试。")}</div>`;
		});
	}

	render_relationship_list(data) {
		const items = data.items || [];
		const count = Number(data.count || 0);
		this.wrapper.querySelector("[data-relationship-count]").textContent = __("共 {0} 条关系", [count]);
		const filter_note = this.wrapper.querySelector("[data-relationship-filter-note]");
		filter_note.innerHTML = this.employee_filter ? `<div class="hrms-employee-relationship__filter-note">${__("当前仅显示所选员工的关系") } <button type="button" class="btn btn-link btn-xs" data-clear-relationship-filter>${__("清除筛选")}</button></div>` : "";
		const list = this.wrapper.querySelector("[data-relationship-list]");
		const columns = this.relationship_columns();
		const header = columns.map((column) => `<th>${this.relationship_sort_indicator(column)}</th>`).join("");
		const filters = columns.map((column) => `<th>${this.relationship_filter_control(column)}</th>`).join("");
		const body = items.length
			? items.map((item) => `<tr>${columns.map((column) => `<td>${this.relationship_cell(item, column.key)}</td>`).join("")}</tr>`).join("")
			: `<tr><td class="hrms-employee-relationship__empty" colspan="${columns.length}">${__("暂无员工关系")}</td></tr>`;
		list.innerHTML = `<div class="hrms-employee-relationship__table-wrap"><table class="hrms-employee-relationship__table"><thead><tr>${header}</tr><tr class="hrms-employee-relationship__filter-row">${filters}</tr></thead><tbody>${body}</tbody></table></div>${data.has_more ? `<div class="text-muted" style="padding-top:12px">${__("仅显示前 100 条，请使用索引缩小范围。")}</div>` : ""}`;
		columns.forEach((column) => {
			const input = list.querySelector(`[data-relationship-filter="${column.key}"]`);
			if (input && this.relationship_filters[column.key]) {
				input.focus();
				input.setSelectionRange(input.value.length, input.value.length);
			}
		});
	}

	relationship_columns() {
		return [
			{ key: "employee_a", label: "员工一" },
			{ key: "relationship", label: "关系" },
			{ key: "employee_b", label: "员工二" },
			{ key: "status", label: "状态" },
			{ key: "submitted_by_name", label: "提交人" },
			{ key: "submitted_on", label: "提交时间" },
		];
	}

	relationship_escape(value) {
		return frappe.utils.escape_html(String(value == null ? "" : value));
	}

	relationship_sort_indicator(column) {
		const active = this.relationship_sort_field === column.key;
		const direction = active && this.relationship_sort_order === "asc" ? "↑" : active ? "↓" : "↕";
		const aria_sort = active ? (this.relationship_sort_order === "asc" ? "ascending" : "descending") : "none";
		return `<button type="button" class="hrms-employee-relationship__sort ${active ? "is-sorted" : ""}" data-relationship-sort="${column.key}" aria-sort="${aria_sort}">${this.relationship_escape(__(column.label))} <span aria-hidden="true">${direction}</span></button>`;
	}

	relationship_filter_control(column) {
		return `<input type="search" class="form-control input-xs" data-relationship-filter="${column.key}" value="${this.relationship_escape(this.relationship_filters[column.key] || "")}" placeholder="${this.relationship_escape(__("输入索引"))}" aria-label="${this.relationship_escape(__(`${column.label}索引`))}">`;
	}

	relationship_cell(item, fieldname) {
		if (fieldname === "employee_a" || fieldname === "employee_b") {
			const employee = item[fieldname];
			return this.employee_link(employee, item[`${fieldname}_name`], item[`${fieldname}_code`]);
		}
		return this.relationship_escape(item[fieldname] || (fieldname === "status" ? "已提交" : "未记录"));
	}

	employee_link(employee, name, code) {
		return `<button type="button" class="hrms-employee-relationship__employee-link" data-employee-route="${frappe.utils.escape_html(employee || "")}">${frappe.utils.escape_html(name || employee || "")}${code ? `<small>${frappe.utils.escape_html(code)}</small>` : ""}</button>`;
	}
}
