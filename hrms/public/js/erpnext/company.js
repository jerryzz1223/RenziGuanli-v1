// Copyright (c) 2022, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Company", {
	after_save: function (frm) {
		// A newly created Company must immediately become available to every HRMS
		// workbench; the top navigation keeps an in-memory company list.
		window.hrmsCompanyContext?.reload?.().then(() => {
			window.hrmsCompanyContext?.setCurrentCompany?.(frm.doc.name);
		});
	},
	refresh: function (frm) {
		frm.set_query("default_expense_claim_payable_account", function () {
			return {
				filters: {
					company: frm.doc.name,
					is_group: 0,
				},
			};
		});

		frm.set_query("default_employee_advance_account", function () {
			return {
				filters: {
					company: frm.doc.name,
					is_group: 0,
					root_type: "Asset",
					account_type: "Receivable",
				},
			};
		});

		frm.set_query("default_payroll_payable_account", function () {
			return {
				filters: {
					company: frm.doc.name,
					is_group: 0,
					root_type: "Liability",
				},
			};
		});

		frm.set_query("hra_component", function () {
			return {
				filters: { type: "Earning" },
			};
		});
	},
});
