frappe.pages["organizational-chart"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("部门架构图"),
		single_column: true,
	});

	wrapper.organizational_chart = new HybridOrganizationChart(page);
	wrapper.organizational_chart.show();
};

frappe.pages["organizational-chart"].on_page_show = function (wrapper) {
	wrapper.organizational_chart?.activate();
};

frappe.pages["organizational-chart"].on_page_hide = function (wrapper) {
	wrapper.organizational_chart?.deactivate();
};

const YONGXIN_COMPANY = "永新";
const MIN_ORG_CHART_ZOOM = 0.025;

class HybridOrganizationChart {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.company = window.hrmsCompanyContext?.getCurrentCompany?.() || YONGXIN_COMPANY;
		this.tree = null;
		this.selected_node = null;
		this.zoom = 1;
		this.view_mode = "overview";
		this.layout_frame = null;
		this.collapsed_nodes = new Set();
		this.field_map = {};
		this.search_term = "";
		this.tree_request_id = 0;
		this.field_map_request_id = 0;
		this.company_context_bound = false;
		this.last_refresh_at = 0;
		this.cache_ttl = 30_000;
		this.mode = null;
		this.report_data = null;
		this.report_loading = false;
		// Live is the only editable source.  The original workbook remains a
		// comparison view, never the default hierarchy users accidentally edit.
		this.source_mode = "live";
		this.fullscreen_bound = false;
	}

	show() {
		this.bind_company_context();
		this.render_current_view(true);
	}

	is_active() {
		const container = this.wrapper.closest(".page-container");
		return !container || container.getClientRects().length > 0;
	}

	activate(initial = false) {
		this.bind_company_context();
		if (this.get_route_mode() !== this.mode) {
			this.render_current_view(true);
			return;
		}
		if (this.mode === "report") {
			if (!initial && Date.now() - this.last_refresh_at > this.cache_ttl) this.load_organization_report(true);
			return;
		}
		if (!initial && Date.now() - this.last_refresh_at > this.cache_ttl) {
			this.load_tree();
		}
	}

	get_route_mode() {
		return frappe.get_route()?.[1] === "report" ? "report" : "chart";
	}

	render_current_view(force = false) {
		this.mode = this.get_route_mode();
		if (this.mode === "report") {
			this.page.set_title(__("部门报表"));
			this.setup_report_actions();
			this.render_report_shell();
			this.load_organization_report(force);
			return;
		}

		this.page.set_title(__("部门架构图"));
		this.setup_actions();
		this.render_shell();
		this.load_field_map();
		this.load_tree();
	}

	deactivate() {
		if (this.company_context_bound) {
			window.removeEventListener("hrms:company-context-changed", this.handle_company_context_change);
			this.company_context_bound = false;
		}
		if (this.fullscreen_bound) {
			document.removeEventListener("fullscreenchange", this.handle_fullscreen_change);
			this.fullscreen_bound = false;
		}
	}

	setup_actions() {
		this.page.clear_inner_toolbar();
		this.page.add_inner_button(__("原表架构"), () => this.set_source_mode("workbook_snapshot"));
		this.page.add_inner_button(__("实时组织"), () => this.set_source_mode("live"));
		this.page.add_inner_button(__("一览全局"), () => this.fit_to_view());
		this.page.add_inner_button(__("全屏查看"), () => this.toggle_fullscreen());
		this.page.add_inner_button(__("展开全部"), () => this.expand_all());
		this.page.add_inner_button(__("收起全部"), () => this.collapse_all());
		this.page.add_inner_button(__("同步2026Q3架构"), () => this.import_yongxin_q3_department_hierarchy());
		this.page.add_inner_button(__("导出 Excel"), () => this.export_chart());
		window.hrmsFormImport?.addPageActions(this.page, "org_structure", "组织架构与编制", "表单导入");
		this.page.set_primary_action(__("新增部门"), () => this.add_department());
	}

	setup_report_actions() {
		this.page.clear_inner_toolbar();
		this.page.add_inner_button(__("刷新"), () => this.load_organization_report(true));
		this.page.set_primary_action(__("导出表格"), () => this.export_report_table());
	}

	render_shell() {
		this.wrapper.innerHTML = `
			<div class="hrms-org-page">
				<section class="hrms-org-main">
					<div class="hrms-org-toolbar">
						<div>
							<strong class="hrms-org-toolbar-title">${__("部门层级与人员归属")}</strong>
							<small class="hrms-org-source" data-source-label>${__("正在读取组织架构来源...")}</small>
							<small class="hrms-org-builder-hint">${__("实时组织：拖动部门、岗位或人员到目标节点，即同步部门、岗位与花名册。")}</small>
						</div>
						<div class="hrms-org-search">
							<input class="form-control" data-search placeholder="${__("搜索部门、员工、岗位")}" />
						</div>
						<div class="hrms-org-toolbar-actions">
							<button class="btn btn-default btn-sm" data-action="fit-view">${__("一览全局")}</button>
							<button class="btn btn-default btn-sm" data-action="toggle-fullscreen">${__("全屏查看")}</button>
							<button class="btn btn-default btn-sm" data-action="zoom-out" title="${__("缩小")}">-</button>
							<button class="btn btn-default btn-sm" data-action="zoom-in" title="${__("放大")}">+</button>
							<button class="btn btn-default btn-sm" data-action="refresh">${__("刷新")}</button>
						</div>
					</div>
					<div class="hrms-org-summary" data-summary></div>
					<div class="hrms-org-tree-canvas" data-tree-canvas>
						<div class="hrms-org-tree-stage" data-tree-stage>
							<div class="hrms-org-tree-scale" data-tree></div>
						</div>
					</div>
				</section>
				<aside class="hrms-org-detail" data-detail>
					<div class="hrms-org-empty">${__("正在加载组织架构...")}</div>
				</aside>
			</div>
		`;

		this.bind_events();
		this.bind_fullscreen_events();
	}

	render_report_shell() {
		this.wrapper.innerHTML = `
			<div class="hrms-org-page hrms-org-page--report">
				<section class="hrms-org-report-host" data-report>
					<div class="hrms-org-report-empty">${__("正在生成部门报表...")}</div>
				</section>
			</div>
		`;
		this.bind_events();
	}

	load_organization_report(force = false) {
		if (this.report_loading || (!force && this.report_data)) return;
		this.report_loading = true;
		this.last_refresh_at = Date.now();
		const host = this.wrapper.querySelector("[data-report]");
		if (host) host.innerHTML = `<div class="hrms-org-report-empty">${__("正在生成部门报表...")}</div>`;
		frappe
			.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.get_organization_report",
				args: { company: this.company },
			})
			.then((response) => {
				this.report_loading = false;
				if (this.mode !== "report") return;
				this.report_data = response.message || {};
				this.render_organization_report();
			})
			.catch((error) => {
				this.report_loading = false;
				if (!host || this.mode !== "report") return;
				host.innerHTML = `<div class="hrms-org-report-empty">${frappe.utils.escape_html(
					error?.message || __("部门报表生成失败，请刷新后重试。"),
				)}</div>`;
			});
	}

	render_organization_report() {
		const host = this.wrapper.querySelector("[data-report]");
		if (!host) return;
		const rows = this.report_data?.rows || [];
		const total = this.report_data?.total || {};
		host.innerHTML = `
			<div class="hrms-org-report">
				<header><h2>${frappe.utils.escape_html(this.report_data?.title || __("部门报表"))}</h2></header>
				<div class="hrms-org-report-table-wrap">
					<table>
						<thead><tr>${(this.report_data?.columns || []).map((column) => `<th>${frappe.utils.escape_html(column)}</th>`).join("")}</tr></thead>
						<tbody>
							${rows.map((row) => this.render_report_row(row)).join("")}
							${this.render_report_total(total)}
						</tbody>
					</table>
				</div>
				<div class="hrms-org-report-approval">${__("批准：")}</div>
			</div>`;
	}

	render_report_row(row) {
		const indent = Math.max(Number(row.level || 1) - 1, 0) * 16;
		return `<tr>
			<td style="padding-left:${12 + indent}px"><strong>${frappe.utils.escape_html(row.department || "")}</strong>${row.parent_department ? `<small>${frappe.utils.escape_html(row.parent_department)}</small>` : ""}</td>
			<td>${frappe.utils.escape_html(String(row.planned_headcount || 0))}</td>
			<td>${frappe.utils.escape_html(String(row.current_headcount || 0))}</td>
			<td>${frappe.utils.escape_html(String(row.vacancy_count || 0))}</td>
			<td>${this.format_report_rate(row.fulfillment_rate)}</td>
			<td>${frappe.utils.escape_html(row.vacancy_notes || "-")}</td>
		</tr>`;
	}

	render_report_total(total) {
		return `<tr class="hrms-org-report-total">
			<td>${__("汇总")}</td>
			<td>${frappe.utils.escape_html(String(total.planned_headcount || 0))}</td>
			<td>${frappe.utils.escape_html(String(total.current_headcount || 0))}</td>
			<td>${frappe.utils.escape_html(String(total.vacancy_count || 0))}</td>
			<td>${this.format_report_rate(total.fulfillment_rate)}</td>
			<td>-</td>
		</tr>`;
	}

	format_report_rate(value) {
		if (value === null || value === undefined) return "-";
		return `${Math.round(Number(value || 0) * 100)}%`;
	}

	export_report_table() {
		if (!this.report_data) return;
		const headers = this.report_data.columns || [];
		const rows = (this.report_data.rows || []).map((row) => [
			row.department,
			row.planned_headcount || 0,
			row.current_headcount || 0,
			row.vacancy_count || 0,
			this.format_report_rate(row.fulfillment_rate),
			row.vacancy_notes || "-",
		]);
		const total = this.report_data.total || {};
		rows.push([__("汇总"), total.planned_headcount || 0, total.current_headcount || 0, total.vacancy_count || 0, this.format_report_rate(total.fulfillment_rate), "-"]);
		const csv = [headers, ...rows]
			.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
			.join("\r\n");
		const link = document.createElement("a");
		link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
		link.download = `${this.company || YONGXIN_COMPANY}_部门报表.csv`;
		link.click();
		URL.revokeObjectURL(link.href);
	}

	set_company(company, { publish = true } = {}) {
		const next_company = (company || "").trim();
		if (!next_company) return;
		if (publish && window.hrmsCompanyContext?.setCurrentCompany) {
			const shared_company = window.hrmsCompanyContext.setCurrentCompany(next_company);
			if (shared_company !== next_company) return;
		}
		if (next_company === this.company) return;
		this.company = next_company;
		if (this.mode === "report") this.load_organization_report(true);
		else this.load_tree();
	}

	bind_company_context() {
		if (this.company_context_bound) return;
		this.company_context_bound = true;
		this.handle_company_context_change = (event) => {
			if (!this.is_active()) return;
			const detail = event.detail || {};
			this.set_company(detail.company, { publish: false });
		};
		window.addEventListener("hrms:company-context-changed", this.handle_company_context_change);
		window.hrmsCompanyContext?.ready?.().then((company) => {
			if (!this.is_active()) return;
			this.set_company(company, { publish: false });
		});
	}

	bind_events() {
		this.wrapper.addEventListener("click", (event) => {
			const action = event.target.closest("[data-action]");
			if (action) {
				this.handle_action(action.dataset.action, action);
				return;
			}

			const node = event.target.closest("[data-node-id]");
			if (node) {
				this.select_node(node.dataset.nodeId, node.dataset.nodeType);
				return;
			}
		});

		this.wrapper.querySelector("[data-search]")?.addEventListener(
			"input",
			frappe.utils.debounce((event) => this.filter_tree(event.target.value), 180),
		);
		this.wrapper.addEventListener("dragstart", (event) => this.handle_drag_start(event));
		this.wrapper.addEventListener("dragover", (event) => this.handle_drag_over(event));
		this.wrapper.addEventListener("dragleave", (event) => this.handle_drag_leave(event));
		this.wrapper.addEventListener("drop", (event) => this.handle_drop(event));
		this.wrapper.addEventListener("dragend", () => {
			this.dragged_node_id = null;
			this.clear_drag_targets();
		});
	}

	handle_action(action, element) {
		if (action === "show-workbook-snapshot") this.set_source_mode("workbook_snapshot");
		if (action === "show-live-tree") this.set_source_mode("live");
		if (action === "toggle-fullscreen") this.toggle_fullscreen();
		if (action === "fit-view") this.fit_to_view();
		if (action === "zoom-in") this.set_zoom(this.zoom + 0.1);
		if (action === "zoom-out") this.set_zoom(this.zoom - 0.1);
		if (action === "refresh") this.load_tree();
		if (action === "toggle-node") this.toggle_node(element?.dataset.toggleNode);
		if (action === "select-node") this.select_node(element?.dataset.nodeId, element?.dataset.nodeType);
		if (action === "add-department") this.add_department();
		if (action === "edit-department") this.edit_department();
		if (action === "quick-edit-node") this.quick_edit_node(element);
		if (action === "delete-department") this.delete_department();
		if (action === "open-employee") {
			this.open_employee(
				element?.dataset.employeeCode,
				element?.dataset.employeeRoute || element?.dataset.employee,
			);
		}
		if (action === "open-person") this.show_person_detail(this.read_person_payload(element));
	}

	handle_drag_start(event) {
		const node = event.target.closest("[data-node-id][draggable='true']");
		if (!node || this.source_mode !== "live") return;
		this.dragged_node_id = node.dataset.nodeId;
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("application/x-hrms-org-node", node.dataset.nodeId);
		node.classList.add("is-dragging");
	}

	handle_drag_over(event) {
		const target = event.target.closest("[data-node-id]");
		if (!target || this.source_mode !== "live") return;
		const sourceId = event.dataTransfer?.getData("application/x-hrms-org-node") || this.dragged_node_id;
		const source = event.dataTransfer?.types?.includes("application/x-hrms-org-node");
		if (!source || target.classList.contains("is-dragging") || !this.is_supported_drop(sourceId, target.dataset.nodeId)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		this.clear_drag_targets();
		target.classList.add("is-drop-target");
	}

	handle_drag_leave(event) {
		const target = event.target.closest("[data-node-id]");
		if (target && !target.contains(event.relatedTarget)) target.classList.remove("is-drop-target");
	}

	handle_drop(event) {
		const target = event.target.closest("[data-node-id]");
		const sourceId = event.dataTransfer?.getData("application/x-hrms-org-node") || this.dragged_node_id;
		if (!target || !sourceId || this.source_mode !== "live" || !this.is_supported_drop(sourceId, target.dataset.nodeId)) return;
		event.preventDefault();
		this.clear_drag_targets();
		if (sourceId === target.dataset.nodeId) return;
		frappe
			.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.move_organization_node",
				args: { node_id: sourceId, target_node_id: target.dataset.nodeId, company: this.company },
				freeze: true,
				freeze_message: __("正在同步组织关系..."),
			})
			.then((response) => {
				frappe.show_alert({ message: response.message?.message || __("组织关系已同步"), indicator: "green" });
				this.load_tree();
			})
			.catch(() => this.clear_drag_targets());
	}

	clear_drag_targets() {
		this.wrapper.querySelectorAll(".is-dragging, .is-drop-target").forEach((node) => {
			node.classList.remove("is-dragging", "is-drop-target");
		});
	}

	is_supported_drop(sourceId, targetId) {
		const sourceType = String(sourceId || "").split(":", 1)[0];
		const targetType = String(targetId || "").split(":", 1)[0];
		if (sourceType === "department") return ["department", "company", "company_leadership"].includes(targetType);
		if (sourceType === "employee") return ["employee", "department", "work_level", "position_group"].includes(targetType);
		return sourceType === "position_group" && targetType === "position_group";
	}

	load_tree() {
		const request_id = ++this.tree_request_id;
		const company = this.company;
		this.last_refresh_at = Date.now();
		const tree = this.wrapper.querySelector("[data-tree]");
		if (tree) tree.innerHTML = `<div class="hrms-org-empty">${__("正在加载组织架构...")}</div>`;
		frappe
			.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.get_hybrid_tree",
				args: { company, source_mode: this.source_mode },
				freeze: true,
				freeze_message: __("正在生成组织架构图..."),
			})
			.then((r) => {
				if (request_id !== this.tree_request_id || company !== this.company || !this.is_active()) return;
				this.tree = r.message || {};
				this.source_mode = this.tree.source_mode || this.source_mode;
				this.field_map = this.tree.field_map || {};
				this.collapsed_nodes.clear();
				if (this.source_mode === "workbook_snapshot") this.collapse_snapshot_detail_nodes(this.tree.root);
				if (this.source_mode === "live") this.collapse_live_folder_nodes(this.tree.root);
				this.view_mode = "overview";
				this.render_summary();
				this.render_source_label();
				this.render_tree();
				const root = this.tree.root;
				const initial_node = this.find_initial_department_node(root);
				if (initial_node) this.select_node(initial_node.node_id, initial_node.node_type);
			})
			.catch((error) => {
				if (request_id !== this.tree_request_id || company !== this.company || !this.is_active()) return;
				this.render_load_error(error, company);
			});
	}

	find_initial_department_node(node) {
		if (!node) return null;
		if (node.node_type === "department") return node;
		for (const child of node.children || []) {
			const department = this.find_initial_department_node(child);
			if (department) return department;
		}
		return node;
	}

	render_load_error(error, company) {
		this.tree = null;
		const message = error?.message || error?.exc_type || __("服务端未返回组织数据。");
		const tree = this.wrapper.querySelector("[data-tree]");
		const detail = this.wrapper.querySelector("[data-detail]");
		if (tree) {
			tree.style.transform = "none";
			tree.style.left = "0";
			tree.innerHTML = `
				<div class="hrms-org-load-error">
					<strong>${__("组织架构加载失败")}</strong>
					<span>${frappe.utils.escape_html(message)}</span>
					<button class="btn btn-default btn-sm" data-action="refresh">${__("重试")}</button>
				</div>
			`;
		}
		if (detail) {
			detail.innerHTML = `
				<div class="hrms-org-empty">
					<div>${__("未能加载 {0} 的组织架构，请重试或检查公司权限。", [company || __("当前公司")])}</div>
				</div>
			`;
		}
	}

	load_field_map() {
		const request_id = ++this.field_map_request_id;
		frappe
			.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.get_employee_roster_field_map",
			})
			.then((r) => {
				if (request_id !== this.field_map_request_id || !this.is_active()) return;
				this.field_map = r.message || this.field_map || {};
			});
	}

	render_summary() {
		const summary = this.tree?.summary || {};
		const cards = [
			["编制人数", summary.planned_headcount || 0],
			["现有人数", summary.current_headcount || 0],
			["空缺人数", summary.vacancy_count || 0],
			["部门数", summary.department_count || 0],
		];
		if (this.source_mode === "workbook_snapshot") {
			cards.push(["原表人员", summary.source_employee_count || 0], ["已匹配档案", summary.matched_employee_count || 0]);
		} else {
			cards.push(["未分配部门", summary.missing_department_count || 0], ["缺少负责人", summary.missing_manager_count || 0]);
		}
		this.wrapper.querySelector("[data-summary]").innerHTML = cards
			.map(
				([label, value]) => `
					<div class="hrms-org-summary-card">
						<strong>${frappe.utils.escape_html(String(value))}</strong>
						<span>${frappe.utils.escape_html(__(label))}</span>
					</div>`,
			)
			.join("");
	}

	render_source_label() {
		const label = this.wrapper.querySelector("[data-source-label]");
		if (!label) return;
		label.textContent = this.tree?.source_label || (this.source_mode === "live" ? __("实时组织主数据") : __("原表组织架构"));
	}

	set_source_mode(source_mode) {
		if (!source_mode || source_mode === this.source_mode) return;
		this.source_mode = source_mode;
		this.selected_node = null;
		this.load_tree();
	}

	render_tree() {
		const root = this.tree?.root;
		const tree = this.wrapper.querySelector("[data-tree]");
		if (!root) {
			tree.innerHTML = `<div class="hrms-org-empty">${__("暂无组织数据，请先导入员工花名册或维护部门。")}</div>`;
			return;
		}
		const roots = [root];
		if (!roots.length) {
			tree.innerHTML = `<div class="hrms-org-empty">${__("暂无部门，请先在部门管理中新增一级部门。")}</div>`;
			return;
		}
		tree.innerHTML = `<ul class="hrms-org-tree hrms-org-tree--forest">${roots.map((node) => this.render_tree_node(node)).join("")}</ul>`;
		if (this.layout_frame) window.cancelAnimationFrame(this.layout_frame);
		this.layout_frame = window.requestAnimationFrame(() => {
			this.layout_frame = null;
			if (this.view_mode === "overview") {
				this.fit_to_view();
			} else {
				this.apply_tree_scale();
			}
		});
	}

	render_tree_node(node) {
		const collapsed = !this.search_term && this.collapsed_nodes.has(node.node_id);
		const children = node.children || [];
		const has_children = children.length > 0;
		const department = this.get_node_department(node);
		const editable = ["department", "work_level", "position_group"].includes(node.node_type);
		const movable = this.source_mode === "live" && ["department", "position_group", "employee"].includes(node.node_type);
		return `
			<li class="${collapsed ? "is-collapsed" : ""}">
				<div
					class="hrms-org-node hrms-org-node--${frappe.utils.escape_html(node.node_type || "default")}"
					data-node-id="${frappe.utils.escape_html(node.node_id)}"
					data-node-type="${frappe.utils.escape_html(node.node_type)}"
					data-search-text="${frappe.utils.escape_html(this.node_search_text(node))}"
					draggable="${movable ? "true" : "false"}"
					title="${movable ? frappe.utils.escape_html(__("可拖动到目标节点，保存真实组织关系")) : ""}"
				>
					<div class="hrms-org-node-bar"></div>
					${
						editable
							? `<button
								type="button"
								class="hrms-org-node-edit"
								data-action="quick-edit-node"
								data-node-id="${frappe.utils.escape_html(node.node_id)}"
								data-node-type="${frappe.utils.escape_html(node.node_type || "")}"
								data-department="${frappe.utils.escape_html(department)}"
								title="${__("快速编辑此卡片")}"
								aria-label="${__("快速编辑此卡片")}"
							>${frappe.utils.icon("edit", "xs")}</button>`
							: ""
					}
					<div class="hrms-org-node-body">
						${this.render_node_heading(node)}
						<span>${frappe.utils.escape_html(node.title || "")}</span>
						${this.render_node_lines(node)}
						${this.render_vacancy_marker(node)}
						${
							node.node_type === "employee"
								? `<small>${frappe.utils.escape_html([node.work_level, node.department].filter(Boolean).join(" · "))}</small>`
								: `<small>${__("编制")} ${frappe.utils.escape_html(String(node.planned_headcount || 0))} · ${__("现有")} ${frappe.utils.escape_html(String(node.current_headcount || 0))} · ${__("空缺")} ${frappe.utils.escape_html(String(node.vacancy_count || 0))}</small>`
						}
					</div>
					${has_children ? `<button class="hrms-org-node-toggle" data-action="toggle-node" data-toggle-node="${frappe.utils.escape_html(node.node_id)}">${collapsed ? "+" : "-"}</button>` : ""}
				</div>
				${
					has_children && !collapsed
						? `<ul>${children.map((child) => this.render_tree_node(child)).join("")}</ul>`
						: ""
				}
			</li>
		`;
	}

	render_node_heading(node) {
		const employee_route = this.normalize_employee_route_value(node.employee_route || node.employee);
		const employee_code = this.normalize_employee_code_value(node.employee_code);
		if (!employee_route) {
			return `<strong>${frappe.utils.escape_html(node.name || "")}</strong>`;
		}
		return `
			<button
				type="button"
				class="hrms-org-node-person-link"
				data-action="open-employee"
				data-employee="${frappe.utils.escape_html(node.employee || "")}"
				data-employee-route="${frappe.utils.escape_html(employee_route)}"
				data-employee-code="${frappe.utils.escape_html(employee_code)}"
				title="${__("打开员工档案")}"
			>${frappe.utils.escape_html(node.name || "")}</button>
		`;
	}

	render_vacancy_marker(node) {
		const vacancy_count = Number(node.vacancy_count || 0);
		if (!vacancy_count) return "";
		return `<strong class="hrms-org-vacancy-marker">TBA×${frappe.utils.escape_html(String(vacancy_count))}</strong>`;
	}

	node_search_text(node) {
		const people = (node.people || [])
			.flatMap((person) => [
				person.name,
				person.employee_name,
				person.employee_code,
				person.department,
				person.designation,
				person.grade,
				person.role,
			])
			.filter(Boolean);
		return [node.name, node.title, node.department, ...(node.lines || []), ...people].filter(Boolean).join(" ");
	}

	render_node_lines(node) {
		if (node.people && node.people.length) {
			const matching_people = this.search_term
				? node.people.filter((person) => {
						const search_text = [
							person.name,
							person.employee_name,
							person.employee_code,
							person.department,
							person.designation,
							person.grade,
							person.role,
						]
							.filter(Boolean)
							.join(" ")
							.toLowerCase();
						return search_text.includes(this.search_term);
					})
				: node.people;
			return `
				<div class="hrms-org-node-lines">
					${this.render_person_tokens(matching_people, { limit: this.search_term ? 0 : 8 })}
					${
						!this.search_term && matching_people.length > 8
							? `<button
								type="button"
								class="hrms-org-person-more"
								data-action="select-node"
								data-node-id="${frappe.utils.escape_html(node.node_id)}"
								data-node-type="${frappe.utils.escape_html(node.node_type || "")}">${__("另有 {0} 人，请点击查看", [matching_people.length - 8])}</button>`
							: ""
					}
				</div>
			`;
		}
		const lines = (node.employee_names && node.employee_names.length ? node.employee_names : node.lines) || [];
		if (!lines.length) return "";
		return `
			<div class="hrms-org-node-lines">
				${lines.map((line) => `<em>${frappe.utils.escape_html(line || "")}</em>`).join("")}
			</div>
		`;
	}

	render_person_tokens(people, options = {}) {
		const list = options.limit ? people.slice(0, options.limit) : people;
		return list
			.map((person) => {
				const employee_route = this.resolve_employee_route_value(person);
				const employee_code = this.resolve_employee_code_value(person);
				const matched = Boolean(employee_route && person.matched_employee !== false);
				const meta = [person.role, person.designation, person.department_label || person.department]
					.filter(Boolean)
					.join(" · ");
				const label = [person.role, person.employee_name || person.name].filter(Boolean).join("：");
				const payload = this.person_payload({ ...person, employee_route });
				const action = matched ? "open-employee" : "open-person";
				return `
					<button
						type="button"
						class="hrms-org-person-token ${matched ? "" : "is-unmatched"}"
						data-action="${action}"
						data-person-name="${frappe.utils.escape_html(person.name || person.employee_name || "")}"
						data-employee="${frappe.utils.escape_html(person.employee || "")}"
						data-employee-route="${frappe.utils.escape_html(employee_route)}"
						data-employee-code="${frappe.utils.escape_html(employee_code)}"
						data-person-payload="${frappe.utils.escape_html(payload)}"
						title="${frappe.utils.escape_html([person.match_status, meta].filter(Boolean).join(" · "))}"
					>
						<span>${frappe.utils.escape_html(label || "")}</span>
						${options.showMeta && meta ? `<small>${frappe.utils.escape_html(meta)}</small>` : ""}
					</button>
				`;
			})
			.join("");
	}

	person_payload(person) {
		return encodeURIComponent(JSON.stringify(person || {}));
	}

	read_person_payload(element) {
		try {
			return JSON.parse(decodeURIComponent(element?.dataset.personPayload || "{}"));
		} catch (error) {
			return {
				name: element?.dataset.personName || "",
				employee: element?.dataset.employee || "",
				employee_name: element?.dataset.personName || "",
			};
		}
	}

	select_node(node_id, node_type) {
		this.selected_node = { node_id, node_type };
		this.wrapper.querySelectorAll(".hrms-org-node.active").forEach((node) => node.classList.remove("active"));
		const selected = Array.from(this.wrapper.querySelectorAll("[data-node-id]")).find(
			(node) => node.dataset.nodeId === node_id,
		);
		if (selected) selected.classList.add("active");

		frappe
			.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.get_hybrid_node_detail",
				args: {
					node_id,
					node_type,
					company: this.company,
					search: this.wrapper.querySelector("[data-search]").value || "",
					source_mode: this.source_mode,
				},
			})
			.then((r) => this.render_detail_panel(r.message || {}));
	}

	bind_fullscreen_events() {
		if (this.fullscreen_bound) return;
		this.fullscreen_bound = true;
		this.handle_fullscreen_change = () => {
			const page = this.wrapper.querySelector(".hrms-org-page");
			page?.classList.toggle("is-fullscreen", document.fullscreenElement === page);
			window.requestAnimationFrame(() => this.fit_to_view());
		};
		document.addEventListener("fullscreenchange", this.handle_fullscreen_change);
	}

	toggle_fullscreen() {
		const page = this.wrapper.querySelector(".hrms-org-page");
		if (!page) return;
		if (document.fullscreenElement === page) {
			document.exitFullscreen?.();
			return;
		}
		if (!page.requestFullscreen) {
			frappe.msgprint(__("当前浏览器不支持全屏模式。"));
			return;
		}
		page.requestFullscreen().catch(() => frappe.msgprint(__("无法进入全屏模式，请检查浏览器权限。")));
	}

	render_detail_panel(detail) {
		const actions = detail.actions || {};
		this.wrapper.querySelector("[data-detail]").innerHTML = `
			<div class="hrms-org-detail-head">
				<div>
					<h3>${frappe.utils.escape_html(detail.title || __("组织节点"))}</h3>
					${detail.subtitle ? `<p>${frappe.utils.escape_html(detail.subtitle)}</p>` : ""}
				</div>
				<div class="hrms-org-detail-actions">
					<button class="btn btn-xs btn-default" data-action="add-department">${__("新增部门")}</button>
					${
						actions.can_edit_department
							? `<button class="btn btn-xs btn-default" data-action="edit-department">${__("编辑部门")}</button>`
							: ""
					}
					${
						actions.can_delete_department
							? `<button class="btn btn-xs btn-danger" data-action="delete-department">${__("删除部门")}</button>`
							: ""
					}
				</div>
			</div>
			${this.render_department_relationships(detail.relationships || {})}
			${this.render_employee_list(detail.employees || [])}
		`;
	}

	render_department_relationships(relationships) {
		const parent = relationships.parent;
		const children = relationships.children || [];
		const is_snapshot = this.source_mode === "workbook_snapshot";
		const node_button = (department) => `
			<button
				type="button"
				class="hrms-org-relation-button"
				data-action="select-node"
				data-node-id="${frappe.utils.escape_html(is_snapshot ? department.name || "" : `department:${department.name || ""}`)}"
				data-node-type="${frappe.utils.escape_html(is_snapshot ? department.node_type || "snapshot" : "department")}"
			>${frappe.utils.escape_html(department.label || department.name || "")}</button>`;
		return `
			<div class="hrms-org-relations">
				<section>
					<strong>${__("上级部门")}</strong>
					${parent ? node_button(parent) : `<span>${__("无上级部门（一级部门）")}</span>`}
				</section>
				<section>
					<strong>${__("下级部门")}</strong>
					<div class="hrms-org-relation-list">
						${children.length ? children.map(node_button).join("") : `<span>${__("暂无下级部门")}</span>`}
					</div>
				</section>
			</div>`;
	}

	render_metric(label, value) {
		return `
			<div>
				<strong>${frappe.utils.escape_html(String(value || 0))}</strong>
				<span>${frappe.utils.escape_html(__(label))}</span>
			</div>
		`;
	}

	render_people_list(people) {
		if (!people.length) return "";
		return `
			<div class="hrms-org-people">
				<div class="hrms-org-section-title">${__("职位与人员匹配")}</div>
				<div class="hrms-org-person-grid">
					${this.render_person_tokens(people, { showMeta: true })}
				</div>
			</div>
		`;
	}

	render_employee_list(employees) {
		if (!employees.length) {
			return `<div class="hrms-org-empty">${__("当前节点没有匹配员工。")}</div>`;
		}
		return `
			<div class="hrms-org-employees">
				<div class="hrms-org-section-title">${this.source_mode === "workbook_snapshot" ? __("原表人员（含下级）") : __("当前部门员工")}</div>
				${employees
					.map(
						(employee) => {
							const employee_route = this.resolve_employee_route_value(employee);
							const employee_code = this.resolve_employee_code_value(employee);
							const matched = Boolean(employee_route && employee.matched_employee !== false);
							const person_payload = this.person_payload({
								name: employee.employee_name || employee.name,
								employee: employee.name,
								employee_route,
								employee_code,
								employee_name: employee.employee_name || employee.name,
								employee_code: employee.employee_code,
								department: employee.department,
								designation: employee.designation,
								grade: employee.grade,
								reports_to: employee.reports_to,
								branch: employee.branch,
								cell_number: employee.cell_number,
								matched_employee: matched,
								match_status: employee.match_status || (matched ? __("已匹配员工档案") : __("待匹配员工档案")),
							});
							return `
							<div class="hrms-org-employee-row" data-employee="${frappe.utils.escape_html(employee.name || "")}" data-employee-route="${frappe.utils.escape_html(employee_route)}" data-employee-code="${frappe.utils.escape_html(employee_code)}">
								<div class="hrms-org-avatar">${frappe.utils.escape_html((employee.employee_name || employee.name || "?").slice(0, 1))}</div>
								<div>
									<strong>${frappe.utils.escape_html(employee.employee_name || employee.name || "")}</strong>
									<span>${frappe.utils.escape_html([employee.employee_code, employee.designation, employee.grade].filter(Boolean).join(" · "))}</span>
									<small>${frappe.utils.escape_html([employee.department, employee.branch, employee.cell_number, employee.match_status].filter(Boolean).join(" · "))}</small>
								</div>
								${
									matched
										? `<button class="btn btn-xs btn-link" data-action="open-employee" data-employee="${frappe.utils.escape_html(employee.name || "")}" data-employee-route="${frappe.utils.escape_html(employee_route)}" data-employee-code="${frappe.utils.escape_html(employee_code)}">${__("资料")}</button>`
										: `<button class="btn btn-xs btn-link" data-action="open-person" data-person-name="${frappe.utils.escape_html(employee.employee_name || "")}" data-person-payload="${frappe.utils.escape_html(person_payload)}">${__("详情")}</button>`
								}
							</div>`;
						},
					)
					.join("")}
			</div>
		`;
	}

	filter_tree(search) {
		const term = (search || "").trim().toLowerCase();
		this.search_term = term;
		this.render_tree();
		this.wrapper.querySelectorAll(".hrms-org-node").forEach((node) => {
			const text = (node.dataset.searchText || "").toLowerCase();
			node.classList.toggle("is-filtered-out", Boolean(term) && !text.includes(term));
		});
		if (this.selected_node) {
			this.select_node(this.selected_node.node_id, this.selected_node.node_type);
		}
	}

	set_zoom(value) {
		this.view_mode = "manual";
		this.zoom = Math.max(MIN_ORG_CHART_ZOOM, Math.min(1.6, value));
		this.apply_tree_scale();
	}

	fit_to_view() {
		const canvas = this.wrapper.querySelector("[data-tree-canvas]");
		const tree = this.wrapper.querySelector("[data-tree]");
		const chart = tree?.querySelector(".hrms-org-tree");
		if (!canvas || !tree || !chart) return;
		tree.style.transform = "none";
		tree.style.left = "0";
		const raw_width = Math.max(chart.scrollWidth, Math.ceil(chart.getBoundingClientRect().width), 1);
		const raw_height = Math.max(chart.scrollHeight, Math.ceil(chart.getBoundingClientRect().height), 1);
		const available_width = Math.max(canvas.clientWidth - 36, 240);
		const available_height = Math.max(canvas.clientHeight - 36, 240);
		this.zoom = Math.max(
			MIN_ORG_CHART_ZOOM,
			Math.min(1, available_width / raw_width, available_height / raw_height),
		);
		this.view_mode = "overview";
		this.apply_tree_scale(true);
		canvas.scrollTo({ left: 0, top: 0 });
	}

	apply_tree_scale(center = false) {
		const canvas = this.wrapper.querySelector("[data-tree-canvas]");
		const stage = this.wrapper.querySelector("[data-tree-stage]");
		const tree = this.wrapper.querySelector("[data-tree]");
		const chart = tree?.querySelector(".hrms-org-tree");
		if (!canvas || !stage || !tree || !chart) return;
		const raw_width = Math.max(chart.scrollWidth, 1);
		const raw_height = Math.max(chart.scrollHeight, 1);
		const scaled_width = Math.ceil(raw_width * this.zoom);
		const scaled_height = Math.ceil(raw_height * this.zoom);
		const available_width = Math.max(canvas.clientWidth - 36, 240);
		const available_height = Math.max(canvas.clientHeight - 36, 240);
		stage.style.width = `${Math.max(available_width, scaled_width)}px`;
		stage.style.height = `${Math.max(available_height, scaled_height)}px`;
		tree.style.left = center && scaled_width < available_width ? `${Math.floor((available_width - scaled_width) / 2)}px` : "0";
		tree.style.top = "0";
		tree.style.transform = `scale(${this.zoom})`;
	}

	expand_all() {
		this.collapsed_nodes.clear();
		this.render_tree();
	}

	collapse_all() {
		this.collect_node_ids(this.tree?.root || {}).forEach((node_id) => this.collapsed_nodes.add(node_id));
		this.render_tree();
	}

	toggle_node(node_id) {
		if (!node_id) return;
		if (this.collapsed_nodes.has(node_id)) {
			this.collapsed_nodes.delete(node_id);
		} else {
			this.collapsed_nodes.add(node_id);
		}
		this.render_tree();
	}

	collect_node_ids(node) {
		const ids = [];
		(node.children || []).forEach((child) => {
			ids.push(child.node_id);
			ids.push(...this.collect_node_ids(child));
		});
		return ids;
	}

	collapse_snapshot_detail_nodes(node) {
		for (const child of node?.children || []) {
			if (["work_level", "position_group"].includes(child.node_type)) this.collapsed_nodes.add(child.node_id);
			this.collapse_snapshot_detail_nodes(child);
		}
	}

	collapse_live_folder_nodes(root) {
		// Keep the company root open. Every managed folder below it opens only
		// when clicked, so the live view behaves like a file tree.
		for (const child of root?.children || []) {
			if ((child.children || []).length) this.collapsed_nodes.add(child.node_id);
			this.collapse_live_folder_nodes(child);
		}
	}

	export_chart() {
		frappe.call({
			method: "hrms.hr.page.organizational_chart.organizational_chart.export_organization_chart_excel",
			args: { company: this.company },
			freeze: true,
			freeze_message: __("正在生成组织架构 Excel..."),
			callback: (response) => {
				const file = response.message || {};
				if (!file.file_url) return;
				const link = document.createElement("a");
				link.href = file.file_url;
				link.download = file.file_name || `${this.company || YONGXIN_COMPANY}_组织架构图.xlsx`;
				link.target = "_blank";
				document.body.appendChild(link);
				link.click();
				link.remove();
			},
		});
	}

	add_department() {
		frappe.route_options = this.company && this.company !== "All Companies" ? { company: this.company } : {};
		const parent_department = this.get_selected_department();
		if (parent_department) {
			frappe.route_options.parent_department = parent_department;
		}
		frappe.new_doc("Department");
	}

	quick_edit_node(element) {
		const node_id = element?.dataset.nodeId || "";
		const node_type = element?.dataset.nodeType || "";
		if (["work_level", "position_group"].includes(node_type)) {
			this.edit_employee_group(node_id, node_type);
			return;
		}
		const department = element?.dataset.department || this.get_node_department(node_id, node_type);
		if (!department) {
			frappe.msgprint(__("当前卡片不是可编辑部门。"));
			return;
		}
		this.select_node(node_id, node_type);
		this.edit_department(department);
	}

	find_node(node_id, node = this.tree?.root) {
		if (!node) return null;
		if (node.node_id === node_id) return node;
		for (const child of node.children || []) {
			const match = this.find_node(node_id, child);
			if (match) return match;
		}
		return null;
	}

	edit_employee_group(node_id, node_type) {
		const node = this.find_node(node_id);
		if (!node) {
			frappe.msgprint(__("当前分组已变化，请刷新后重试。"));
			return;
		}
		const is_grade = node_type === "work_level";
		const fieldname = is_grade ? "grade" : "designation";
		const label = is_grade ? __("职级") : __("岗位");
		const options = is_grade ? "Employee Grade" : "Designation";
		this.select_node(node_id, node_type);
		const dialog = new frappe.ui.Dialog({
			title: __("调整{0}分组", [label]),
			fields: [
				{
					fieldname: "summary",
					fieldtype: "HTML",
					options: `<p>${__("将 {0} 个员工从“{1}”调整到新{2}。保存后花名册与架构图会同步更新。", [node.current_headcount || 0, frappe.utils.escape_html(node.name || ""), label])}</p>`,
				},
				{ fieldname: "new_value", fieldtype: "Link", options, label: __("新{0}", [label]), reqd: 1 },
			],
			primary_action_label: __("确认调整"),
			primary_action: (values) => {
				frappe.confirm(
					__("确认调整该分组的 {0} 个员工吗？", [node.current_headcount || 0]),
					() => {
						frappe
							.call({
								method: "hrms.hr.page.organizational_chart.organizational_chart.update_employee_group",
								args: { node_id, fieldname, new_value: values.new_value, company: this.company },
								freeze: true,
								freeze_message: __("正在同步员工归属..."),
							})
							.then((response) => {
								dialog.hide();
								frappe.show_alert({
									message: __("已更新 {0} 个员工", [(response.message?.updated || []).length]),
									indicator: "green",
								});
								this.load_tree();
							});
					},
				);
			},
		});
		dialog.show();
	}

	edit_department(department = this.get_selected_department()) {
		if (!department) {
			frappe.msgprint(__("请先选择部门节点。"));
			return;
		}
		frappe.db.get_doc("Department", department).then((doc) => this.show_department_edit_dialog(doc));
	}

	show_department_edit_dialog(doc) {
		const dialog = new frappe.ui.Dialog({
			title: __("快速编辑部门"),
			fields: this.get_department_edit_fields(doc),
			primary_action_label: __("保存"),
			primary_action: (values) => {
				frappe
					.call({
						method: "hrms.hr.page.organizational_chart.organizational_chart.update_department_fields",
						args: {
							department: doc.name,
							values: JSON.stringify(values),
						},
						freeze: true,
						freeze_message: __("正在保存部门..."),
					})
					.then(() => {
						dialog.hide();
						frappe.show_alert({ message: __("部门已更新"), indicator: "green" });
						this.load_tree();
					});
			},
		});
		dialog.show();
	}

	get_department_edit_fields(doc) {
		const company = doc.company || (this.company !== "All Companies" ? this.company : "");
		return [
			{ fieldname: "department_name", fieldtype: "Data", label: __("部门名称"), reqd: 1, default: doc.department_name },
			{ fieldname: "company", fieldtype: "Link", options: "Company", default: company, hidden: 1 },
			{
				fieldname: "parent_department",
				fieldtype: "Link",
				options: "Department",
				label: __("上级部门"),
				default: doc.parent_department,
				get_query() {
					if (!company) {
						return {};
					}
					return { filters: { name: ["!=", doc.name], company, is_group: 1 } };
				},
			},
			{ fieldname: "is_group", fieldtype: "Check", label: __("文件夹部门（可包含下级部门）"), default: doc.is_group },
			{ fieldname: "hrms_org_level", fieldtype: "Int", label: __("组织层级（数字越小越高）"), default: doc.hrms_org_level },
			{ fieldname: "hrms_org_role", fieldtype: "Data", label: __("组织角色"), default: doc.hrms_org_role },
			{ fieldname: "hrms_org_manager", fieldtype: "Data", label: __("负责人"), default: doc.hrms_org_manager },
			{ fieldname: "hrms_roster_assignable", fieldtype: "Check", label: __("允许花名册归属（仅末级）"), default: doc.hrms_roster_assignable },
		];
	}

	import_yongxin_template() {
		frappe
			.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.get_yongxin_q2_org_template_preview",
			})
			.then((preview) => {
				const data = preview.message || {};
				frappe.confirm(
					__(
						"将导入 {0}：{1} 个部门节点、{2} 个岗位上下级模板。已存在的部门会按来源单元格或名称更新，不会重复创建。是否继续？",
						[data.title || __("组织架构模板"), data.department_count || 0, data.position_count || 0],
					),
					() => this.run_yongxin_template_import(),
				);
			});
	}

	import_yongxin_q3_department_hierarchy() {
		frappe
			.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.preview_yongxin_q3_department_hierarchy",
				args: { company: this.company },
			})
			.then((preview) => {
				const data = preview.message || {};
				const summary = data.summary || {};
				frappe.prompt(
					[
						{
							fieldname: "confirmation",
							fieldtype: "Data",
							label: __("确认文字"),
							reqd: 1,
							description: __(
								"将建立或调整 {0} 个组织节点，其中 {1} 个文件夹、{2} 个花名册末级节点。请输入“{3}”继续。当前有 {4} 名员工仍归属在将成为文件夹的旧部门，系统会保留并列出，绝不猜测分组。",
								[
									summary.node_count || 0,
									summary.folder_count || 0,
									summary.roster_leaf_count || 0,
									data.confirmation_text || "",
									summary.legacy_employee_assignment_count || 0,
								],
							),
						},
					],
					(values) => {
						frappe
							.call({
								method: "hrms.hr.page.organizational_chart.organizational_chart.import_yongxin_q3_department_hierarchy",
								args: { company: this.company, confirmation: values.confirmation },
								freeze: true,
								freeze_message: __("正在同步2026Q3文件夹架构..."),
							})
							.then((response) => {
								const result = response.message || {};
								frappe.show_alert({
									message: __("已同步 {0} 个组织节点；请处理 {1} 条待分组员工记录。", [
										(result.created_departments || []).length + (result.updated_departments || []).length,
										result.summary?.legacy_employee_assignment_count || 0,
									]),
									indicator: "green",
								});
								this.set_source_mode("live");
							});
					},
					__("同步2026Q3架构"),
					__("同步"),
				);
			});
	}

	run_yongxin_template_import() {
		frappe
			.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.import_yongxin_q2_org_structure",
				args: { company: this.company },
				freeze: true,
				freeze_message: __("正在导入组织架构模板..."),
			})
			.then((r) => {
				const result = r.message || {};
				frappe.show_alert({
					message: __("已同步部门 {0} 个，岗位 {1} 个", [
						(result.created_departments || []).length + (result.updated_departments || []).length,
						(result.created_designations || []).length + (result.updated_designations || []).length,
					]),
					indicator: "green",
				});
				this.load_tree();
			});
	}

	delete_department() {
		const department = this.get_selected_department();
		if (!department) {
			frappe.msgprint(__("请先选择部门节点。"));
			return;
		}
		frappe.confirm(__("确定删除部门 {0}？删除前请确认没有员工或子部门仍在使用。", [department]), () => {
			frappe
				.call({
					method: "hrms.hr.page.organizational_chart.organizational_chart.delete_departments",
					args: { departments: JSON.stringify([department]) },
					freeze: true,
					freeze_message: __("正在删除部门..."),
				})
				.then((r) => {
					const result = r.message || {};
					if (result.failed_count) {
						frappe.msgprint({
							title: __("部门未删除"),
							indicator: "orange",
							message: (result.failed || [])
								.map((row) => `${frappe.utils.escape_html(row.name)}：${frappe.utils.escape_html(row.message)}`)
								.join("<br>"),
						});
						return;
					}
					frappe.show_alert({ message: __("部门已删除"), indicator: "green" });
					this.load_tree();
				});
		});
	}

	open_employee(employee_code, fallback_route) {
		const lookup_value =
			this.normalize_employee_code_value(employee_code) || this.normalize_employee_route_value(fallback_route);
		if (!lookup_value) {
			frappe.msgprint(__("当前人员没有可用于匹配档案的员工编号。"));
			return;
		}
		frappe
			.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.resolve_employee_code",
				args: { employee_code: lookup_value, company: this.company },
			})
			.then((response) => {
				const employee = this.normalize_employee_route_value(response.message?.name);
				if (!employee) throw new Error(__("员工编号未匹配到有效员工档案"));
				frappe.set_route("employee-detail", employee);
			});
	}

	resolve_employee_route_value(person) {
		if (typeof person === "string") {
			return this.normalize_employee_route_value(person);
		}
		return this.normalize_employee_route_value(person?.employee_route || person?.employee);
	}

	resolve_employee_code_value(person) {
		if (typeof person === "string") return this.normalize_employee_code_value(person);
		return this.normalize_employee_code_value(person?.employee_code);
	}

	normalize_employee_code_value(employee_code) {
		const value = String(employee_code || "").trim();
		if (!value || value.length > 140 || /[\/?#\u0000-\u001f]/.test(value)) return "";
		return value;
	}

	normalize_employee_route_value(employee) {
		const value = String(employee || "").trim();
		if (!value || value.length > 140 || /[\/?#\u0000-\u001f]/.test(value)) return "";
		return value;
	}

	show_person_detail(person) {
		if (!person || !(person.employee_name || person.name)) return;
		const employee = this.resolve_employee_route_value(person);
		const employee_code = this.resolve_employee_code_value(person);
		const fields = [
			[__("匹配状态"), person.match_status || (employee ? __("已匹配员工档案") : __("待匹配员工档案"))],
			[__("员工编号"), person.employee_code],
			[__("部门"), person.department_label || person.department],
			[__("职位"), person.designation || person.role],
			[__("职级"), person.grade],
			[__("上级"), person.reports_to],
			[__("分支/区域"), person.branch],
			[__("联系电话"), person.cell_number],
		].filter((row) => row[1]);
		this.wrapper.querySelector("[data-detail]").innerHTML = `
			<div class="hrms-org-detail-head">
				<div>
					<h3>${frappe.utils.escape_html(person.employee_name || person.name)}</h3>
					<p>${frappe.utils.escape_html([person.role, person.match_status].filter(Boolean).join(" · "))}</p>
				</div>
				<div class="hrms-org-detail-actions">
					${employee ? `<button class="btn btn-xs btn-default" data-action="open-employee" data-employee="${frappe.utils.escape_html(person.employee || "")}" data-employee-route="${frappe.utils.escape_html(employee)}" data-employee-code="${frappe.utils.escape_html(employee_code)}">${__("打开员工档案")}</button>` : ""}
				</div>
			</div>
			<div class="hrms-org-person-detail">
				${fields
					.map(
						([label, value]) => `
							<div>
								<span>${frappe.utils.escape_html(label)}</span>
								<strong>${frappe.utils.escape_html(value || "")}</strong>
							</div>`,
					)
					.join("")}
			</div>
		`;
	}

	get_selected_department() {
		const node_id = this.selected_node?.node_id || "";
		return this.get_node_department(node_id, this.selected_node?.node_type);
	}

	get_node_department(node_or_id, node_type = "") {
		if (node_or_id && typeof node_or_id === "object") {
			const node = node_or_id;
			node_type = node_or_id.node_type || node_type;
			node_or_id = node_or_id.node_id || "";
			if (!["department", "employee_group"].includes(node_type)) return null;
			if (node.department) return node.department;
			if (node_type === "employee_group") return null;
		}
		const node_id = String(node_or_id || "");
		if (node_type === "department" || node_id.startsWith("department:")) {
			return node_id.slice(node_id.indexOf(":") + 1);
		}
		if (node_type === "employee_group" || node_id.startsWith("employee_group:")) {
			return node_id.slice(node_id.indexOf(":") + 1);
		}
		return null;
	}
}
