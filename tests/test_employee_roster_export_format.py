"""Focused contracts for roster export filters and spreadsheet presentation."""

import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

from openpyxl import Workbook


SOURCE = Path(__file__).resolve().parents[1] / "hrms/api/employee_field_template.py"


def load_functions(*names, namespace=None):
    tree = ast.parse(SOURCE.read_text())
    functions = [
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name in names
    ]
    scope = namespace or {}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(SOURCE), "exec"), scope)
    return scope


class EmployeeRosterExportFormatTests(unittest.TestCase):
    def test_reference_headers_match_the_37_column_roster(self):
        tree = ast.parse(SOURCE.read_text())
        columns = ast.literal_eval(next(
            node.value for node in tree.body
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "EMPLOYEE_REFERENCE_EXPORT_COLUMNS" for target in node.targets)
        ))
        expected = [
            "序号", "工号 *", "姓名 *", "部门 *", "入职日期 *", "手机号码 *",
            "证件类型", "证件号码", "户籍地址", "籍贯", "岗位 *", "工作性质",
            "直间接", "民族", "婚姻状况", "出生年月", "年龄", "性别",
            "学历类别", "学习形式", "学历", "毕业院校", "科系", "当前地址",
            "交通工具", "紧急联系", "紧急联系人电话", "试用期", "转正日期",
            "是否转正", "合同-签订日期", "合同-合同编号", "合同-签订次数",
            "合同-结束月份", "保险-社保", "保险-医保", "保险-公积金",
        ]
        self.assertEqual([header for _fieldname, header in columns], expected)
        self.assertEqual(len({fieldname for fieldname, _header in columns}), 37)

    def test_current_roster_filters_reach_export_query(self):
        scope = load_functions(
            "_build_employee_roster_filters",
            namespace={
                "_parse_json": lambda value, default: value,
                "_get_employee_meta_field_map": lambda: {
                    key: True for key in (
                        "company", "custom_work_nature", "employee_name",
                        "custom_employee_code", "cell_number", "contract_end_date",
                        "relieving_date", "date_of_joining",
                    )
                },
                "frappe": SimpleNamespace(
                    defaults=SimpleNamespace(get_user_default=lambda key: "永新")
                ),
            },
        )
        filters = scope["_build_employee_roster_filters"]({
            "custom_work_nature": ["!=", "离职"],
            "employee_name": ["like", "%张%"],
            "custom_employee_code": "4005",
            "company": "永新",
            "unrecognised": "ignored",
        })
        self.assertEqual(filters, {
            "custom_work_nature": ["!=", "离职"],
            "employee_name": ["like", "%张%"],
            "custom_employee_code": "4005",
            "company": "永新",
        })

    def test_export_values_are_business_labels(self):
        scope = load_functions(
            "_format_employee_export_value",
            namespace={
                "_display_option": lambda value: {
                    "Active": "激活", "Left": "已离职",
                    "Male": "男", "Female": "女",
                }.get(value, value),
                "_department_display_name": lambda value, names: names.get(value, value),
            },
        )
        format_value = scope["_format_employee_export_value"]
        self.assertEqual(format_value("status", "Active", {}), "激活")
        self.assertEqual(format_value("gender", "Female", {}), "女")
        self.assertEqual(format_value("custom_work_nature", "在职·正式", {}), "在职·正式")
        self.assertEqual(format_value("department", "QA - 永新", {"QA - 永新": "品保课"}), "品保课")

    def test_workbook_header_remains_visible_and_filterable(self):
        scope = load_functions("_write_sheet_rows")
        sheet = Workbook().active
        scope["_write_sheet_rows"](sheet, [["工号", "姓名"], ["0001", "甲"], ["0002", "乙"]])
        self.assertEqual(sheet.freeze_panes, "A2")
        self.assertEqual(sheet.auto_filter.ref, "A1:B3")
        self.assertEqual(sheet["A2"].value, "0001")


if __name__ == "__main__":
    unittest.main()
