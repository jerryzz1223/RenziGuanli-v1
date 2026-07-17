/* global frappe, __ */

(function () {
	const API = "hrms.api.form_data_intake";

	function call(method, args, message) {
		return frappe.call({ method: `${API}.${method}`, args, freeze: true, freeze_message: __(message) });
	}

	function refreshAfter(response, frm) {
		const result = response.message || {};
		if (result.message) frappe.show_alert({ message: __(result.message), indicator: "green" });
		frm.reload_doc();
	}

	frappe.ui.form.on("HRMS Form Import Row", {
		refresh(frm) {
			if (frm.is_new()) return;
			const canReview = !["处理失败", "已忽略", "已提交生效"].includes(frm.doc.status);
			if (canReview && frm.doc.review_status !== "已批准" && frm.doc.review_status !== "已驳回") {
				const stepLabel = frm.doc.approval_step_label || "人事复核";
				const approveLabel = frm.doc.review_status === "审批中" ? __("当前节点批准") : __("批准审核");
				frm.add_custom_button(approveLabel, () => {
					frappe.prompt([{ fieldname: "review_note", fieldtype: "Small Text", label: __("审核意见"), reqd: 0 }], (values) => {
						call("review_form_import_row", { row_name: frm.doc.name, decision: "批准", review_note: values.review_note }, "正在记录审核结果…").then((r) => refreshAfter(r, frm));
					}, stepLabel, __("批准"));
				}, __("审核"));
				frm.add_custom_button(__("驳回"), () => {
					frappe.prompt([{ fieldname: "review_note", fieldtype: "Small Text", label: __("驳回原因"), reqd: 1 }], (values) => {
						call("review_form_import_row", { row_name: frm.doc.name, decision: "驳回", review_note: values.review_note }, "正在记录驳回原因…").then((r) => refreshAfter(r, frm));
					}, __("人事审核"), __("确认驳回"));
				}, __("审核"));
			}

			if (frm.doc.review_status === "已批准" && !frm.doc.target_name) {
				frm.add_custom_button(__("生成正式草稿"), () => {
					frappe.confirm(
						__("将根据已审核的字段生成可编辑草稿；此操作不会改变员工状态、考勤锁定或薪资结算。是否继续？"),
						() => call("generate_form_import_target", { row_name: frm.doc.name }, "正在生成正式草稿…").then((r) => refreshAfter(r, frm)),
					);
				}, __("正式处理"));
			}

			if (frm.doc.target_name && frm.doc.target_doctype) {
				frm.add_custom_button(__("查看正式草稿"), () => frappe.set_route("Form", frm.doc.target_doctype, frm.doc.target_name), __("正式处理"));
			}

			if (frm.doc.review_status === "已批准" && frm.doc.target_name && frm.doc.status !== "已提交生效") {
				frm.add_custom_button(__("提交并生效"), () => {
					frappe.confirm(
						__("此操作会提交正式人事单据，或确认薪资/考勤来源；生效后会影响后续考勤、薪资或员工任职记录。请确认已复核正式草稿。"),
						() => call("activate_form_import_target", { row_name: frm.doc.name }, "正在提交并生效…").then((r) => refreshAfter(r, frm)),
					);
				}, __("正式处理"));
			}
		},
	});
})();
