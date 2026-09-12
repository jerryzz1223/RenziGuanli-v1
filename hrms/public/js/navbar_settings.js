function show_logo_upload_button(frm) {
	const field = frm.fields_dict.app_logo;
	const wrapper = field?.$wrapper?.[0];
	if (!wrapper) return;

	const refresh_button = () => {
		const button = wrapper.querySelector(".btn-attach");
		if (!button) return;

		const label = frm.doc.app_logo ? __("更换图片") : __("上传图片");
		if (button.textContent.trim() !== label) button.textContent = label;
		if (button.style.display === "none") button.style.display = "";
		button.classList.add("hrms-navbar-logo-upload");
		button.style.marginTop = frm.doc.app_logo ? "8px" : "0";
	};

	refresh_button();
	if (wrapper.hrms_logo_upload_observer) return;

	const observer = new MutationObserver(refresh_button);
	observer.observe(wrapper, {
		attributes: true,
		attributeFilter: ["style"],
		childList: true,
		subtree: true,
	});
	wrapper.hrms_logo_upload_observer = observer;
}

function apply_minimal_branding_layout(frm) {
	for (const fieldname of ["section_break_2", "announcements_section"]) {
		if (frm.fields_dict[fieldname]) frm.set_df_property(fieldname, "hidden", 1);
	}

	const page = frm.page?.wrapper?.[0];
	if (!page) return;
	page.classList.add("hrms-navbar-settings-minimal");

	if (document.getElementById("hrms-navbar-settings-minimal-style")) return;
	const style = document.createElement("style");
	style.id = "hrms-navbar-settings-minimal-style";
	style.textContent = `
		.hrms-navbar-settings-minimal [data-fieldname="section_break_2"],
		.hrms-navbar-settings-minimal [data-fieldname="announcements_section"],
		.hrms-navbar-settings-minimal .form-footer,
		.hrms-navbar-settings-minimal .layout-side-section,
		.hrms-navbar-settings-minimal #full-search-button,
		.hrms-navbar-settings-minimal .menu-more-button {
			display: none !important;
		}
		.hrms-navbar-settings-minimal .layout-main-section-wrapper {
			width: 100%;
		}
	`;
	document.head.appendChild(style);
}

frappe.ui.form.on("Navbar Settings", {
	refresh(frm) {
		apply_minimal_branding_layout(frm);
		show_logo_upload_button(frm);
	},
});
