"""Execute the real generation function against an isolated in-memory store."""
import ast
from collections import defaultdict
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


formula = load("formula", ROOT / "hrms/payroll/payroll_formula.py")
departure = load("departure", ROOT / "hrms/payroll/termination_settlement.py")


class Row(dict):
    def __getattr__(self, field):
        return self.get(field)


class TerminationPayrollIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.saved = []
        self.inputs = {field: 0 for field, _, _ in departure.INPUT_FIELDS}
        self.inputs.update(base_salary=2660, standard_hours=184, basic_attendance_hours=32,
                           weekday_overtime_hours=6, raw_weekend_overtime_hours=11, utilities_deduction=67.65)
        # Input's overtime is deliberately already offset. The departure row
        # must use the reviewed pre-offset inputs instead of these values.
        self.rows = [Row(name="input-" + name, employee=name, employee_code=name,
                         employee_name=name, company="ACME", standard_hours=184,
                         adjusted_working_hours=32, overtime_2_hours=0,
                         overtime_1_5_hours=0) for name in ("leaver", "normal")]
        self.payload = {"inputs": self.inputs, "source_hash": "source-v1",
                        "rule_version": departure.RULE_VERSION}
        self.decisions = {"leaver": Row(name="decision-1", decision="离职结算", review_status="审核通过",
                                        termination_inputs_json=json.dumps(self.payload))}
        def get_all(doctype, **kwargs):
            if doctype == "input":
                return self.rows
            if doctype == "attendance":
                return self.rows
            return []
        def get_doc(data):
            doc = Row(data)
            doc["name"] = "result-" + data["employee"]
            doc["insert"] = lambda **kwargs: self.saved.append(doc)
            return doc
        def throw(message):
            raise ValueError(message)
        self.frappe = SimpleNamespace(get_all=get_all, get_doc=get_doc, throw=throw,
            delete_doc=Mock(), db=SimpleNamespace(sql=Mock(), exists=Mock(return_value=False), commit=Mock()))
        self.scope = lambda *args: dict(company="ACME", payroll_month="2026-07", attendance_lock_version="lock-v1")
        salary = Row(name="salary", base_salary=2660, function_allowance=0)
        self.ns = dict(frappe=self.frappe, _=lambda x: x, defaultdict=defaultdict, json=json,
            flt=lambda value: float(value or 0), FormulaError=formula.FormulaError,
            FORMULA_TEMPLATES=formula.FORMULA_TEMPLATES, evaluate_formula_set=formula.evaluate_formula_set,
            calculate_termination_settlement=departure.calculate_termination_settlement,
            TERMINATION_RULE_VERSION=departure.RULE_VERSION, PAYROLL_PARTICIPATION_APPROVED_STATUS="审核通过",
            PAYROLL_SETTLEMENT_DOCTYPE="settlement", PAYROLL_INPUT_DOCTYPE="input",
            MONTHLY_ATTENDANCE_DOCTYPE="attendance", LOCAL_PAYROLL_TEST_COMPANY="TEST-HRMS",
            _require_payroll_master_manager=lambda: None, _require_payroll_scope=lambda *args: args,
            _assert_workflow_locked_for_generation=lambda *args: None, _payroll_run_snapshot=lambda *args: "run-v1",
            _payroll_calculation_rules=lambda *args: {}, _apply_attendance_rule_parameters=lambda formulas, rules: formulas,
            _effective_payroll_formulas=lambda *args: formula.FORMULA_TEMPLATES,
            _payroll_scope_filters=self.scope, _attendance_scope_filters=self.scope,
            _variable_totals=lambda *args: ({}, {}, {}), _trace_snapshot_hash=lambda row: "run-v1",
            _assert_row_company=lambda *args: None, _employee_identity_key=lambda row: row.employee,
            _employee_population_labels=lambda *args: [],
            _active_salary_changes_for_month=lambda *args: {row.employee: salary for row in self.rows},
            _is_trial_salary_change=lambda row: False,
            _monthly_payroll_participation_decision_map=lambda *args: self.decisions,
            _termination_source=lambda *args: {"source_hash": "source-v1"},
            _apply_social_insurance_payroll_policy=lambda *args: {"apply": True},
            get_active_salary_change_for_employee=lambda **kwargs: salary,
            _money=lambda value: round(value, 2),
            _source_trace_hash=lambda trace: (json.dumps(trace), "result-hash"))
        source = ast.parse((ROOT / "hrms/api/payroll_input.py").read_text())
        fn = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "generate_payroll_settlement_records")
        fn.decorator_list = []
        exec(compile(ast.Module(body=[fn], type_ignores=[]), "payroll_input.py", "exec"), self.ns)

    def run_generation(self):
        return self.ns["generate_payroll_settlement_records"]("ACME", "2026-07", "lock-v1")

    def test_mixed_population_uses_two_calculators_one_record_each(self):
        result = self.run_generation()
        self.assertEqual(result["created"], 2)
        by_employee = {row.employee: row for row in self.saved}
        self.assertEqual(len(by_employee), 2)
        leaver = by_employee["leaver"]
        self.assertEqual(leaver.net_pay, 868.87)
        self.assertEqual(leaver.weekend_overtime_hours, 11)
        self.assertEqual(leaver.income_tax, 0)
        self.assertEqual(json.loads(leaver.source_trace_json)["settlement_type"], "离职结算")
        self.assertEqual(json.loads(by_employee["normal"].source_trace_json)["settlement_type"], "正常计薪")
        self.assertEqual(by_employee["normal"].weekend_overtime_hours, 0)

    def test_changed_source_blocks_before_any_result_is_written(self):
        self.payload["source_hash"] = "old-source"
        self.decisions["leaver"]["termination_inputs_json"] = json.dumps(self.payload)
        with self.assertRaisesRegex(ValueError, "来源或规则已变化"):
            self.run_generation()
        self.assertEqual(self.saved, [])
        self.frappe.delete_doc.assert_not_called()

    def test_other_confirmed_lock_prevents_duplicate_pay(self):
        self.frappe.db.exists.return_value = True
        with self.assertRaisesRegex(ValueError, "本月已有已确认工资"):
            self.run_generation()
        self.assertEqual(self.saved, [])

    def test_legacy_departure_decision_cannot_use_normal_formula(self):
        self.decisions["leaver"]["termination_inputs_json"] = ""
        with self.assertRaisesRegex(ValueError, "重新核对"):
            self.run_generation()
        self.assertEqual(self.saved, [])


if __name__ == "__main__":
    unittest.main()
