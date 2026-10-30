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
						(!d.read_only || allowed_fieldnames.includes(d.fieldname)) &&
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
				--transfer-accent: #2459b8;
				--transfer-border: #cbd5e1;
				display: grid;
				gap: 20px;
				margin: 8px 0 20px;
				color: var(--text-color, #243247);
			}
			.hrms-transfer-property-picker {
				display: grid;
				gap: 14px;
				padding: 20px;
				border: 1px solid var(--transfer-border);
				border-radius: 12px;
				background: var(--subtle-fg, #f4f6f9);
			}
			.hrms-transfer-property-picker__title,
			.hrms-transfer-property-editors__title {
				font-size: 15px;
				font-weight: 650;
			}
			.hrms-transfer-property-picker__hint {
				margin-top: 5px;
				color: var(--text-muted, #526175);
				font-size: 13px;
				line-height: 1.6;
			}
			.hrms-transfer-property-cards {
				display: grid;
				grid-template-columns: repeat(3, minmax(0, 1fr));
				gap: 10px;
			}
			.hrms-transfer-property-card {
				display: grid;
				grid-template-columns: 1fr auto;
				align-content: start;
				gap: 8px 10px;
				min-height: 96px;
				padding: 14px 16px;
				border: 1px solid var(--transfer-border);
				border-radius: 9px;
				background: var(--card-bg, #fff);
				color: inherit;
				text-align: left;
				cursor: pointer;
				box-shadow: 0 2px 3px rgba(25, 43, 70, .04);
				transition: border-color 120ms ease, box-shadow 120ms ease;
			}
			.hrms-transfer-property-card:hover:not(:disabled) {
				border-color: var(--transfer-accent);
				box-shadow: 0 0 0 2px rgba(36, 89, 184, .12);
			}
			.hrms-transfer-property-card:focus-visible,
			.hrms-transfer-property-remove:focus-visible {
				outline: 3px solid #719aeb;
				outline-offset: 3px;
			}
			.hrms-transfer-property-card[aria-pressed="true"] {
				border-color: var(--transfer-accent);
				background: #edf4ff;
				color: #193f82;
				box-shadow: inset 0 0 0 1px var(--transfer-accent);
			}
			.hrms-transfer-property-card:disabled { cursor: default; opacity: 1; }
			.hrms-transfer-property-card strong { font-size: 14px; font-weight: 650; }
			.hrms-transfer-property-card small {
				grid-column: 1 / -1;
				color: var(--text-muted, #526175);
				line-height: 1.5;
			}
			.hrms-transfer-property-card__state {
				font-size: 12px;
				font-weight: 600;
				color: var(--transfer-accent);
			}
			.hrms-transfer-property-editor__empty {
				padding: 24px;
				border: 1px dashed var(--transfer-border);
				border-radius: 10px;
				color: var(--text-muted);
				text-align: center;
			}
			.hrms-transfer-property-editors { display: grid; gap: 14px; }
			.hrms-transfer-property-panel {
				display: grid;
				gap: 18px;
				padding: 20px;
				border: 1px solid var(--transfer-border);
				border-left: 4px solid var(--transfer-accent);
				border-radius: 10px;
				background: var(--card-bg, #fff);
				box-shadow: 0 3px 10px rgba(25, 43, 70, .05);
			}
			.hrms-transfer-property-panel:focus-within {
				box-shadow: 0 0 0 3px rgba(36, 89, 184, .12);
			}
			.hrms-transfer-property-panel__header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 12px;
				padding-bottom: 14px;
				border-bottom: 1px solid var(--border-color, #e2e8f0);
			}
			.hrms-transfer-property-panel__header strong { font-size: 15px; font-weight: 650; }
			.hrms-transfer-property-remove {
				padding: 6px 12px;
				border: 1px solid #d5a9ae;
				border-radius: 6px;
				background: var(--card-bg, #fff);
				color: #a12d3b;
				font-size: 12px;
				cursor: pointer;
			}
			.hrms-transfer-property-remove:disabled { opacity: .5; cursor: wait; }
			.hrms-transfer-property-remove:hover:not(:disabled) { background: #fff0f1; color: #8a1c2b; }
			.hrms-transfer-property-panel__fields {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
				gap: 20px;
			}
			.hrms-transfer-property-field {
				display: grid;
				grid-template-columns: minmax(95px, .8fr) 20px minmax(150px, 1.4fr);
				align-items: center;
				gap: 12px;
				min-width: 0;
			}
			.hrms-transfer-property-current { display: grid; gap: 6px; min-width: 0; }
			.hrms-transfer-property-current small { color: var(--text-muted); }
			.hrms-transfer-property-current span { overflow-wrap: anywhere; }
			.hrms-transfer-property-field__arrow { color: var(--transfer-accent); font-size: 20px; }
			.hrms-transfer-property-target { min-width: 0; }
			.hrms-transfer-property-target .form-group { margin-bottom: 0; }
			.hrms-transfer-property-target .control-label { padding-top: 0; }
			.hrms-transfer-property-target .form-control {
				min-height: 38px;
				border: 1px solid #9caec5;
				border-radius: 6px;
				background: var(--card-bg, #fff);
				color: var(--text-color, #243247);
			}
			.hrms-transfer-property-target .form-control[aria-invalid="true"] { border-color: #b33543; }
			.hrms-transfer-property-target .form-control:focus {
				border-color: var(--transfer-accent);
				box-shadow: 0 0 0 3px rgba(36, 89, 184, .15);
			}
			.hrms-transfer-property-target .awesomplete > ul {
				border: 1px solid var(--transfer-border);
				border-radius: 8px;
				background: var(--card-bg, #fff);
				box-shadow: 0 8px 24px rgba(25, 43, 70, .18);
				z-index: 100;
			}
			.hrms-transfer-property-target .awesomplete > ul > li[aria-selected="true"] {
				background: #edf4ff;
				color: #193f82;
			}
			.hrms-transfer-property-target .form-control:disabled { background: var(--subtle-fg); }
			@media (max-width: 420px) {
				.hrms-transfer-property-card { grid-template-columns: 1fr; gap: 6px; }
			}
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
				.hrms-transfer-property-field__arrow { display: none; }
				.hrms-transfer-property-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
				.hrms-transfer-property-picker, .hrms-transfer-property-panel { padding: 14px; }
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

			clear_transfer_control_state(frm, row);
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

var get_transfer_control_state = function (frm, row) {
	// UI controls contain DOM references and circular objects. Keep them on the
	// form instance, never on a child document that Frappe serializes on save.
	frm.__hrms_transfer_control_state = frm.__hrms_transfer_control_state || Object.create(null);
	frm.__hrms_transfer_control_state[row.name] =
		frm.__hrms_transfer_control_state[row.name] || { control: null, setting: false };
	return frm.__hrms_transfer_control_state[row.name];
};

var clear_transfer_control_state = function (frm, row) {
	if (frm.__hrms_transfer_control_state && row?.name) {
		delete frm.__hrms_transfer_control_state[row.name];
	}
};

var get_transfer_target_department = function (frm, table) {
	const department = get_transfer_detail(frm, table, "department");
	return department ? department.new || "__hrms_department_required__" : frm.doc.department || "";
};

var get_transfer_property_card_config = function (field) {
	const descriptions = {
		department: __("更换部门，并同时选择该部门下的新岗位"),
		designation: __("部门不变，仅调整员工岗位"),
		grade: __("调整员工职级"),
		reports_to: __("调整直属上级"),
		employment_type: __("调整正式、试用期、返聘等工作性质"),
		custom_direct_indirect: __("调整直接或间接人员属性"),
		custom_is_confirmed: __("调整员工转正状态"),
	};

	return {
		...field,
		label: field.value === "department" ? __("部门与岗位") : field.label,
		description: descriptions[field.value] || __("调整{0}", [field.label]),
	};
};

var can_edit_transfer_properties = function (frm) {
	if (frm.doc.docstatus !== 0 || frm.read_only) return false;
	if (typeof frm.is_read_only === "function" && frm.is_read_only()) return false;
	return !Array.isArray(frm.perm) || frm.perm.some((permission) => permission.write || (frm.is_new?.() && permission.create));
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
	const available = fields.filter((item) => item.value !== "designation" || !selected.has("department"));
	const pending = frm.__hrms_transfer_pending_fields || new Set();
	const can_edit = can_edit_transfer_properties(frm);

	const picker_html = `
		${
			can_edit && available.length
				? `<div class="hrms-transfer-property-picker">
					<div>
						<div class="hrms-transfer-property-picker__title">${__("1. 选择变更项目")}</div>
						<div class="hrms-transfer-property-picker__hint">${__("点击卡片后直接在下方填写目标值；蓝色表示已选择，可在填写区移除。")}</div>
					</div>
					<div class="hrms-transfer-property-cards">
						${available
							.map(
								(item) => `<button type="button" class="hrms-transfer-property-card" aria-pressed="${selected.has(item.value)}" ${selected.has(item.value) || pending.size || !frm.doc.employee ? "disabled" : ""} data-add-transfer-property="${escape_business_change_value(item.value)}">
									<strong>${escape_business_change_value(item.label)}</strong>
									<span class="hrms-transfer-property-card__state">${selected.has(item.value) ? __("✓ 已选择") : pending.has(item.value) ? __("读取中…") : __("＋ 添加")}</span>
									<small>${escape_business_change_value(item.description)}</small>
								</button>`
							)
							.join("")}
					</div>
				</div>`
				: ""
		}
	`;
	if (!$editor.find("[data-transfer-property-editors]").length) {
		$editor.html(`<div data-transfer-picker></div>
			<div class="hrms-transfer-property-editors__title" data-transfer-progress aria-live="polite"></div>
			<div class="hrms-transfer-property-editors" data-transfer-property-editors></div>`);
	}
	$editor.attr("aria-busy", pending.size ? "true" : "false");
	$editor.find("[data-transfer-picker]").html(picker_html);

	$editor
		.off("click.hrms-transfer-property-add")
		.on("click.hrms-transfer-property-add", "[data-add-transfer-property]", function () {
			add_inline_transfer_property(frm, table, $(this).attr("data-add-transfer-property"));
		});

	render_transfer_property_panels(frm, table, rows, can_edit);
	$editor.find("[data-remove-transfer-property]").prop("disabled", Boolean(pending.size));
	update_transfer_property_progress(frm, table);
};

var add_inline_transfer_property = function (frm, table, fieldname) {
	if (!can_edit_transfer_properties(frm)) return Promise.resolve();
	if (!frm.doc.employee) {
		frappe.msgprint(__("请先输入并匹配员工工号。"));
		return Promise.resolve();
	}

	const fields_to_add = fieldname === "department" ? ["department", "designation"] : [fieldname];
	const missing_fields = fields_to_add.filter((name) => !get_transfer_detail(frm, table, name));
	if (!missing_fields.length) return Promise.resolve();
	const pending = frm.__hrms_transfer_pending_fields || (frm.__hrms_transfer_pending_fields = new Set());
	if (pending.size) return Promise.resolve();
	const employee = frm.doc.employee;
	let added = false;
	const original_rows = frm.doc[table] || (frm.doc[table] = []);
	missing_fields.forEach((name) => pending.add(name));
	render_transfer_property_editor(frm, table);

	return Promise.all(
		missing_fields.map(
			(name) =>
				new Promise((resolve, reject) => {
					frappe.call({
						method: "hrms.hr.doctype.employee_transfer.employee_transfer.get_transfer_field_property",
						args: { employee, fieldname: name },
						timeout: 15000,
						callback: (response) => (response.message ? resolve({ name, ...response.message }) : reject()),
						error: reject,
					});
				})
		)
	)
		.then((properties) => {
			if (frm.doc.employee !== employee || frm.doc[table] !== original_rows || frm.doc.docstatus !== 0) return;
			properties.forEach((property) => {
				if (get_transfer_detail(frm, table, property.name)) return;
				frm.add_child(table, {
					fieldname: property.name,
					property:
						(frm.__hrms_employee_property_labels || {})[property.name] || property.label,
					current: property.value,
					new: "",
				});
			});
			added = true;
			frm.refresh_field(table);
			frm.dirty();
		})
		.catch(() => frappe.msgprint(__("读取员工当前任职信息失败，请重试。")))
		.finally(() => {
			missing_fields.forEach((name) => pending.delete(name));
			render_transfer_property_editor(frm, table);
			const $panel = frm.fields_dict[table].$wrapper.find(`[data-transfer-property-group="${fieldname}"]`);
			const input = $panel.find("input, select, textarea")[0];
			if (added && input && frm.doc.employee === employee && frm.doc.docstatus === 0) {
				input.focus({ preventScroll: true });
				input.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
			}
		});
};

var update_transfer_property_progress = function (frm, table) {
	const rows = (frm.doc[table] || []).filter((row) => !row.__deleted);
	const filled = rows.filter((row) => row.new !== null && row.new !== undefined && String(row.new).trim() !== "").length;
	const message = frm.doc.docstatus !== 0
		? __("变更明细 · {0} 项", [rows.length])
		: __("2. 填写变更内容 · 已填写 {0}/{1} 项", [filled, rows.length]);
	frm.fields_dict[table].$wrapper.find("[data-transfer-progress]").text(message);
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
	const groups = get_transfer_property_groups(rows);
	$container.find("[data-transfer-property-group]").each(function () {
		const key = $(this).attr("data-transfer-property-group");
		if (!groups.some((group) => group.key === key)) $(this).remove();
	});
	$container.find(".hrms-transfer-property-editor__empty").remove();
	if (!rows.length) {
		$container.html(`<div class="hrms-transfer-property-editor__empty">${frm.doc.employee ? __("从上方选择需要变更的项目，当前信息会自动带出。") : __("请先从员工详情进入此页面，匹配员工后再选择变更项目。")}</div>`);
		return;
	}

	groups.forEach((group) => {
		const panels = frm.__hrms_transfer_panel_rows || (frm.__hrms_transfer_panel_rows = {});
		const signature = JSON.stringify([can_edit, group.rows.map((row) => [row.name, row.current, can_edit ? null : row.new])]);
		const $existing = $container.find(`[data-transfer-property-group="${group.key}"]`);
		if ($existing.attr("data-row-signature") === signature && group.rows.every((row, index) => panels[group.key]?.[index] === row)) return;
		panels[group.key] = group.rows;
		$existing.remove();
		const $panel = $(`
			<div class="hrms-transfer-property-panel" data-transfer-property-group="${escape_business_change_value(group.key)}">
				<div class="hrms-transfer-property-panel__header">
					<strong>${escape_business_change_value(group.label)}</strong>
					${can_edit ? `<button type="button" class="hrms-transfer-property-remove" data-remove-transfer-property="${escape_business_change_value(group.key)}">${__("移除")}</button>` : ""}
				</div>
				<div class="hrms-transfer-property-panel__fields"></div>
			</div>
		`);
		$panel.attr("data-row-signature", signature);
		$container.append($panel);

		group.rows.forEach((row) => render_transfer_property_control(frm, table, row, $panel, can_edit));
	});

	$container
		.off("click.hrms-transfer-property-remove")
		.on("click.hrms-transfer-property-remove", "[data-remove-transfer-property]", function () {
			if (!can_edit) return;
			const key = $(this).attr("data-remove-transfer-property");
			remove_inline_transfer_property(frm, table, key);

		});
};

var remove_inline_transfer_property = function (frm, table, key) {
	if (!can_edit_transfer_properties(frm) || frm.__hrms_transfer_pending_fields?.size) return;
	const fieldnames = key === "department" ? ["department", "designation"] : [key];
	const rows = (frm.doc[table] || []).filter((row) => !row.__deleted && fieldnames.includes(row.fieldname));
	if (!rows.length) return;
	const employee = frm.doc.employee;
	const remove = () => {
		if (!can_edit_transfer_properties(frm) || frm.doc.employee !== employee) return;
		rows.forEach((row) => {
			if (get_transfer_detail(frm, table, row.fieldname) !== row) return;
			clear_transfer_control_state(frm, row);
			frappe.model.clear_doc(row.doctype, row.name);
		});
		frm.refresh_field(table);
		frm.dirty();
		render_transfer_property_editor(frm, table);
		frm.fields_dict[table].$wrapper.find(`[data-add-transfer-property="${key}"]`)[0]?.focus();
	};
	if (rows.some((row) => row.new !== null && row.new !== undefined && String(row.new).trim() !== "")) {
		frappe.confirm(__("移除后将清空此项目已填写的内容，是否继续？"), remove);
	} else {
		remove();
	}
};

var validate_inline_transfer_details = function (frm) {
	if (frm.doc.docstatus !== 0) return;
	if (frm.__hrms_transfer_pending_fields?.size) frappe.throw(__("正在读取变更项目，请稍候再保存。"));
	const rows = (frm.doc.transfer_details || []).filter((row) => !row.__deleted);
	if (!rows.length) frappe.throw(__("请至少选择一项变更项目。"));
	const department = rows.find((row) => row.fieldname === "department");
	if (department && !rows.some((row) => row.fieldname === "designation")) {
		frappe.throw(__("调整部门时必须同时选择新岗位。"));
	}
	for (const row of rows) {
		const value = String(row.new ?? "").trim();
		if (!value) frappe.throw(__("请填写{0}的变更后内容。", [row.property]));
		const same_designation = row.fieldname === "designation" && department && String(department.new || "") !== String(department.current || "");
		if (String(row.current ?? "").trim() === value && !same_designation) {
			frappe.throw(__("{0}的变更前后不能相同。", [row.property]));
		}
		if (row.fieldname === "reports_to" && value === frm.doc.employee) frappe.throw(__("直属上级不能选择员工本人。"));
	}
};

var match_transfer_manager = function (employees, value) {
	const text = String(value || "").trim();
	const identity = (employee) => [employee.employee_code, employee.employee_name].filter(Boolean).join(" · ");
	const exact = employees.filter((employee) => identity(employee) === text || employee.employee_code === text);
	const matches = exact.length ? exact : employees.filter((employee) => employee.employee_name === text);
	return matches.length === 1 ? matches[0] : null;
};

var render_transfer_employee_business_control = function (frm, table, row, $field) {
	const $target = $field.find(".hrms-transfer-property-target");
	const list_id = `hrms-transfer-manager-${row.name || Date.now()}`;
	const $input = $(`<input type="text" class="form-control" list="${list_id}" placeholder="${__("正在读取员工选项…")}" disabled>`);
	const $list = $(`<datalist id="${list_id}"></datalist>`);
	const $retry = $("<button type='button' class='hrms-transfer-property-remove'>").text(__("重新加载"));
	$target.empty().append(
		$("<label>").attr("for", list_id + "-input").text(__("{0} · 变更后 *", [row.property])),
		$input.attr("id", list_id + "-input").attr("aria-required", "true"), $list
	);
	let employees = [];
	const is_active = () => can_edit_transfer_properties(frm) && get_transfer_detail(frm, table, "reports_to") === row;
	const identity = (employee) => [employee.employee_code, employee.employee_name].filter(Boolean).join(" · ");
	$input.on("input", () => {
		if (!is_active()) return;
		const matched = match_transfer_manager(employees, $input.val());
		$input.attr("aria-invalid", $input.val().trim() && !matched ? "true" : "false");
		frappe.model.set_value(row.doctype, row.name, "new", matched?.name || "");
		update_transfer_property_progress(frm, table);
	});
	$input.on("change", () => {
		if (!is_active()) return;
		const matched = match_transfer_manager(employees, $input.val());
		$input.attr("aria-invalid", $input.val().trim() && !matched ? "true" : "false");
		frappe.model.set_value(row.doctype, row.name, "new", matched?.name || "");
		if (matched) $input.val(identity(matched));
		else if ($input.val().trim()) frappe.msgprint(__("未匹配到唯一员工，请使用工号或从候选中选择，重名员工需按工号区分。"));
		update_transfer_property_progress(frm, table);
	});
	const load = () => {
		$retry.detach();
		$input.prop("disabled", true).attr("placeholder", __("正在读取员工选项…"));
		frappe.call({
			method: "hrms.hr.doctype.employee_transfer.employee_transfer.get_employee_business_options",
			args: { company: frm.doc.company || "" },
			timeout: 15000,
			callback(response) {
				if (!is_active()) return;
				employees = (response.message || []).filter((employee) => employee.name !== frm.doc.employee);
				const selected = employees.find((employee) => employee.name === row.new);
				$input.val(selected ? identity(selected) : "").prop("disabled", false).attr("placeholder", __("输入工号或姓名，同名请按工号选择"));
				$list.empty();
				employees.forEach((employee) => $list.append($("<option>").attr("value", identity(employee))));
			},
			error() {
				if (!is_active()) return;
				$input.attr("placeholder", __("读取失败，请重新加载"));
				$target.append($retry);
			},
		});
	};
	$retry.on("click", load);
	load();
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
			<span class="hrms-transfer-property-field__arrow" aria-hidden="true">→</span>
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

	const control_state = get_transfer_control_state(frm, row);
	let control;
	const handle_change = () => {
		if (control_state.setting || !can_edit_transfer_properties(frm) || get_transfer_detail(frm, table, row.fieldname) !== row) return;

		const value = control.get_value();
		if (String(row.new ?? "") === String(value ?? "")) return;

		frappe.model.set_value(row.doctype, row.name, "new", value);
		update_transfer_property_progress(frm, table);
		if (row.fieldname !== "department") return;

		// A designation belongs to a department. Preserve the active Link control
		// and only clear its stale selection when its department changes.
		const designation = get_transfer_detail(frm, table, "designation");
		if (!designation || !designation.new) return;

		frappe.model.set_value(designation.doctype, designation.name, "new", "");
		const designation_state = get_transfer_control_state(frm, designation);
		const designation_control = designation_state.control;
		if (!designation_control) return;

		designation_state.setting = true;
		designation_control.set_value("");
		update_transfer_property_progress(frm, table);
		designation_state.setting = false;
	};

	control = frappe.ui.form.make_control({
		parent: $field.find(".hrms-transfer-property-target"),
		df: {
			fieldname: `target_${row.name}`,
			fieldtype: row.fieldname === "employment_type" ? "Select" : employee_field.fieldtype,
			options: row.fieldname === "employment_type" ? "\n" + TRANSFER_WORK_NATURE_OPTIONS.join("\n") : employee_field.fieldtype === "Select" ? "\n" + (employee_field.options || "").trim() : employee_field.options || "",
			label: __("{0} · 变更后", [row.property]),
			description: row.fieldname === "designation" && get_transfer_detail(frm, table, "department") ? __("先选择目标部门，再选择岗位；更换部门后需重新选择岗位。") : "",
			reqd: 1,
			change: handle_change,
		},
		render_input: true,
	});
	control_state.control = control;

	if (row.fieldname === "department") {
		control.get_query = () => ({ filters: { company: frm.doc.company, is_group: 0, disabled: 0 } });
	}
	if (row.fieldname === "designation") {
		control.get_query = () => ({
			query: "hrms.hr.doctype.employee_transfer.employee_transfer.get_designations_for_department",
			filters: {
				department: get_transfer_target_department(frm, table),
				company: frm.doc.company,
			},
		});
	}

	control_state.setting = true;
	control.set_value(row.new ?? "");
	control_state.setting = false;
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
