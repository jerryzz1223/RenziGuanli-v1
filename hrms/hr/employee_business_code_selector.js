(function () {
	if (window.hrmsEmployeeBusinessCodeSelector) return;

	function normalise_employee_code(value) {
		return String(value || "").trim();
	}

	function set_employee_code(frm, employee_code) {
		frm.__hrms_updating_employee_code = true;
		frm.set_value("employee_code_display", employee_code || "");
		frm.__hrms_updating_employee_code = false;
	}

	function load_employee_code(frm) {
		if (!frm.doc.employee || frm.__hrms_loading_employee_code) return;

		frm.__hrms_loading_employee_code = true;
		frappe.db
			.get_value("Employee", frm.doc.employee, ["custom_employee_code", "employee_number"])
			.then(({ message }) => {
				const employee_code = message?.custom_employee_code || message?.employee_number || "";
				if (employee_code) {
					frm.__hrms_selected_employee_code = employee_code;
					set_employee_code(frm, employee_code);
				}
			})
			.finally(() => {
				frm.__hrms_loading_employee_code = false;
			});
	}

	function setup(frm) {
		frm.set_df_property("employee_code_display", "label", __("员工工号"));
		frm.set_df_property("employee_code_display", "description", __("输入公司工号后自动匹配员工"));
		frm.toggle_display("employee", false);
		frm.toggle_display("employee_code_display", true);
	}

	function refresh(frm) {
		setup(frm);
		if (frm.doc.employee && !normalise_employee_code(frm.doc.employee_code_display)) {
			load_employee_code(frm);
		}
	}

	function employee_selected(frm) {
		frm.__hrms_selected_employee_code = "";
		refresh(frm);
	}

	function resolve_employee(frm) {
		if (frm.__hrms_updating_employee_code) return;

		const employee_code = normalise_employee_code(frm.doc.employee_code_display);
		if (!employee_code) {
			frm.__hrms_selected_employee_code = "";
			if (frm.doc.employee) frm.set_value("employee", "");
			return;
		}
		if (employee_code === frm.__hrms_selected_employee_code && frm.doc.employee) return;

		frappe.call({
			method: "hrms.api.employee_field_template.get_employee_by_business_code",
			args: { employee_code },
			freeze: true,
			freeze_message: __("正在匹配员工工号"),
			callback(response) {
				const employee = response.message;
				if (!employee) {
					frm.__hrms_selected_employee_code = "";
					if (frm.doc.employee) frm.set_value("employee", "");
					frappe.msgprint(__("未找到工号为 {0} 的在职员工。", [employee_code]));
					return;
				}

				frm.__hrms_selected_employee_code = employee.employee_code;
				frm.set_value("employee", employee.name);
				set_employee_code(frm, employee.employee_code);
			},
		});
	}

	window.hrmsEmployeeBusinessCodeSelector = { setup, refresh, employee_selected, resolve_employee };
})();
