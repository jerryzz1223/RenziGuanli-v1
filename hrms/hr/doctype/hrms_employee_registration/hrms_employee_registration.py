"""Internal-network employee onboarding links and review workflow."""

import base64
import hashlib
import html
import json
import re
import secrets
from datetime import timedelta

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, get_datetime, now_datetime

from hrms.utils.business_department import business_departments, is_business_department
from hrms.utils.employee_profile import normalise_profile_value


DOCTYPE = "HRMS Employee Registration"
PUBLIC_FIELDS = (
	"employee_code", "employee_name", "custom_id_type", "passport_number", "gender",
	"date_of_birth", "custom_ethnicity", "custom_native_place", "custom_marital_status_text",
	"permanent_address", "current_address", "cell_number", "personal_email", "custom_transport",
	"person_to_be_contacted", "relation", "emergency_phone_number", "custom_education_level",
	"custom_graduation_school", "custom_major", "custom_graduation_date", "custom_work_nature",
	"custom_direct_indirect", "custom_contract_type", "custom_contract_sign_date", "custom_contract_no",
	"custom_contract_sign_count", "contract_end_date", "bank_name", "bank_ac_no", "date_of_joining",
	"company", "department", "designation", "declaration_accepted",
)
ATTACHMENT_FIELDS = (
	"employee_photo", "id_card_front", "id_card_back", "household_register", "residence_permit",
	"education_certificate", "bank_card_photo", "former_employment_certificate", "marriage_certificate",
)
SELECT_OPTIONS = {
	"custom_id_type": {"身份证", "护照", "港澳通行证", "台胞证", "其他"},
	"gender": {"男", "女", "其他"},
	"custom_marital_status_text": {"未", "已", "离异", "丧偶"},
	"custom_work_nature": {"在职·正式", "在职·试用期", "退休返聘", "待离职", "离职"},
	"custom_direct_indirect": {"直接人员", "间接人员"},
	"custom_contract_type": {"固定期限", "无固定期限", "非全日制", "实习协议", "其他"},
	"relation": {"配偶", "父母", "子女", "兄弟姐妹", "其他"},
	"custom_education_level": {"初中", "高中", "中专", "大专", "本科", "研究生"},
}
EMPLOYEE_FIELD_MAP = {
	"employee_code": "custom_employee_code",
	"employee_name": "first_name",
	"custom_id_type": "custom_id_type",
	"passport_number": "passport_number",
	"gender": "gender",
	"date_of_birth": "date_of_birth",
	"custom_ethnicity": "custom_ethnicity",
	"custom_native_place": "custom_native_place",
	"custom_marital_status_text": "custom_marital_status_text",
	"permanent_address": "permanent_address",
	"current_address": "current_address",
	"cell_number": "cell_number",
	"personal_email": "personal_email",
	"custom_transport": "custom_transport",
	"person_to_be_contacted": "person_to_be_contacted",
	"relation": "relation",
	"emergency_phone_number": "emergency_phone_number",
	"custom_education_level": "custom_education_level",
	"custom_graduation_school": "custom_graduation_school",
	"custom_major": "custom_major",
	"date_of_joining": "date_of_joining",
	"company": "company",
	"department": "department",
	"designation": "designation",
	"custom_work_nature": "custom_work_nature",
	"custom_direct_indirect": "custom_direct_indirect",
	"custom_contract_sign_date": "custom_contract_sign_date",
	"custom_contract_no": "custom_contract_no",
	"custom_contract_sign_count": "custom_contract_sign_count",
	"contract_end_date": "contract_end_date",
	"bank_name": "bank_name",
	"bank_ac_no": "bank_ac_no",
}
GENDER_MAP = {"男": "Male", "女": "Female", "其他": "Other"}
PHONE_RE = re.compile(r"^(?:1\d{10}|0\d{2,3}-?\d{7,8})$")
ALLOWED_FILE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
MAX_FILE_BYTES = 8 * 1024 * 1024


def _require_hr_role(capability_key="employee_create"):
	from hrms.access_control import require_hrms_capability

	require_hrms_capability(capability_key)


def _token_hash(token):
	return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def _registration_by_token(token):
	token = str(token or "").strip()
	if len(token) < 20:
		frappe.throw(_("入职链接无效或已失效。"))
	name = frappe.db.get_value(DOCTYPE, {"token_hash": _token_hash(token)}, "name")
	if not name:
		frappe.throw(_("入职链接无效或已失效。"))
	doc = frappe.get_doc(DOCTYPE, name)
	if doc.status not in ("待填写", "待审核", "已驳回"):
		frappe.throw(_("该入职链接已不能继续填写。"))
	if doc.token_expires_on and get_datetime(doc.token_expires_on) < now_datetime():
		if doc.status == "待填写":
			doc.db_set("status", "已失效", update_modified=False)
		frappe.throw(_("该入职链接已过期，请联系人事重新生成。"))
	return doc


def _parse_json(value, default):
	if value in (None, ""):
		return default
	if isinstance(value, (dict, list)):
		return value
	try:
		return frappe.parse_json(value)
	except Exception:
		frappe.throw(_("提交数据格式不正确。"))


def _safe_file_name(file_name):
	name = re.sub(r"[^\w.\-\u4e00-\u9fff ]", "_", str(file_name or "").strip())[:120]
	if not name or "." not in name:
		frappe.throw(_("附件文件名无效。"))
	return name


def _save_private_attachment(doc, fieldname, file_item):
	if not isinstance(file_item, dict):
		frappe.throw(_("附件数据格式不正确。"))
	file_name = _safe_file_name(file_item.get("file_name"))
	file_extension = file_name.lower()
	if not any(file_extension.endswith(extension) for extension in ALLOWED_FILE_EXTENSIONS):
		frappe.throw(_("附件仅支持 JPG、PNG、WEBP 或 PDF。"))
	try:
		content = base64.b64decode(str(file_item.get("content") or ""), validate=True)
	except Exception:
		frappe.throw(_("附件内容无法读取。"))
	if not content or len(content) > MAX_FILE_BYTES:
		frappe.throw(_("每个附件必须大于 0 且不超过 8 MB。"))
	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"attached_to_doctype": DOCTYPE,
			"attached_to_name": doc.name,
			"attached_to_field": fieldname,
			"folder": "Home",
			"file_name": file_name,
			"content": content,
			"is_private": 1,
		}
	).insert(ignore_permissions=True)
	return file_doc.file_url


def _copy_attachments_to_employee(registration, employee):
	"""Keep the submitted evidence and add a private copy to the approved employee."""
	photo_url = ""
	for file_name in frappe.get_all(
		"File",
		filters={"attached_to_doctype": DOCTYPE, "attached_to_name": registration.name},
		pluck="name",
	):
		original = frappe.get_doc("File", file_name)
		copy = frappe.get_doc(
			{
				"doctype": "File",
				"attached_to_doctype": "Employee",
				"attached_to_name": employee.name,
				"attached_to_field": original.attached_to_field,
				"folder": "Home",
				"file_name": original.file_name,
				"content": original.get_content(),
				"is_private": 1,
			}
		).insert(ignore_permissions=True)
		if original.attached_to_field == "employee_photo":
			photo_url = copy.file_url
	if photo_url and frappe.get_meta("Employee").has_field("image"):
		employee.db_set("image", photo_url, update_modified=False)


def _department_designation_names(company, department):
	"""Return positions used or explicitly mapped to one department."""
	department = str(department or "").strip()
	if not department or not frappe.db.exists("Department", department):
		return []
	department_company = frappe.db.get_value("Department", department, "company")
	if company and department_company and department_company != company:
		return []
	designation_names = {
		str(name).strip()
		for name in frappe.get_all(
			"Employee",
			filters={"department": department, "company": company} if company else {"department": department},
			pluck="designation",
			limit_page_length=0,
		)
		if str(name or "").strip()
	}
	designation_meta = frappe.get_meta("Designation")
	if designation_meta.has_field("hrms_source_department"):
		designation_names.update(
			str(name).strip()
			for name in frappe.get_all(
				"Designation",
				filters={"hrms_source_department": department},
				pluck="name",
				limit_page_length=0,
			)
			if str(name or "").strip()
		)
	if not designation_names:
		return []
	rows = frappe.get_all(
		"Designation",
		filters={"name": ["in", list(designation_names)]},
		fields=["name", "designation_name"],
		order_by="designation_name asc, name asc",
		limit_page_length=500,
	)
	return [row.name for row in rows]


def _link_options(company, department=""):
	companies = frappe.get_all("Company", filters={"is_group": 0}, pluck="name", limit_page_length=200)
	department_filters = {}
	if frappe.get_meta("Department").has_field("company") and company:
		department_filters["company"] = company
	department_fields = ["name", "department_name"]
	if frappe.get_meta("Department").has_field("hrms_org_role"):
		department_fields.append("hrms_org_role")
	department_rows = frappe.get_all(
		"Department",
		filters=department_filters,
		fields=department_fields,
		order_by="department_name asc, name asc",
		limit_page_length=500,
	)
	departments = [row.name for row in business_departments(department_rows)]
	designations = _department_designation_names(company, department)
	return {"companies": companies, "departments": departments, "designations": designations}


def _validate_links(values):
	company = str(values.get("company") or "").strip()
	department = str(values.get("department") or "").strip()
	designation = str(values.get("designation") or "").strip()
	if not company or not frappe.db.exists("Company", company):
		frappe.throw(_("请选择有效的公司。"))
	for doctype, fieldname in (("Department", "department"), ("Designation", "designation")):
		value = str(values.get(fieldname) or "").strip()
		if not value:
			continue
		if not frappe.db.exists(doctype, value):
			frappe.throw(_("{0}不存在：{1}").format(_(fieldname), value))
		if doctype == "Department":
			department_meta = frappe.get_meta(doctype)
			department_fields = ["name", "department_name"]
			if department_meta.has_field("company"):
				department_fields.append("company")
			if department_meta.has_field("hrms_org_role"):
				department_fields.append("hrms_org_role")
			department_row = frappe.db.get_value(doctype, value, department_fields, as_dict=True)
			if department_row.get("company") and department_row.company != company:
				frappe.throw(_("部门不属于所选公司。"))
			if not is_business_department(department_row):
				frappe.throw(_("组是组织内分组，不是员工所属部门，请选择部门或课别。"))
	if department and designation and designation not in _department_designation_names(company, department):
		frappe.throw(_("岗位不属于所选部门，请重新选择岗位。"))


def _validate_submission(doc, values):
	if not str(values.get("employee_name") or "").strip():
		frappe.throw(_("请填写姓名。"))
	if not str(values.get("passport_number") or "").strip():
		frappe.throw(_("请填写证件号码。"))
	if not values.get("date_of_birth"):
		frappe.throw(_("请选择出生日期。"))
	if not values.get("date_of_joining"):
		frappe.throw(_("请选择入职日期。"))
	for fieldname, label in (("company", "公司"), ("department", "部门"), ("designation", "岗位"), ("custom_education_level", "学历"), ("bank_name", "开户行"), ("bank_ac_no", "银行卡号"), ("person_to_be_contacted", "紧急联系人姓名"), ("relation", "联系人关系"), ("emergency_phone_number", "紧急联系人电话")):
		if not str(values.get(fieldname) or "").strip():
			frappe.throw(_("请填写{0}。" ).format(label))
	phone = str(values.get("cell_number") or "").strip().replace(" ", "")
	if not PHONE_RE.match(phone):
		frappe.throw(_("请填写有效的手机号码或座机号码。"))
	if not values.get("declaration_accepted"):
		frappe.throw(_("请先确认资料真实、准确。"))
	native_place_field = frappe.get_meta(DOCTYPE).get_field("custom_native_place")
	if native_place_field and values.get("custom_native_place") not in (None, ""):
		values["custom_native_place"] = normalise_profile_value(
			"custom_native_place", values["custom_native_place"], native_place_field.options
		)
		allowed_native_places = {
			str(option).strip() for option in native_place_field.options.splitlines() if str(option).strip()
		}
		if values["custom_native_place"] not in allowed_native_places:
			frappe.throw(_("籍贯无法识别为有效的省级行政区，请填写城市或省份名称。"))
	for fieldname, allowed in SELECT_OPTIONS.items():
		value = str(values.get(fieldname) or "").strip()
		if value and value not in allowed:
			frappe.throw(_("{0}的选项无效。" ).format(fieldname))
	_validate_links(values)
	if doc.employee_code and values.get("employee_code") and doc.employee_code != values["employee_code"]:
		frappe.throw(_("该二维码的工号不能修改，请联系人事重新生成。"))


def _public_values(doc):
	return {fieldname: doc.get(fieldname) for fieldname in PUBLIC_FIELDS if doc.meta.has_field(fieldname)}


class HRMSEmployeeRegistration(Document):
	def before_insert(self):
		if not self.invited_by or self.invited_by == "Guest":
			self.invited_by = frappe.session.user
		token = self.token_secret or secrets.token_urlsafe(18)
		self.token_secret = token
		if not self.token_hash:
			self.token_hash = _token_hash(token)
		if not self.token_expires_on:
			self.token_expires_on = now_datetime() + timedelta(days=30)
		if not self.status:
			self.status = "待填写"

	def validate(self):
		if self.company:
			_validate_links(self.as_dict())


@frappe.whitelist()
def create_registration_link(company: str, department: str = "", designation: str = "", date_of_joining: str = "", expires_days: int = 30):
	"""Create a tokenized link for HR; the token itself is never stored in the database."""
	_require_hr_role()
	company = str(company or "").strip()
	if not company:
		frappe.throw(_("请选择公司。"))
	_validate_links({"company": company, "department": department, "designation": designation})
	token = secrets.token_urlsafe(18)
	doc = frappe.get_doc(
		{
			"doctype": DOCTYPE,
			"company": company,
			"department": department or None,
			"designation": designation or None,
			"date_of_joining": date_of_joining or None,
			"invited_by": frappe.session.user,
			"status": "待填写",
			"token_hash": _token_hash(token),
			"token_secret": token,
			"token_expires_on": now_datetime() + timedelta(days=max(1, min(cint(expires_days or 30), 90))),
		}
	).insert(ignore_permissions=True)
	return {"name": doc.name, "token": token, "expires_on": doc.token_expires_on, "status": doc.status}


@frappe.whitelist(allow_guest=True)
def get_public_registration(token: str):
	doc = _registration_by_token(token)
	meta = frappe.get_meta(DOCTYPE)
	profile_options = {}
	for fieldname in ("custom_ethnicity", "custom_native_place"):
		field = meta.get_field(fieldname)
		if field:
			profile_options[fieldname] = [option for option in field.options.splitlines() if option.strip()]
	return {
		"registration": _public_values(doc),
		"status": doc.status,
		"review_note": doc.review_note or "",
		"expires_on": doc.token_expires_on,
		"options": _link_options(doc.company, doc.department),
		"profile_options": profile_options,
		"editable_preset_fields": [field for field in ("company", "department", "designation", "date_of_joining") if not doc.get(field)],
		"required_attachments": ["employee_photo", "id_card_front", "id_card_back", "household_register", "bank_card_photo"],
	}


@frappe.whitelist(allow_guest=True)
def get_public_designations(token: str, department: str = ""):
	"""Return only positions allowed for the token's company and department."""
	doc = _registration_by_token(token)
	department = str(department or "").strip()
	if not department:
		return {"designations": []}
	if doc.department and doc.department != department:
		frappe.throw(_("该二维码的部门不能修改。"))
	if not frappe.db.exists("Department", department):
		frappe.throw(_("请选择有效的部门。"))
	return {"designations": _department_designation_names(doc.company, department)}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def submit_public_registration(token: str, data=None, files=None):
	doc = _registration_by_token(token)
	if doc.status == "待审核":
		frappe.throw(_("资料已经提交，请等待人事审核，不能重复提交。"))
	values = _parse_json(data, {})
	files = _parse_json(files, [])
	if not isinstance(values, dict) or not isinstance(files, list):
		frappe.throw(_("提交数据格式不正确。"))
	effective = _public_values(doc)
	for fieldname in PUBLIC_FIELDS:
		if fieldname in values and values[fieldname] not in (None, ""):
			effective[fieldname] = str(values[fieldname]).strip() if isinstance(values[fieldname], str) else values[fieldname]
	# The inviter's organization preset is authoritative.
	for fieldname in ("company", "department", "designation", "date_of_joining"):
		if doc.get(fieldname):
			effective[fieldname] = doc.get(fieldname)
	_validate_submission(doc, effective)
	received_attachment_fields = {str(item.get("fieldname") or "") for item in files if isinstance(item, dict)}
	for fieldname in ("employee_photo", "id_card_front", "id_card_back", "household_register", "bank_card_photo"):
		if not doc.get(fieldname) and fieldname not in received_attachment_fields:
			frappe.throw(_("请上传{0}。" ).format(fieldname))
	for fieldname, value in effective.items():
		if fieldname in PUBLIC_FIELDS and fieldname not in {"declaration_accepted"} and value not in (None, ""):
			setattr(doc, fieldname, value)
	doc.save(ignore_permissions=True, ignore_mandatory=True)

	file_fields = set(ATTACHMENT_FIELDS)
	for item in files:
		fieldname = str(item.get("fieldname") or "") if isinstance(item, dict) else ""
		if fieldname not in file_fields:
			frappe.throw(_("附件字段无效。"))
		setattr(doc, fieldname, _save_private_attachment(doc, fieldname, item))
	doc.status = "待审核"
	doc.submitted_on = now_datetime()
	doc.save(ignore_permissions=True, ignore_mandatory=True)
	return {"name": doc.name, "status": doc.status, "message": _("资料已提交，请等待人事审核。")}


@frappe.whitelist()
def get_registration_qr_svg(name: str, url: str):
	_require_hr_role()
	doc = frappe.get_doc(DOCTYPE, name)
	url = str(url or "").strip()
	if not url.startswith(("http://", "https://")) or len(url.encode("utf-8")) > 180:
		frappe.throw(_("二维码地址无效或过长，请使用公司内网地址。"))
	token = doc.get_password("token_secret")
	if not token or _token_hash(token) != doc.token_hash:
		frappe.throw(_("入职链接密钥不存在，请重新生成。"))
	separator = "&" if "?" in url else "?"
	return {"svg": _make_qr_svg(f"{url}{separator}token={token}"), "token": token}


@frappe.whitelist()
def approve_registration(name: str, employee_code: str = ""):
	_require_hr_role("employee_create_approve")
	doc = frappe.get_doc(DOCTYPE, name)
	if doc.status != "待审核":
		frappe.throw(_("只有待审核资料可以通过。"))
	employee_code = str(employee_code or doc.employee_code or "").strip()
	if not employee_code or employee_code.startswith("HR-EMP-"):
		frappe.throw(_("请填写有效的公司工号，不能使用系统内部编号。"))
	if frappe.db.exists("Employee", {"custom_employee_code": employee_code}):
		frappe.throw(_("公司工号 {0} 已存在，请先核对是否重复提交。" ).format(employee_code))
	values = _public_values(doc)
	values["employee_code"] = employee_code
	_validate_submission(doc, {**values, "declaration_accepted": 1})
	employee_values = {"doctype": "Employee"}
	employee_meta = frappe.get_meta("Employee")
	for source, target in EMPLOYEE_FIELD_MAP.items():
		value = values.get(source)
		if value not in (None, "") and employee_meta.has_field(target):
			employee_values[target] = GENDER_MAP.get(value, value)
	employee_values["employee_name"] = values.get("employee_name")
	employee = frappe.get_doc(employee_values)
	employee.flags.hrms_employee_registration = True
	employee.insert(ignore_permissions=True)
	_copy_attachments_to_employee(doc, employee)
	doc.status = "已通过"
	doc.employee_code = employee_code
	doc.reviewed_by = frappe.session.user
	doc.reviewed_on = now_datetime()
	doc.save(ignore_permissions=True, ignore_mandatory=True)
	return {"registration": doc.name, "employee": employee.name, "employee_code": employee_code, "status": doc.status}


@frappe.whitelist()
def reject_registration(name: str, review_note: str):
	_require_hr_role("employee_create_approve")
	doc = frappe.get_doc(DOCTYPE, name)
	if doc.status != "待审核":
		frappe.throw(_("只有待审核资料可以驳回。"))
	if not str(review_note or "").strip():
		frappe.throw(_("驳回时必须填写原因。"))
	doc.status = "已驳回"
	doc.review_note = str(review_note).strip()
	doc.reviewed_by = frappe.session.user
	doc.reviewed_on = now_datetime()
	doc.save(ignore_permissions=True, ignore_mandatory=True)
	return {"name": doc.name, "status": doc.status}


# A small dependency-free QR encoder for short internal URLs.  It supports QR
# versions 1-5 with error correction L, enough for the tokenized registration
# URL while keeping the intranet page independent of a CDN or external service.
_QR_TABLE = ((26, 19, 7), (44, 34, 10), (70, 55, 15), (100, 80, 20), (134, 108, 26))
_QR_ALIGNMENT = {2: (6, 18), 3: (6, 22), 4: (6, 26), 5: (6, 30)}


def _gf_mul(x, y):
	result = 0
	while y:
		if y & 1:
			result ^= x
		y >>= 1
		x <<= 1
		if x & 0x100:
			x ^= 0x11D
	return result


def _qr_ec_codewords(data, count):
	generator = [1]
	root = 1
	for _ in range(count):
		updated = [0] * (len(generator) + 1)
		for index, coefficient in enumerate(generator):
			updated[index] ^= coefficient
			updated[index + 1] ^= _gf_mul(coefficient, root)
		generator = updated
		root = _gf_mul(root, 2)
	remainder = [0] * count
	for value in data:
		factor = value ^ remainder[0]
		remainder = remainder[1:] + [0]
		for index in range(count):
			remainder[index] ^= _gf_mul(generator[index + 1], factor)
	return remainder


def _qr_format_bits(mask=0):
	value = (1 << 3) | mask  # error correction L = 01
	bits = value << 10
	while bits.bit_length() >= 11:
		bits ^= 0x537 << (bits.bit_length() - 11)
	return ((value << 10) | bits) ^ 0x5412


def _qr_matrix(text):
	encoded = text.encode("utf-8")
	version = next((index + 1 for index, (_, capacity, _) in enumerate(_QR_TABLE) if len(encoded) <= capacity - 2), None)
	if not version:
		frappe.throw(_("二维码内容过长，请使用较短的内网域名。"))
	total_codewords, data_codewords, ec_count = _QR_TABLE[version - 1]
	bits = [0, 1, 0, 0] + [(len(encoded) >> shift) & 1 for shift in range(7, -1, -1)]
	for value in encoded:
		bits.extend((value >> shift) & 1 for shift in range(7, -1, -1))
	bits.extend([0] * min(4, data_codewords * 8 - len(bits)))
	bits.extend([0] * ((8 - len(bits) % 8) % 8))
	data = [sum(bits[index + offset] << (7 - offset) for offset in range(8)) for index in range(0, len(bits), 8)]
	pad = (0xEC, 0x11)
	for index in range(len(data), data_codewords):
		data.append(pad[index % 2])
	codewords = data + _qr_ec_codewords(data, ec_count)
	all_bits = [bit for value in codewords for bit in ((value >> shift) & 1 for shift in range(7, -1, -1))]

	size = version * 4 + 17
	modules = [[None for _ in range(size)] for _ in range(size)]

	def set_module(row, col, value):
		if 0 <= row < size and 0 <= col < size:
			modules[row][col] = bool(value)

	def finder(row, col):
		for dy in range(-1, 8):
			for dx in range(-1, 8):
				set_module(row + dy, col + dx, 0 <= dx <= 6 and 0 <= dy <= 6 and (dx in (0, 6) or dy in (0, 6) or 2 <= dx <= 4 and 2 <= dy <= 4))

	finder(0, 0)
	finder(size - 7, 0)
	finder(0, size - 7)
	for index in range(8, size - 8):
		if modules[6][index] is None:
			set_module(6, index, index % 2 == 0)
		if modules[index][6] is None:
			set_module(index, 6, index % 2 == 0)
	if version >= 2:
		centers = _QR_ALIGNMENT[version]
		for row in centers:
			for col in centers:
				if modules[row][col] is not None:
					continue
				for dy in range(-2, 3):
					for dx in range(-2, 3):
						set_module(row + dy, col + dx, max(abs(dx), abs(dy)) != 1)
	# Reserve format information and place the fixed dark module.
	for index in range(15):
		set_module(index if index < 6 else index + 1 if index < 8 else size - 15 + index, 8, False)
		set_module(8, size - index - 1 if index < 8 else 15 - index if index < 9 else 14 - index, False)
	set_module(size - 8, 8, True)
	row, direction, bit_index, col = size - 1, -1, 0, size - 1
	while col > 0:
		if col == 6:
			col -= 1
		while True:
			for current_col in (col, col - 1):
				if modules[row][current_col] is None:
					value = all_bits[bit_index] if bit_index < len(all_bits) else 0
					bit_index += 1
					modules[row][current_col] = bool(value ^ ((row + current_col) % 2 == 0))
			row += direction
			if row < 0 or row >= size:
				row -= direction
				direction = -direction
				break
		col -= 2
	format_bits = _qr_format_bits()
	for index in range(15):
		value = (format_bits >> index) & 1
		set_module(index if index < 6 else index + 1 if index < 8 else size - 15 + index, 8, value)
		set_module(8, size - index - 1 if index < 8 else 15 - index if index < 9 else 14 - index, value)
	set_module(size - 8, 8, True)
	return modules


def _make_qr_svg(text):
	modules = _qr_matrix(text)
	size = len(modules)
	quiet = 4
	paths = []
	for row, values in enumerate(modules):
		for col, value in enumerate(values):
			if value:
				paths.append(f"M{col + quiet},{row + quiet}h1v1h-1z")
	path = "".join(paths)
	view_box = size + quiet * 2
	return (
		f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {view_box} {view_box}" '
		f'role="img" aria-label="员工入职填写二维码"><rect width="100%" height="100%" fill="#fff"/>'
		f'<path d="{html.escape(path)}" fill="#000" shape-rendering="crispEdges"/></svg>'
	)
