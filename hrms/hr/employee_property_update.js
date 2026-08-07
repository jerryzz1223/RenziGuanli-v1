frappe.ui.form.on(cur_frm.doctype, {
	setup: function (frm) {
		frm.set_query("employee", function () {
			return {
				filters: {
					status: "Active",
				},
			};
		});
	},

	onload: function (frm) {
		if (frm.doc.__islocal && !frm.doc.amended_from) frm.trigger("clear_property_table");
	},

	employee: function (frm) {
		frm.trigger("clear_property_table");
	},

	clear_property_table: function (frm) {
		let table = frm.doctype == "Employee Promotion" ? "promotion_details" : "transfer_details";
		frm.clear_table(table);
		frm.refresh_field(table);
		render_business_change_action(frm, table);
	},

	refresh: function (frm) {
		let table;
		if (frm.doctype == "Employee Promotion") {
			table = "promotion_details";
		} else if (frm.doctype == "Employee Transfer") {
			table = "transfer_details";
		}

		if (!table) return;

		frm.events.setup_employee_property_button(frm, table);
	},

	setup_employee_property_button: function (frm, table) {
		const button_label = frm.doctype === "Employee Transfer" ? __("添加变更项目") : __("添加调整项目");
		const open_property_dialog = () => {
			const use_inline_editor =
				frm.doctype === "Employee Transfer" && frm.__hrms_inline_property_selection;
			if (!frm.doc.employee && !use_inline_editor) {
				frappe.msgprint(__("请先输入并匹配员工工号。"));
				return;
			}

			const allowed_fields = [];
			const exclude_fields = [
				"naming_series",
				"employee",
				"first_name",
				"middle_name",
				"last_name",
				"marital_status",
				"ctc",
				"employee_name",
				"status",
				"image",
				"gender",
				"date_of_birth",
				"date_of_joining",
				"lft",
				"rgt",
				"old_parent",
			];

			const exclude_field_types = [
				"HTML",
				"Section Break",
				"Column Break",
				"Button",
				"Read Only",
				"Tab Break",
				"Table",
			];

			frappe.model.with_doctype("Employee", () => {
				const field_label_map = {};
				const field_label_overrides = frm.__hrms_employee_property_labels || {};
				const allowed_fieldnames = frm.__hrms_employee_property_fields || [];
				frappe.get_meta("Employee").fields.forEach((d) => {
					// Fieldnames are implementation details. HR operators should only see business labels.
					field_label_map[d.fieldname] = field_label_overrides[d.fieldname] || __(d.label, null, d.parent);
					if (
						!exclude_field_types.includes(d.fieldtype) &&
						!exclude_fields.includes(d.fieldname) &&
						!d.hidden &&
						!d.read_only &&
						(!allowed_fieldnames.length || allowed_fieldnames.includes(d.fieldname))
					) {
						allowed_fields.push({
							label: field_label_map[d.fieldname],
							value: d.fieldname,
						});
					}
				});

				if (frm.doctype === "Employee Transfer" && frm.__hrms_inline_property_selection) {
					setup_transfer_property_editor(frm, table, allowed_fields);
					return;
				}

				show_dialog(frm, table, allowed_fields);
			});
		};

		if (frm.doctype === "Employee Transfer" && frm.__hrms_inline_property_selection) {
			open_property_dialog();
			return;
		}

		setup_business_change_action(frm, table, button_label, open_property_dialog);
	},
});

var ensure_business_change_styles = function () {
	if (document.getElementById("hrms-business-change-styles")) return;

	$("<style>", { id: "hrms-business-change-styles" })
		.text(`
			.hrms-business-change-action {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 16px;
				padding: 12px 14px;
				border: 1px solid var(--border-color);
				border-radius: 6px;
				background: var(--subtle-fg);
			}
			.hrms-business-change-action__copy {
				display: grid;
				gap: 3px;
			}
			.hrms-business-change-action__copy strong {
				font-size: var(--text-md);
				font-weight: 600;
			}
			.hrms-business-change-action__copy small {
				color: var(--text-muted);
			}
			.hrms-business-change-list {
				margin-top: 10px;
				border: 1px solid var(--border-color);
				border-radius: 6px;
				overflow: hidden;
			}
			.hrms-business-change-list__row {
				display: grid;
				grid-template-columns: minmax(140px, 1.1fr) minmax(140px, 1fr) 24px minmax(140px, 1fr) 32px;
				align-items: center;
				gap: 10px;
				min-height: 42px;
				padding: 8px 12px;
				border-top: 1px solid var(--border-color);
			}
			.hrms-business-change-list__row:first-child { border-top: 0; }
			.hrms-business-change-list__row--heading {
				min-height: 36px;
				background: var(--subtle-fg);
				color: var(--text-muted);
				font-size: var(--text-sm);
			}
			.hrms-business-change-list__arrow {
				color: var(--text-muted);
				text-align: center;
			}
			.hrms-business-change-list__remove {
				width: 28px;
				height: 28px;
				padding: 0;
				font-size: 18px;
				line-height: 1;
			}
			.hrms-business-change-grid,
			.hrms-business-change-grid .grid-row-check,
			.hrms-business-change-grid .row-index,
			.hrms-business-change-grid .grid-field-setup,
			.hrms-business-change-grid .grid-buttons { display: none !important; }
			.hrms-transfer-property-editor {
				display: grid;
				gap: 14px;
				margin-bottom: 12px;
			}
			.hrms-transfer-property-picker {
				display: grid;
				gap: 8px;
			}
			.hrms-transfer-property-picker__title {
				font-weight: 600;
			}
			.hrms-transfer-property-picker__hint {
				color: var(--text-muted);
				font-size: var(--text-sm);
			}
			.hrms-transfer-property-cards {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
				gap: 8px;
			}
			.hrms-transfer-property-card {
				display: grid;
				gap: 4px;
				min-height: 68px;
				padding: 10px 12px;
				border: 1px solid var(--border-color);
				border-radius: 6px;
				background: var(--card-bg);
				text-align: left;
				transition: border-color 120ms ease, background-color 120ms ease;
			}
			.hrms-transfer-property-card:hover {
				border-color: var(--primary);
				background: var(--subtle-fg);
			}
			.hrms-transfer-property-card strong { font-weight: 600; }
			.hrms-transfer-property-card small {
				color: var(--text-muted);
				line-height: 1.4;
			}
			.hrms-transfer-property-editor__empty {
				padding: 12px 14px;
				border: 1px dashed var(--border-color);
				border-radius: 6px;
				color: var(--text-muted);
			}
			.hrms-transfer-property-editors {
				display: grid;
				gap: 10px;
			}
			.hrms-transfer-property-panel {
				display: grid;
				gap: 10px;
				padding: 12px 14px;
				border: 1px solid var(--border-color);
				border-radius: 6px;
				background: var(--card-bg);
			}
			.hrms-transfer-property-panel__header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 12px;
			}
			.hrms-transfer-property-panel__header strong { font-weight: 600; }
			.hrms-transfer-property-panel__fields {
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				gap: 12px;
			}
			.hrms-transfer-property-field {
				display: grid;
				grid-template-columns: minmax(110px, .8fr) minmax(180px, 1.4fr);
				align-items: end;
				gap: 10px;
			}
			.hrms-transfer-property-current {
				display: grid;
				gap: 4px;
				min-width: 0;
			}
			.hrms-transfer-property-current small { color: var(--text-muted); }
			.hrms-transfer-property-current span {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.hrms-transfer-property-target .form-group { margin-bottom: 0; }
			.hrms-transfer-property-target .control-label { padding-top: 0; }
			@media (max-width: 720px) {
				.hrms-business-change-action { align-items: stretch; flex-direction: column; }
				.hrms-business-change-list__row {
					grid-template-columns: 1fr;
					gap: 4px;
				}
				.hrms-business-change-list__row--heading { display: none; }
				.hrms-business-change-list__arrow { text-align: left; }
				.hrms-transfer-property-panel__fields { grid-template-columns: 1fr; }
				.hrms-transfer-property-field { grid-template-columns: 1fr; }
			}
		`)
		.appendTo(document.head);
};

var escape_business_change_value = function (value) {
	const display_value = value === null || value === undefined || value === "" ? "-" : value;
	return $("<div>").text(display_value).html();
};

var setup_business_change_action = function (frm, table, button_label, on_click) {
	const field = frm.fields_dict[table];
	if (!field || !field.grid) return;

	ensure_business_change_styles();
	field.grid.wrapper.addClass("hrms-business-change-grid");

	let $action = field.$wrapper.find(`.hrms-business-change-action[data-table="${table}"]`);
	if (!$action.length) {
		$action = $(`
			<div class="hrms-business-change-action" data-table="${table}">
				<div class="hrms-business-change-action__copy">
					<strong data-change-summary></strong>
					<small>${__("只添加本次实际发生变化的项目，提交后会同步员工档案并生成任职记录。")}</small>
				</div>
				<button type="button" class="btn btn-primary btn-sm" data-add-business-change>${button_label}</button>
			</div>
			<div class="hrms-business-change-list" data-table="${table}" data-business-change-list></div>
		`);
		field.grid.wrapper.before($action);
	}

	$action
		.find("[data-add-business-change]")
		.text(button_label)
		.toggle(frm.doc.docstatus === 0)
		.off("click.hrms-business-change")
		.on("click.hrms-business-change", on_click);

	frm.__hrms_business_change_actions = frm.__hrms_business_change_actions || {};
	frm.__hrms_business_change_actions[table] = { button_label, on_click };
	render_business_change_action(frm, table);
};

var render_business_change_action = function (frm, table) {
	const field = frm.fields_dict[table];
	if (!field || !field.grid) return;

	field.grid.wrapper.addClass("hrms-business-change-grid");
	const rows = (frm.doc[table] || []).filter((row) => !row.__deleted);
	const $action = field.$wrapper.find(`.hrms-business-change-action[data-table="${table}"]`);
	if (!$action.length) return;

	$action
		.find("[data-change-summary]")
		.text(rows.length ? __("已添加 {0} 项变更", [rows.length]) : __("尚未添加变更项目"));

	const $list = field.$wrapper.find(`[data-business-change-list][data-table="${table}"]`);
	if (!rows.length) {
		$list.hide().empty();
		return;
	}

	const can_edit = frm.doc.docstatus === 0;
	$list
		.html(`
			<div class="hrms-business-change-list__row hrms-business-change-list__row--heading">
				<span>${__("变更项目")}</span><span>${__("变更前")}</span><span></span><span>${__("变更后")}</span><span></span>
			</div>
			${rows
				.map(
					(row) => `
						<div class="hrms-business-change-list__row">
							<strong>${escape_business_change_value(row.property)}</strong>
							<span>${escape_business_change_value(row.current)}</span>
							<span class="hrms-business-change-list__arrow">→</span>
							<span>${escape_business_change_value(row.new)}</span>
							${
								can_edit
									? `<button type="button" class="btn btn-default btn-xs hrms-business-change-list__remove" data-remove-business-change="${escape_business_change_value(row.name)}" title="${__("移除")}">×</button>`
									: "<span></span>"
							}
						</div>
					`
				)
				.join("")}
		`)
		.show()
		.off("click.hrms-business-change-remove")
		.on("click.hrms-business-change-remove", "[data-remove-business-change]", function () {
			const row_name = $(this).attr("data-remove-business-change");
			const row = (frm.doc[table] || []).find((item) => item.name === row_name);
			if (!row || frm.doc.docstatus !== 0) return;

			frappe.model.clear_doc(row.doctype, row.name);
			frm.refresh_field(table);
			frm.dirty();
			window.setTimeout(() => {
				const action = frm.__hrms_business_change_actions?.[table];
				if (action) setup_business_change_action(frm, table, action.button_label, action.on_click);
			}, 0);
		});
};

var get_transfer_detail = function (frm, table, fieldname) {
	return (frm.doc[table] || []).find((row) => !row.__deleted && row.fieldname === fieldname);
};

var get_transfer_target_department = function (frm, table) {
	return get_transfer_detail(frm, table, "department")?.new || frm.doc.department || "";
};

var get_transfer_property_card_config = function (field) {
	const descriptions = {
		department: __("更换部门，并同时选择该部门下的新岗位"),
		designation: __("部门不变，仅调整员工岗位"),
		grade: __("调整员工职级"),
		reports_to: __("调整直属上级"),
		employment_type: __("调整全职、实习、外包等工作性质"),
		custom_direct_indirect: __("调整直接或间接人员属性"),
		custom_is_confirmed: __("调整员工转正状态"),
	};

	return {
		...field,
		label: field.value === "department" ? __("部门与岗位") : field.label,
		description: descriptions[field.value] || __("调整{0}", [field.label]),
	};
};

var setup_transfer_property_editor = function (frm, table, allowed_fields) {
	const field = frm.fields_dict[table];
	if (!field || !field.grid) return;

	ensure_business_change_styles();
	field.grid.wrapper.addClass("hrms-business-change-grid");
	field.$wrapper.find(`.hrms-business-change-action[data-table="${table}"]`).remove();
	field.$wrapper.find(`[data-business-change-list][data-table="${table}"]`).remove();

	let $editor = field.$wrapper.find(`.hrms-transfer-property-editor[data-table="${table}"]`);
	if (!$editor.length) {
		$editor = $(`<div class="hrms-transfer-property-editor" data-table="${table}"></div>`);
		field.grid.wrapper.before($editor);
	}

	frm.__hrms_transfer_property_fields = allowed_fields.map(get_transfer_property_card_config);
	render_transfer_property_editor(frm, table);
};

var render_transfer_property_editor = function (frm, table) {
	const field = frm.fields_dict[table];
	if (!field || !field.grid) return;

	const $editor = field.$wrapper.find(`.hrms-transfer-property-editor[data-table="${table}"]`);
	if (!$editor.length) return;

	const rows = (frm.doc[table] || []).filter((row) => !row.__deleted);
	const selected = new Set(rows.map((row) => row.fieldname));
	const fields = frm.__hrms_transfer_property_fields || [];
	if (
		frm.doc.docstatus === 0 &&
		frm.doc.employee &&
		selected.has("department") &&
		!selected.has("designation") &&
		!frm.__hrms_adding_required_designation
	) {
		frm.__hrms_adding_required_designation = true;
		add_inline_transfer_property(frm, table, "designation").finally(() => {
			frm.__hrms_adding_required_designation = false;
		});
		return;
	}
	const available = fields.filter((item) => {
		if (item.value === "department") return !selected.has("department");
		if (item.value === "designation") return !selected.has("designation") && !selected.has("department");
		return !selected.has(item.value);
	});
	const can_edit = frm.doc.docstatus === 0;

	$editor.html(`
		${
			can_edit && available.length
				? `<div class="hrms-transfer-property-picker">
					<div>
						<div class="hrms-transfer-property-picker__title">${__("选择变更项目")}</div>
						<div class="hrms-transfer-property-picker__hint">${__("点击卡片后直接在下方填写目标值；已选择的项目不会重复显示。")}</div>
					</div>
					<div class="hrms-transfer-property-cards">
						${available
							.map(
								(item) => `<button type="button" class="hrms-transfer-property-card" data-add-transfer-property="${escape_business_change_value(item.value)}">
									<strong>${escape_business_change_value(item.label)}</strong>
									<small>${escape_business_change_value(item.description)}</small>
								</button>`
							)
							.join("")}
					</div>
				</div>`
				: ""
		}
		<div class="hrms-transfer-property-editors" data-transfer-property-editors></div>
	`);

	$editor
		.off("click.hrms-transfer-property-add")
		.on("click.hrms-transfer-property-add", "[data-add-transfer-property]", function () {
			add_inline_transfer_property(frm, table, $(this).attr("data-add-transfer-property"));
		});

	render_transfer_property_panels(frm, table, rows, can_edit);
};

var add_inline_transfer_property = function (frm, table, fieldname) {
	if (!frm.doc.employee) {
		frappe.msgprint(__("请先输入并匹配员工工号。"));
		return Promise.resolve();
	}

	const fields_to_add = fieldname === "department" ? ["department", "designation"] : [fieldname];
	const missing_fields = fields_to_add.filter((name) => !get_transfer_detail(frm, table, name));
	if (!missing_fields.length) return Promise.resolve();

	return Promise.all(
		missing_fields.map(
			(name) =>
				new Promise((resolve, reject) => {
					frappe.call({
						method: "hrms.hr.utils.get_employee_field_property",
						args: { employee: frm.doc.employee, fieldname: name },
						callback: (response) => (response.message ? resolve({ name, ...response.message }) : reject()),
						error: reject,
					});
				})
		)
	)
		.then((properties) => {
			properties.forEach((property) => {
				frm.add_child(table, {
					fieldname: property.name,
					property:
						(frm.__hrms_employee_property_labels || {})[property.name] || property.label,
					current: property.value,
					new: "",
				});
			});
			frm.refresh_field(table);
			frm.dirty();
			render_transfer_property_editor(frm, table);
		})
		.catch(() => frappe.msgprint(__("读取员工当前任职信息失败，请刷新后重试。")));
};

var get_transfer_property_groups = function (rows) {
	const groups = [];
	const consumed = new Set();
	const department = rows.find((row) => row.fieldname === "department");
	const designation = rows.find((row) => row.fieldname === "designation");

	if (department) {
		groups.push({ key: "department", label: __("部门与岗位"), rows: [department, designation].filter(Boolean) });
		consumed.add("department");
		if (designation) consumed.add("designation");
	}

	rows.forEach((row) => {
		if (consumed.has(row.fieldname)) return;
		groups.push({ key: row.fieldname, label: row.property, rows: [row] });
	});
	return groups;
};

var render_transfer_property_panels = function (frm, table, rows, can_edit) {
	const $container = frm.fields_dict[table].$wrapper.find("[data-transfer-property-editors]");
	if (!rows.length) {
		$container.html(`<div class="hrms-transfer-property-editor__empty">${__("请选择本次实际发生变化的项目。")}</div>`);
		return;
	}

	get_transfer_property_groups(rows).forEach((group) => {
		const $panel = $(`
			<div class="hrms-transfer-property-panel" data-transfer-property-group="${escape_business_change_value(group.key)}">
				<div class="hrms-transfer-property-panel__header">
					<strong>${escape_business_change_value(group.label)}</strong>
					${can_edit ? `<button type="button" class="btn btn-default btn-xs" data-remove-transfer-property="${escape_business_change_value(group.key)}">${__("移除")}</button>` : ""}
				</div>
				<div class="hrms-transfer-property-panel__fields"></div>
			</div>
		`);
		$container.append($panel);

		group.rows.forEach((row) => render_transfer_property_control(frm, table, row, $panel, can_edit));
	});

	$container
		.off("click.hrms-transfer-property-remove")
		.on("click.hrms-transfer-property-remove", "[data-remove-transfer-property]", function () {
			if (!can_edit) return;
			const key = $(this).attr("data-remove-transfer-property");
			const fieldnames = key === "department" ? ["department", "designation"] : [key];
			(frm.doc[table] || [])
				.filter((row) => fieldnames.includes(row.fieldname))
				.forEach((row) => frappe.model.clear_doc(row.doctype, row.name));
			frm.refresh_field(table);
			frm.dirty();
			render_transfer_property_editor(frm, table);
		});
};

var render_transfer_employee_business_control = function (frm, table, row, $field) {
	const $target = $field.find(".hrms-transfer-property-target");
	const list_id = `hrms-transfer-manager-${row.name || Date.now()}`;
	const $input = $(
		`<input type="text" class="form-control" list="${list_id}" placeholder="${__("输入工号或姓名")}">`
	);
	const $list = $(`<datalist id="${list_id}"></datalist>`);

	$target.empty().append($input, $list);
	frappe.call({
		method: "hrms.hr.doctype.employee_transfer.employee_transfer.get_employee_business_options",
		args: { company: frm.doc.company || "" },
		callback(response) {
			const employees = response.message || [];
			const display_name = (employee) =>
				[employee.employee_code, employee.employee_name].filter(Boolean).join(" · ");
			const selected = employees.find((employee) => employee.name === row.new);
			if (selected) $input.val(display_name(selected));

			employees.forEach((employee) => {
				$list.append($("<option>").attr("value", display_name(employee)));
			});

			$input.on("change", function () {
				const input_value = $(this).val().trim();
				const selected_employee = employees.find(
					(employee) =>
						display_name(employee) === input_value ||
						employee.employee_code === input_value ||
						employee.employee_name === input_value
				);
				if (!selected_employee) {
					frappe.msgprint(__("请选择有效的员工工号或姓名。"));
					return;
				}
				$input.val(display_name(selected_employee));
				frappe.model.set_value(row.doctype, row.name, "new", selected_employee.name);
			});
		},
	});
};

var render_transfer_property_control = function (frm, table, row, $panel, can_edit) {
	const employee_field =
		frappe.meta.get_docfield("Employee", row.fieldname) ||
		(frappe.get_meta("Employee").fields || []).find((field) => field.fieldname === row.fieldname);
	if (!employee_field) return;

	const $field = $(`
		<div class="hrms-transfer-property-field">
			<div class="hrms-transfer-property-current">
				<small>${escape_business_change_value(row.property)} · ${__("变更前")}</small>
				<span title="${escape_business_change_value(row.current)}">${escape_business_change_value(row.current)}</span>
			</div>
			<div class="hrms-transfer-property-target"></div>
		</div>
	`);
	$panel.find(".hrms-transfer-property-panel__fields").append($field);

	if (!can_edit) {
		$field.find(".hrms-transfer-property-target").html(`
			<div class="hrms-transfer-property-current">
				<small>${__("变更后")}</small>
				<span>${escape_business_change_value(row.new)}</span>
			</div>
		`);
		return;
	}

	if (row.fieldname === "reports_to") {
		render_transfer_employee_business_control(frm, table, row, $field);
		return;
	}

	let control;
	const handle_change = () => {
		if (row.__hrms_setting_transfer_value) return;

		const value = control.get_value();
		if ((row.new || "") === (value || "")) return;

		frappe.model.set_value(row.doctype, row.name, "new", value);
		if (row.fieldname !== "department") return;

		// A designation belongs to a department. Preserve the active Link control
		// and only clear its stale selection when its department changes.
		const designation = get_transfer_detail(frm, table, "designation");
		if (!designation || !designation.new) return;

		frappe.model.set_value(designation.doctype, designation.name, "new", "");
		const designation_control = designation.__hrms_transfer_control;
		if (!designation_control) return;

		designation.__hrms_setting_transfer_value = true;
		designation_control.set_value("");
		designation.__hrms_setting_transfer_value = false;
	};

	control = frappe.ui.form.make_control({
		parent: $field.find(".hrms-transfer-property-target"),
		df: {
			fieldname: `target_${row.name}`,
			fieldtype: employee_field.fieldtype,
			options: employee_field.options || "",
			label: __("变更后"),
			reqd: 1,
			change: handle_change,
		},
		render_input: true,
	});
	row.__hrms_transfer_control = control;

	if (row.fieldname === "designation") {
		control.get_query = () => ({
			query: "hrms.hr.doctype.employee_transfer.employee_transfer.get_designations_for_department",
			filters: {
				department: get_transfer_target_department(frm, table),
				company: frm.doc.company,
			},
		});
	}

	row.__hrms_setting_transfer_value = true;
	control.set_value(row.new || "");
	row.__hrms_setting_transfer_value = false;
};

var show_dialog = function (frm, table, field_labels) {
	const is_transfer = frm.doctype === "Employee Transfer";
	var d = new frappe.ui.Dialog({
		title: is_transfer ? __("添加人事异动项目") : __("添加转正/晋升调整项目"),
		fields: [
			{
				fieldname: "property",
				label: __("选择变更项目"),
				fieldtype: "Autocomplete",
				options: field_labels,
			},
			{ fieldname: "current", fieldtype: "Data", label: __("变更前"), read_only: true },
			{ fieldname: "new_value", fieldtype: "Data", label: __("变更后") },
		],
		primary_action_label: is_transfer ? __("加入异动明细") : __("加入调整明细"),
		primary_action: () => {
			d.get_primary_btn().attr("disabled", true);
			if (d.data) {
				d.data.new = d.get_values().new_value;
				add_to_details(frm, d, table);
			}
		},
	});

	d.fields_dict["property"].df.onchange = () => {
		let property = d.get_values().property;
		d.data.fieldname = property;
		if (!property) {
			return;
		}
		frappe.call({
			method: "hrms.hr.utils.get_employee_field_property",
			args: { employee: frm.doc.employee, fieldname: property },
			callback: function (r) {
				if (r.message) {
					d.data.current = r.message.value;
						d.data.property =
							(frm.__hrms_employee_property_labels || {})[property] || r.message.label;

					d.set_value("current", r.message.value);
					render_dynamic_field(d, r.message.datatype, r.message.options, property);
					d.get_primary_btn().attr("disabled", false);
				}
			},
		});
	};
	d.get_primary_btn().attr("disabled", true);
	d.data = {};
	d.show();
};

var render_dynamic_field = function (d, fieldtype, options, fieldname) {
	d.data.new = null;
	var dynamic_field = frappe.ui.form.make_control({
		df: {
			fieldtype: fieldtype,
			fieldname: fieldname,
			options: options || "",
			label: __("变更后"),
		},
		parent: d.fields_dict.new_value.wrapper,
		only_input: false,
	});
	dynamic_field.make_input();
	d.replace_field("new_value", dynamic_field.df);
};

var add_to_details = function (frm, d, table) {
	let data = d.data;
	if (data.fieldname) {
		if (validate_duplicate(frm, table, data.fieldname)) {
			frappe.show_alert({ message: __("该变更项目已添加"), indicator: "orange" });
			return false;
		}
		if (data.current == data.new) {
			frappe.show_alert({ message: __("变更前后不能相同"), indicator: "orange" });
			d.get_primary_btn().attr("disabled", false);
			return false;
		}
		frm.add_child(table, {
			fieldname: data.fieldname,
			property: data.property,
			current: data.current,
			new: data.new,
		});
		frm.refresh_field(table);
		render_business_change_action(frm, table);

		d.fields_dict.new_value.$wrapper.html("");
		d.set_value("property", "");
		d.set_value("current", "");
		frappe.show_alert({ message: __("已加入变更明细"), indicator: "green" });
		d.data = {};
	} else {
		frappe.show_alert({ message: __("请选择需要变更的项目"), indicator: "red" });
	}
};

var validate_duplicate = function (frm, table, fieldname) {
	let duplicate = false;
	$.each(frm.doc[table], function (i, detail) {
		if (detail.fieldname === fieldname) {
			duplicate = true;
			return;
		}
	});
	return duplicate;
};
