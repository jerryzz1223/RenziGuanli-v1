frappe.pages["organizational-chart"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("组织架构图"),
		single_column: true,
	});

	const view = new HybridOrganizationChart(page);
	view.show();
};

const YONGXIN_COMPANY = "永新";

class HybridOrganizationChart {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.company = YONGXIN_COMPANY;
		this.tree = null;
		this.selected_node = null;
		this.zoom = 1;
		this.collapsed_nodes = new Set();
		this.field_map = {};
	}

	show() {
		this.page.set_title(__("组织架构图"));
		this.setup_actions();
		this.render_shell();
		this.load_field_map();
		this.load_tree();
	}

	setup_actions() {
		this.page.clear_inner_toolbar();
		this.page.add_inner_button(__("展开全部"), () => this.expand_all());
		this.page.add_inner_button(__("收起全部"), () => this.collapse_all());
		this.page.add_inner_button(__("导入架构模板"), () => this.import_yongxin_template());
		this.page.add_inner_button(__("导出"), () => this.export_chart());
		this.page.set_primary_action(__("新增部门"), () => this.add_department());
	}

	render_shell() {
		this.wrapper.innerHTML = `
			<div class="hrms-org-page">
				<aside class="hrms-org-sidebar">
					<div class="hrms-org-sidebar-title">${__("组织")}</div>
					${this.render_sidebar()}
				</aside>
				<section class="hrms-org-main">
					<div class="hrms-org-toolbar">
						<div class="hrms-org-search">
							<input class="form-control" data-search placeholder="${__("搜索部门、员工、岗位")}" />
						</div>
						<div class="hrms-org-toolbar-actions">
							<button class="btn btn-default btn-sm" data-action="zoom-out">-</button>
							<button class="btn btn-default btn-sm" data-action="zoom-in">+</button>
							<button class="btn btn-default btn-sm" data-action="refresh">${__("刷新")}</button>
						</div>
					</div>
					<div class="hrms-org-summary" data-summary></div>
					<div class="hrms-org-tree-canvas">
						<div class="hrms-org-tree-scale" data-tree></div>
					</div>
				</section>
				<aside class="hrms-org-detail" data-detail>
					<div class="hrms-org-empty">${__("正在加载组织架构...")}</div>
				</aside>
			</div>
		`;

		this.bind_events();
	}

	render_sidebar() {
		const items = [
			["组织管理", ["List", "Department"]],
			["架构图", ["organizational-chart"]],
			["组织报表", ["List", "Staffing Plan"]],
		];
		return `
			<nav>
				${items
					.map(
						([label, route]) => `
							<button class="hrms-org-sidebar-link ${route[0] === "organizational-chart" ? "active" : ""}" data-route="${frappe.utils.escape_html(JSON.stringify(route))}">
								${frappe.utils.escape_html(__(label))}
							</button>`,
					)
					.join("")}
			</nav>
		`;
	}

	bind_events() {
		this.wrapper.addEventListener("click", (event) => {
			const action = event.target.closest("[data-action]");
			if (action) {
				this.handle_action(action.dataset.action, action);
				return;
			}

			const route_button = event.target.closest("[data-route]");
			if (route_button) {
				const route = JSON.parse(route_button.dataset.route || "[]");
				if (route.length) frappe.set_route(...route);
				return;
			}

			const node = event.target.closest("[data-node-id]");
			if (node) {
				this.select_node(node.dataset.nodeId, node.dataset.nodeType);
				return;
			}
		});

		this.wrapper.querySelector("[data-search]").addEventListener(
			"input",
			frappe.utils.debounce((event) => this.filter_tree(event.target.value), 180),
		);
	}

	handle_action(action, element) {
		if (action === "zoom-in") this.set_zoom(this.zoom + 0.1);
		if (action === "zoom-out") this.set_zoom(this.zoom - 0.1);
		if (action === "refresh") this.load_tree();
		if (action === "toggle-node") this.toggle_node(element?.dataset.toggleNode);
		if (action === "add-department") this.add_department();
		if (action === "edit-department") this.edit_department();
		if (action === "delete-department") this.delete_department();
		if (action === "open-employee") this.open_employee(element?.dataset.employee);
	}

	load_tree() {
		frappe
			.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.get_hybrid_tree",
				args: { company: this.company },
				freeze: true,
				freeze_message: __("正在生成组织架构图..."),
			})
			.then((r) => {
				this.tree = r.message || {};
				this.field_map = this.tree.field_map || {};
				this.collapsed_nodes.clear();
				this.render_summary();
				this.render_tree();
				const root = this.tree.root;
				if (root) this.select_node(root.node_id, root.node_type);
			});
	}

	load_field_map() {
		frappe
			.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.get_employee_roster_field_map",
			})
			.then((r) => {
				this.field_map = r.message || this.field_map || {};
			});
	}

	render_summary() {
		const summary = this.tree?.summary || {};
		this.wrapper.querySelector("[data-summary]").innerHTML = [
			["编制人数", summary.planned_headcount || 0],
			["现有人数", summary.current_headcount || 0],
			["空缺人数", summary.vacancy_count || 0],
			["部门数", summary.department_count || 0],
			["未分配部门", summary.missing_department_count || 0],
			["缺少负责人", summary.missing_manager_count || 0],
		]
			.map(
				([label, value]) => `
					<div class="hrms-org-summary-card">
						<strong>${frappe.utils.escape_html(String(value))}</strong>
						<span>${frappe.utils.escape_html(__(label))}</span>
					</div>`,
			)
			.join("");
	}

	render_tree() {
		const root = this.tree?.root;
		const tree = this.wrapper.querySelector("[data-tree]");
		if (!root) {
			tree.innerHTML = `<div class="hrms-org-empty">${__("暂无组织数据，请先导入员工花名册或维护部门。")}</div>`;
			return;
		}
		tree.style.transform = `scale(${this.zoom})`;
		tree.innerHTML = `<ul class="hrms-org-tree">${this.render_tree_node(root)}</ul>`;
	}

	render_tree_node(node) {
		const collapsed = this.collapsed_nodes.has(node.node_id);
		const children = node.children || [];
		const has_children = children.length > 0;
		return `
			<li class="${collapsed ? "is-collapsed" : ""}">
				<div
					class="hrms-org-node hrms-org-node--${frappe.utils.escape_html(node.node_type || "default")}"
					data-node-id="${frappe.utils.escape_html(node.node_id)}"
					data-node-type="${frappe.utils.escape_html(node.node_type)}"
					data-search-text="${frappe.utils.escape_html([node.name, node.title, node.department].filter(Boolean).join(" "))}"
				>
					<div class="hrms-org-node-bar"></div>
					<div class="hrms-org-node-body">
						<strong>${frappe.utils.escape_html(node.name || "")}</strong>
						<span>${frappe.utils.escape_html(node.title || "")}</span>
						${this.render_node_lines(node)}
						<small>${__("编制")} ${frappe.utils.escape_html(String(node.planned_headcount || 0))} · ${__("现有")} ${frappe.utils.escape_html(String(node.current_headcount || 0))} · ${__("空缺")} ${frappe.utils.escape_html(String(node.vacancy_count || 0))}</small>
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

	render_node_lines(node) {
		const lines = (node.employee_names && node.employee_names.length ? node.employee_names : node.lines) || [];
		if (!lines.length) return "";
		const visible_lines = lines.slice(0, 8);
		const hidden_count = Math.max(lines.length - visible_lines.length, 0);
		return `
			<div class="hrms-org-node-lines">
				${visible_lines.map((line) => `<em>${frappe.utils.escape_html(line || "")}</em>`).join("")}
				${hidden_count ? `<em>${__("+{0} 人", [hidden_count])}</em>` : ""}
			</div>
		`;
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
				},
			})
			.then((r) => this.render_detail_panel(r.message || {}));
	}

	render_detail_panel(detail) {
		const metrics = detail.metrics || {};
		const actions = detail.actions || {};
		this.wrapper.querySelector("[data-detail]").innerHTML = `
			<div class="hrms-org-detail-head">
				<div>
					<h3>${frappe.utils.escape_html(detail.title || __("组织节点"))}</h3>
					<p>${frappe.utils.escape_html(detail.subtitle || "")}</p>
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
			<div class="hrms-org-detail-metrics">
				${this.render_metric("编制人数", metrics.planned_headcount)}
				${this.render_metric("现有人数", metrics.current_headcount || metrics.employee_count)}
				${this.render_metric("空缺人数", metrics.vacancy_count)}
				${this.render_metric("直属人数", metrics.direct_report_count)}
			</div>
			<div class="hrms-org-field-map">
				<strong>${__("花名册字段匹配")}</strong>
				<p>${__("现职务/职位 -> 岗位，部门 -> 部门，上级主管/直接上级 -> 汇报对象，职级 -> 员工等级。")}</p>
			</div>
			${this.render_employee_list(detail.employees || [])}
		`;
	}

	render_metric(label, value) {
		return `
			<div>
				<strong>${frappe.utils.escape_html(String(value || 0))}</strong>
				<span>${frappe.utils.escape_html(__(label))}</span>
			</div>
		`;
	}

	render_employee_list(employees) {
		if (!employees.length) {
			return `<div class="hrms-org-empty">${__("当前节点没有匹配员工。")}</div>`;
		}
		return `
			<div class="hrms-org-employees">
				<div class="hrms-org-section-title">${__("员工清单")}</div>
				${employees
					.map(
						(employee) => `
							<div class="hrms-org-employee-row" data-employee="${frappe.utils.escape_html(employee.name || "")}">
								<div class="hrms-org-avatar">${frappe.utils.escape_html((employee.employee_name || employee.name || "?").slice(0, 1))}</div>
								<div>
									<strong>${frappe.utils.escape_html(employee.employee_name || employee.name || "")}</strong>
									<span>${frappe.utils.escape_html([employee.employee_code, employee.designation, employee.grade].filter(Boolean).join(" · "))}</span>
									<small>${frappe.utils.escape_html([employee.department, employee.branch, employee.cell_number].filter(Boolean).join(" · "))}</small>
								</div>
								<button class="btn btn-xs btn-link" data-action="open-employee" data-employee="${frappe.utils.escape_html(employee.name || "")}">${__("资料")}</button>
							</div>`,
					)
					.join("")}
			</div>
		`;
	}

	filter_tree(search) {
		const term = (search || "").trim().toLowerCase();
		this.wrapper.querySelectorAll(".hrms-org-node").forEach((node) => {
			const text = (node.dataset.searchText || "").toLowerCase();
			node.classList.toggle("is-filtered-out", Boolean(term) && !text.includes(term));
		});
		if (this.selected_node) {
			this.select_node(this.selected_node.node_id, this.selected_node.node_type);
		}
	}

	set_zoom(value) {
		this.zoom = Math.max(0.6, Math.min(1.4, value));
		const tree = this.wrapper.querySelector("[data-tree]");
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

	export_chart() {
		window.print();
	}

	add_department() {
		frappe.route_options = { company: YONGXIN_COMPANY };
		const parent_department = this.get_selected_department();
		if (parent_department) {
			frappe.route_options.parent_department = parent_department;
		}
		frappe.new_doc("Department");
	}

	edit_department() {
		const department = this.get_selected_department();
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
		const company = doc.company || this.company || YONGXIN_COMPANY;
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
					return { filters: { name: ["!=", doc.name], company } };
				},
			},
			{ fieldtype: "Section Break", label: __("组织属性") },
			{ fieldname: "hrms_org_level", fieldtype: "Int", label: __("层级"), default: doc.hrms_org_level },
			{ fieldname: "hrms_org_role", fieldtype: "Data", label: __("管理角色"), default: doc.hrms_org_role },
			{ fieldname: "hrms_org_manager", fieldtype: "Data", label: __("负责人"), default: doc.hrms_org_manager },
			{ fieldname: "hrms_org_proxy", fieldtype: "Data", label: __("代理人"), default: doc.hrms_org_proxy },
			{ fieldtype: "Column Break" },
			{ fieldname: "hrms_planned_headcount", fieldtype: "Int", label: __("编制人数"), default: doc.hrms_planned_headcount },
			{ fieldname: "hrms_actual_headcount", fieldtype: "Int", label: __("现有人数"), default: doc.hrms_actual_headcount },
			{ fieldname: "hrms_vacancy_count", fieldtype: "Int", label: __("空缺人数"), default: doc.hrms_vacancy_count },
			{ fieldname: "hrms_recruitment_plan", fieldtype: "Small Text", label: __("招聘需求"), default: doc.hrms_recruitment_plan },
			{ fieldtype: "Section Break" },
			{ fieldname: "is_group", fieldtype: "Check", label: __("是否分组"), default: doc.is_group },
			{ fieldname: "disabled", fieldtype: "Check", label: __("停用"), default: doc.disabled },
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

	open_employee(employee) {
		if (employee) {
			frappe.set_route("Form", "Employee", employee);
		}
	}

	get_selected_department() {
		const node_id = this.selected_node?.node_id || "";
		if (node_id.startsWith("department:")) return node_id.slice("department:".length);
		if (node_id.startsWith("employee_group:")) return node_id.slice("employee_group:".length);
		return null;
	}
}
