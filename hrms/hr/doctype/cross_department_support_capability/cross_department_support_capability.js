frappe.ui.form.on("Cross Department Support Capability", {
    refresh(frm) {
        ["qualification_status", "is_active", "qualified_on", "valid_from", "valid_until", "remarks", "import_validation_note"].forEach((fieldname) => {
            frm.toggle_display(fieldname, false);
        });
        focus_support_capability_form(frm);
        load_support_capability_options(frm);
        if (frm.is_new()) frm.page.set_title(__("新建支援"));
        if (!frm.is_new()) {
            frm.add_custom_button(__("查看可派名单"), () => {
                frappe.set_route("cross-department-support", frm.doc.support_department, frm.doc.support_designation);
            });
        }
    },
    support_department(frm) {
        update_support_designations(frm, false);
    },
});

function focus_support_capability_form(frm) {
    const container = frm.page.wrapper.closest(".page-container");
    const wrapper = container.length ? container : frm.page.wrapper;
    wrapper.addClass("hrms-support-capability-form");
    if (!document.getElementById("hrms-support-capability-style")) {
        $("<style>", {id: "hrms-support-capability-style", text: `
            .hrms-support-capability-form .layout-side-section,
            .hrms-support-capability-form .form-sidebar,
            .hrms-support-capability-form .form-footer,
            .hrms-support-capability-form .form-timeline,
            .hrms-support-capability-form .new-timeline { display: none !important; }
            .hrms-support-capability-form .layout-main-section-wrapper {
                width: 100% !important; max-width: none !important; flex: 0 0 100% !important;
            }
            .hrms-support-capability-form .form-layout { max-width: 1100px; margin: 0 auto; }
            .hrms-support-capability-form .form-section { padding-top: 20px; padding-bottom: 12px; }
            .hrms-support-capability-form select.form-control { cursor: pointer; }
        `}).appendTo(document.head);
    }
    wrapper.find(".layout-side-section, .form-sidebar, .form-footer, .form-timeline, .new-timeline").hide();
}

function set_support_choices(frm, fieldname, values, preserve = true) {
    const current = frm.doc[fieldname];
    const options = ["", ...new Set([...values, ...(preserve && current ? [current] : [])].filter(Boolean))];
    frm.set_df_property(fieldname, "options", options);
    frm.refresh_field(fieldname);
    if (!preserve && current && !options.includes(current)) frm.set_value(fieldname, "");
}

function update_support_designations(frm, preserve = true) {
    const options = frm.__support_options;
    if (!options) return;
    const matches = options.pairs.filter(row => row.department === frm.doc.support_department).map(row => row.designation);
    const values = matches.length ? [...matches, ...options.master_designations] : options.designations;
    set_support_choices(frm, "support_designation", values, preserve);
}

function load_support_capability_options(frm) {
    // Include the saved values immediately, including legacy imports, while options load.
    set_support_choices(frm, "support_department", []);
    set_support_choices(frm, "support_designation", []);
    const request = (frm.__support_options_request || 0) + 1;
    frm.__support_options_request = request;
    return Promise.resolve(frappe.call({
        method: "hrms.hr.doctype.cross_department_support_capability.cross_department_support_capability.get_support_capability_options",
    })).then(response => {
        if (frm.__support_options_request !== request) return;
        const result = response.message || {};
        frm.__support_options = {departments: result.departments || [], designations: result.designations || [],
            pairs: result.pairs || [], master_designations: result.master_designations || []};
        set_support_choices(frm, "support_department", frm.__support_options.departments);
        update_support_designations(frm);
    }).catch(() => {
        if (frm.__support_options_request === request) frappe.show_alert({message: __("支援选项加载失败，请刷新后重试。"), indicator: "orange"});
    });
}
