import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt


DEFAULT_REWARD_PUNISHMENT_RULES = (
	{"reward_punishment_type": "奖励", "category": "嘉奖", "rate_percent": 8, "conversion_count": 3, "converts_to": "小功", "display_order": 10, "remarks": "3次嘉奖=1次小功"},
	{"reward_punishment_type": "奖励", "category": "小功", "rate_percent": 14, "conversion_count": 3, "converts_to": "大功", "display_order": 20, "remarks": "3次小功=1次大功"},
	{"reward_punishment_type": "奖励", "category": "大功", "rate_percent": 20, "conversion_count": 0, "converts_to": "", "display_order": 30, "remarks": ""},
	{"reward_punishment_type": "惩处", "category": "警告", "rate_percent": 8, "conversion_count": 3, "converts_to": "小过", "display_order": 40, "remarks": "3次警告=1次小过"},
	{"reward_punishment_type": "惩处", "category": "小过", "rate_percent": 14, "conversion_count": 3, "converts_to": "大过", "display_order": 50, "remarks": "3次小过=1次大过"},
	{"reward_punishment_type": "惩处", "category": "大过", "rate_percent": 20, "conversion_count": 3, "converts_to": "开除", "display_order": 60, "remarks": "3次大过=开除"},
	{"reward_punishment_type": "惩处", "category": "开除", "rate_percent": 100, "conversion_count": 0, "converts_to": "", "termination_action": 1, "display_order": 70, "remarks": "罚1个月全薪"},
)


def _standard_text(reward_punishment_type, category, rate_percent):
	if category == "开除":
		return "罚1个月全薪"
	direction = "奖" if reward_punishment_type == "奖励" else "罚"
	return f"{direction}全薪的{flt(rate_percent):g}%"


class HRMSRewardPunishmentRule(Document):
	def validate(self):
		self.category = (self.category or "").strip()
		self.converts_to = (self.converts_to or "").strip()
		if flt(self.rate_percent) < 0 or flt(self.rate_percent) > 100:
			frappe.throw(_("全薪比例必须在0%至100%之间。"))
		if cint(self.conversion_count) < 0:
			frappe.throw(_("折算所需次数不能为负数。"))
		if cint(self.conversion_count) and not self.converts_to:
			frappe.throw(_("配置折算次数后必须填写“折算为”。"))
		if self.converts_to == self.category:
			frappe.throw(_("奖惩类别不能折算为自身。"))
		duplicate = frappe.db.get_value(
			self.doctype,
			{"company": self.company, "category": self.category, "name": ["!=", self.name]},
			"name",
		)
		if duplicate:
			frappe.throw(_("公司 {0} 已存在奖惩类别“{1}”。").format(self.company, self.category))
		self.standard_text = _standard_text(self.reward_punishment_type, self.category, self.rate_percent)


def get_effective_reward_punishment_rule(company, category):
	name = frappe.db.get_value(
		"HRMS Reward Punishment Rule",
		{"company": company, "category": category, "enabled": 1},
		"name",
	)
	return frappe.get_doc("HRMS Reward Punishment Rule", name) if name else None


@frappe.whitelist()
def ensure_default_reward_punishment_rules(company: str = "", force: int = 0, ignore_permissions: bool = False):
	if not ignore_permissions:
		frappe.only_for(("System Manager", "HR Manager"))
	companies = [company] if company else frappe.get_all("Company", pluck="name")
	created = []
	updated = []
	for company_name in companies:
		for rule in DEFAULT_REWARD_PUNISHMENT_RULES:
			existing = frappe.db.get_value(
				"HRMS Reward Punishment Rule",
				{"company": company_name, "category": rule["category"]},
				"name",
			)
			values = {**rule, "company": company_name, "enabled": 1}
			if existing:
				if not cint(force):
					continue
				doc = frappe.get_doc("HRMS Reward Punishment Rule", existing)
				doc.update(values)
				doc.save(ignore_permissions=True)
				updated.append(doc.name)
				continue
			doc = frappe.get_doc({"doctype": "HRMS Reward Punishment Rule", **values})
			doc.insert(ignore_permissions=True)
			created.append(doc.name)
	return {"created": created, "updated": updated}
