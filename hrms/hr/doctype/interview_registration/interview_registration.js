frappe.ui.form.on("Interview Registration", {
 refresh(frm) {
  frm.$wrapper.addClass("interview-registration-form");
  if (!document.getElementById("interview-registration-style")) {
   const style = document.createElement("style");
   style.id = "interview-registration-style";
   style.textContent = `
    .interview-registration-form .form-layout { padding: 0 20px 20px; }
    .interview-registration-form .form-section { margin: 0 0 16px; padding: 18px 20px; border: 1px solid var(--border-color, #e2e8f0); border-radius: 10px; }
    .interview-registration-form .section-head { font-size: 15px; font-weight: 600; padding: 0 0 14px; }
    .interview-registration-form .form-column { padding-left: 12px; padding-right: 12px; }
    .interview-registration-form .frappe-control { margin-bottom: 16px; }
    .interview-registration-form .control-label { font-size: 13px; color: var(--text-color, #334155); }
    .interview-registration-form .control-input .form-control { min-height: 36px; border: 1px solid var(--border-color, #dce3ed); border-radius: 7px; }
    .interview-registration-form .help-box { font-size: 12px; line-height: 1.6; margin-top: 5px; }
    .interview-registration-form .ir-summary { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin: 0 0 16px; padding: 18px 20px; border: 1px solid var(--border-color, #dce5f2); border-radius: 10px; background: var(--control-bg, #f5f8fc); }
    .interview-registration-form .ir-summary strong { font-size: 18px; }
    .interview-registration-form .ir-summary p { margin: 5px 0 0; color: var(--text-muted, #64748b); font-size: 12px; }
    .interview-registration-form .ir-summary__status { display: flex; flex-wrap: wrap; gap: 8px; }
    .interview-registration-form .ir-summary__status span { padding: 5px 10px; border: 1px solid var(--border-color, #dce3ed); border-radius: 6px; background: var(--fg-color, #fff); font-size: 12px; }
    @media (max-width: 767px) { .interview-registration-form .form-layout { padding: 0 10px 10px; } .interview-registration-form .form-section { padding: 16px 10px; } }
   `;
   document.head.appendChild(style);
  }
  render_interview_registration_summary(frm);
 },
 candidate_name: render_interview_registration_summary,
 interview_position: render_interview_registration_summary,
 hired: render_interview_registration_summary,
 arrival_status: render_interview_registration_summary,
});

function render_interview_registration_summary(frm) {
 const layout = frm.$wrapper.find(".form-layout");
 if (!layout.length) return;
 const safe = (value) => frappe.utils.escape_html(String(value || ""));
 const hired = frm.doc.hired === "是" ? "已录用" : frm.doc.hired === "否" ? "未录用" : "未填写";
 layout.find(".ir-summary").remove();
 layout.prepend(`<div class="ir-summary"><div><strong>${safe(frm.doc.candidate_name || "面试登记")}</strong><p>${safe(frm.doc.interview_position || "应聘岗位未填写")} · 请按实际情况登记，必填项以 * 标记。</p></div><div class="ir-summary__status"><span>录用：${hired}</span><span>报到：${safe(frm.doc.arrival_status || "未填写")}</span></div></div>`);
}
