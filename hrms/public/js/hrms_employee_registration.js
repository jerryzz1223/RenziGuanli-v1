/* global frappe, __ */

const REGISTRATION_API = "hrms.hr.doctype.hrms_employee_registration.hrms_employee_registration";

frappe.ui.form.on("HRMS Employee Registration", {
	refresh(frm) {
		const preset_fields = ["company", "department", "designation", "date_of_joining"];
		preset_fields.forEach((fieldname) => {
			frm.set_df_property(fieldname, "read_only", Boolean(frm.doc[fieldname]) && frm.doc.status !== "已驳回");
		});
		frm.set_df_property("status", "read_only", 1);
		if (!frm.is_new()) {
			frm.add_custom_button(__("查看填写二维码"), () => show_registration_qr(frm), __("员工扫码填写"));
		}
		if (frm.doc.status === "待审核") {
			const can_review = (frappe.user_roles || []).some((role) => ["HR Manager", "System Manager"].includes(role));
			if (can_review) {
				frm.add_custom_button(__("通过并创建员工"), () => approve_registration(frm), __("审核"));
				frm.add_custom_button(__("驳回"), () => reject_registration(frm), __("审核"));
			}
		}
	},
});

function registration_url() {
	return `${window.location.origin}/employee-registration`;
}

function show_registration_qr(frm) {
	frappe.call({
		method: `${REGISTRATION_API}.get_registration_qr_svg`,
		args: { name: frm.doc.name, url: registration_url() },
		freeze: true,
		freeze_message: __("正在生成二维码…"),
	}).then((response) => {
		const token_url = `${registration_url()}?token=${encodeURIComponent(response.message.token)}`;
		const dialog = new frappe.ui.Dialog({
			title: __("员工入职填写二维码"),
			fields: [{ fieldtype: "HTML", fieldname: "qr" }],
		});
		dialog.fields_dict.qr.$wrapper.html(`
			<div class="hrms-registration-qr-dialog">
				<div class="hrms-registration-qr-image">${response.message.svg}</div>
				<p class="text-muted">${__("员工使用任意二维码扫描软件，连接公司 Wi‑Fi 后扫码填写。")}</p>
				<div class="hrms-registration-qr-url">${frappe.utils.escape_html(token_url)}</div>
				<button class="btn btn-default hrms-copy-registration-url">${__("复制填写地址")}</button>
			</div>`);
			dialog.fields_dict.qr.$wrapper.find(".hrms-copy-registration-url").on("click", () => {
			frappe.utils.copy_to_clipboard(token_url);
			frappe.show_alert({ message: __("地址已复制"), indicator: "green" });
		});
		dialog.show();
	});
}

function approve_registration(frm) {
	const dialog = new frappe.ui.Dialog({
		title: __("审核通过并创建员工"),
		fields: [{ fieldtype: "Data", fieldname: "employee_code", label: __("公司工号"), reqd: 1, default: frm.doc.employee_code || "" }],
		primary_action_label: __("确认创建"),
		primary_action(values) {
			frappe.call({
				method: `${REGISTRATION_API}.approve_registration`,
				args: { name: frm.doc.name, employee_code: values.employee_code },
				freeze: true,
				freeze_message: __("正在创建员工档案…"),
			}).then((response) => {
				dialog.hide();
				frappe.msgprint(__("已创建员工：{0}", [response.message.employee_code]));
				frm.reload_doc();
			});
		},
	});
	dialog.show();
}

function reject_registration(frm) {
	const dialog = new frappe.ui.Dialog({
		title: __("驳回员工入职资料"),
		fields: [{ fieldtype: "Small Text", fieldname: "review_note", label: __("驳回原因"), reqd: 1 }],
		primary_action_label: __("确认驳回"),
		primary_action(values) {
			frappe.call({
				method: `${REGISTRATION_API}.reject_registration`,
				args: { name: frm.doc.name, review_note: values.review_note },
				freeze: true,
			}).then(() => { dialog.hide(); frm.reload_doc(); });
		},
	});
	dialog.show();
}

window.hrmsEmployeeRegistration = { show_registration_qr };
