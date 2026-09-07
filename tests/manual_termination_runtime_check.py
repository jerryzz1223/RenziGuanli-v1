"""Read live locked sources and exercise preview; never approve real payroll."""
import json
import frappe


def run():
    from hrms.api import payroll_input as payroll
    from hrms.payroll.termination_settlement import INPUT_FIELDS
    assert frappe.get_meta(payroll.MONTHLY_PAYROLL_PARTICIPATION_DOCTYPE).has_field("termination_inputs_json")
    scopes = frappe.get_all(payroll.MONTHLY_ATTENDANCE_DOCTYPE,
        filters={"lock_status": "已锁定"}, fields=["company", "attendance_month", "attendance_lock_version"],
        group_by="company, attendance_month, attendance_lock_version", limit_page_length=20)
    checked = False
    for scope in scopes:
        current = payroll._current_payroll_attendance_lock(scope.company, scope.attendance_month) or {}
        if current.get("attendance_lock_version") != scope.attendance_lock_version:
            continue
        args = dict(company=scope.company, payroll_month=scope.attendance_month, attendance_lock_version=scope.attendance_lock_version)
        workbench = payroll.get_termination_settlement_workbench(**args)
        if not workbench["candidates"]:
            continue
        employee = workbench["candidates"][0]["employee"]
        context = payroll.get_termination_settlement_context(**args, employee=employee)
        assert context["source_hash"]
        assert len(context["fields"]) == len(INPUT_FIELDS)
        values = {field: 0 for field, _, _ in INPUT_FIELDS}
        values.update(base_salary=2660, standard_hours=184, basic_attendance_hours=32,
                      raw_weekend_overtime_hours=11, weekday_overtime_hours=6, utilities_deduction=67.65)
        result = payroll.preview_termination_settlement(**args, employee=employee, inputs_json=json.dumps(values))
        assert result["calculated"]["net_pay"] == 868.87
        print("PASS: schema, live current-lock population, source context, worksheet preview 868.87; no approval or generation")
        checked = True
        break
    assert checked, "No current locked attendance population available for runtime validation"


if __name__ == "__main__":
    frappe.init(site="hrms.localhost", sites_path="/home/frappe/frappe-bench/sites")
    frappe.connect()
    frappe.set_user("Administrator")
    try:
        run()
    finally:
        frappe.db.rollback()
        frappe.destroy()
