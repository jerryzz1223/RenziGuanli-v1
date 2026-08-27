// Keep every Desk upload dialog focused on the two sources used in HRMS:
// the current device and the existing file library.
(function simplify_file_uploader() {
	function install() {
		const BaseFileUploader = window.frappe?.ui?.FileUploader;
		if (!BaseFileUploader || BaseFileUploader.__hrms_simplified_sources) return;

		class HRMSFileUploader extends BaseFileUploader {
			constructor(options = {}) {
				super({ ...options, allow_web_link: false, allow_take_photo: false });
			}
		}

		HRMSFileUploader.__hrms_simplified_sources = true;
		window.frappe.ui.FileUploader = HRMSFileUploader;
	}

	if (window.frappe?.ui?.FileUploader) install();
	else window.addEventListener("DOMContentLoaded", install, { once: true });
})();
