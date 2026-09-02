from frappe.model.document import Document
from frappe.utils import cstr, now_datetime


class OrganizationStructureVersion(Document):
	def validate(self):
		self.version_code = cstr(self.version_code).strip()
		if not self.imported_on:
			self.imported_on = now_datetime()

