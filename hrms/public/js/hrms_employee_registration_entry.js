/* global frappe, __ */

(function () {
	const REGISTRATION_API = "hrms.hr.doctype.hrms_employee_registration.hrms_employee_registration";
	const EMPLOYEE_DOCTYPE = "Employee";

	function is_employee_roster_page() {
		return window.location.pathname === "/desk/employee";
	}

	function normalise_button_text(button) {
		return String(button?.textContent || "").replace(/\s+/g, " ").trim();
	}

	function get_registration_url() {
		return `${window.location.origin}/employee-registration`;
	}

	function open_registration_qr() {
		const company = frappe.defaults.get_user_default("Company") || "";
		if (!company) {
			frappe.msgprint(__("请先设置默认公司，再生成员工填写二维码。"));
			return;
		}

		frappe.call({
			method: `${REGISTRATION_API}.create_registration_link`,
			args: { company, expires_days: 30 },
			freeze: true,
			freeze_message: __("正在生成一次性填写链接…"),
		}).then((response) => {
			const link = response.message;
			const base_url = get_registration_url();
			return frappe.call({
				method: `${REGISTRATION_API}.get_registration_qr_svg`,
				args: { name: link.name, url: base_url },
			}).then((qr_response) => show_registration_qr(qr_response.message, base_url, link.token));
		});
	}

	function show_registration_qr(qr, base_url, token) {
		const url = `${base_url}?token=${encodeURIComponent(token)}`;
		const dialog = new frappe.ui.Dialog({
			title: __("员工入职填写二维码"),
			fields: [{ fieldtype: "HTML", fieldname: "qr" }],
		});
		dialog.fields_dict.qr.$wrapper.html(`
			<div class="hrms-registration-qr-dialog">
				<div class="hrms-registration-qr-image">${qr.svg}</div>
				<p class="text-muted">${__("员工连接公司 Wi‑Fi 后，使用任意二维码扫描软件扫码填写。")}</p>
				<div class="hrms-registration-qr-url">${frappe.utils.escape_html(url)}</div>
				<button class="btn btn-default hrms-copy-registration-url">${__("复制填写地址")}</button>
				<div><a href="#" class="hrms-registration-manual-entry">${__("手动填写")}</a></div>
			</div>`);
		dialog.fields_dict.qr.$wrapper.find(".hrms-copy-registration-url").on("click", () => {
			frappe.utils.copy_to_clipboard(url);
			frappe.show_alert({ message: __("地址已复制"), indicator: "green" });
		});
		dialog.fields_dict.qr.$wrapper.find(".hrms-registration-manual-entry").on("click", (event) => {
			event.preventDefault();
			dialog.hide();
			frappe.new_doc(EMPLOYEE_DOCTYPE);
		});
		dialog.show();
	}

	document.addEventListener("click", (event) => {
		if (!is_employee_roster_page()) return;
		const button = event.target?.closest?.("button");
		if (!button || normalise_button_text(button) !== __("添加员工")) return;

		event.preventDefault();
		event.stopImmediatePropagation();
		open_registration_qr();
	}, true);
})();
