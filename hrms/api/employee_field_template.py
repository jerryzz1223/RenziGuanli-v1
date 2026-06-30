import hashlib
import json
import re

import frappe
from frappe import _
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


TEMPLATE_DOCTYPE = "HRMS Employee Field Template"
TEMPLATE_CHILD_TABLE = "HRMS Employee Field Template Item"
EMPLOYEE_DOCTYPE = "Employee"

EMPLOYEE_TEMPLATE_CATEGORIES = ["在职信息", "个人信息", "联系信息", "工资社保", "个税申报"]

EMPLOYEE_SYSTEM_FIELDS = [
	{
		"category": "在职信息",
		"field_label": "工号",
		"fieldname": "name",
		"fieldtype": "Data",
		"description": "员工唯一编号",
		"insert_after": "naming_series",
	},
	{
		"category": "在职信息",
		"field_label": "公司",
		"fieldname": "company",
		"fieldtype": "Link",
		"description": "员工所属公司",
		"insert_after": "employee_name",
	},
	{
		"category": "在职信息",
		"field_label": "部门",
		"fieldname": "department",
		"fieldtype": "Link",
		"description": "员工所属部门",
		"insert_after": "company",
	},
	{
		"category": "在职信息",
		"field_label": "职位",
		"fieldname": "designation",
		"fieldtype": "Link",
		"description": "员工当前职位",
		"insert_after": "department",
	},
	{
		"category": "在职信息",
		"field_label": "上级主管",
		"fieldname": "reports_to",
		"fieldtype": "Link",
		"description": "员工汇报对象",
		"insert_after": "designation",
	},
	{
		"category": "在职信息",
		"field_label": "工作性质",
		"fieldname": "employment_type",
		"fieldtype": "Link",
		"description": "全职、实习、外包等",
		"insert_after": "reports_to",
	},
	{
		"category": "在职信息",
		"field_label": "入职日期",
		"fieldname": "date_of_joining",
		"fieldtype": "Date",
		"description": "员工入职日期",
		"insert_after": "employment_type",
	},
	{
		"category": "在职信息",
		"field_label": "状态",
		"fieldname": "status",
		"fieldtype": "Select",
		"description": "员工当前状态",
		"insert_after": "date_of_joining",
	},
	{
		"category": "个人信息",
		"field_label": "姓名",
		"fieldname": "employee_name",
		"fieldtype": "Data",
		"description": "员工真实姓名",
		"insert_after": "naming_series",
	},
	{
		"category": "个人信息",
		"field_label": "性别",
		"fieldname": "gender",
		"fieldtype": "Link",
		"description": "员工性别",
		"insert_after": "employee_name",
	},
	{
		"category": "个人信息",
		"field_label": "出生日期",
		"fieldname": "date_of_birth",
		"fieldtype": "Date",
		"description": "员工出生日期",
		"insert_after": "gender",
	},
	{
		"category": "个人信息",
		"field_label": "证件号码",
		"fieldname": "passport_number",
		"fieldtype": "Data",
		"description": "身份证、护照等证件号码",
		"insert_after": "date_of_birth",
	},
	{
		"category": "联系信息",
		"field_label": "手机号",
		"fieldname": "cell_number",
		"fieldtype": "Data",
		"description": "主要联系电话",
		"insert_after": "personal_email",
	},
	{
		"category": "联系信息",
		"field_label": "公司邮箱",
		"fieldname": "company_email",
		"fieldtype": "Data",
		"description": "公司邮箱",
		"insert_after": "cell_number",
	},
	{
		"category": "联系信息",
		"field_label": "个人电子邮件",
		"fieldname": "personal_email",
		"fieldtype": "Data",
		"description": "个人邮箱",
		"insert_after": "prefered_email",
	},
	{
		"category": "联系信息",
		"field_label": "紧急联系人姓名",
		"fieldname": "person_to_be_contacted",
		"fieldtype": "Data",
		"description": "紧急联系人",
		"insert_after": "company_email",
	},
	{
		"category": "联系信息",
		"field_label": "紧急电话",
		"fieldname": "emergency_phone_number",
		"fieldtype": "Data",
		"description": "紧急联系人电话",
		"insert_after": "person_to_be_contacted",
	},
]

FIELD_TYPE_MAP = {
	"文本格式": "Data",
	"日期格式": "Date",
	"自定义选项": "Select",
	"长文本格式": "Small Text",
	"Data": "Data",
	"Date": "Date",
	"Select": "Select",
	"Small Text": "Small Text",
	"Check": "Check",
	"Link": "Link",
}

CATEGORY_INSERT_AFTER = {
	"在职信息": "date_of_joining",
	"个人信息": "date_of_birth",
	"联系信息": "emergency_phone_number",
	"工资社保": "salary_mode",
	"个税申报": "salary_mode",
}


def _parse_json(value, fallback):
	if value is None:
		return fallback
	if isinstance(value, str):
		return json.loads(value) if value else fallback
	return value


def _validate_category(category):
	if category not in EMPLOYEE_TEMPLATE_CATEGORIES:
		frappe.throw(_("无效的员工属性分类: {0}").format(category))


def _normalise_fieldtype(fieldtype):
	fieldtype = FIELD_TYPE_MAP.get(fieldtype)
	if not fieldtype:
		frappe.throw(_("不支持的字段类型"))
	return fieldtype


def _make_custom_fieldname(field_label):
	slug = re.sub(r"[^a-z0-9_]+", "_", frappe.scrub(field_label or "").lower()).strip("_")
	if not slug:
		slug = hashlib.sha1((field_label or "").encode("utf-8")).hexdigest()[:10]
	return f"custom_hrms_{slug}"[:140]


def _get_template_doc():
	doc = frappe.get_single(TEMPLATE_DOCTYPE)
	if doc.enabled is None:
		doc.enabled = 1
	_seed_system_fields(doc)
	return doc


def _template_item_exists(doc, fieldname):
	return any(row.fieldname == fieldname for row in doc.template_items)


def _seed_system_fields(doc):
	changed = False
	for item in EMPLOYEE_SYSTEM_FIELDS:
		if _template_item_exists(doc, item["fieldname"]):
			continue
		doc.append(
			"template_items",
			{
				**item,
				"source": "系统",
				"enabled": 1,
				"search_enabled": 0,
			},
		)
		changed = True

	if changed:
		doc.save(ignore_permissions=True)


def _serialize_item(row):
	return {
		"category": row.category,
		"field_label": row.field_label,
		"fieldname": row.fieldname,
		"fieldtype": row.fieldtype,
		"description": row.description,
		"source": row.source,
		"enabled": int(row.enabled or 0),
		"search_enabled": int(row.search_enabled or 0),
		"options": row.options,
		"insert_after": row.insert_after,
		"idx": row.idx,
	}


def _get_rows_by_category(doc):
	fields = [_serialize_item(row) for row in doc.template_items]
	categories = []
	for category in EMPLOYEE_TEMPLATE_CATEGORIES:
		categories.append(
			{
				"label": category,
				"fields": [field for field in fields if field["category"] == category],
			}
		)
	return categories


@frappe.whitelist()
def get_employee_field_template():
	doc = _get_template_doc()
	fields = [_serialize_item(row) for row in doc.template_items]
	return {
		"enabled": int(doc.enabled or 0),
		"categories": _get_rows_by_category(doc),
		"fields": fields,
	}


@frappe.whitelist()
def save_employee_field_template(items):
	items = _parse_json(items, [])
	doc = _get_template_doc()
	rows_by_fieldname = {row.fieldname: row for row in doc.template_items}

	for item in items:
		fieldname = item.get("fieldname")
		if fieldname not in rows_by_fieldname:
			frappe.throw(_("字段不存在: {0}").format(fieldname))

		row = rows_by_fieldname[fieldname]
		if item.get("category"):
			_validate_category(item["category"])
			row.category = item["category"]

		if "description" in item:
			row.description = item.get("description")
		if "enabled" in item:
			row.enabled = 1 if item.get("enabled") else 0
		if "search_enabled" in item:
			row.search_enabled = 1 if item.get("search_enabled") else 0

	doc.save(ignore_permissions=True)
	return get_employee_field_template()


@frappe.whitelist()
def create_employee_custom_field(
	category,
	field_label,
	fieldtype,
	description=None,
	options=None,
	search_enabled=False,
):
	_validate_category(category)
	fieldtype = _normalise_fieldtype(fieldtype)

	field_label = (field_label or "").strip()
	if not field_label or len(field_label) > 30:
		frappe.throw(_("字段名称不能为空且不能超过 30 个字符"))

	options = (options or "").strip()
	if fieldtype == "Select" and not options:
		frappe.throw(_("自定义选项字段必须填写选项"))

	doc = _get_template_doc()
	fieldname = _make_custom_fieldname(field_label)

	if _template_item_exists(doc, fieldname):
		frappe.throw(_("员工属性字段已存在: {0}").format(field_label))

	custom_field_name = f"{EMPLOYEE_DOCTYPE}-{fieldname}"
	if not frappe.db.exists("Custom Field", custom_field_name):
		custom_field = {
			"fieldname": fieldname,
			"label": field_label,
			"fieldtype": fieldtype,
			"insert_after": CATEGORY_INSERT_AFTER.get(category, "date_of_joining"),
			"description": description,
		}
		if fieldtype == "Select":
			custom_field["options"] = options
		create_custom_field(EMPLOYEE_DOCTYPE, custom_field)

	doc.append(
		"template_items",
		{
			"category": category,
			"field_label": field_label,
			"fieldname": fieldname,
			"fieldtype": fieldtype,
			"description": description,
			"source": "自定义",
			"enabled": 1,
			"search_enabled": 1 if search_enabled else 0,
			"options": options,
			"insert_after": CATEGORY_INSERT_AFTER.get(category, "date_of_joining"),
		},
	)
	doc.save(ignore_permissions=True)
	frappe.clear_cache(doctype=EMPLOYEE_DOCTYPE)
	return get_employee_field_template()


@frappe.whitelist()
def set_employee_template_field_enabled(fieldname, enabled):
	doc = _get_template_doc()
	for row in doc.template_items:
		if row.fieldname == fieldname:
			row.enabled = 1 if frappe.utils.cint(enabled) else 0
			doc.save(ignore_permissions=True)
			return get_employee_field_template()

	frappe.throw(_("字段不存在: {0}").format(fieldname))
