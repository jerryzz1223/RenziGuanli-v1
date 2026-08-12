#!/usr/bin/env python3
"""Static contract for the persistent attendance processing center."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
API_PATH = ROOT / "hrms" / "api" / "attendance_processing_center.py"
PROCESSOR_PATH = ROOT / "hrms" / "api" / "attendance_processors" / "attendance_draft.py"
DOCTYPE_DIR = ROOT / "hrms" / "hr" / "doctype" / "hrms_attendance_processing_record"
DEPARTMENT_MAPPING_DIR = ROOT / "hrms" / "hr" / "doctype" / "hrms_attendance_department_mapping"
BATCH_JSON = ROOT / "hrms" / "hr" / "doctype" / "hrms_attendance_import_batch" / "hrms_attendance_import_batch.json"
STATUS_SYNC_PATCH = ROOT / "hrms" / "patches" / "v16_0" / "sync_attendance_import_batch_status_options.py"
PATCHES_FILE = ROOT / "hrms" / "patches.txt"


def require(source: str, marker: str, message: str = ""):
	if marker not in source:
		raise AssertionError(message or f"Missing contract marker: {marker}")


for path in (
	API_PATH, PROCESSOR_PATH,
	DOCTYPE_DIR / "hrms_attendance_processing_record.json", DOCTYPE_DIR / "hrms_attendance_processing_record.py",
	DEPARTMENT_MAPPING_DIR / "hrms_attendance_department_mapping.json", DEPARTMENT_MAPPING_DIR / "hrms_attendance_department_mapping.py",
	STATUS_SYNC_PATCH,
):
	if not path.exists():
		raise AssertionError(f"Missing attendance processing component: {path.relative_to(ROOT)}")

api = API_PATH.read_text(encoding="utf-8")
processor = PROCESSOR_PATH.read_text(encoding="utf-8")
doctype = json.loads((DOCTYPE_DIR / "hrms_attendance_processing_record.json").read_text(encoding="utf-8"))
batch = json.loads(BATCH_JSON.read_text(encoding="utf-8"))
status_sync_patch = STATUS_SYNC_PATCH.read_text(encoding="utf-8")
patches_file = PATCHES_FILE.read_text(encoding="utf-8")

for method in (
	"get_processing_batch",
	"register_source_file",
	"register_monthly_support_file",
	"precheck_monthly_support_file",
	"process_monthly_support_file",
	"confirm_monthly_support_file",
	"precheck_source_slot",
	"process_source_slot",
	"list_processing_results",
	"export_processing_result",
	"get_processing_record",
	"update_processing_record",
	"bulk_update_processing_records",
	"confirm_source_result",
	"list_processing_exceptions",
	"list_processing_batches",
	"list_manual_adjustments",
	"get_processing_configuration",
	"list_department_mappings",
	"upsert_department_mapping",
	"generate_monthly_final_files",
	"get_monthly_final_preview",
):
	require(api, f"def {method}(", f"Processing-center API is missing {method}.")

for marker in (
	"process_attendance_draft_rows",
	"process_apple_tree_rows",
	"process_missed_punch_rows",
	"processed_result",
	"ATTENDANCE_DRAFT_RESULT_COLUMNS",
	"MISSED_PUNCH_RESULT_COLUMNS",
	"MISSED_PUNCH_SIGNOFF_COLUMNS",
	"APPLE_TREE_SIGNOFF_COLUMNS",
	"def _missed_punch_summary",
	"红苹果金额",
	"processed_rows",
	"review_rows",
	"月度终稿来源未完备",
	"FINAL_SIGNED_COLUMNS",
	"FINAL_FINANCE_COLUMNS",
	"_monthly_final_rows",
	"monthly_final_outputs",
	"_monthly_snapshot_version",
	"_processing_state_hash",
	"MONTHLY_SUPPORT_SOURCE_TYPES",
	"MONTHLY_SUPPORT_SOURCE_CONFIG",
	"monthly_support_precheck",
	"_process_monthly_support_rows",
	"SPECIAL_HOURS_INVALID",
	"DUPLICATE_EMPLOYEE_RECORD",
	"单日工时汇总",
	"_require_processing_source_type(source_type)",
	"已识别字段，但未找到任何工号记录。",
	"住房补贴",
	"全勤奖",
	"特殊工时",
):
	require(api, marker)

# Lock the shared processor variants: Apple Tree uses include_in_downstream,
# while the other processors use eligible_for_downstream. Both must persist.
for marker in (
	"include_in_downstream",
	"downstream_eligible",
	"def _confirmed_downstream_eligible",
	'"eligible_for_downstream": 1 if downstream_eligible else 0',
	'row.review_status == "待审核"',
	"included_rows",
	"rejected_rows",
	"_refresh_batch_review_status",
	"processed_result_refreshed_on",
	"manual_review_update",
	"processed_result = _export_processed_result(batch)",
	"def _effective_result_values",
	'values["included"] = bool(row.get("eligible_for_downstream"))',
	"setattr(doc, identity_field",
	"custom_employee_code",
	"employee_number",
	"Internal document",
	"frappe.get_roles(frappe.session.user)",
	"{\"System Manager\", \"HR Manager\"}",
	"PROCESSING_FIELD_LABELS",
	"EXCEPTION_LABELS",
	"def _review_guidance",
	"def _review_options",
	"__review_decision__",
	"bulk_manual_review_update",
	"confirmed_with_pending_reviews",
	"pending_review_rows",
	"待审核记录不会阻塞来源确认",
	"批量处理仅适用于异常记录",
	"所选记录已经处理。若需更正，请逐条使用“查看/更正记录”。",
	"该来源已经确认；如需更正，请使用“查看/更正记录”。",
	"确认未打卡（不计入下游）",
	"def _department_comparison",
	"def _department_mapping_for",
	"HRMS Attendance Department Mapping",
	"创建人部门",
	"department_mapping=_department_mapping_for",
	"钉钉考勤表部门：{0}；花名册部门：{1}。",
	"source_department",
	"roster_department",
	"补卡时间",
	"补卡类型",
	"补卡理由",
	"审批结果",
	"审批状态",
	"红苹果",
	"红苹果金额",
	"result_summary",
):
	require(api, marker)

# A source has one download only.  It must be rebuilt from persisted records
# after every reviewer change, otherwise the download silently lags confirmed
# values and can diverge from downstream eligibility.
review_start = api.find("def update_processing_record(")
review_end = api.find("\ndef deepcopy_json", review_start)
review_body = api[review_start:review_end]
for marker in (
	"_confirmed_downstream_eligible(confirmed)",
	"_export_processed_result(batch)",
	'"processed_result": processed_result',
	"_save_batch_notes(batch",
):
	require(review_body, marker, f"Review updates must refresh the one processed-result download: {marker}")

# A human may record a review decision (for example, a checked-but-unmade
# punch) without fabricating a numeric adjustment just to close the queue.
for marker in (
	'decision_only = field_name == "__review_decision__"',
	"if not decision_only:",
	'"field_name": field_name',
):
	require(review_body, marker, f"Decision-only review contract missing: {marker}")

# Pending exceptions are visible and excluded from downstream calculation, but
# must not freeze a source or the rest of the monthly workflow.  Confirmation
# retains the exception queue and review history for later resolution.
confirm_start = api.find("def confirm_source_result(")
confirm_end = api.find("\n@frappe.whitelist()", confirm_start + 1)
confirm_body = api[confirm_start:] if confirm_end == -1 else api[confirm_start:confirm_end]
for marker in (
	'pending_review_rows = [row for row in rows if row.review_status == "待审核"]',
	'"confirmed_with_pending_reviews": bool(pending_review_rows)',
	'"pending_review_rows": len(pending_review_rows)',
):
	require(confirm_body, marker, f"Pending exceptions must not block source confirmation: {marker}")

if "if batch.status == \"已确认\":" not in confirm_body:
	raise AssertionError("Confirmed sources must reject duplicate confirmation and require an auditable correction path.")

# Every callable API must authorize before accessing the batch/record data.
for method in (
	"get_processing_batch", "register_source_file", "register_monthly_support_file", "precheck_monthly_support_file", "process_monthly_support_file", "confirm_monthly_support_file", "precheck_source_slot", "process_source_slot",
	"list_processing_results", "export_processing_result", "get_processing_record", "update_processing_record", "bulk_update_processing_records", "confirm_source_result",
	"list_processing_exceptions", "list_processing_batches", "list_manual_adjustments",
	"get_processing_configuration", "list_department_mappings", "upsert_department_mapping", "generate_monthly_final_files", "get_monthly_final_preview",
):
	start = api.find(f"def {method}(")
	end = api.find("\n@frappe.whitelist()", start + 1)
	body = api[start:] if end == -1 else api[start:end]
	if start == -1 or "_require_processing_manager()" not in body:
		raise AssertionError(f"{method} must enforce processing-manager permission.")

for marker in (
	"one employee per row",
	"standard_hours",
	"actual_attendance_hours",
	"workday_overtime_hours",
	"restday_overtime_hours",
	"holiday_overtime_hours",
	"ATTENDANCE_DATE_DUPLICATE",
	"EMPLOYEE_CODE_NAME_CONFLICT",
	"SHIFT_MISSING",
	"CLOCK_IN_MISSING",
	"CLOCK_OUT_MISSING",
	"_department_key",
	"设备组 and 设备课",
	"INVALID_NUMERIC_VALUE",
	"eligible_for_downstream",
	"source_rows",
):
	require(processor, marker)

fieldnames = {field["fieldname"] for field in doctype["fields"]}
for fieldname in (
	"import_batch", "company", "attendance_month", "source_type", "employee_code", "employee_name", "department",
	"processed_value_json", "original_value_json", "exception_codes", "exception_message", "review_status",
	"proposed_value_json", "confirmed_value_json", "reviewer", "reviewed_on", "review_note", "review_history_json",
	"eligible_for_downstream", "source_file", "source_sheet", "source_row", "source_id", "approval_no",
):
	if fieldname not in fieldnames:
		raise AssertionError(f"Unified processing record is missing field {fieldname}.")

source_type_options = next(field["options"] for field in doctype["fields"] if field["fieldname"] == "source_type")
for source_type in ("housing_allowance", "full_attendance", "special_hours"):
	require(source_type_options, source_type, f"Processing record must support monthly source {source_type}.")

status_options = next(field["options"] for field in batch["fields"] if field["fieldname"] == "status")
allowed_batch_statuses = set(status_options.splitlines())
for status in ("已导入", "已生成异常", "待加工", "结构异常", "待处理异常", "待确认", "已确认"):
	if status not in allowed_batch_statuses:
		raise AssertionError(f"Import batch must retain/add status {status}.")

# Mirror Frappe's Select validation for every literal status directly written
# to an import batch.  This catches the exact regression where the API wrote
# “结构异常” but the DocType did not permit that value.
written_batch_statuses = set(re.findall(r'batch\.status\s*=\s*"([^"]+)"', api))
unsupported_statuses = written_batch_statuses - allowed_batch_statuses
if unsupported_statuses:
	raise AssertionError(f"Import batch writes unsupported Select statuses: {sorted(unsupported_statuses)}")

# The Select definition protects new sites; this patch protects existing sites
# and any historic Property Setter that overrides the app-owned options.
require(patches_file, "hrms.patches.v16_0.sync_attendance_import_batch_status_options")
for marker in (
	'frappe.reload_doc("hr", "doctype", "hrms_attendance_import_batch")',
	'"Property Setter"',
	'"property": "options"',
	'REQUIRED_STATUS = "结构异常"',
	"frappe.clear_cache(doctype=DOCTYPE)",
):
	require(status_sync_patch, marker, f"Attendance status sync patch is incomplete: {marker}")

print("Attendance processing center contract passed.")
