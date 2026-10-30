"""Isolated regression checks; no live database, role engine or deployment claimed."""
from contextlib import contextmanager
from io import BytesIO
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class Row(dict):
    __getattr__ = dict.get
    def check_permission(self, permission):
        if permission in self.get("denied", []):
            raise PermissionError(permission)


def field(name, **kw):
    return Row(fieldname=name, label=name, fieldtype=kw.pop("fieldtype", "Data"), **kw)


@contextmanager
def api_context():
    frappe = ModuleType("frappe")
    model = ModuleType("frappe.model")
    frappe.whitelist = lambda: lambda fn: fn
    frappe.PermissionError = PermissionError
    frappe.throw = lambda message, error=ValueError: (_ for _ in ()).throw(error(message))
    frappe.session = SimpleNamespace(user="hr-user")
    frappe.has_permission = lambda *a, **kw: True
    frappe.db = SimpleNamespace(exists=lambda *a: True)
    frappe.utils = SimpleNamespace(now=lambda: "2026-10-23 12:00:00", get_url=lambda value="": "https://hrms.test" + value)
    frappe.get_meta = lambda doctype: SimpleNamespace(fields=[], get_field=lambda name: None)
    frappe.get_list = lambda *a, **kw: []
    frappe.get_doc = lambda doctype, name: Row(name=name)
    model.get_permitted_fields = lambda *a, **kw: []
    layout_spec = importlib.util.spec_from_file_location("hrms.utils.personnel_export_layout", ROOT / "hrms/utils/personnel_export_layout.py")
    layout = importlib.util.module_from_spec(layout_spec)
    layout_spec.loader.exec_module(layout)
    with patch.dict(sys.modules, {"frappe": frappe, "frappe.model": model, layout_spec.name: layout}):
        spec = importlib.util.spec_from_file_location("history_under_test", ROOT / "hrms/api/employee_history_export.py")
        api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
        api.get_permitted_fields = lambda *a, **kw: model.get_permitted_fields(*a, **kw)
        yield api, frappe, model


class HistoryExportTests(unittest.TestCase):
    def test_pagination_keeps_filters_and_all_rows(self):
        with api_context() as (api, frappe, _):
            calls = []
            def get_list(doctype, **kw):
                calls.append(kw)
                self.assertEqual(kw["filters"], {"employee": "EMP-A"})
                self.assertNotIn("ignore_permissions", kw)
                return [Row(name=str(i)) for i in range(kw["limit_start"], min(1001, kw["limit_start"] + 500))]
            frappe.get_list = get_list
            self.assertEqual(len(api._list("Attendance", {"employee": "EMP-A"}, ["name"])), 1001)
            self.assertEqual([c["limit_start"] for c in calls], [0, 500, 1000])

    def test_record_limit_fails_instead_of_silent_truncation(self):
        with api_context() as (api, frappe, _):
            api.MAX_ROWS = 2
            frappe.get_list = lambda *a, **kw: [Row(name=str(i)) for i in range(3)]
            with self.assertRaisesRegex(ValueError, "上限"):
                api._list("Attendance", {}, ["name"])

    def test_fields_omit_permission_hidden_password_and_attachments(self):
        with api_context() as (api, frappe, model):
            frappe.get_meta = lambda _: SimpleNamespace(fields=[field("safe"), field("private"), field("hidden", hidden=1), field("password", fieldtype="Password"), field("file", fieldtype="Attach")])
            model.get_permitted_fields = lambda *a, **k: ["safe", "hidden", "password", "file"]
            self.assertEqual([f.fieldname for f in api._fields("Employee")], ["safe"])

    def test_basic_respects_template_export_switch(self):
        template = ModuleType("hrms.api.employee_field_template")
        template.TEMPLATE_DOCTYPE = "HRMS Employee Field Template"
        template._get_template_doc = lambda: self.fail("Export must not invoke the template writer")
        template._get_employee_export_fields = lambda _: []
        template._get_allowed_export_fields = lambda _: {"safe": {"field_label": "姓名"}}
        with api_context() as (api, frappe, model), patch.dict(sys.modules, {template.__name__: template}):
            frappe.get_single = lambda doctype: Row(doctype=doctype)
            frappe.get_meta = lambda _: SimpleNamespace(fields=[field("safe"), field("secret")])
            model.get_permitted_fields = lambda *a, **k: ["safe", "secret"]
            section = api._basic(Row(safe="张三", secret="不可导出"))
            self.assertEqual(section["rows"], [{"label": "姓名", "value": "张三"}])

    def test_row_specific_permissions_are_enforced(self):
        with api_context() as (api, frappe, _):
            frappe.get_list = lambda *a, **kw: [Row(name="allowed"), Row(name="denied")]
            frappe.get_doc = lambda dt, name: Row(name=name, denied=["read"] if name == "denied" else [])
            section = api._records("考勤", "Attendance", {"employee": "EMP-A"})
            self.assertEqual(section["rows"], [{"name": "allowed"}])
            self.assertIn("部分", section["status"])

    def test_denied_and_empty_and_uninstalled_are_distinct(self):
        with api_context() as (api, frappe, _):
            self.assertIn("暂无", api._records("考勤", "Attendance", {})["status"])
            frappe.has_permission = lambda *a, **k: False
            self.assertIn("无读取", api._collect("考勤", "Attendance", lambda: api._records("考勤", "Attendance", {}))["status"])
            frappe.db.exists = lambda *a: False
            self.assertIn("尚未安装", api._records("考勤", "Attendance", {})["status"])

    def test_unexpected_source_failure_aborts_instead_of_pretending_empty(self):
        with api_context() as (api, _, _):
            with self.assertRaisesRegex(RuntimeError, "database unavailable"):
                api._collect("考勤", "Attendance", lambda: (_ for _ in ()).throw(RuntimeError("database unavailable")))

    def test_education_includes_visible_profile_fields_and_does_not_duplicate_history(self):
        with api_context() as (api, frappe, model):
            mapping = [field("custom_education_level"), field("custom_graduation_school"), field("custom_major")]
            frappe.get_meta = lambda dt: SimpleNamespace(
                get_field=lambda name: field(name, options="Employee Education", permlevel=0),
                fields=mapping if dt == "Employee" else [field("qualification"), field("school_univ"), field("major_opt_subj")])
            model.get_permitted_fields = lambda dt, **kw: [f.fieldname for f in (mapping if dt == "Employee" else frappe.get_meta(dt).fields)]
            employee = Row(education=[], custom_education_level="高中", custom_graduation_school="示例学校", custom_major="")
            section = api._education(employee)
            self.assertEqual(section["rows"], [{"qualification": "高中", "school_univ": "示例学校"}])
            self.assertIn("已读取", section["status"])
            from openpyxl import load_workbook
            watermark = ModuleType("hrms.utils.export_watermark")
            watermark.save_workbook_with_logo_watermark = lambda book, output, **kw: book.save(output)
            with patch.dict(sys.modules, {watermark.__name__: watermark}):
                content = api.make_history_workbook({"employee": "TEST-1", "generated_at": "2026-10-30", "sections": [section]})
            workbook = load_workbook(BytesIO(content))
            exported = [cell.value for row in workbook["教育背景"] for cell in row]
            self.assertIn("高中", exported)
            self.assertIn("示例学校", exported)
            self.assertFalse(any("暂无" in str(value) for value in exported if value))
            employee["education"] = [Row(qualification="高中", school_univ="示例学校", major_opt_subj="文科")]
            self.assertEqual(len(api._education(employee)["rows"]), 1)
            employee["custom_graduation_school"] = "另一学校"
            self.assertEqual(len(api._education(employee)["rows"]), 2)
            employee["education"] = []
            model.get_permitted_fields = lambda dt, **kw: ["custom_education_level"] if dt == "Employee" else []
            self.assertEqual(api._education(employee)["rows"], [{"qualification": "高中"}])

    def test_education_profile_survives_absent_child_model_but_not_denied_child_access(self):
        with api_context() as (api, frappe, model):
            frappe.get_meta = lambda dt: SimpleNamespace(get_field=lambda name: None, fields=[field("custom_education_level")])
            model.get_permitted_fields = lambda *a, **kw: ["custom_education_level"]
            section = api._education(Row(custom_education_level="本科"))
            self.assertEqual(section["rows"], [{"qualification": "本科"}])
            self.assertIn("子表尚未安装", section["status"])
            with patch.object(api, "_table_field", side_effect=PermissionError):
                with self.assertRaises(PermissionError):
                    api._education(Row(custom_education_level="本科"))

    def test_training_exports_only_matching_child_and_permitted_event(self):
        with api_context() as (api, frappe, model):
            model.get_permitted_fields = lambda dt, **k: ["training_event"] if dt == "Training Result" else ["score"] if dt == "Training Result Employee" else ["event_name"]
            frappe.get_meta = lambda dt: SimpleNamespace(get_field=lambda name: field(name, fieldtype="Table"), fields=[field("event_name")] if dt == "Training Event" else [field("score"), field("secret", permlevel=1)])
            events = {"E-A": Row(name="E-A", event_name="课程A"), "E-D": Row(name="E-D", denied=["export"])}
            children = [Row(employee="EMP-A", score=90), Row(employee="EMP-B", employee_code="001", score=11), Row(employee=None, employee_code="001", score=80), Row(employee=None, employee_code="002", score=12)]
            docs = {"R-A": Row(name="R-A", docstatus=1, training_event="E-A", employees=children), "R-OTHER-COMPANY": Row(name="R-OTHER-COMPANY", training_event="E-B", employees=children), "R-DENIED": Row(name="R-DENIED", training_event="E-D", employees=children)}
            def get_list(dt, **kw):
                if dt == "Training Event":
                    self.assertEqual(kw["filters"]["company"], "Company A")
                    return [Row(name=key) for key in events]
                self.assertEqual(kw["filters"], {"docstatus": ["<", 2], "training_event": ["in", ["E-A", "E-D"]]})
                return [Row(name=key) for key in docs]
            frappe.get_list = get_list
            frappe.get_doc = lambda dt, name: events[name] if dt == "Training Event" else docs[name]
            section = api._training(Row(name="EMP-A", custom_employee_code="001", company="Company A"))
            self.assertEqual([r["score"] for r in section["rows"]], [90, 80])
            self.assertIn("部分培训", section["status"])
            self.assertNotIn("secret", dict(section["columns"]))

    def test_child_table_visibility_and_all_rows(self):
        with api_context() as (api, frappe, model):
            model.get_permitted_fields = lambda *a, **kw: ["school"]
            frappe.get_meta = lambda dt: SimpleNamespace(get_field=lambda name: field(name, options="Employee Education", permlevel=0 if name == "education" else 1), get_permlevel_access=lambda **kw: [0], fields=[field("school"), field("secret", permlevel=1)])
            section = api._child(Row(education=[Row(school=str(i), secret="x") for i in range(9)]), "education", "教育")
            self.assertEqual(len(section["rows"]), 9)
            self.assertNotIn("secret", section["rows"][0])
            with self.assertRaises(PermissionError): api._child(Row(), "other", "其他")

    def test_attachments_are_employee_scoped_and_file_read_checked(self):
        template = ModuleType("hrms.api.employee_field_template")
        template.EMPLOYEE_MATERIAL_FIELD_PREFIX = "hrms_material_"
        with api_context() as (api, frappe, model), patch.dict(sys.modules, {template.__name__: template}):
            frappe.get_meta = lambda _: SimpleNamespace(fields=[field("file_url")])
            model.get_permitted_fields = lambda *a, **kw: ["file_url"]
            def get_list(dt, **kw):
                self.assertEqual(kw["filters"], {"attached_to_doctype": "Employee", "attached_to_name": "EMP-A", "attached_to_field": ["in", ["employee_talk_form", "hrms_material_employee_talk_form"]]})
                return [Row(name="ok", file_url="/private/files/a.pdf"), Row(name="no", file_url="secret")]
            frappe.get_list = get_list
            frappe.has_permission = lambda dt, perm, **kw: not kw.get("doc") or kw["doc"].name != "no"
            section = api._attachments(Row(name="EMP-A"), "谈话", "employee_talk_form")
            self.assertEqual([r["name"] for r in section["rows"]], ["ok"])
            self.assertIn("不含原件正文", section["source"])

    def test_attendance_existing_interface_and_defensive_employee_filter(self):
        source = ModuleType("hrms.api.attendance_processing_center")
        calls = []
        def preview(**kw):
            calls.append(kw)
            if kw["attendance_month"] == "2026-09": return {"available": False, "reason": "需重新锁定"}
            return {"available": True, "columns": [{"field": "hours", "label": "时数"}], "rows": [{"employee_code": "001", "hours": 8}, {"employee_code": "002", "hours": 10}], "locked_snapshot_version": "v1"}
        source.get_monthly_final_preview = preview
        with api_context() as (api, frappe, _), patch.dict(sys.modules, {source.__name__: source}):
            frappe.get_list = lambda *a, **kw: [Row(attendance_month="2026-10"), Row(attendance_month="2026-10"), Row(attendance_month="2026-09")]
            section = api._attendance_final(Row(name="EMP-A", company="A", custom_employee_code="001"))
            self.assertEqual(len(calls), 2)
            self.assertTrue(all(c["employee_code"] == "001" and c["kind"] == "signed" and c["company"] == "A" for c in calls))
            self.assertEqual(section["rows"], [{"month": "2026-09", "note": "需重新锁定"}, {"employee_code": "001", "hours": 8, "month": "2026-10", "version": "v1"}])

    def test_support_uses_owning_count_contract(self):
        support = ModuleType("hrms.api.cross_department_support")
        support.DOCTYPE = "Cross Department Support Record"
        support.get_employee_support_counts = lambda employee: {"employee": employee, "month": "2026-10", "monthly_count": 0, "total_count": 3, "months": [{"month": "2026-09", "count": 3}], "counting_rule": "来源单号去重"}
        with api_context() as (api, frappe, _), patch.dict(sys.modules, {support.__name__: support}):
            sections = api._support_sections(Row(name="EMP-A"))
            self.assertEqual(sections[0]["rows"], [{"period": "累计", "count": 3}, {"period": "2026-09", "count": 3}, {"period": "2026-10", "count": 0}])
            frappe.db.exists = lambda *a: False
            self.assertIn("不能", api._support_sections(Row(name="EMP-A"))[0]["status"])

    def test_top_level_authorization_before_any_source_reads(self):
        access = ModuleType("hrms.access_control")
        access.require_hrms_capability = lambda _: (_ for _ in ()).throw(PermissionError("capability"))
        with api_context() as (api, frappe, _), patch.dict(sys.modules, {access.__name__: access}):
            frappe.get_doc = lambda *a: self.fail("should not read employee before capability")
            with self.assertRaises(PermissionError): api.collect_employee_history("EMP-A")
            access.require_hrms_capability = lambda _: None
            for permission in ["read", "export"]:
                frappe.get_doc = lambda *a: Row(name="EMP-A", denied=[permission])
                with self.assertRaises(PermissionError): api.collect_employee_history("EMP-A")

    def test_apple_uses_visible_company_batches_and_checked_employee_records(self):
        access = ModuleType("hrms.access_control")
        access.require_hrms_capability = lambda _: None
        with api_context() as (api, frappe, model), patch.dict(sys.modules, {access.__name__: access}):
            fields = [field("employee"), field("import_batch"), field("green_apples"), field("source_rows_json")]
            frappe.get_meta = lambda _: SimpleNamespace(fields=fields)
            model.get_permitted_fields = lambda *a, **k: [f.fieldname for f in fields]
            calls = []
            def get_list(dt, **kw):
                calls.append((dt, kw))
                if dt == "HRMS Attendance Import Batch":
                    self.assertEqual(kw["filters"], {"company": "A"})
                    return [Row(name="visible", attendance_month="2024-10", status="已完成"), Row(name="denied")]
                self.assertEqual(kw["filters"], {"employee": "EMP-A", "import_batch": ["in", ["visible"]]})
                return [Row(name=dt + "-1", employee="EMP-A", import_batch="visible", green_apples=2)]
            frappe.get_list = get_list
            frappe.get_doc = lambda dt, name: Row(name=name)
            frappe.has_permission = lambda dt, perm, **kw: not kw.get("doc") or kw["doc"].name != "denied"
            section = api._apple(Row(name="EMP-A", company="A"))
            self.assertEqual(len(section["rows"]), 2)
            self.assertTrue(all(row["batch_month"] == "2024-10" for row in section["rows"]))
            self.assertNotIn("source_rows_json", dict(section["columns"]))
            self.assertIn("不跨版本累计", section["source"])
            self.assertEqual(len(calls), 3)

    def test_apple_history_details_check_json_field_and_each_employee_link(self):
        import json
        access = ModuleType("hrms.access_control")
        access.require_hrms_capability = lambda _: None
        with api_context() as (api, frappe, model), patch.dict(sys.modules, {access.__name__: access}):
            model.get_permitted_fields = lambda *a, **kw: ["source_rows_json"]
            frappe.get_meta = lambda _: SimpleNamespace(get_field=lambda name: field(name))
            frappe.get_list = lambda dt, **kw: [Row(name="batch", status="已导入")] if dt == "HRMS Attendance Import Batch" else [Row(name="summary")]
            details = [dict(employee="EMP-A", green_apples=2, note="原始备注"), dict(employee="EMP-B", green_apples=99), dict(employee_code="001", green_apples=88)]
            frappe.get_doc = lambda dt, name: Row(name=name, import_batch="batch", source_rows_json=json.dumps(details))
            section = api._apple_history_details(Row(name="EMP-A", company="A"))
            self.assertEqual(len(section["rows"]), 1)
            self.assertEqual(section["rows"][0]["green_apples"], 2)
            self.assertEqual(section["rows"][0]["note"], "原始备注")
            self.assertIn("不匹配", section["status"])
            model.get_permitted_fields = lambda *a, **kw: []
            with self.assertRaises(PermissionError): api._apple_history_details(Row(name="EMP-A", company="A"))

    def test_happy_collection_includes_every_block_and_scopes_record_queries(self):
        access = ModuleType("hrms.access_control")
        access.require_hrms_capability = lambda _: None
        with api_context() as (api, frappe, _), patch.dict(sys.modules, {access.__name__: access}):
            frappe.get_doc = lambda *a: Row(name="EMP-A")
            queries = []
            def records(title, doctype, filters, **kw):
                queries.append(filters)
                return api._section(title, doctype)
            with patch.object(api, "_basic", lambda _: api._section("基本信息", "Employee")), patch.object(api, "_child", lambda doc, field, title: api._section(title, field)), patch.object(api, "_training", lambda _: api._section("教育训练", "Training")), patch.object(api, "_apple", lambda _, **kw: api._section("苹果树", "Apple")), patch.object(api, "_apple_history_details", lambda _, **kw: api._section("苹果树历史明细", "Apple")), patch.object(api, "_records", records), patch.object(api, "_attachments", lambda doc, title, *a: api._section(title, "File")), patch.object(api, "_attendance_final", lambda _: api._section("考勤月度终稿", "Preview")), patch.object(api, "_support_sections", lambda _: [api._section("支援次数", "Support")]):
                payload = api.collect_employee_history("EMP-A")
            titles = {s["title"] for s in payload["sections"]}
            self.assertTrue({"基本信息", "教育背景", "教育训练", "苹果树", "请假记录", "请假审批证据", "考勤日记录", "导入考勤日记录", "考勤月度终稿", "奖惩记录", "奖惩提报单", "员工谈话表", "支援次数", "材料附件"}.issubset(titles))
            self.assertTrue(all(q == {"employee": "EMP-A"} for q in queries))
            self.assertEqual(len(titles), len(payload["sections"]))

    def test_expanded_detail_limit_prevents_oversized_workbook(self):
        with api_context() as (api, _, _):
            api.MAX_ROWS = 2
            with self.assertRaisesRegex(ValueError, "展开后"):
                api._section("历史明细", "JSON", [("value", "值")], [{"value": 1}] * 3)

    def test_training_empty_company_courses_does_not_scan_all_results(self):
        with api_context() as (api, frappe, model):
            model.get_permitted_fields = lambda *a, **kw: ["training_event"]
            frappe.get_meta = lambda _: SimpleNamespace(fields=[], get_field=lambda name: field(name))
            calls = []
            def get_list(dt, **kw):
                calls.append(dt)
                if dt == "Training Result": self.fail("Empty course scope must not scan training results")
                return []
            frappe.get_list = get_list
            self.assertEqual(api._training(Row(name="EMP-A", company="A"))["rows"], [])
            self.assertEqual(calls, ["Training Event"])
            self.assertIn("缺少公司", api._training(Row(name="EMP-A"))["status"])
            frappe.db.exists = lambda *a: False
            self.assertIn("尚未安装", api._training(Row(name="EMP-A", company="A"))["status"])

    def test_batch_cache_is_local_and_keyed_by_employee_and_company(self):
        with api_context() as (api, frappe, _):
            calls = []
            def get_list(dt, **kw):
                calls.append(kw["filters"])
                return [Row(name="batch", status="已导入")]
            frappe.get_list = get_list
            cache = {}
            employee = Row(name="EMP-A", company="A")
            self.assertEqual(api._apple_batches(employee, cache), api._apple_batches(employee, cache))
            self.assertEqual(len(calls), 1)
            api._apple_batches(Row(name="EMP-B", company="A"), cache)
            api._apple_batches(employee, {})
            self.assertEqual(len(calls), 3)

    def test_record_export_keeps_cancelled_document_status(self):
        with api_context() as (api, frappe, _):
            frappe.get_list = lambda *a, **kw: [Row(name="cancelled", docstatus=2)]
            section = api._records("请假", "Leave Application", {"employee": "EMP-A"})
            self.assertIn("docstatus", dict(section["columns"]))
            self.assertEqual(section["rows"][0]["docstatus"], 2)

    def test_download_endpoint_returns_binary_without_creating_a_file(self):
        desk = ModuleType("frappe.desk.utils")
        calls = []
        desk.provide_binary_file = lambda *args: calls.append(args)
        with api_context() as (api, _, _), patch.dict(sys.modules, {desk.__name__: desk}):
            with patch.object(api, "collect_employee_history", lambda employee: {"employee": employee}), patch.object(api, "make_history_workbook", lambda payload: b"xlsx-bytes"):
                api.download_employee_history("EMP/A")
            self.assertEqual(calls, [("EMP_A-全履历", "xlsx", b"xlsx-bytes")])

    def test_complete_workbook_with_real_watermark_roundtrip(self):
        from openpyxl import load_workbook
        from zipfile import ZipFile
        spec = importlib.util.spec_from_file_location("real_history_watermark", ROOT / "hrms/utils/export_watermark.py")
        watermark = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(watermark)
        settings = ModuleType("hrms.utils.export_watermark_settings")
        options = {"export": True, "print": True, "text": "履历回归测试", "opacity": 12}
        settings.get_export_watermark_options = lambda key: options
        with api_context() as (api, _, _), patch.dict(sys.modules, {"hrms.utils.export_watermark": watermark, settings.__name__: settings}):
            titles = ["基本信息", "教育背景", "内部任职履历", "外部工作履历", "教育训练", "苹果树", "苹果树历史明细", "请假记录", "请假审批证据", "人事异动", "转正晋升", "离职办理", "考勤日记录", "导入考勤日记录", "考勤月度终稿", "奖惩记录", "奖惩提报单", "员工谈话表", "材料附件", "支援次数"]
            sections = [api._section(title, "synthetic", [("value", "值"), ("file_url", "原件链接")], [{"value": "=SUM(1,2)", "file_url": "https://hrms.test/private/files/synthetic.pdf" if title == "材料附件" else ""}]) for title in titles]
            content = api.make_history_workbook({"employee": "SYNTHETIC", "generated_at": "2026-10-23", "sections": sections})
            with ZipFile(BytesIO(content)) as archive:
                self.assertIsNone(archive.testzip())
                self.assertIn("xl/media/hrms-yongxin-watermark.png", archive.namelist())
                sheets = [name for name in archive.namelist() if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")]
                self.assertEqual(len(sheets), 21)
                self.assertTrue(all(b"<picture " in archive.read(name) for name in sheets))
            workbook = load_workbook(BytesIO(content))
            self.assertEqual(workbook.sheetnames, ["履历目录"] + titles)
            for title in titles:
                self.assertEqual(workbook[title]["A4"].value, "=SUM(1,2)")
                self.assertEqual(workbook[title]["A4"].data_type, "s")
                self.assertIn("履历回归测试", workbook[title].oddHeader.center.text)
            self.assertEqual(workbook["材料附件"]["B4"].hyperlink.target, "https://hrms.test/private/files/synthetic.pdf")

    def test_chinese_monochrome_layout_preserves_detail_and_directory(self):
        from openpyxl import load_workbook
        watermark = ModuleType("hrms.utils.export_watermark")
        watermark.save_workbook_with_logo_watermark = lambda book, output, **kw: book.save(output)
        with api_context() as (api, frappe, _), patch.dict(sys.modules, {watermark.__name__: watermark}):
            sections = [
                api._section("基本信息", "Employee", [("label", "字段"), ("value", "内容")],
                    [{"label": "姓名", "value": "示例员工"}, {"label": "工号", "value": "0001"}, {"label": "地址", "value": "较长地址" * 20}]),
                api._section("教育训练", "Training Result / Training Event", [("event_name", "Event Name"), ("trainer", "Trainer Name"), ("docstatus", "单据状态"), ("status", "Status")],
                    [{"event_name": "安全教育", "trainer": "示例讲师", "docstatus": 1, "status": "Completed"}]),
                api._section("苹果树", "HRMS Apple Reward Record", status="HRMS Apple Reward Record：暂无当前权限可见记录"),
            ]
            book = load_workbook(BytesIO(api.make_history_workbook({"employee": "0001", "generated_at": "2026-10-30 12:00:00.123456", "sections": sections})))
            self.assertEqual(list(book["教育训练"].values)[2], ("培训名称", "讲师姓名", "单据状态", "状态"))
            self.assertEqual(list(book["教育训练"].values)[3], ("安全教育", "示例讲师", "已提交", "已完成"))
            basic = book["基本信息"]
            self.assertEqual(list(basic.values)[3], ("姓名", "示例员工", "工号", "0001"))
            self.assertEqual(basic["B5"].value, "较长地址" * 20)
            self.assertGreater(basic.row_dimensions[5].height, 26)
            self.assertIn("A1:D1", basic.merged_cells)
            self.assertNotIn("HRMS", book["苹果树"]["A2"].value)
            self.assertEqual(book["履历目录"]["A6"].hyperlink.target, "#'基本信息'!A1")
            self.assertEqual(book["履历目录"]["D2"].value, "2026-10-30 12:00:00")
            for sheet in book:
                self.assertTrue(sheet.page_setup.blackAndWhite)
                self.assertTrue(sheet.print_area)
                for row in sheet:
                    for cell in row:
                        if cell.value is not None:
                            self.assertIsNone(cell.fill.patternType)
                            self.assertEqual(cell.font.name, "宋体")
                            self.assertEqual(cell.font.color.rgb, "00000000")

    def test_workbook_retains_literal_text_empty_status_and_watermark_contract(self):
        from openpyxl import load_workbook
        watermark = ModuleType("hrms.utils.export_watermark")
        keys = []
        def save(book, output, export_key):
            keys.append(export_key)
            book.save(output)
        watermark.save_workbook_with_logo_watermark = save
        with api_context() as (api, _, _), patch.dict(sys.modules, {watermark.__name__: watermark}):
            payload = {"employee": "EMP-A", "generated_at": "2026-10-23", "sections": [api._section("基本信息", "Employee", [("value", "内容")], [{"value": "=HYPERLINK(\"https://invalid\")"}, {"value": "a\x01b"}]), api._section("员工谈话表", "File")]}
            book = load_workbook(BytesIO(api.make_history_workbook(payload)))
            self.assertEqual(book.sheetnames, ["履历目录", "基本信息", "员工谈话表"])
            self.assertEqual(book["基本信息"]["A4"].data_type, "s")
            self.assertTrue(book["基本信息"]["A4"].value.startswith("=HYPERLINK"))
            self.assertEqual(book["基本信息"]["A5"].value, "ab")
            self.assertIn("暂无", book["员工谈话表"]["A4"].value)
            self.assertEqual(book["基本信息"].freeze_panes, "A4")
            self.assertEqual(keys, ["employee_report"])
            with self.assertRaisesRegex(ValueError, "单元格"):
                api._cell("x" * 32768)


if __name__ == "__main__":
    unittest.main()
