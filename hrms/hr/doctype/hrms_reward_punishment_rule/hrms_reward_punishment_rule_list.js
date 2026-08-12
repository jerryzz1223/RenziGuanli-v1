/* global frappe, __ */

frappe.listview_settings["HRMS Reward Punishment Rule"] = {
	get_indicator(doc) {
		return doc.enabled
			? [__(doc.reward_punishment_type), doc.reward_punishment_type === "奖励" ? "green" : "orange", `reward_punishment_type,=,${doc.reward_punishment_type}`]
			: [__("已停用"), "grey", "enabled,=,0"];
	},
};
