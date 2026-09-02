from frappe.model.document import Document
from frappe.utils import cstr


class GradeTag(Document):
	def validate(self):
		self.tag_code = cstr(self.tag_code).strip()
		self.tag_name = cstr(self.tag_name).strip()
