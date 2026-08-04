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
			if (!frm.doc.employee) {
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

				show_dialog(frm, table, allowed_fields);
			});
		};

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
			@media (max-width: 720px) {
				.hrms-business-change-action { align-items: stretch; flex-direction: column; }
				.hrms-business-change-list__row {
					grid-template-columns: 1fr;
					gap: 4px;
				}
				.hrms-business-change-list__row--heading { display: none; }
				.hrms-business-change-list__arrow { text-align: left; }
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
