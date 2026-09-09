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
		this.list_node_id = null;
		this.detail_request_id = 0;
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
		this.multiple_position_draft = null;
		// List and chart share Organization Node relationships; roster references
		// remain read-only and never change Employee master data.
		this.source_mode = "manual";
		this.fullscreen_bound = false;
	}

	show() {
		this.bind_company_context();
		this.bind_roster_updates();
		this.render_current_view(true);
	}

	is_active() {
		const container = this.wrapper.closest(".page-container");
		return !container || container.getClientRects().length > 0;
	}

	activate(initial = false) {
		this.bind_company_context();
		this.bind_roster_updates();
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
		const route_mode = frappe.get_route()?.[1];
		return route_mode === "report" ? "report" : route_mode === "list" ? "list" : "chart";
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

		this.page.set_title(__(this.mode === "list" ? "组织列表" : "组织架构图"));
		this.setup_actions();
		this.render_shell();
		if (this.tree && Date.now() - this.last_refresh_at < this.cache_ttl) {
			this.render_summary();
			this.render_source_label();
			this.render_tree();
			const selected = this.find_node(this.selected_node?.node_id) || this.tree.root;
			if (selected) this.select_node(selected.node_id, selected.node_type);
		} else this.load_tree();
	}

	bind_roster_updates() {
		if (this.roster_update_handler || !frappe.realtime) return;
		this.roster_update_handler = data => {
			if (data.company === this.company && this.is_active() && this.mode !== "report") this.load_tree();
		};
		frappe.realtime.on("organization_roster_updated", this.roster_update_handler);
	}

	deactivate() {
		if (this.roster_update_handler) {
			frappe.realtime?.off("organization_roster_updated", this.roster_update_handler);
			this.roster_update_handler = null;
		}
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
		if (frappe.user.has_role("System Manager")) {
			for (const [label, action] of [["导出配置", () => this.export_configuration()], ["导入配置", () => this.import_configuration()]]) {
				const item = this.page.add_inner_button(__(label), action, __("组织配置"));
				// These are actions, not home links. The site's navigation normalizer
				// treats href="#" as a homepage shortcut.
				item?.removeAttr("href").attr({ role: "button", tabindex: "0" }).on("keydown", event => {
					if (["Enter", " "].includes(event.key)) { event.preventDefault(); item.trigger("click"); }
				});
				this.page.menu?.find("a").filter((_, element) => element.textContent.trim() === `${__("组织配置")} > ${__(label)}`).removeAttr("href").attr({ role: "button", tabindex: "0" });
			}
		}
		if (this.mode === "chart") {
		this.page.add_inner_button(__("导出架构图"), () => this.show_visual_export());
		this.page.add_inner_button(__("一览全局"), () => this.fit_to_view());
		this.page.add_inner_button(__("全屏查看"), () => this.toggle_fullscreen());
		this.page.add_inner_button(__("展开全部"), () => this.expand_all());
		this.page.add_inner_button(__("收起全部"), () => this.collapse_all());
		}
		this.page.set_primary_action(__("新增组织节点"), () => this.show_manual_node_dialog(null, this.mode === "list" ? this.list_node_id : undefined));
	}

	async export_configuration() {
		const result = await frappe.call({ method: "hrms.api.organization_package.export_configuration", args: { company: this.company }, freeze: true, freeze_message: __("正在导出组织配置…") });
		if (result.message?.file_url) {
			const link = document.createElement("a");
			link.href = result.message.file_url;
			link.download = result.message.file_name;
			link.click();
			frappe.show_alert({ message: __("组织配置已导出，包含上下级、人员任职和职级定义。"), indicator: "green" });
		}
	}

	import_configuration() {
		let preview = null;
		let busy = false;
		const escape = value => frappe.utils.escape_html(String(value ?? ""));
		const dialog = new frappe.ui.Dialog({
			title: __("导入组织配置"), size: "extra-large",
			fields: [
				{ fieldtype: "HTML", options: `<p>${__("按节点编号更新组织，按工号匹配当前公司的花名册。未包含的节点保留；导入前自动保存配置备份。")}</p>` },
				{ fieldname: "company", fieldtype: "Link", options: "Company", label: __("目标公司"), reqd: 1, default: this.company, onchange: () => { preview = null; } },
				{ fieldname: "file_url", fieldtype: "Attach", label: __("组织配置 Excel（私有文件）"), reqd: 1, options: { make_attachments_public: false, restrictions: { allowed_file_types: [".xlsx"] } }, onchange: () => { preview = null; } },
				{ fieldname: "auto_sync", fieldtype: "Check", label: __("导入后按花名册自动更新人员"), default: 1 },
				{ fieldname: "preview", fieldtype: "HTML" },
			],
			primary_action_label: __("校验并预览"),
			// Own the button state: Frappe restores the constructor's original
			// label after a returned Promise, which would mislabel the commit step.
			primary_action: () => { void dialog.run_configuration_action().catch(() => {}); },
		});
		dialog.run_configuration_action = async () => {
			if (busy) return;
			busy = true;
			dialog.get_primary_btn().prop("disabled", true);
			try {
				const values = dialog.get_values();
				if (!values) return;
				if (!preview || preview.company !== values.company || preview.file_url !== values.file_url) {
					const result = await frappe.call({ method: "hrms.api.organization_package.preview_configuration", args: { company: values.company, file_url: values.file_url }, freeze: true });
					const data = result.message;
					preview = data.errors.length ? null : { ...data, company: values.company, file_url: values.file_url };
					dialog.fields_dict.preview.$wrapper.html(`
						<p><strong>新增 ${data.create_count} 个 · 更新 ${data.update_count} 个 · 保留 ${data.retained_count} 个 · 人员引用 ${data.person_rows} 条</strong></p>
						${data.errors.length ? `<div class="alert alert-danger"><strong>请修正以下问题后重新上传</strong><ul>${data.errors.map(e => `<li>${escape(e)}</li>`).join("")}</ul></div>` : ""}
						${data.warnings.length ? `<details open><summary>待确认事项（${data.warnings.length}）</summary><ul>${data.warnings.map(e => `<li>${escape(e)}</li>`).join("")}</ul></details>` : ""}
						<details open><summary>组织及上下级预览</summary><div style="max-height:320px;overflow:auto"><table class="table table-bordered"><thead><tr><th>节点编号</th><th>组织名称</th><th>上级组织</th><th>职级</th></tr></thead><tbody>${data.preview.map(n => `<tr><td>${escape(n.id)}</td><td>${escape(n.name)}</td><td>${escape(n.parent_name || "公司")}<small class="text-muted d-block">${escape(n.parent)}</small></td><td>${escape(n.grade || "未设置")}</td></tr>`).join("")}</tbody></table></div></details>
						<details><summary>职级定义（${data.grades.length}）</summary><table class="table"><thead><tr><th>编码</th><th>名称</th><th>等级顺序</th><th>上级职级</th></tr></thead><tbody>${data.grades.map(g => `<tr><td>${escape(g.code)}</td><td>${escape(g.label)}</td><td>${escape(g.rank ?? "未设置")}</td><td>${escape(g.parent)}</td></tr>`).join("")}</tbody></table></details>`);
					dialog.get_primary_btn().text(preview ? __("确认导入") : __("重新校验"));
					return;
				}
				let result;
				try {
					result = await frappe.call({ method: "hrms.api.organization_package.import_configuration", args: { company: values.company, file_url: values.file_url, fingerprint: preview.fingerprint, auto_sync: values.auto_sync }, freeze: true, freeze_message: __("正在导入组织配置…") });
				} catch (error) {
					preview = null;
					dialog.get_primary_btn().text(__("重新校验"));
					return;
				}
				dialog.hide();
				const data = result.message;
				frappe.msgprint({ title: __("导入完成"), indicator: "green", message: `新增 ${data.created} 个节点，更新 ${data.updated} 个节点。<br><a href="${escape(data.backup.file_url)}" download>${__("下载导入前备份")}</a>` });
				if (values.company === this.company) await this.load_tree();
			} finally {
				busy = false;
				dialog.get_primary_btn().prop("disabled", false);
			}
		};
		dialog.show();
	}

	setup_report_actions() {
		this.page.clear_inner_toolbar();
		this.page.add_inner_button(__("刷新"), () => this.load_organization_report(true));
		this.page.set_primary_action(__("导出表格"), () => this.export_report_table());
	}

	render_shell() {
		this.wrapper.innerHTML = `
			<div class="hrms-org-page ${this.mode === "list" ? "hrms-org-page--list" : ""}">
				<section class="hrms-org-main">
					<div class="hrms-org-toolbar hrms-org-toolbar--search-only">
						<div class="hrms-org-search">
							<input class="form-control" data-search aria-label="${__("搜索部门、员工、岗位")}" placeholder="${__("搜索部门、员工、岗位")}" />
						</div>
						${this.mode === "chart" ? `<div class="hrms-org-zoom-controls" role="group" aria-label="${__("架构图缩放")}">
							<button type="button" class="btn btn-default btn-sm" data-action="zoom-out" aria-label="${__("缩小架构图")}">− ${__("缩小")}</button>
							<button type="button" class="btn btn-default btn-sm" data-action="zoom-in" aria-label="${__("放大架构图")}">+ ${__("放大")}</button>
						</div>` : ""}
					</div>
					<div class="hrms-org-summary" data-summary></div>
					<div class="hrms-org-level-list" data-level-list></div>
					<div class="hrms-org-chart-context" data-chart-context></div>
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
		this.tree = null;
		this.list_node_id = null;
		this.selected_node = null;
		this.detail_request_id++;
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
		if (!this.wrapper_click_bound) {
		this.wrapper_click_bound = true;
		this.wrapper.addEventListener("input", (event) => {
			if (event.target.matches("[data-roster-search]")) this.render_inline_people(this.last_detail, event.target.value);
		});
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

		}
		this.wrapper.querySelector("[data-search]")?.addEventListener(
			"input",
			frappe.utils.debounce((event) => this.filter_tree(event.target.value), 180),
		);
	}

	handle_action(action, element) {
		if (action === "view-list" || action === "view-chart") {
			if (action === "view-list") this.list_node_id = this.selected_node?.node_id || this.list_node_id;
			if (action === "view-list") frappe.set_route("organizational-chart", "list");
			else frappe.set_route("organizational-chart");
			return;
		}
		if (action === "show-personnel") { this.show_personnel = !this.show_personnel; this.wrapper.querySelector(".hrms-org-page")?.classList.toggle("show-personnel", this.show_personnel); this.apply_tree_scale(); return; }
		if (action === "browse-node") { this.browse_node(element?.dataset.nodeId); return; }
		if (action === "place-department") { this.show_manual_node_dialog(null, this.list_node_id, element?.dataset.department); return; }
		if (action === "show-workbook-snapshot") this.set_source_mode("workbook_snapshot");
		if (action === "show-live-tree") this.set_source_mode("live");
		if (action === "toggle-fullscreen") this.toggle_fullscreen();
		if (action === "fit-view") this.fit_to_view();
		if (action === "zoom-in") this.set_zoom(this.zoom + 0.1);
		if (action === "zoom-out") this.set_zoom(this.zoom - 0.1);
		if (action === "refresh") this.load_tree();
		if (action === "toggle-node") this.toggle_node(element?.dataset.toggleNode);
		if (action === "select-node") this.select_node(element?.dataset.nodeId, element?.dataset.nodeType);
		if (action === "add-organization-node") this.show_manual_node_dialog(null, element?.dataset.parentNodeId);
		if (action === "edit-organization-node") this.edit_manual_node(element?.dataset.nodeId);
		if (action === "delete-organization-node") this.delete_manual_node(element?.dataset.nodeId);
		if (action === "review-assignments") this.show_assignment_review(element?.dataset.nodeId);
		if (action === "quick-edit-node") this.edit_manual_node(element?.dataset.nodeId);
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
		const tree = this.wrapper.querySelector(this.mode === "list" ? "[data-level-list]" : "[data-tree]");
		if (tree) tree.innerHTML = `<div class="hrms-org-empty">${__("正在加载组织架构...")}</div>`;
		frappe.call({
			method: "hrms.api.organization_roster_sync.sync_current_organization", args: { company },
		}).then(response => {
			if (request_id !== this.tree_request_id || company !== this.company || !this.is_active()) return null;
			this.roster_sync_status = response.message || {};
			return frappe.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.get_hybrid_tree",
				args: { company, source_mode: this.source_mode },
				freeze: true,
				freeze_message: __("正在读取部门层级关系..."),
			})
			})
			.then((r) => {
				if (!r) return;
				if (request_id !== this.tree_request_id || company !== this.company || !this.is_active()) return;
				if (this.mode === "report") return;
				this.tree = r.message || {};
				this.source_mode = this.tree.source_mode || this.source_mode;
				this.field_map = this.tree.field_map || {};
				const current_ids = new Set(this.collect_node_ids(this.tree.root || {}));
				if (this.tree.root) current_ids.add(this.tree.root.node_id);
				this.collapsed_nodes = new Set([...this.collapsed_nodes].filter(id => current_ids.has(id)));
				this.initialized_unit_ids = this.initialized_unit_ids || new Set();
				const collapse_new_units = node => {
					if (["室", "课", "组", "线"].includes(node.organization_node_type) && !this.initialized_unit_ids.has(node.node_id)) {
						if (node.children?.length) this.collapsed_nodes.add(node.node_id);
						this.initialized_unit_ids.add(node.node_id);
					}
					(node.children || []).forEach(collapse_new_units);
				};
				if (this.tree.root) collapse_new_units(this.tree.root);
				if (this.source_mode === "workbook_snapshot") this.collapse_snapshot_detail_nodes(this.tree.root);
				if (this.source_mode === "live") this.collapse_live_folder_nodes(this.tree.root);
				this.view_mode = "readable";
				this.render_summary();
				this.render_source_label();
				this.render_tree();
				const root = this.tree.root;
				const initial_node = this.find_node(this.selected_node?.node_id) || root;
				if (initial_node) this.select_node(initial_node.node_id, initial_node.node_type);
			})
			.catch((error) => {
				if (request_id !== this.tree_request_id || company !== this.company || !this.is_active()) return;
				this.render_load_error(error, company);
			});
	}

	find_initial_department_node(node) {
		if (!node) return null;
		if (node.node_type === "organization_node") return node;
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
		const tree = this.wrapper.querySelector(this.mode === "list" ? "[data-level-list]" : "[data-tree]");
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

	load_multiple_position_draft_status() {
		const company = this.company;
		frappe
			.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.get_multiple_position_draft_status",
				args: { company },
			})
			.then((r) => {
				if (company !== this.company || !this.is_active()) return;
				this.multiple_position_draft = r.message || null;
				this.render_summary();
			});
	}

	render_summary() {
		const summary = this.tree?.summary || {};
		if (this.tree?.source_mode === "manual") {
			const cards = [
				["编制", summary.planned_headcount || 0],
				["实际", summary.current_headcount || 0],
				["空缺", summary.vacancy_count || 0],
				["分管", summary.supervisor_count || 0],
				["室", summary.office_count || 0],
				["课", summary.section_count || 0],
				["组", summary.group_count || 0],
				["线", summary.line_count || 0],
				["岗位", summary.position_count || 0],
				["员工", summary.person_count || 0],
				["节点总数", summary.node_count || 0],
			];
			this.wrapper.querySelector("[data-summary]").innerHTML = cards
				.map(
					([label, value]) => `
						<div class="hrms-org-summary-card">
							<strong>${frappe.utils.escape_html(String(value))}</strong>
							<span>${frappe.utils.escape_html(__(label))}</span>
						</div>`,
				)
				.join("");
			return;
		}
		const draft = this.multiple_position_draft;
		const cards = [
			["编制人数", summary.planned_headcount || 0],
			["现有人数", summary.current_headcount || 0],
			["空缺人数", summary.vacancy_count || 0],
			["部门数", summary.department_count || 0],
		];
		if (draft) {
			cards.push([
				"多岗位草稿",
				draft.exists ? `${draft.status || __("草稿")} · ${draft.position_count || 0}${__("岗位")}` : __("未建立"),
			]);
		}
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
		label.textContent = this.tree?.source_label || __("手工组织图谱（独立展示）");
	}

	set_source_mode(source_mode) {
		if (!source_mode || source_mode === this.source_mode) return;
		this.source_mode = source_mode;
		this.selected_node = null;
		this.load_tree();
	}

	staffing_value(node, key) {
		if (key !== "current_headcount" && node.has_staffing_plan === false) return __("未设置");
		return Number(node[key] || 0);
	}

	render_chart_context() {
		const host = this.wrapper.querySelector("[data-chart-context]");
		const node = this.find_node(this.selected_node?.node_id) || this.tree?.root;
		if (!host || !node || this.mode !== "chart") return;
		const escape = value => frappe.utils.escape_html(String(value ?? ""));
		host.innerHTML = `<nav class="hrms-org-breadcrumb" aria-label="${__("组织路径")}">${this.node_path(node.node_id).map((parent, index) => `${index ? '<span>/</span>' : ''}<button class="btn btn-link" data-action="select-node" data-node-id="${escape(parent.node_id)}" data-node-type="${escape(parent.node_type)}">${escape(parent.name)}</button>`).join("")}</nav>
			<div class="hrms-org-current"><div><small>${escape(node.title)}</small><h3>${escape(node.name)}</h3>${this.render_assignment_warning(node)}${(node.lines || []).slice(0, 3).map(line => `<div>${escape(line)}</div>`).join("")}</div><div class="hrms-org-current-actions">${String(node.node_type).startsWith("organization_") ? `<button class="btn btn-default btn-sm" data-action="edit-organization-node" data-node-id="${escape(node.node_id)}">${__("编辑节点")}</button><button class="btn btn-default btn-sm" data-action="review-assignments" data-node-id="${escape(node.node_id)}">${__("核对任职")}</button>` : ''}<button class="btn btn-default btn-sm" data-action="show-personnel">${__("人员明细")}</button></div></div>`;
	}

	render_assignment_warning(node) {
		return (node.assignment_issues || []).length ? `<p class="text-warning">待核对：${node.assignment_issues.map(v => frappe.utils.escape_html(v)).join("；")}</p>` : "";
	}

	render_assignment_queue() {
		const pending = [];
		const visit = node => { if (node.assignment_issues?.length) pending.push(node); (node.children || []).forEach(visit); };
		if (this.tree?.root) visit(this.tree.root);
		const escape = value => frappe.utils.escape_html(String(value || ""));
		return pending.length ? `<details class="hrms-org-unplaced"><summary>待核对任职 · ${pending.length} 个节点</summary>${pending.map(node => `<div><span>${escape(this.node_path(node.node_id).map(n => n.name).join(" / "))}<small>${escape(node.template_source_cell)} · ${escape(node.assignment_issues.join("；"))}</small></span><button class="btn btn-default btn-xs" data-action="review-assignments" data-node-id="${escape(node.node_id)}">核对任职</button></div>`).join("")}</details>` : "";
	}

	async show_assignment_review(node_id) {
		const node_name = String(node_id || "").replace(/^organization_node:/, "");
		const company = this.company;
		const result = await frappe.call({method: "hrms.api.organization_assignment_review.get_review", args: {company, node_name}});
		const data = result.message;
		const escape = value => frappe.utils.escape_html(String(value || ""));
		const dialog = new frappe.ui.Dialog({title: `核对任职 · ${data.name}`, size: "extra-large",
			fields: [
				{fieldname: "help", fieldtype: "HTML", options: `<p>${escape(data.department || company)}${data.source_cell ? ` · 原表 ${escape(data.source_cell)}` : ""}</p><p>按工号选择员工，逐人确认职务和任职性质。“代理任职”表示代行该岗位，“代理人”表示本节点明确设置的代理关系。同一人可保留多处任职，但全公司至多确认一个正式职位，其他任职需明确为兼任、代理或继续待确认。汇总人数按工号去重。</p><p class="text-muted">同名组线无法仅凭职位分配；请对照原表确认。跨部门展示仅用于明确的兼任或代理人，不改变花名册部门、不计本部门人数。未选员工的原表记录保留待核对。</p>`},
				{fieldname: "related", fieldtype: "HTML", options: (data.related_assignments || []).filter(item => item.positions.length > 1).map(item => `<p><strong>${escape(item.employee_name)} · 多处任职</strong>：${item.positions.map(pos => `${escape(pos.name)} / ${escape(pos.role)}（${pos.formal ? "已确认正式" : escape(pos.assignment_type)}）`).join("；")}。${item.positions.some(pos => pos.formal) ? "变更正式职位前，请先将原正式任职调整为待确认或其他性质。" : "尚未人工确认唯一正式职位。"}</p>`).join("")},
				{fieldname: "rows", fieldtype: "Table", label: "任职记录", in_place_edit: true, data: data.rows,
					fields: [
						{fieldname: "reference_index", fieldtype: "Data", hidden: 1},
						{fieldname: "source_name", fieldtype: "Data", label: "原表姓名", read_only: 1, in_list_view: 1, columns: 2},
						{fieldname: "source_role", fieldtype: "Data", label: "原表职务", read_only: 1},
						{fieldname: "employee", fieldtype: "Link", options: "Employee", label: "员工工号", in_list_view: 1, columns: 2,
							get_query: () => ({filters: {name: ["in", data.candidates.map(p => p.value)]}})},
						{fieldname: "roster_job", fieldtype: "Data", label: "打开时花名册职位", read_only: 1},
						{fieldname: "role", fieldtype: "Data", label: "图中职务", reqd: 1, in_list_view: 1, columns: 2},
						{fieldname: "assignment_type", fieldtype: "Select", label: "任职性质", options: "待确认\n正式\n代理任职\n兼任\n代理人", default: "待确认", reqd: 1, in_list_view: 1, columns: 2},
						{fieldname: "leader", fieldtype: "Check", label: "负责人", in_list_view: 1, columns: 1},
						{fieldname: "display_only", fieldtype: "Check", label: "跨部门展示", in_list_view: 1, columns: 1},
						{fieldname: "status", fieldtype: "Data", label: "核对状态", read_only: 1},
					]},
			], primary_action_label: "保存任职确认",
			primary_action: async () => {
				const values = dialog.get_values(); if (!values) return;
				try {
				await frappe.call({method: "hrms.api.organization_assignment_review.save_review", args: {company, node_name, modified: data.modified, rows: values.rows}, freeze: true, freeze_message: "保存任职确认…"});
				} catch (error) { frappe.show_alert({message: "保存未完成，请核对提示后重试；当前填写内容已保留", indicator: "red"}); return; }
				dialog.hide(); await this.load_tree();
				frappe.show_alert({message: "任职已保存；未绑定或性质待确认的记录继续保留", indicator: "green"});
			}});
		dialog.show();
	}

	node_path(node_id, node = this.tree?.root, path = []) {
		if (!node) return [];
		const next = [...path, node];
		if (node.node_id === node_id) return next;
		for (const child of node.children || []) {
			const result = this.node_path(node_id, child, next);
			if (result.length) return result;
		}
		return [];
	}

	browse_node(node_id) {
		const node = this.find_node(node_id);
		if (!node) return;
		this.list_node_id = node_id;
		this.show_personnel = false;
		this.search_term = "";
		const search = this.wrapper.querySelector("[data-search]");
		if (search) search.value = "";
		this.render_level_list();
		this.select_node(node_id, node.node_type);
	}

	render_level_list() {
		const host = this.wrapper.querySelector("[data-level-list]");
		if (!host) return;
		const current = this.find_node(this.list_node_id) || this.tree?.root;
		if (!current) { host.innerHTML = `<div class="hrms-org-empty">${__("暂无组织数据")}</div>`; return; }
		this.list_node_id = current.node_id;
		const escape = value => frappe.utils.escape_html(String(value ?? ""));
		const path = this.node_path(current.node_id);
		let children = current.children || [];
		if (this.search_term) {
			children = [];
			const visit = node => {
				if (this.node_search_text(node).toLowerCase().includes(this.search_term)) children.push(node);
				(node.children || []).forEach(visit);
			};
			visit(this.tree.root);
		}
		const editable = String(current.node_type).startsWith("organization_");
		const has_people = current.node_type === "roster_unassigned" || (current.node_type === "company" && current.unassigned_employees?.length > 0) || ["室", "课", "组", "线", "岗位", "员工"].includes(current.organization_node_type) || ["organization_section", "organization_office", "organization_group", "organization_line", "organization_position", "organization_person"].includes(current.node_type);
		this.wrapper.querySelector(".hrms-org-page")?.classList.toggle("show-personnel", this.show_personnel === true);
		const unplaced = this.tree.unplaced_departments || [];
		host.innerHTML = `
			<nav class="hrms-org-breadcrumb" aria-label="${__("组织路径")}">${path.map((node, index) => `${index ? '<span>/</span>' : ''}<button type="button" class="btn btn-link" data-action="browse-node" data-node-id="${escape(node.node_id)}" ${node === current ? 'aria-current="page"' : ''}>${escape(node.name)}</button>`).join("")}</nav>
			<section class="hrms-org-current">
				<div><small>${escape(current.title)}</small><h3>${escape(current.name)}</h3>${this.render_assignment_warning(current)}${(current.lines || []).slice(0, 3).map(line => `<div>${escape(line)}</div>`).join("")}</div>
				<div class="hrms-org-current-actions"><button class="btn btn-default btn-sm" data-action="show-personnel">${__("人员明细")}</button>${editable ? `<button class="btn btn-default btn-sm" data-action="edit-organization-node" data-node-id="${escape(current.node_id)}">${__("编辑节点")}</button><button class="btn btn-default btn-sm" data-action="review-assignments" data-node-id="${escape(current.node_id)}">${__("核对任职")}</button>` : ''}${this.can_add_manual_child(current) ? `<button class="btn btn-primary btn-sm" data-action="add-organization-node" data-parent-node-id="${escape(current.node_id)}">${__("新增下级")}</button>` : ''}</div>
				<div class="hrms-org-current-metrics">${[ ["编制", "planned_headcount"], ["实际", "current_headcount"], ["空缺", "vacancy_count"] ].map(([label, key]) => `<span>${__(label)} <strong>${escape(this.staffing_value(current, key))}</strong></span>`).join("")}</div>
			</section>
			<div class="hrms-org-list-caption">${this.search_term ? __("全组织搜索结果") : __("直属下级")} · ${children.length}</div>
			${children.length ? `<div class="hrms-org-level-rows">${children.map(node => `<button type="button" class="hrms-org-level-row" data-action="browse-node" data-node-id="${escape(node.node_id)}">
				<span><strong>${escape(node.name)}</strong><small>${escape(node.title)}${node.reporting_scope_pending ? " · 分管待设置" : ""}</small>${node.chart_grade?.label ? `<small>职级：${escape(node.chart_grade.label)}</small>` : ""}${this.search_term ? `<small>${escape(this.node_path(node.node_id).slice(0, -1).map(parent => parent.name).join(" / "))}</small>` : ''}</span>
				<span class="hrms-org-row-info">${(node.lines || []).slice(0, 3).map(escape).join("<br>") + ((node.lines || []).length > 3 ? `<small>另有 ${node.lines.length - 3} 人，点击查看</small>` : "") || (node.department ? `${__("关联部门")}：${escape(node.department)}` : __("负责人待设置"))}<small>${(node.children || []).length} ${__("个下级")} · ${__("实际")} ${escape(this.staffing_value(node, "current_headcount"))} · ${__("编制")} ${escape(this.staffing_value(node, "planned_headcount"))} · ${__("空缺")} ${escape(this.staffing_value(node, "vacancy_count"))}</small></span><span aria-hidden="true">›</span>
			</button>`).join("")}</div>` : `<div class="hrms-org-list-empty">${this.search_term ? __("没有匹配的组织节点") : __("暂无下级机构，可新增下级或查看人员明细。")}</div>`}
			${has_people && !this.search_term ? `<section class="hrms-org-inline-people"><div class="hrms-org-roster-heading"><h3>${current.node_type === "company" ? __("待完善部门的人员") : current.organization_node_type === "岗位" || current.node_type === "organization_position" ? __("岗位人员") : __("本部门人员")}</h3><input class="form-control" data-roster-search aria-label="搜索本层人员" placeholder="搜索姓名、工号、职位"></div><div data-inline-people>${__("正在读取人员…")}</div></section>` : ''}
			${current.node_type === "company" ? this.render_assignment_queue() : ""}
			${current.node_type === "company" && (this.roster_sync_status?.issues || []).some(item => item.reason !== "待完善部门") ? `<section class="hrms-org-unplaced"><h3>待完善的组织关系</h3>${this.roster_sync_status.issues.filter(item => item.reason !== "待完善部门").map(item => `<p>${item.employee ? `<button class="btn btn-link" data-action="open-employee" data-employee="${escape(item.employee)}" data-employee-route="${escape(item.employee)}">${escape(item.employee)}</button>` : escape(item.department)} · ${escape(item.reason)}</p>`).join("")}</section>` : ""}
			${current.node_type === "company" && unplaced.length && !this.search_term ? `<details class="hrms-org-unplaced"><summary>${__("待编入组织的部门")} · ${unplaced.length}</summary>${unplaced.map(dept => `<div><span>${escape(dept.department_name)}</span><button class="btn btn-default btn-xs" data-action="place-department" data-department="${escape(dept.name)}">${__("编入组织")}</button></div>`).join("")}</details>` : ''}
		`;
		if (current.node_type === "company") this.render_inline_people({node_id: current.node_id, employees: current.unassigned_employees || [], employee_match_mode: "missing_department"});
		else if (this.last_detail?.node_id === current.node_id) this.render_inline_people(this.last_detail);
	}

	render_inline_people(detail, search = "") {
		if (this.mode !== "list" || !detail || detail.node_id !== this.list_node_id) return;
		const host = this.wrapper.querySelector("[data-inline-people]");
		if (!host) return;
		const escape = value => frappe.utils.escape_html(String(value ?? ""));
		if (detail.node_id === this.tree?.root?.node_id) detail = {...detail, employees: this.tree.root.unassigned_employees || [], employee_match_mode: "missing_department"};
		const all = detail.employees || [];
		const term = search.trim().toLowerCase();
		const rows = all.filter(row => [row.employee_name, row.employee_code, row.designation].some(value => String(value || "").toLowerCase().includes(term)));
		host.innerHTML = `<p class="text-muted">${detail.employee_match_mode === "missing_department" ? "花名册尚未填写部门，待补齐后分配" : detail.employee_match_mode === "department" ? "花名册部门归属" : "本岗位已分配人员"} · ${rows.length} / ${all.length} 人</p>
			${rows.length ? `<table class="hrms-org-roster-table"><thead><tr><th>工号</th><th>姓名</th><th>花名册职位</th></tr></thead><tbody>${rows.map(person => `<tr data-roster-employee="${escape(person.name)}"><td>${escape(this.resolve_employee_code_value(person))}</td><td><button class="btn btn-link" data-action="open-employee" data-employee="${escape(person.name)}" data-employee-route="${escape(this.resolve_employee_route_value(person))}">${escape(person.employee_name || person.name)}</button></td><td>${escape(person.designation || "未设置")}</td></tr>`).join("")}</tbody></table>` : `<p class="text-muted">${term ? "没有匹配的人员" : "暂无人员"}</p>`}`;
	}

	render_tree() {
		if (this.mode === "list") { this.render_level_list(); return; }
		const root = this.tree?.root;
		const tree = this.wrapper.querySelector("[data-tree]");
		if (!root) {
			tree.innerHTML = `<div class="hrms-org-empty">${__("暂无组织数据，请先导入员工花名册或维护部门。")}</div>`;
			return;
		}
		const filtered = this.search_term ? this.filter_tree_branch(root) : null;
		const roots = this.search_term ? (filtered ? [filtered] : []) : [this.find_node(this.tree_focus_id) || root];
		if (!roots.length) { tree.innerHTML = `<div class="hrms-org-empty">${__("没有匹配的部门、员工或岗位")}</div>`; return; }
		tree.innerHTML = `<ul class="hrms-org-tree hrms-org-tree--forest">${roots.map((node) => this.render_tree_node(node)).join("")}</ul>`;
		if (this.layout_frame) window.cancelAnimationFrame(this.layout_frame);
		this.layout_frame = window.requestAnimationFrame(() => {
			this.layout_frame = null;
			if (["overview", "readable"].includes(this.view_mode)) {
				this.fit_to_view(this.view_mode === "readable");
			} else {
				this.apply_tree_scale();
			}
		});
	}

	render_tree_node(node) {
		const collapsed = !this.search_term && this.collapsed_nodes.has(node.node_id);
		const children = node.children || [];
		const has_children = children.length > 0;
		const editable = String(node.node_type || "").startsWith("organization_");
		const movable = false;
		return `
			<li class="${collapsed ? "is-collapsed" : ""}">
				<div
					class="hrms-org-node hrms-org-node--${frappe.utils.escape_html(node.node_type || "default")} ${this.selected_node?.node_id === node.node_id ? "active" : ""}"
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
								title="${__("快速编辑此卡片")}"
								aria-label="${__("快速编辑此卡片")}"
							>${frappe.utils.icon("edit", "xs")}</button>`
							: ""
					}
					<div class="hrms-org-node-body">
						${this.render_node_heading(node)}
						<span>${frappe.utils.escape_html(node.title || "")}${node.reporting_scope_pending ? " · 分管待设置" : ""}</span>
						${node.chart_grade?.label ? `<small>职级：${frappe.utils.escape_html(node.chart_grade.label)}${node.chart_grade.rank != null ? ` · 等级 ${frappe.utils.escape_html(String(node.chart_grade.rank))}` : ""}</small>` : ""}
						${this.render_node_lines(node)}
						${node.card_content ? `<p class="hrms-org-node-note">${frappe.utils.escape_html(node.card_content)}</p>` : ""}
						${this.render_vacancy_marker(node)}
						${node.template_source_vacancies ? `<small class="hrms-org-template-vacancy">原表空缺 ${frappe.utils.escape_html(String(node.template_source_vacancies))}</small>` : ""}
						${
				node.node_type === "organization_person"
								? `<small>${__("员工节点")}</small>`
								: `<small>${__("编制")} ${frappe.utils.escape_html(String(this.staffing_value(node, "planned_headcount")))} · ${__("实际")} ${frappe.utils.escape_html(String(node.current_headcount || 0))} · ${__("空缺")} ${frappe.utils.escape_html(String(this.staffing_value(node, "vacancy_count")))}</small>`
						}
					</div>
					${has_children ? `<button class="hrms-org-node-toggle" data-action="toggle-node" data-toggle-node="${frappe.utils.escape_html(node.node_id)}" aria-expanded="${!collapsed}" aria-label="${frappe.utils.escape_html((collapsed ? __("展开") : __("收起")) + node.name)}">${collapsed ? "+ " + __("展开") : "− " + __("收起")} · ${children.length} ${__("个下级")}</button>` : ""}
				</div>
				${this.can_add_manual_child(node) ? `<button class="hrms-org-node-add" data-action="add-organization-node" data-parent-node-id="${frappe.utils.escape_html(node.node_id)}" title="${__("添加下级节点")}">+</button>` : ""}
				${
					has_children && !collapsed
						? `<ul>${children.map((child) => this.render_tree_node(child)).join("")}</ul>`
						: ""
				}
			</li>
		`;
	}

	can_add_manual_child(node) {
		return this.tree?.source_mode === "manual" && node?.node_type !== "organization_person" && (node.node_type === "company" || String(node.node_type).startsWith("organization_"));
	}

	render_node_heading(node) {
		if (node.organization_node_type !== "员工" && this.source_mode === "manual") {
			return `<button type="button" class="hrms-org-node-person-link" data-action="select-node" data-node-id="${frappe.utils.escape_html(node.node_id)}" data-node-type="${frappe.utils.escape_html(node.node_type)}">${frappe.utils.escape_html(node.name || "")}</button>`;
		}
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
		const vacancy_count = node.has_staffing_plan === false ? 0 : Number(node.vacancy_count || 0);
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
		return [node.name, node.title, node.card_content, node.department, ...(node.lines || []), ...people].filter(Boolean).join(" ");
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
					${this.render_person_tokens(matching_people)}
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
						${person.source_reference ? `<small>原表 · ${frappe.utils.escape_html(person.match_status || "待核对")}</small>` : ""}
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
		const request_id = ++this.detail_request_id;
		const company = this.company;
		const changed = this.selected_node?.node_id !== node_id;
		this.selected_node = { node_id, node_type };
		if (this.mode !== "list" && changed) {
			this.tree_focus_id = node_id;
			const focused = this.find_node(node_id);
			if (focused && node_type !== "company") {
				[focused.node_id, ...this.collect_node_ids(focused)].forEach(id => this.collapsed_nodes.delete(id));
			}
			this.view_mode = "readable";
			this.render_tree();
		}
		this.render_chart_context();
		this.wrapper.querySelectorAll(".hrms-org-node.active").forEach((node) => node.classList.remove("active"));
		const selected = Array.from(this.wrapper.querySelectorAll(".hrms-org-node[data-node-id]")).find(
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
					search: this.wrapper.querySelector("[data-search]")?.value || "",
					source_mode: this.source_mode,
				},
			})
			.then((r) => {
				if (request_id !== this.detail_request_id || company !== this.company || !this.is_active() || this.mode === "report") return;
				this.last_detail = r.message || {};
				this.render_detail_panel(this.last_detail);
				this.render_inline_people(this.last_detail);
			}).catch(() => {
				if (request_id !== this.detail_request_id || company !== this.company || !this.is_active()) return;
				const host = this.wrapper.querySelector("[data-inline-people]");
				if (host) host.textContent = __("人员读取失败，请刷新重试。");
			});
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
					${actions.can_add_organization_node ? `<button class="btn btn-xs btn-default" data-action="add-organization-node" data-parent-node-id="${frappe.utils.escape_html(detail.node_id || "")}">${__("新增下级")}</button>` : ""}
					${actions.can_edit_organization_node ? `<button class="btn btn-xs btn-default" data-action="edit-organization-node" data-node-id="${frappe.utils.escape_html(detail.node_id || "")}">${__("编辑节点")}</button>` : ""}
					${actions.can_delete_organization_node ? `<button class="btn btn-xs btn-danger" data-action="delete-organization-node" data-node-id="${frappe.utils.escape_html(detail.node_id || "")}">${__("删除节点")}</button>` : ""}
				</div>
			</div>
			${(detail.role_lines || []).map(line => `<div class="hrms-org-detail-note">${frappe.utils.escape_html(line)}</div>`).join("")}
			${detail.card_content ? `<div class="hrms-org-detail-note">${frappe.utils.escape_html(detail.card_content)}</div>` : ""}
			${this.render_department_relationships(detail.relationships || {})}
			${this.render_employee_list(detail.employees || [], detail.employee_match_mode)}
		`;
	}

	render_department_relationships(relationships) {
		const parent = relationships.parent;
		const children = relationships.children || [];
		const node_button = (node) => `
			<button
				type="button"
				class="hrms-org-relation-button"
				data-action="select-node"
				data-node-id="${frappe.utils.escape_html(`organization_node:${node.name || ""}`)}"
				data-node-type="${frappe.utils.escape_html(node.node_type || "organization_node")}"
			>${frappe.utils.escape_html(node.label || node.name || "")}</button>`;
		return `
			<div class="hrms-org-relations">
				<section>
					<strong>${__("上级节点")}</strong>
					${parent ? node_button(parent) : `<span>${__("无上级节点（一级部门）")}</span>`}
				</section>
				<section>
					<strong>${__("下级节点")}</strong>
					<div class="hrms-org-relation-list">
						${children.length ? children.map(node_button).join("") : `<span>${__("暂无下级节点")}</span>`}
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

	render_employee_list(employees, employee_match_mode = null) {
		if (!employees.length) {
			return `<div class="hrms-org-empty">${employee_match_mode === "department" ? __("员工档案中暂未找到属于该部门的在职员工。") : employee_match_mode === "display" ? __("分管为展示层级，人员由下级部门自动匹配。") : __("当前节点没有匹配员工。")}</div>`;
		}
		return `
			<div class="hrms-org-employees">
				<div class="hrms-org-section-title">${this.source_mode === "workbook_snapshot" ? __("原表人员（含下级）") : employee_match_mode === "assigned" ? __("图中已选用员工") : employee_match_mode === "department" ? __("按花名册部门统计") : __("当前部门员工")}</div>
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

	filter_tree_branch(node) {
		const children = (node.children || []).map(child => this.filter_tree_branch(child)).filter(Boolean);
		return this.node_search_text(node).toLowerCase().includes(this.search_term) || children.length ? {...node, children} : null;
	}

	set_zoom(value) {
		this.view_mode = "manual";
		this.zoom = Math.max(MIN_ORG_CHART_ZOOM, Math.min(1.6, value));
		this.apply_tree_scale();
	}

	fit_to_view(readable = false) {
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
			readable ? 1 : MIN_ORG_CHART_ZOOM,
			Math.min(1, available_width / raw_width, available_height / raw_height),
		);
		this.view_mode = readable ? "readable" : "overview";
		this.apply_tree_scale(true);
		canvas.scrollTo({ left: readable ? Math.max(0, (raw_width * this.zoom - available_width) / 2) : 0, top: 0 });
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

	show_visual_export() {
		if (!this.tree?.root) { frappe.msgprint(__("暂无可导出的组织架构")); return; }
		const dialog = new frappe.ui.Dialog({
			title: __("导出架构图"),
			fields: [
				{ fieldname: "scope", fieldtype: "Select", label: __("导出范围"), options: "完整架构\n当前展开层级", default: "完整架构", reqd: 1 },
				{ fieldname: "format", fieldtype: "Select", label: __("文件格式"), options: "Excel 可编辑架构图\nSVG 矢量图\nPNG 图片", default: "Excel 可编辑架构图", reqd: 1 },
				{ fieldtype: "HTML", options: "<p class='text-muted'>完整架构包含所有下级及人员；当前展开层级按当前搜索、查看范围和展开状态导出。均保留任职标记，不受页面缩放或滚动位置影响。<br>Excel 使用可编辑单元格与连线，完整导出附各课室工作表，便于放大查看和打印。SVG 可放大查看；PNG 会按尺寸限制等比缩小。</p>" },
			],
			primary_action_label: __("导出"),
			primary_action: async values => {
				dialog.get_primary_btn().prop("disabled", true);
				try {
					await this.download_visual_chart(values.scope === "完整架构", values.format.startsWith("Excel") ? "xlsx" : values.format.startsWith("PNG") ? "png" : "svg");
					dialog.hide();
				} catch (error) {
					frappe.msgprint({ title: __("导出失败"), message: frappe.utils.escape_html(error.message || "请重试；大型架构建议选择 SVG 格式。"), indicator: "red" });
				} finally { dialog.get_primary_btn().prop("disabled", false); }
			},
		});
		dialog.show();
	}

	visual_export_root(complete) {
		const root = this.tree?.root;
		if (!root || complete) return root;
		return this.search_term ? this.filter_tree_branch(root) : (this.find_node(this.tree_focus_id) || root);
	}

	build_visual_export(complete = true, measure = text => Array.from(text).reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 14 : 8), 0)) {
		const root = this.visual_export_root(complete);
		if (!root) throw new Error("当前没有匹配的组织节点，请清除搜索后重试。");
		const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
		const cardWidth = 240, gap = 24, padding = 40, rowGap = 64, lineHeight = 22;
		const wrap = value => String(value ?? "").split(/\r?\n/).flatMap(paragraph => {
			const rows = []; let row = "";
			for (const char of paragraph) {
				if (row && measure(row + char) > cardWidth - 32) { rows.push(row); row = ""; }
				row += char;
			}
			rows.push(row); return rows;
		});
		const levels = [], nodes = [];
		const visit = (node, depth) => {
			const children = node.children || [];
			const collapsed = !complete && !this.search_term && this.collapsed_nodes.has(node.node_id);
			const rows = [];
			const add = (value, kind = "detail") => { if (value !== undefined && value !== null && value !== "") wrap(value).forEach(text => rows.push({ text, kind })); };
			add(node.name, "heading");
			add(`${node.title || ""}${node.reporting_scope_pending ? " · 分管待设置" : ""}`, "muted");
			if (node.chart_grade?.label) add(`职级：${node.chart_grade.label}${node.chart_grade.rank != null ? ` · 等级 ${node.chart_grade.rank}` : ""}`, "muted");
			if (node.people?.length) {
				for (const person of node.people) {
					if (!complete && this.search_term && ![person.name, person.employee_name, person.employee_code, person.department, person.designation, person.grade, person.role].filter(Boolean).join(" ").toLowerCase().includes(this.search_term)) continue;
					add([person.role, person.employee_name || person.name].filter(Boolean).join("："));
					if (person.source_reference) add(`原表 · ${person.match_status || "待核对"}`, "muted");
				}
			} else {
				for (const line of (node.employee_names?.length ? node.employee_names : node.lines) || []) add(line);
			}
			add(node.card_content);
			if (node.has_staffing_plan !== false && Number(node.vacancy_count || 0)) add(`TBA×${node.vacancy_count}`, "vacancy");
			if (node.template_source_vacancies) add(`原表空缺 ${node.template_source_vacancies}`, "muted");
			add(node.node_type === "organization_person" ? "员工节点" : `编制 ${this.staffing_value(node, "planned_headcount")} · 实际 ${node.current_headcount || 0} · 空缺 ${this.staffing_value(node, "vacancy_count")}`, "muted");
			if (collapsed && children.length) add(`已收起 · ${children.length} 个直属下级`, "muted");
			const item = { id: node.node_id, depth, rows, height: rows.length * lineHeight + 32, children: [], width: cardWidth };
			nodes.push(item);
			levels[depth] = Math.max(levels[depth] || 0, item.height);
			item.children = collapsed ? [] : children.map(child => visit(child, depth + 1));
			item.width = Math.max(cardWidth, item.children.reduce((sum, child) => sum + child.width, 0) + Math.max(0, item.children.length - 1) * gap);
			return item;
		};
		const layout = visit(root, 0);
		const levelY = [100];
		for (let depth = 1; depth < levels.length; depth++) levelY[depth] = levelY[depth - 1] + levels[depth - 1] + rowGap;
		const place = (item, left) => {
			item.x = left + item.width / 2; item.y = levelY[item.depth];
			const width = item.children.reduce((sum, child) => sum + child.width, 0) + Math.max(0, item.children.length - 1) * gap;
			let next = left + (item.width - width) / 2;
			for (const child of item.children) { place(child, next); next += child.width + gap; }
		};
		place(layout, padding);
		const width = layout.width + padding * 2, height = levelY.at(-1) + levels.at(-1) + padding;
		const title = `${this.tree.root.name || this.company || "公司"} · 组织架构图`;
		const paths = [], cards = [];
		for (const item of nodes) {
			if (item.children.length) {
				const busY = levelY[item.depth + 1] - rowGap / 2;
				paths.push(`<path d="M${item.x} ${item.y + item.height}V${busY} M${item.children[0].x} ${busY}H${item.children.at(-1).x}${item.children.map(child => ` M${child.x} ${busY}V${child.y}`).join("")}"/>`);
			}
			cards.push(`<g data-node-id="${esc(item.id)}"><rect x="${item.x - cardWidth / 2}" y="${item.y}" width="${cardWidth}" height="${item.height}" rx="8" fill="white" stroke="#cdd8e8"/>${item.rows.map((row, i) => `<text x="${item.x}" y="${item.y + 27 + i * lineHeight}" text-anchor="middle" fill="${row.kind === "vacancy" ? "#16a34a" : row.kind === "muted" ? "#64748b" : "#273445"}"${row.kind === "heading" ? ' font-weight="700"' : ""}>${esc(row.text)}</text>`).join("")}</g>`);
		}
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${esc(title)}</title><rect width="100%" height="100%" fill="white"/><g font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="14"><text x="40" y="35" font-size="20" font-weight="700">${esc(title)}</text><text x="40" y="62" fill="#64748b">${complete ? "完整架构" : "当前展开层级"} · ${nodes.length} 个节点 · ${esc(new Date().toLocaleString("zh-CN"))}</text><g fill="none" stroke="#94a3b8" stroke-width="1.5">${paths.join("")}</g>${cards.join("")}</g></svg>`;
		return { svg, width, height, nodeCount: nodes.length };
	}

	async download_visual_chart(complete, format) {
		if (format === "xlsx") {
			const node_ids = Array.from(this.wrapper.querySelectorAll("[data-tree] .hrms-org-node")).map(node => node.dataset.nodeId);
			const result = await frappe.call({
				method: "hrms.api.organization_chart_export.export_excel", type: "POST",
				args: {company: this.company, scope: complete ? "complete" : "current", node_ids: JSON.stringify(node_ids), search: complete ? "" : this.search_term || ""},
				freeze: true, freeze_message: __("正在生成 Excel 架构图…"),
			});
			if (!result.message?.file_url) throw new Error("Excel 导出失败，请重试。");
			const link = document.createElement("a");
			link.href = result.message.file_url; link.download = result.message.file_name;
			document.body.appendChild(link); link.click(); link.remove();
			frappe.show_alert({message: `已生成 Excel 架构图，${result.message.node_count} 个节点、${result.message.sheet_count} 张工作表。`, indicator: "green"}, 8);
			frappe.msgprint({title: __("Excel 架构图已生成"), message: `<p>${result.message.node_count} 个节点，${result.message.sheet_count} 张工作表。文字和连线可在 Excel 中编辑。</p><a class="btn btn-primary" href="${frappe.utils.escape_html(result.message.file_url)}" download="${frappe.utils.escape_html(result.message.file_name)}" target="_blank" rel="noopener">下载 Excel 架构图</a>`});
			return;
		}
		await document.fonts?.ready;
		const measureCanvas = document.createElement("canvas");
		const measureContext = measureCanvas.getContext("2d");
		if (!measureContext) throw new Error("浏览器无法生成图片，请更换浏览器重试。");
		measureContext.font = "bold 14px Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif";
		const output = this.build_visual_export(complete, text => measureContext.measureText(text).width);
		let blob = new Blob([output.svg], { type: "image/svg+xml;charset=utf-8" });
		let reduced = false;
		if (format === "png") {
			const scale = Math.min(1, 8192 / output.width, 8192 / output.height, Math.sqrt(16000000 / (output.width * output.height)));
			reduced = scale < 1;
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.floor(output.width * scale)); canvas.height = Math.max(1, Math.floor(output.height * scale));
			const context = canvas.getContext("2d");
			if (!context) throw new Error("图片尺寸过大，请选择 SVG 矢量图导出。");
			const url = URL.createObjectURL(blob);
			try {
				const image = new Image();
				await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("图片转换失败，请选择 SVG 矢量图导出。")); image.src = url; });
				context.drawImage(image, 0, 0, canvas.width, canvas.height);
				blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
				if (!blob) throw new Error("图片生成失败，请选择 SVG 矢量图导出。");
			} finally { URL.revokeObjectURL(url); canvas.width = 0; canvas.height = 0; }
		}
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${this.tree.root.name || "公司"}-组织架构图-${complete ? "完整" : "当前层级"}-${new Date().toISOString().slice(0, 10)}.${format}`.replace(/[\\/:*?"<>|]/g, "_");
		document.body.appendChild(link); link.click(); link.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 60000);
		frappe.show_alert({ message: `已生成 ${output.nodeCount} 个节点的${format === "png" ? "图片" : "矢量图"}${reduced ? "；PNG 已等比缩小，查看细节建议导出 SVG" : ""}，请在浏览器下载中查看。`, indicator: "green" }, 8);
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

	manual_node_name(node_id) {
		const value = String(node_id || "");
		return value.startsWith("organization_node:") ? value.replace(/^organization_node:/, "") : "";
	}

	manual_node_config(doc) {
		try {
			const config = JSON.parse(doc?.source_text || "{}");
			return config?.manual_organization ? config : {};
		} catch (error) {
			return {};
		}
	}

	manual_child_kinds(parent_node_id) {
		return this.find_node(parent_node_id)?.organization_node_type === "员工" ? [] : ["管理层", "分管", "室", "课", "组", "线", "岗位", "员工"];
	}

	manual_parent_options(node_kind, excluded_name = "") {
		const options = [{ label: __("公司（根节点）"), value: "" }];
		const visit = (node) => {
			if (!node) return;
			if (excluded_name && this.manual_node_name(node.node_id) === excluded_name) return;
			const kind = node.organization_node_type || (node.node_type === "company" ? "root" : "");
			if (kind && kind !== "root" && kind !== "员工") {
				options.push({ label: `${node.name} [${this.manual_node_name(node.node_id)}]`, value: this.manual_node_name(node.node_id) });
			}
			(node.children || []).forEach(visit);
		};
		visit(this.tree?.root);
		return options;
	}

	manual_department_for_node(node_id, node = this.tree?.root, inherited_department = "") {
		if (!node) return "";
		const department = node.department || inherited_department;
		if (node.node_id === node_id) return department;
		for (const child of node.children || []) {
			const match = this.manual_department_for_node(node_id, child, department);
			if (match) return match;
		}
		return "";
	}

	show_manual_node_dialog(doc = null, parent_node_id = "", initial_department = "") {
		const company = this.company !== "All Companies" ? this.company : "";
		const is_edit = Boolean(doc?.name);
		const parent_context_id = is_edit
			? doc?.parent_node
				? `organization_node:${doc.parent_node}`
				: "company:root"
			: parent_node_id || this.selected_node?.node_id || "company:root";
		const selected_parent = is_edit ? doc?.parent_node || "" : this.manual_node_name(parent_context_id);
		const parent_node = this.find_node(parent_context_id);
		const config = this.manual_node_config(doc);
		const chart_grades = this.tree?.chart_grades || [];
		if (!is_edit && initial_department) {
			config.department = initial_department;
			config.node_kind = ["室", "课", "组", "线"].find(kind => initial_department.endsWith(kind)) || "课";
		}
		const allowed_kinds = is_edit ? [config.node_kind] : this.manual_child_kinds(parent_context_id);
		if (!allowed_kinds.length) { frappe.msgprint(__("员工节点不能添加下级，请选择部门或岗位节点。")); return; }
		const parent_options = this.manual_parent_options(config.node_kind || allowed_kinds[0], doc?.name);
		const parent_by_label = new Map(parent_options.map((option) => [option.label, option.value]));
		const linked_department = config.department || "";
		const parent_department = () => this.manual_department_for_node(dialog?.get_value("parent_node") ? `organization_node:${dialog.get_value("parent_node")}` : parent_context_id);
		let dialog;
		let pool = { rows: [], employees: [] };
		let poolRequest = 0;
		let poolReady = false;
		// A department/unit node owns its Department reference.  It must never
		// silently fall back to a parent department: the link is the node's
		// business identity, while display_name is only the chart caption.
		const selected_base_department = () => {
			if (["管理层", "分管"].includes(dialog?.get_value("node_kind"))) return "";
			if (dialog?.get_value("node_kind") === "员工") {
				return this.manual_department_for_node(dialog?.get_value("parent_node") ? `organization_node:${dialog.get_value("parent_node")}` : parent_context_id);
			}
			return dialog?.get_value("department") || "";
		};
		const eligible_rows = () => pool.rows;
		const employee_filters = () => ({
			...(company ? { company } : {}),
			status: "Active",
			...(poolReady ? { name: ["in", [...new Set(eligible_rows().map(row => row.employee)), ""]] } : {}),
		});
		const clear_people = () => {
			if (!dialog) return;
			["employee", "primary_employee", "proxy_employee", "manager_employee"].forEach(field => dialog.set_value(field, ""));
			dialog.set_value("assigned_employees", []);
		};
		const toggle_auto_members = () => {
			const input = dialog?.fields_dict.assigned_employees.$wrapper?.[0]?.querySelector(".multiselect-list");
			if (input) {
				input.inert = Boolean(config.assignment_rules_manual || dialog.get_value("roster_auto_sync"));
				input.style.opacity = input.inert ? "0.6" : "1";
			}
		};
		const load_pool = async (reset = true) => {
			if (!dialog) return;
			const request = ++poolRequest;
			poolReady = false;
			pool = { rows: [], employees: [] };
			if (reset) clear_people();
			const department = selected_base_department();
			dialog.fields_dict.roster_department_hint.$wrapper.html('<p class="text-muted">正在读取花名册…</p>');
			try {
				const result = await frappe.call({ method: "hrms.api.organization_roster.get_candidates", args: { company, department, allow_company: ["管理层", "分管"].includes(dialog.get_value("node_kind")), inherit_parent: false } });
				if (request !== poolRequest) return;
				pool = result.message || { rows: [], employees: [] };
				poolReady = true;
				const rosterDepartment = pool.roster_department || department;
				const sourceLabel = rosterDepartment ? `已关联部门：${rosterDepartment}` : "全公司花名册";
				const isUnit = ["室", "课", "组", "线"].includes(dialog.get_value("node_kind")) && !dialog.get_value("roster_subset");
				const hint = !department && !["管理层", "分管"].includes(dialog.get_value("node_kind"))
					? "请先关联部门，自动读取该部门的在职花名册。"
					: isUnit
						? `${sourceLabel} · 在职 ${pool.employees.length} 人。部门成员自动取自花名册，无需逐个选用；这里只填写负责人、代理人和编制。下级岗位或员工可直接从对应部门花名册选人。`
						: `${sourceLabel} · 在职 ${pool.employees.length} 人。可直接按姓名或工号选择，无需先在上级分配；图中任职不改变花名册主职。`;
				dialog.fields_dict.roster_department_hint.$wrapper.html(`<p class="text-muted">${frappe.utils.escape_html(hint)}</p><button type="button" class="btn btn-default btn-xs" data-open-base>查看部门花名册统计</button>`);
				dialog.fields_dict.roster_department_hint.$wrapper.find("[data-open-base]").on("click", () => { dialog.hide(); rosterDepartment ? frappe.set_route("Form", "Department", rosterDepartment) : frappe.set_route("List", "Department"); });
			} catch (error) {
				if (request === poolRequest) dialog.fields_dict.roster_department_hint.$wrapper.html('<p class="text-danger">花名册读取失败，请重新打开窗口。</p>');
			}
		};
		dialog = new frappe.ui.Dialog({
			title: is_edit ? __("编辑组织节点") : __("新增组织节点"),
			fields: [
				{ fieldname: "roster_subset", fieldtype: "Check", label: __("部门内分组"), default: Boolean(config.roster_subset), read_only: is_edit, depends_on: "eval:['室','组','线','岗位'].includes(doc.node_kind)", description: __("用于生产组、直线级等部门内部层级；关联所属课室并单独安排成员。") },
				{ fieldname: "display_name", fieldtype: "Data", label: __("组织名称"), default: doc?.display_name || "", description: __("列表与架构图共用此名称，例如“生产分管”。负责人单独设置，换人后组织名称与下属机构保持不变。") },
				{
					fieldname: "node_kind",
					fieldtype: "Select",
					label: __("节点类型"),
					options: allowed_kinds.join("\n"),
					reqd: 1,
					read_only: is_edit,
					default: config.node_kind || allowed_kinds[0],
					onchange: () => { if (dialog) { dialog.set_value("department", dialog.get_value("node_kind") === "岗位" ? parent_department() : ""); dialog.set_value("designation", ""); dialog.set_value("grade", ""); load_pool(); } },
				},
				{
					fieldname: "manager_employee",
					fieldtype: "Link",
					options: "Employee",
					label: __("管理岗位任职人／分管负责人"),
					description: __("输入员工姓名或工号后选择匹配员工；仅用于组织图展示，不修改员工档案。"),
					default: config.manager_employee || "",
					depends_on: "eval:doc.node_kind=='分管'||doc.node_kind=='管理层'",
					get_query: () => ({ filters: employee_filters() }),
				},
				{ fieldname: "chart_grade_code", fieldtype: "Select", label: __("图中职级"),
					options: [{ label: __("未设置"), value: "" }, ...chart_grades.map(g => ({ label: `${g.label} (${g.code})`, value: g.code }))],
					default: config.chart_grade_code || "", hidden: !chart_grades.length,
					description: __("职级定义由组织配置导入；上下级由上级组织节点决定。") },
				{
					fieldname: "department",
					fieldtype: "Link",
					options: "Department",
					label: __("关联部门（必选）"),
					description: __("室、课、组、线的成员自动读取此部门的在职花名册，无需再次分配。选择“课”时仅列出已创建的“××课”；岗位人员也从关联部门直接选择。"),
					default: linked_department,
					onchange: () => load_pool(),
					depends_on: "eval:doc.node_kind!='管理层'&&doc.node_kind!='分管'&&doc.node_kind!='员工'",
					mandatory_depends_on: "eval:doc.node_kind!='管理层'&&doc.node_kind!='分管'&&doc.node_kind!='员工'",
					get_query: () => {
						const kind = dialog?.get_value("node_kind");
						const filters = company ? { company, disabled: 0 } : { disabled: 0 };
						if (["室", "课", "组", "线"].includes(kind) && !dialog.get_value("roster_subset")) filters.department_name = ["like", `%${kind}`];
						return { filters };
					},
				},
				{
					fieldname: "designation",
					fieldtype: "Link",
					options: "Designation",
					label: __("关联岗位（必选）"),
					description: __("岗位节点必须绑定岗位管理中已创建的岗位。员工仍从关联部门花名册选择；花名册主职不同的，需在核对任职中明确正式、代理任职或兼任。"),
					default: config.designation || "",
					depends_on: "eval:doc.node_kind=='岗位'",
					mandatory_depends_on: "eval:doc.node_kind=='岗位'&&!doc.roster_subset",
					// A vacant post still needs to be selectable.  Do not limit this
					// link to designations which already have a roster holder.
					get_query: () => ({}),
					onchange: () => { if (dialog) { dialog.set_value("grade", ""); clear_people(); } },
				},
				{ fieldname: "grade", fieldtype: "Link", options: "Employee Grade", label: __("职级（可选）"), default: config.grade || "", depends_on: "eval:doc.node_kind=='岗位'", get_query: () => ({ filters: { name: ["in", [...new Set(pool.rows.filter(row => !dialog.get_value("designation") || row.designation === dialog.get_value("designation")).map(row => row.grade)), ""]] } }), onchange: clear_people },
				{ fieldname: "leadership_from_roster", fieldtype: "Check", label: __("显示花名册中的总经理／副总经理"), default: config.leadership_from_roster ? 1 : 0, depends_on: "eval:doc.node_kind=='管理层'", description: __("合并展示公司管理层；关闭后可手动设置本节点的管理岗位任职人。") },
				{ fieldname: "role_title", fieldtype: "Data", label: __("图中职位名称"), default: config.role_title || config.designation || "", description: __("例如：技术总监、课长、组长。即使未安排人员或为代理任职，仍保留这个名称。") },
				{ fieldname: "assignment_mode", fieldtype: "Select", label: __("任职方式"), options: "自动\n正式\n代理", default: config.assignment_mode || (is_edit ? "正式" : "自动"), description: __("此处仅调整职务显示。唯一正式职位需在“核对任职”中逐人确认；自动只识别同一职务中的“代”标记。") },
				{ fieldname: "planned_headcount_set", fieldtype: "Check", label: __("已设置编制"), default: config.planned_headcount_set ?? Number(doc?.planned_headcount || 0) > 0, depends_on: "eval:doc.node_kind!='分管'&&doc.node_kind!='管理层'&&doc.node_kind!='员工'" },
				{ fieldname: "planned_headcount", fieldtype: "Int", label: __("编制人数"), default: doc?.planned_headcount || 0, description: __("未设置时不计算空缺；管理层与分管汇总直属下级编制。"), depends_on: "eval:doc.planned_headcount_set&&doc.node_kind!='分管'&&doc.node_kind!='管理层'" },
				{
					fieldname: "roster_department_hint",
					fieldtype: "HTML",
					options: '<div class="text-muted small">人员、职位与职级取自花名册。</div>',
				},
				{
					fieldname: "employee",
					fieldtype: "Link",
					options: "Employee",
					label: __("选择员工（必选）"),
					description: __("从上级所关联部门的在职花名册选择；员工自身的部门和岗位以花名册为准。"),
					default: config.employee || "",
					depends_on: "eval:doc.node_kind=='员工'",
					get_query: () => ({ filters: employee_filters() }),
				},
				{
					fieldname: "roster_auto_sync", fieldtype: "Check", label: __("人员随花名册自动更新"),
					onchange: toggle_auto_members,
					default: Boolean(config.roster_auto_sync),
					depends_on: "eval:['室','课','组','线','岗位'].includes(doc.node_kind)",
					description: config.roster_subset || config.template_leadership ? __("按原表已匹配的员工工号跟随花名册变化，保留图中职务和代理关系。取消后可手动调整人员。") : __("按部门、职位自动增减岗位人员，负责人仅在职位唯一匹配时读取，代理人需明确设置。取消勾选后可手动维护人员；名称、上级和编制可单独修改。"),
				},
				{
					fieldname: "primary_employee",
					read_only_depends_on: "eval:doc.roster_auto_sync",
					fieldtype: "Link",
					options: "Employee",
					label: __("负责人／岗位任职人（可选）"),
					description: __("仅填写此节点的负责人或岗位任职人。部门普通成员由花名册自动确定，在下级节点直接安排展示。"),
					default: config.primary_employee || config.responsible_person || "",
					depends_on: "eval:doc.node_kind!='管理层'&&doc.node_kind!='分管'&&doc.node_kind!='员工'",
					get_query: () => ({ filters: employee_filters() }),
				},
				{
					fieldname: "assigned_employees",
					fieldtype: "MultiSelectList",
					options: "Employee",
					label: __("本岗位其他任职人员（可多选）"),
					description: __("同一岗位需要展示多人时直接选择；无需先在上级选用员工。"),
					default: config.node_kind === "岗位" || config.roster_subset ? config.assigned_employees || [] : [],
					depends_on: "eval:doc.node_kind=='岗位'||doc.roster_subset",
					get_data: (txt) => frappe.db.get_link_options("Employee", txt, employee_filters()),
				},
				{
					fieldname: "proxy_employee",
					read_only_depends_on: "eval:doc.roster_auto_sync",
					fieldtype: "Link",
					options: "Employee",
					label: __("代理人（可选）"),
					description: __("代理人仅用于图谱展示，不参与权限、审批、考勤、薪资或汇报关系。"),
					default: config.proxy_employee || "",
					depends_on: "eval:doc.node_kind!='员工'",
					get_query: () => ({ filters: employee_filters() }),
				},
				{
					fieldname: "parent_node_label",
					fieldtype: "Autocomplete",
					label: __("上级组织节点"),
					default: parent_options.find(option => option.value === selected_parent)?.label || parent_options[0].label,
					options: parent_options.map((option) => option.label),
					description: __("调整后，层级列表与树状架构图同步更新；保留花名册中的员工部门归属。"),
					onchange: () => { if (dialog && parent_by_label.has(dialog.get_value("parent_node_label"))) dialog.set_value("parent_node", parent_by_label.get(dialog.get_value("parent_node_label"))); },
				},
				{
					fieldname: "parent_node",
					fieldtype: "Data",
					default: selected_parent,
					hidden: 1,
					onchange: () => load_pool(),
				},
			],
			primary_action_label: __("保存"),
			primary_action: (values) => {
				if (!parent_by_label.has(values.parent_node_label)) { frappe.msgprint(__("请从候选项选择有效上级节点。")); return; }
				values.parent_node = parent_by_label.get(values.parent_node_label);
				delete values.parent_node_label;
				frappe
					.call({
						method: "hrms.hr.page.organizational_chart.organizational_chart.save_manual_organization_node",
						args: { ...values, company: this.company, node_name: doc?.name || "" },
						freeze: true,
						freeze_message: __("正在保存组织节点..."),
					})
					.then((response) => {
						dialog.hide();
						frappe.show_alert({ message: __("组织节点已保存"), indicator: "green" });
						this.load_tree();
						const saved = response.message || {};
						if (saved.name) this.selected_node = { node_id: `organization_node:${saved.name}`, node_type: this.manual_node_type(saved.node_kind) };
					});
			},
		});
		if (config.assignment_rules_manual) {
			["employee", "primary_employee", "proxy_employee", "manager_employee", "assignment_mode", "roster_auto_sync", "department", "node_kind"].forEach(field => dialog.set_df_property(field, "read_only", 1));
			dialog.set_df_property("assignment_mode", "description", "人员与任职性质已逐人确认，请通过页面上的核对任职按钮修改。");
		}
		dialog.show();
		// MultiSelectList creates an empty internal selection when first made
		// editable. Initialize it now so leaving auto mode retains the roster set.
		const assigned_control = dialog.fields_dict.assigned_employees;
		if (!assigned_control.has_input) assigned_control.make_input();
		assigned_control.set_value(config.node_kind === "岗位" || config.roster_subset ? config.assigned_employees || [] : []);
		toggle_auto_members();
		load_pool(false).then(() => {
			// Link defaults may fire asynchronous change handlers during construction.
			// Restore the saved selection once those initial scope loads have settled.
			if (dialog.get_value("department") === (config.department || "") && dialog.get_value("designation") === (config.designation || "")) {
				assigned_control.set_value(config.node_kind === "岗位" || config.roster_subset ? config.assigned_employees || [] : []);
			}
		});
	}

	manual_node_type(node_kind) {
		return { 管理层: "organization_management", 分管: "organization_supervisor", 室: "organization_office", 课: "organization_section", 组: "organization_group", 线: "organization_line", 岗位: "organization_position", 员工: "organization_person" }[node_kind] || "organization_node";
	}

	edit_manual_node(node_id = this.selected_node?.node_id) {
		const name = this.manual_node_name(node_id);
		if (!name) {
			frappe.msgprint(__("请先选择要编辑的组织节点。"));
			return;
		}
		frappe.db.get_doc("Organization Node", name).then((doc) => this.show_manual_node_dialog(doc));
	}

	delete_manual_node(node_id = this.selected_node?.node_id) {
		const name = this.manual_node_name(node_id);
		if (!name) return;
		frappe.confirm(__("删除此节点不会修改员工、部门或岗位资料。确认删除吗？"), () => {
			frappe
				.call({
					method: "hrms.hr.page.organizational_chart.organizational_chart.delete_manual_organization_node",
					args: { node_name: name, company: this.company },
					freeze: true,
					freeze_message: __("正在删除组织节点..."),
				})
				.then(() => {
					this.selected_node = null;
					frappe.show_alert({ message: __("组织节点已删除"), indicator: "green" });
					this.load_tree();
				});
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

	add_organization_node() {
		frappe.new_doc("Organization Node");
	}

	open_manual_version_list() {
		frappe.set_route("List", "Organization Structure Version");
	}

	open_manual_node_list() {
		frappe.set_route("List", "Organization Node");
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
			{
				fieldname: "hrms_org_manager",
				fieldtype: "Data",
				label: __("部门负责人"),
				description: __("可填写多位负责人，用顿号、逗号或换行分隔；每位人员仍以员工档案中的唯一正式职位显示。"),
				default: doc.hrms_org_manager,
			},
			{
				fieldname: "hrms_org_card_content",
				fieldtype: "Small Text",
				label: __("卡片说明"),
				description: __("仅覆盖此来源单元格对应原表卡片的补充说明，不改变原表层级。"),
				default: doc.hrms_org_card_content,
			},
			{ fieldname: "hrms_roster_assignable", fieldtype: "Check", label: __("允许花名册归属"), default: doc.hrms_roster_assignable },
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
								"将建立或调整 {0} 个组织节点，其中 {1} 个文件夹、{2} 个可用于花名册的节点。请输入“{3}”继续。",
								[
									summary.node_count || 0,
									summary.folder_count || 0,
									summary.roster_leaf_count || 0,
									data.confirmation_text || "",
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
									message: __("已同步 {0} 个组织节点。", [
										(result.created_departments || []).length + (result.updated_departments || []).length,
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

	preview_multiple_position_import() {
		frappe
			.call({
				method: "hrms.hr.page.organizational_chart.organizational_chart.preview_multiple_position_organization_import",
				args: { company: this.company },
				freeze: true,
				freeze_message: __("正在解析原表中的组织、岗位和职级标签..."),
			})
			.then((response) => {
				const data = response.message || {};
				const summary = data.summary || {};
				frappe.msgprint({
					title: __("多岗位初始导入预览"),
					indicator: "blue",
					message: `
						<p>${__("来源：{0} / {1}。本操作仅生成预览，不写入任何员工、部门或岗位数据。", [
							frappe.utils.escape_html(data.source_document || ""),
							frappe.utils.escape_html(data.source_sheet || ""),
						])}</p>
						<ul>
							<li>${__("组织节点候选：{0}", [summary.organization_node_count || 0])}</li>
							<li>${__("岗位节点候选：{0}", [summary.position_count || 0])}</li>
							<li>${__("非互斥职级标签候选：{0}", [summary.grade_tag_candidate_count || 0])}</li>
							<li>${__("需人工分类的职级行：{0}", [summary.unclassified_level_count || 0])}</li>
							<li>${__("需确认岗位的负责人/代理人卡片：{0}", [summary.manager_confirmation_count || 0])}</li>
							<li>${__("待映射人员：{0}", [summary.employee_mapping_count || 0])}</li>
						</ul>
						<p>${__("下一步会将这些候选保存为草稿组织版本，由人事确认岗位、主职和附职后再发布。")}</p>
					`,
					});
				});
	}

	create_multiple_position_draft() {
		frappe.prompt(
			[
				{
					fieldname: "confirmation",
					fieldtype: "Data",
					label: __("确认文字"),
					reqd: 1,
					description: __("请输入“建立多岗位草稿”。此操作只保存原表候选节点、岗位和职级标签，不会改动任何员工主职、部门或薪资考勤数据。"),
				},
			],
			(values) => {
				if (values.confirmation !== "建立多岗位草稿") {
					frappe.msgprint(__("确认文字不正确，未创建草稿。"));
					return;
				}
				frappe
					.call({
						method: "hrms.hr.page.organizational_chart.organizational_chart.create_multiple_position_organization_draft",
						args: { company: this.company },
						freeze: true,
						freeze_message: __("正在建立多岗位组织草稿..."),
					})
					.then((response) => {
						const result = response.message || {};
						frappe.show_alert({ message: result.message || __("多岗位组织草稿已建立"), indicator: "green" });
						this.load_tree();
					});
			},
			__("建立多岗位草稿"),
			__("建立草稿"),
		);
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
		return this.get_node_department(this.find_node(node_id) || node_id, this.selected_node?.node_type);
	}

	get_node_department(node_or_id, node_type = "") {
		if (node_or_id && typeof node_or_id === "object") {
			const node = node_or_id;
			node_type = node_or_id.node_type || node_type;
			node_or_id = node_or_id.node_id || "";
			if (node.department) return node.department;
			if (!["department", "employee_group"].includes(node_type)) return null;
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
