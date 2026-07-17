from frappe.model.document import Document


class HRMSBusinessProcessRecord(Document):
	"""Formal, auditable destination for HR forms that do not alter a master directly."""
