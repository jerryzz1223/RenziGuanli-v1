(function () {
	if (window.hrmsEmployeeBusinessCodeSelector) return;

	function normalise_employee_code(value) {
		return String(value || "").trim();
	}

	function get_employee_identity(employee) {
		return [employee?.employee_code, employee?.employee_name].filter(Boolean).join(" · ");
	}

	function set_employee_identity_hint(frm, employee) {
		const identity = get_employee_identity(employee);
		frm.set_df_property(
			"employee_code_display",
			"description",
			identity ? __("已匹配员工：{0}", [identity]) : __("输入公司工号后自动匹配员工"),
		);
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
			.get_value("Employee", frm.doc.employee, ["custom_employee_code", "employee_number", "employee_name"])
			.then(({ message }) => {
				const employee_code = message?.custom_employee_code || message?.employee_number || "";
				if (employee_code) {
					frm.__hrms_selected_employee_code = employee_code;
					set_employee_code(frm, employee_code);
					set_employee_identity_hint(frm, { ...message, employee_code });
				}
			})
			.finally(() => {
				frm.__hrms_loading_employee_code = false;
			});
	}

	function setup(frm) {
		frm.set_df_property("employee_code_display", "label", __("员工工号"));
		set_employee_identity_hint(frm);
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
			set_employee_identity_hint(frm);
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
				set_employee_identity_hint(frm, employee);
			},
		});
	}

	window.hrmsEmployeeBusinessCodeSelector = { setup, refresh, employee_selected, resolve_employee };
})();
