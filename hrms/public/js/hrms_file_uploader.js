// HRMS files are selected from the current device. Hide alternative sources
// and uploader settings that are not part of the business import workflow.
(function simplify_file_uploader() {
	function install() {
		const BaseFileUploader = window.frappe?.ui?.FileUploader;
		if (!BaseFileUploader || BaseFileUploader.__hrms_simplified_sources) return;

		class HRMSFileUploader extends BaseFileUploader {
			constructor(options = {}) {
				super({
					...options,
					disable_file_browser: true,
					allow_web_link: false,
					allow_take_photo: false,
					allow_google_drive: false,
					allow_toggle_private: false,
				});
			}
		}

		HRMSFileUploader.__hrms_simplified_sources = true;
		window.frappe.ui.FileUploader = HRMSFileUploader;
	}

	if (window.frappe?.ui?.FileUploader) install();
	else window.addEventListener("DOMContentLoaded", install, { once: true });
})();
