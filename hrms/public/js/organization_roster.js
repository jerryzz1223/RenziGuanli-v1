window.hrmsOrganizationRoster = {
	async open(department) {
		const { message: base } = await frappe.call({ method: "hrms.api.organization_roster.get_base", args: { department } });
		const escape = value => frappe.utils.escape_html(String(value || ""));
		const groups = new Map();
		base.rows.forEach(row => {
			const key = JSON.stringify([row.grade || "未设置职级", row.designation || "未设置职位"]);
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(row);
		});
		const content = [...groups].sort(([a], [b]) => a.localeCompare(b, "zh")).map(([key, rows]) => {
			const [grade, designation] = JSON.parse(key);
			return `<tr><td>${escape(grade)}</td><td>${escape(designation)}</td><td>${rows.length}</td><td>${rows.map(row => `<button class="btn btn-default btn-xs" data-roster-employee="${escape(row.name)}">${escape(row.employee_name)} · ${escape(row.custom_employee_code || row.name)}</button>`).join(" ")}</td></tr>`;
		}).join("");
		const dialog = new frappe.ui.Dialog({ title: `${department} · 花名册职位与人员`, size: "extra-large", fields: [{ fieldtype: "HTML", fieldname: "summary", options: `<p>在职员工 ${base.employee_count} 人 · 按花名册部门、职级和职位统计，组织图从这里选人。</p><table class="table table-bordered"><thead><tr><th>职级</th><th>职位</th><th>人数</th><th>员工</th></tr></thead><tbody>${content || '<tr><td colspan="4">花名册中暂无归属该部门的在职员工。</td></tr>'}</tbody></table>` }], primary_action_label: __("关闭"), primary_action: () => dialog.hide() });
		dialog.show();
		dialog.fields_dict.summary.$wrapper.on("click", "[data-roster-employee]", event => { dialog.hide(); frappe.set_route("employee-detail", event.currentTarget.dataset.rosterEmployee); });
	},
};
