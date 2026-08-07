(function () {
	const YONGXIN_COMPANY = "永新";

	frappe.listview_settings["Department"] = {
		onload(listview) {
			setup_department_list_actions(listview);
		},
		refresh(listview) {
			setup_department_list_actions(listview);
		},
	};

	function setup_department_list_actions(listview) {
		if (!listview || !listview.page || listview.page.__hrms_department_actions_ready) return;
		listview.page.__hrms_department_actions_ready = true;
		attach_department_import_action(listview);
		const roles = frappe.user_roles || [];
		const isSystemManager = roles.includes("System Manager") || frappe.session.user === "Administrator";

		if (isSystemManager) {
			listview.page.add_inner_button(__("规范部门名称"), function () {
				show_department_name_normalisation_dialog(listview);
			});
		}

		listview.page.add_inner_button(__("预检部门层级"), function () {
			show_department_hierarchy_preview_dialog(listview);
		});

		listview.page.add_inner_button(__("核对职位层级"), function () {
			show_position_hierarchy_preview_dialog(listview);
		});

		listview.page.add_inner_button(__("快速编辑"), function () {
			const selected = get_selected_departments(listview);
			if (selected.length !== 1) {
				frappe.msgprint(__("请选择一个部门进行快速编辑。"));
				return;
			}
			show_department_quick_edit_dialog(listview, selected[0]);
		});

		listview.page.add_inner_button(__("批量删除部门"), function () {
			const selected = get_selected_departments(listview);
			if (!selected.length) {
				frappe.msgprint(__("请先勾选需要删除的部门。"));
				return;
			}
			show_department_bulk_delete_dialog(listview, selected);
		});
	}

	function attach_department_import_action(listview) {
		const add_action = () => {
			if (!window.hrmsFormImport?.addPageActions) return false;
			window.hrmsFormImport.addPageActions(
				listview.page,
				"org_structure",
				__("组织架构与编制"),
				__("导入组织架构"),
			);
			return true;
		};

		// The contextual importer is bundled globally.  Delay once only if Frappe
		// creates this ListView before the global asset has finished evaluating.
		if (!add_action()) setTimeout(add_action, 300);
	}

	function get_list_company(listview) {
		const filters = listview?.filter_area?.get?.() || [];
		const companyFilter = filters.find((filter) => filter?.[1] === "company" && filter?.[2] === "=");
		if (companyFilter?.[3]) return companyFilter[3];

		const contextCompany = window.hrmsCompanyContext?.getCurrentCompany?.();
		if (contextCompany) return contextCompany;

		return frappe.defaults.get_user_default?.("Company") || frappe.defaults.get_default("company") || YONGXIN_COMPANY;
	}

	function show_department_hierarchy_preview_dialog(listview) {
		const dialog = new frappe.ui.Dialog({
			title: __("部门层级预检"),
			fields: [
				{
					fieldname: "company",
					fieldtype: "Link",
					options: "Company",
					label: __("公司"),
					reqd: 1,
					default: get_list_company(listview),
				},
				{ fieldname: "preview", fieldtype: "HTML" },
			],
		});

		const renderPreview = () => {
			const company = dialog.get_value("company");
			const wrapper = dialog.fields_dict.preview.$wrapper;
			if (!company) {
				wrapper.html(`<p class="text-muted">${__("请选择公司后进行预检。")}</p>`);
				return;
			}
			wrapper.html(`<p class="text-muted">${__("正在按组织架构表核对部门上下级关系，不会修改数据...")}</p>`);
			frappe
				.call({
					method: "hrms.hr.page.organizational_chart.organizational_chart.preview_yongxin_department_hierarchy",
					args: { company },
				})
				.then((r) => wrapper.html(render_department_hierarchy_preview(r.message || {})))
				.catch(() => wrapper.html(`<p class="text-danger">${__("部门层级预检失败，请刷新后重试。")}</p>`));
		};

		dialog.fields_dict.company.df.change = renderPreview;
		dialog.show();
		dialog.set_value("company", get_list_company(listview));
		renderPreview();
	}

	function render_department_hierarchy_preview(preview) {
		const summary = preview.summary || {};
		const rows = (preview.rows || []).map((row) => `
			<tr>
				<td>${frappe.utils.escape_html(row.node_type === "team" ? __("组") : __("部门"))}</td>
				<td><strong>${frappe.utils.escape_html(row.department_name || "")}</strong>${row.management_path ? `<small class="d-block text-muted">${frappe.utils.escape_html(row.management_path)}</small>` : ""}</td>
				<td>${frappe.utils.escape_html(row.current_parent || "-")}</td>
				<td>${frappe.utils.escape_html(row.expected_parent || "-")}</td>
				<td>${frappe.utils.escape_html(row.status_label || "")}</td>
				<td>${frappe.utils.escape_html(row.message || "")}</td>
			</tr>`);
		return `
			<div class="alert alert-info">${frappe.utils.escape_html(
				__("预检模式：仅比较当前部门与 Q2 组织架构表，不会创建部门、修改上级部门或迁移员工。"),
			)}</div>
			<div class="mb-2"><strong>${frappe.utils.escape_html(preview.root_label || "永新（公司根节点）")}</strong></div>
			<div class="mb-3 text-muted">${__("已匹配 {0} 项；待调整 {1} 项；待创建 {2} 项；需确认 {3} 项；未纳入架构表 {4} 项。", [
				summary.aligned_count || 0,
				summary.needs_update_count || 0,
				summary.needs_create_count || 0,
				summary.ambiguous_count || 0,
				summary.unmapped_count || 0,
			])}</div>
			<div style="max-height: 480px; overflow: auto;">
				<table class="table table-bordered table-sm">
					<thead><tr><th>${__("类型")}</th><th>${__("架构节点")}</th><th>${__("当前上级")}</th><th>${__("建议上级")}</th><th>${__("结果")}</th><th>${__("说明")}</th></tr></thead>
					<tbody>${rows.join("") || `<tr><td colspan="6" class="text-muted">${__("未找到可预检的部门。")}</td></tr>`}</tbody>
				</table>
			</div>`;
	}

	function show_position_hierarchy_preview_dialog(listview) {
		const dialog = new frappe.ui.Dialog({
			title: __("职位层级核对"),
			fields: [
				{
					fieldname: "company",
					fieldtype: "Link",
					options: "Company",
					label: __("公司"),
					reqd: 1,
					default: get_list_company(listview),
				},
				{ fieldname: "preview", fieldtype: "HTML" },
			],
		});

		const renderPreview = () => {
			const company = dialog.get_value("company");
			const wrapper = dialog.fields_dict.preview.$wrapper;
			if (!company) {
				wrapper.html(`<p class="text-muted">${__("请选择公司后进行核对。")}</p>`);
				return;
			}
			wrapper.html(`<p class="text-muted">${__("正在按组织架构表核对岗位与职级关系，不会修改数据...")}</p>`);
			frappe
				.call({
					method: "hrms.hr.page.organizational_chart.organizational_chart.preview_yongxin_position_hierarchy",
					args: { company },
				})
				.then((r) => wrapper.html(render_position_hierarchy_preview(r.message || {})))
				.catch(() => wrapper.html(`<p class="text-danger">${__("职位层级核对失败，请刷新后重试。")}</p>`));
		};

		dialog.fields_dict.company.df.change = renderPreview;
		dialog.show();
		dialog.set_value("company", get_list_company(listview));
		renderPreview();
	}

	function render_position_hierarchy_preview(preview) {
		const summary = preview.summary || {};
		const rows = (preview.rows || []).map((row) => {
			const matchedPeople = (row.matched_employees || [])
				.map((person) => `${frappe.utils.escape_html(person.name || "")} · ${frappe.utils.escape_html(person.designation || __("未设置岗位"))} · ${frappe.utils.escape_html(person.grade || __("未设置职级"))}`)
				.join("<br>");
			return `<tr>
				<td><strong>${frappe.utils.escape_html(row.department || "")}</strong></td>
				<td>${frappe.utils.escape_html(row.expected_designation || row.expected_level || "")}</td>
				<td>${frappe.utils.escape_html(row.parent_designation || "-")}</td>
				<td>${matchedPeople || `<span class="text-muted">${__("未匹配")}</span>`}</td>
				<td>${frappe.utils.escape_html(row.status_label || "")}</td>
				<td>${frappe.utils.escape_html(row.message || "")}</td>
			</tr>`;
		});
		return `
			<div class="alert alert-info">${frappe.utils.escape_html(
				__("核对模式：仅比较 Q2 组织架构表、当前部门、岗位与职级，不会修改部门、员工、职级或岗位。"),
			)}</div>
			<div class="mb-3 text-muted">${__("岗位名称已匹配 {0} 项；仅职位层级匹配 {1} 项；缺少职位层级 {2} 项；缺少或待确认部门 {3} 项；未设置职级员工 {4} 人。", [
				summary.aligned_count || 0,
				summary.level_only_count || 0,
				summary.missing_position_count || 0,
				summary.missing_department_count || 0,
				summary.missing_grade_count || 0,
			])}</div>
			<div style="max-height: 480px; overflow: auto;">
				<table class="table table-bordered table-sm">
					<thead><tr><th>${__("部门")}</th><th>${__("组织图职位")}</th><th>${__("上级职位")}</th><th>${__("当前匹配员工 · 岗位 · 职级")}</th><th>${__("结果")}</th><th>${__("说明")}</th></tr></thead>
					<tbody>${rows.join("") || `<tr><td colspan="6" class="text-muted">${__("未找到可核对的职位。")}</td></tr>`}</tbody>
				</table>
			</div>`;
	}

	function show_department_name_normalisation_dialog(listview) {
		let latestPlan = null;
		const dialog = new frappe.ui.Dialog({
			title: __("规范部门正式名称"),
			fields: [
				{
					fieldname: "company",
					fieldtype: "Link",
					options: "Company",
					label: __("公司"),
					reqd: 1,
					default: get_list_company(listview),
				},
				{
					fieldname: "preview",
					fieldtype: "HTML",
				},
				{
					fieldname: "confirmation",
					fieldtype: "Data",
					label: __("确认文字"),
					description: __("预检通过后，输入“确认规范部门名称”才能执行。"),
				},
			],
			primary_action_label: __("执行正式重命名"),
			primary_action(values) {
				if (!latestPlan?.can_execute) {
					frappe.msgprint(__("当前预检未通过，不能执行重命名。"));
					return;
				}
				frappe
					.call({
						method: "hrms.api.department_identity.normalise_department_names",
						args: { company: values.company, confirmation: values.confirmation },
						freeze: true,
						freeze_message: __("正在更新部门名称及关联字段..."),
					})
					.then((r) => {
						dialog.hide();
						frappe.show_alert({ message: r.message?.message || __("部门名称已规范化"), indicator: "green" });
						listview.refresh();
					});
			},
		});

		const renderPreview = () => {
			const company = dialog.get_value("company");
			const wrapper = dialog.fields_dict.preview.$wrapper;
			if (!company) {
				wrapper.html(`<p class="text-muted">${__("请选择公司后进行预检。")}</p>`);
				return;
			}

			wrapper.html(`<p class="text-muted">${__("正在预检部门、员工和上级部门关联...")}</p>`);
			frappe
				.call({
					method: "hrms.api.department_identity.preview_department_name_normalisation",
					args: { company },
				})
				.then((r) => {
					latestPlan = r.message || {};
					const conflicts = latestPlan.conflicts || [];
					const samples = (latestPlan.changes || [])
						.slice(0, 8)
						.map(
							(row) =>
								`<li><code>${frappe.utils.escape_html(row.name)}</code> → <strong>${frappe.utils.escape_html(
									row.target_name,
								)}</strong></li>`,
						)
						.join("");
					const conflictHtml = conflicts.length
						? `<div class="alert alert-danger mt-3"><strong>${__("发现冲突，未允许执行")}</strong><ul>${conflicts
								.map((item) => `<li>${frappe.utils.escape_html(item.message)}</li>`)
								.join("")}</ul></div>`
						: `<div class="alert alert-success mt-3">${__("预检通过：可以安全执行正式重命名。")}</div>`;

					wrapper.html(`
						<div class="small text-muted">${frappe.utils.escape_html(latestPlan.note || "")}</div>
						<div class="mt-2">${__("需重命名：{0} 个；保持不变：{1} 个；受影响员工：{2} 人；子部门链接：{3} 条。", [
							latestPlan.rename_count || 0,
							latestPlan.unchanged_count || 0,
							latestPlan.linked_records?.employees || 0,
							latestPlan.linked_records?.child_departments || 0,
						])}</div>
						${samples ? `<ul class="mt-2">${samples}</ul>` : ""}
						${conflictHtml}
					`);
					dialog.get_primary_btn().prop("disabled", !latestPlan.can_execute);
				})
				.catch(() => {
					latestPlan = null;
					dialog.get_primary_btn().prop("disabled", true);
				});
		};

		dialog.fields_dict.company.df.change = renderPreview;
		dialog.show();
		renderPreview();
	}

	function get_selected_departments(listview) {
		const checked = listview.get_checked_items ? listview.get_checked_items() : [];
		return checked
			.map((item) => (typeof item === "string" ? item : item.name))
			.filter(Boolean);
	}

	function show_department_quick_edit_dialog(listview, department) {
		frappe.db.get_doc("Department", department).then((doc) => {
			const dialog = new frappe.ui.Dialog({
				title: __("快速编辑部门"),
				fields: [
					{
						fieldname: "department_name",
						fieldtype: "Data",
						label: __("部门名称"),
						reqd: 1,
						default: doc.department_name,
					},
					{
						fieldname: "company",
						fieldtype: "Link",
						options: "Company",
						default: doc.company || YONGXIN_COMPANY,
						hidden: 1,
					},
					{
						fieldname: "parent_department",
						fieldtype: "Link",
						options: "Department",
						label: __("上级部门"),
						default: doc.parent_department,
						get_query() {
							return {
								filters: {
									name: ["!=", department],
									company: dialog.get_value("company") || doc.company || YONGXIN_COMPANY,
								},
							};
							},
						},
					],
				primary_action_label: __("保存"),
				primary_action(values) {
					frappe
						.call({
							method: "hrms.hr.page.organizational_chart.organizational_chart.update_department_fields",
							args: {
								department,
								values: JSON.stringify(values),
							},
							freeze: true,
							freeze_message: __("正在保存部门..."),
						})
						.then(() => {
							dialog.hide();
							frappe.show_alert({ message: __("部门已更新"), indicator: "green" });
							frappe.set_route("List", "Department");
							listview.refresh();
						});
				},
			});
			dialog.show();
		});
	}

	function show_department_bulk_delete_dialog(listview, departments) {
		frappe.confirm(
			__("确定删除已选择的 {0} 个部门？有关联员工或子部门的部门会被跳过并显示原因。", [departments.length]),
			() => {
				frappe
					.call({
						method: "hrms.hr.page.organizational_chart.organizational_chart.delete_departments",
						args: { departments: JSON.stringify(departments) },
						freeze: true,
						freeze_message: __("正在删除部门..."),
					})
					.then((r) => {
						const result = r.message || {};
						frappe.set_route("List", "Department");
						listview.refresh();
						if (result.failed_count) {
							frappe.msgprint({
								title: __("部分部门未删除"),
								indicator: "orange",
								message: `
									<p>${__("已删除 {0} 个，未删除 {1} 个。", [result.deleted_count || 0, result.failed_count || 0])}</p>
									<ul>${(result.failed || [])
										.map((row) => `<li>${frappe.utils.escape_html(row.name)}：${frappe.utils.escape_html(row.message)}</li>`)
										.join("")}</ul>
								`,
							});
							return;
						}
						frappe.show_alert({
							message: __("已删除 {0} 个部门", [result.deleted_count || 0]),
							indicator: "green",
						});
					});
			},
		);
	}
})();
