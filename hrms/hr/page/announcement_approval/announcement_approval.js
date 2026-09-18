frappe.pages["announcement-approval"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("公告审批"), single_column: true });
	const root = $(page.main).html('<div class="hrms-announcement-page"><p class="hrms-announcement-page__intro">查看公告正文和提交附件，批准后进入签字版上传环节。</p><div data-approval-list></div></div>').find(".hrms-announcement-page")[0];
	const list = root.querySelector("[data-approval-list]");
	const esc = hrms.announcement.escape.bind(hrms.announcement);
	const time = (value) => esc(value || "—");
	const routeName = String((frappe.get_route?.() || [])[1] || "").trim();
	let openedRoute = false;
	let request_id = 0;
	page.set_primary_action(__("审批记录"), () => frappe.set_route("announcement-approval-records"), "list");

	function load() {
		const current_request_id = ++request_id;
		list.innerHTML = '<div class="text-muted">正在加载审批公告…</div>';
		hrms.announcement.call("hrms.api.announcement.list_announcements", { view: "approval" }).then((response) => {
			if (current_request_id !== request_id) return;
			const rows = response.message || [];
			list.innerHTML = rows.length ? rows.map((row) => `<article class="hrms-announcement-card"><div class="hrms-announcement-card__head"><div><h4><a data-open="${esc(row.name)}">${esc(row.announcement_number || "未编号")}</a>　${esc(row.subject)}</h4><p class="hrms-announcement-card__meta">发文者：${esc(row.issuer_name)}　发文单位：${esc(row.issuing_unit_name)}　${hrms.announcement.status(row.status)}</p><p class="hrms-announcement-card__meta">创建时间：${time(row.created_on)}　提交时间：${time(row.submitted_on)}</p></div><button class="btn btn-primary btn-sm" data-open="${esc(row.name)}">查看并处理</button></div><div class="hrms-announcement-card__files">附件：${hrms.announcement.files(row.files)}</div></article>`).join("") : '<div class="text-muted">无待审批记录。</div>';
			list.querySelectorAll("[data-open]").forEach((node) => node.addEventListener("click", () => open_detail(node.dataset.open)));
			if (routeName && !openedRoute) { openedRoute = true; open_detail(routeName); }
			hrms.announcement.bind_file_links(list);
		});
	}
	function open_detail(name) {
		hrms.announcement.call("hrms.api.announcement.get_announcement", { name }).then((response) => {
			const row = response.message || {};
			const pending = row.status === "待审核";
			const dialog = new frappe.ui.Dialog({ title: `${row.announcement_number || "公告"} · ${row.subject}`, fields: [
				{ fieldname: "meta", fieldtype: "HTML" },
				{ fieldname: "approval_comment", fieldtype: "Small Text", label: __("审核意见") },
				{ fieldname: "approver_name", fieldtype: "Data", label: __("核准人（可手动填写）"), default: row.approver_name || "" },
			], primary_action_label: pending ? __("批准") : __("关闭"), primary_action(values) {
				if (!pending) return dialog.hide();
				review("approve", values);
			} });
			dialog.fields_dict.meta.$wrapper.html(`<div class="hrms-announcement-card"><p>${hrms.announcement.status(row.status)}　签字状态：${esc(row.signature_status)}</p><p><strong>创建时间：</strong>${time(row.created_on)}<br><strong>提交时间：</strong>${time(row.submitted_on)}<br><strong>审批时间：</strong>${time(row.reviewed_on)}</p><p><strong>收文单位：</strong>${esc(row.receiving_units)}<br><strong>附本抄送：</strong>${esc(row.cc_units || "—")}<br><strong>发文单位：</strong>${esc(row.issuing_unit_name)}<br><strong>发文者：</strong>${esc(row.issuer_name)}</p><h4>主旨：${esc(row.subject)}</h4><p>相关附件：${hrms.announcement.files(row.files)}</p>${pending ? '<button class="btn btn-link text-danger" data-reject>驳回</button>' : ""}</div>`);
			dialog.show();
			hrms.announcement.bind_file_links(dialog.$wrapper[0]);
			dialog.$wrapper.find("[data-reject]").on("click", () => review("reject", dialog.get_values()));
			if (!pending) dialog.get_primary_btn().addClass("hidden");
			function review(decision, values) {
				if (decision === "reject" && !String(values?.approval_comment || "").trim()) { frappe.msgprint(__("驳回时请填写审核意见。")); return; }
				dialog.disable_primary_action();
				hrms.announcement.call("hrms.api.announcement.review_announcement", { name, decision, approval_comment: values?.approval_comment || "", approver_name: values?.approver_name || "" }).then(() => { dialog.hide(); frappe.show_alert({ message: decision === "approve" ? __("公告已审核通过，已进入上传签字版") : __("公告已驳回"), indicator: decision === "approve" ? "green" : "orange" }); load(); }).finally(() => dialog.enable_primary_action());
			}
		});
	}
	load();
	wrapper.announcement_approval = { load };
};

frappe.pages["announcement-approval"].on_page_show = function (wrapper) {
	wrapper.announcement_approval?.load();
};
