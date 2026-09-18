const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const api = read("hrms/api/announcement.py");
const announcementJs = read("hrms/public/js/hrms_announcement.js");
const announcementCss = read("hrms/public/css/hrms_announcement.css");
const directory = read("hrms/hr/page/announcement_directory/announcement_directory.js");
const approval = read("hrms/hr/page/announcement_approval/announcement_approval.js");
const approvalRecordsPage = read("hrms/hr/page/announcement_approval_records/announcement_approval_records.js");
const submissionRecordsPage = read("hrms/hr/page/announcement_submission_records/announcement_submission_records.js");
const signedUpload = read("hrms/hr/page/announcement_signed_upload/announcement_signed_upload.js");
const model = read("hrms/hr/doctype/hrms_announcement/hrms_announcement.py");
const doctype = read("hrms/hr/doctype/hrms_announcement/hrms_announcement.json");
const access = read("hrms/access_control.py");
const sidebar = read("hrms/workspace_sidebar/personnel.json");
const topNav = read("hrms/public/js/hrms_top_nav.js");
const projectDirectory = read("hrms/public/js/hrms_home_redirect_v6.js");
const hooks = read("hrms/hooks.py");
const patches = read("hrms/patches.txt");
const announcementPatch = read("hrms/patches/v16_0/ensure_announcement_pages.py");
const announcementFilenamePatch = read("hrms/patches/v16_0/rename_announcement_files_to_subject.py");

for (const marker of ["YXSR{int(year) % 100:02d}{int(month):02d}{int(sequence):02d}", "SELECT sequence FROM `tabHRMS Announcement`", "ORDER BY sequence DESC LIMIT 1 FOR UPDATE"]) {
	assert(model.includes(marker), `Announcement model contract missing: ${marker}`);
}
for (const marker of [
	"def preview_announcement_file(",
	"def _preview_docx(",
	"def _preview_xlsx(",
	"def generate_announcement_templates(",
	"def review_announcement(",
	"def upload_signed_announcement(",
	"def attach_announcement_file(",
	"_build_docx",
	"_build_xlsx",
]) assert(api.includes(marker), `Announcement backend contract missing: ${marker}`);
for (const marker of [
	"_UNSAFE_FILENAME_CHARS",
	"def _announcement_filename(doc, extension):",
	"subject = _UNSAFE_FILENAME_CHARS.sub(\"_\", str(doc.subject or \"\").strip())",
	"word_filename = _announcement_filename(doc, \".docx\")",
	"excel_filename = _announcement_filename(doc, \".xlsx\")",
	'"file_name": _announcement_filename(doc, file_extension)',
	"def _rename_file(file_url, filename):",
]) assert(api.includes(marker), `Announcement subject filename contract missing: ${marker}`);
assert(api.includes('if fieldname == "signed_attachment":') && api.includes('file_values["file_name"] = _announcement_filename(doc, file_extension)'), "Signed attachment uploads must use the subject filename");
assert(!api.includes("公告待填写"), "Announcement filenames must not use the generic filename suffix");
for (const marker of ["preview_announcement_file", "preview_html", "data-announcement-name", "download_file", "data-download-url", "下载原文件"]) {
	assert(announcementJs.includes(marker), `Announcement attachment preview UI contract missing: ${marker}`);
}
for (const marker of ["hrms-announcement-file-preview--docx", "hrms-announcement-file-preview--xlsx", "hrms-announcement-file-preview--image"]) {
	assert(announcementCss.includes(marker), `Announcement attachment preview style missing: ${marker}`);
}

for (const field of ["announcement_number", "receiving_units", "cc_units", "issuing_unit", "issuer_name", "source_attachment", "signed_attachment", "word_template", "excel_template"]) {
	assert(doctype.includes(`\"fieldname\": \"${field}\"`), `Announcement field missing: ${field}`);
}
assert(doctype.includes('"is_submittable": 0'), "Announcement DocType must use the custom status workflow");
assert(model.includes("def prepare_submission(self):"), "Announcement custom submission hook missing");
assert(!api.includes("doc.submit()"), "Announcement API must not call Frappe native submit");
assert(api.includes('filters = {"status": "待审核"}'), "Approval view must only list pending announcements");
assert(api.includes('filters = {"status": ["in", ["审核通过", "审核驳回", "待上传签字", "已签字"]]}'), "Approval records view must only list completed approvals");
assert(patches.includes("hrms.patches.v16_0.ensure_announcement_pages"), "Announcement page registration patch missing");
assert(announcementPatch.includes("ensure_announcement_pages()"), "Announcement page registration patch must invoke the shared repair");
assert(patches.includes("hrms.patches.v16_0.rename_announcement_files_to_subject"), "Announcement filename migration patch missing");
assert(announcementFilenamePatch.includes("_announcement_filename") && announcementFilenamePatch.includes('"file_name", desired_name'), "Announcement filename migration must preserve URLs and content while updating file names");
assert(api.includes('"reviewed_on", "approval_comment"'), "Approval records must include review time and comments");
assert(api.includes('(\"announcement-approval-records\", \"公告审批记录\", \"list\", ())'), "Approval records page must be created during migration");
assert(api.includes('filters = {"owner": frappe.session.user, "status": ["in", SUBMISSION_STATUSES]}'), "Submit view must only list submission-stage records");
assert(api.includes('SUBMISSION_STATUSES = ("草稿", "待审核", "审核驳回")'), "Submit-stage status boundary missing");
assert(api.includes('filters = {"owner": frappe.session.user, "status": ["in", SUBMISSION_RECORD_STATUSES]}'), "Submission records view must only list completed records owned by the submitter");
assert(api.includes('SUBMISSION_RECORD_STATUSES = ("待审核", "审核通过", "审核驳回", "待上传签字", "已签字")'), "Submission records status boundary missing");
assert(api.includes('view == "signed_records"') && api.includes('rows = [row for row in rows if row.get("signed_attachment")]'), "Signed records view must only list archived signed versions");
assert(!api.includes('filters = {"owner": frappe.session.user}\n'), "Submit view must not list all records owned by the submitter");
assert(api.includes('"status": "审核通过" if decision == "approve" else "审核驳回"'), "Approval must enter the explicit approved status");
assert(api.includes('"审核通过", "待上传签字", "已签字"'), "Sign-upload view must accept approved announcements and legacy records");
assert(api.includes('"reviewer_name"') && api.includes('"signed_attachment"'), "Directory rows must include the reviewer and signature attachment");
assert(model.includes("def _normalise_content(value):") && model.includes("self.content = _normalise_content(self.content)"), "Announcement validation must reject empty rich-text editor shells");
assert(api.includes("该公告已完成签字归档，不能重复修改"), "Signed announcements must reject signed-file replacement");
assert(api.includes("def _archive_versions(files):"), "Announcement archive versions must be explicit");
assert(api.includes('"label": "未签字版"') && api.includes('"label": "签字版"'), "Unsigned and signed archive labels must be explicit");
assert(api.includes('"key": "unsigned"') && api.includes('"key": "signed"'), "Archive versions must have stable row keys");
assert(api.includes("def _expand_directory_versions(row):") && api.includes('if view == "directory":'), "Directory must expand retained versions into separate rows");
assert(api.includes('rows = [row for row in rows if row["signature_status"] == signature_status]') && api.indexOf('if view == "directory":') < api.lastIndexOf('rows = [row for row in rows if row["signature_status"] == signature_status]'), "Signature filters must apply after directory version expansion");
assert(api.includes("The signed file is a retained archive version"), "Signed upload must be an archive version, not a workflow transition");
assert(!api.includes('"status": "已签字"})'), "Signed upload must not mutate workflow status");
assert(!directory.includes('label: "附属文件"'), "Directory must not render the redundant attachment column");
assert(!directory.includes("hrms.announcement.versions(row.versions || [])"), "Directory table must not render archive versions as a column");
assert(directory.includes('hrms.announcement.versions(row.versions || [], ["word_template", "excel_template"])'), "Directory detail must retain archive attachments");
assert(directory.includes('key: "version_label", label: "版本"'), "Directory must show the archive version as a column");
assert(!approval.includes("hrms-announcement-preview"), "Approval detail must not display the raw announcement body");
assert(!signedUpload.includes("hrms-announcement-preview"), "Signed-upload detail must not display the raw announcement body");
assert(read("hrms/hr/page/announcement_signed_upload/announcement_signed_upload.js").includes("不改变公告流程状态"), "Signed upload page must describe version archiving");
const submitPage = read("hrms/hr/page/announcement_submit/announcement_submit.js");
assert(approval.includes('page.set_primary_action(__("审批记录")') && approval.includes('frappe.set_route("announcement-approval-records")'), "Approval page must provide a route to approval records");
assert(approval.includes("on_page_show") && approval.includes("let request_id = 0") && approval.includes("current_request_id !== request_id"), "Approval page must refresh cached pages and ignore stale list responses");
assert(!approval.includes('new frappe.ui.Dialog({\n\t\t\t\ttitle: __("审批记录")'), "Approval records must not be rendered as a floating list dialog");
assert(approvalRecordsPage.includes('frappe.pages["announcement-approval-records"]'), "Approval records page must be registered");
assert(approvalRecordsPage.includes('view: "approval_records"') && approvalRecordsPage.includes("data-history-open"), "Approval records page must load and open completed records");
assert(signedUpload.includes('versions(row.versions || [], [], "download")'), "Signed-upload list files must download directly; preview belongs in detail");
const signedRecordsPage = read("hrms/hr/page/announcement_signed_records/announcement_signed_records.js");
assert(signedRecordsPage.includes('frappe.pages["announcement-signed-records"]') && signedRecordsPage.includes('view: "signed_records"'), "Signed records page must load the archived signed versions");
assert(fs.existsSync(path.join(root, "hrms/hr/page/announcement_approval_records/__init__.py")) && fs.existsSync(path.join(root, "hrms/hr/page/announcement_signed_records/__init__.py")), "Announcement record pages must be standard Frappe page packages");
assert(signedUpload.includes('frappe.set_route("announcement-signed-records")') && signedUpload.includes("已上传记录会移入"), "Signed-upload page must route archived uploads separately");
assert(submitPage.includes('data-back'), "Submit detail view must provide a return control");
assert(submitPage.includes("返回列表"), "Submit detail view return label missing");
assert(!submitPage.includes("返回提交记录"), "Submit detail view must not call the pending list submission records");
assert(submitPage.includes("current = null; load();"), "Submit detail view return control must restore the record list");
assert(submitPage.includes('page.set_secondary_action(__("提交记录")') && submitPage.includes('frappe.set_route("announcement-submission-records")'), "Submit page must provide a submission records button");
assert(submissionRecordsPage.includes('frappe.pages["announcement-submission-records"]'), "Submission records page must be registered");
assert(submissionRecordsPage.includes('view: "submission_records"') && submissionRecordsPage.includes("data-submission-open"), "Submission records page must load and open completed submissions");
assert(submitPage.includes("hrms.announcement.content_html(data.content)"), "Submit detail must render announcement content through the safe rich-text renderer");
assert(submitPage.includes('{ fieldname: "content", fieldtype: "Text Editor", label: __("正文") }'), "Announcement body must be optional in the submit dialog");
assert(!signedUpload.includes("上传附属文件") && !signedUpload.includes("data-extra-upload"), "Signed-upload page must not offer supplementary-file upload");
assert(!doctype.includes('"fieldname": "content", "fieldtype": "Text Editor", "label": "正文", "reqd": 1'), "Announcement body DocType field must be optional");
assert(!model.includes('if not self.content:'), "Announcement validation must allow an empty body");
for (const marker of ['"content": doc.content or ""', 'body = _plain_text(context.get("content"))', 'sheet["B8"] = _plain_text(context.get("content"))', '"B8:U17"']) {
	assert(api.includes(marker), `Announcement template must write body content: ${marker}`);
}
assert(approvalRecordsPage.includes("hrms.announcement.content_html(row.content)"), "Approval history detail must render announcement content through the safe rich-text renderer");
assert(announcementJs.includes('if (!visibleText && !parsed.body.querySelector("img, video, audio, svg"))'), "Empty rich-text editor shells must render as no body text");
for (const marker of ["announcement_date", "created_on", "signed_on", "reviewed_on", "issuer", "announcement_number", "signature_status", "sort_field", "sort_order"]) {
	assert(api.includes(marker), `Announcement directory API filter/date contract missing: ${marker}`);
}
for (const marker of ["def download_announcement_directory_export(", "_directory_export_date_range", "_directory_export_matches_date", "start_date: str = \"\"", "end_date: str = \"\"", "provide_binary_file", "sheet.title = \"公告目录\""]) {
	assert(api.includes(marker), `Announcement directory export backend contract missing: ${marker}`);
}
for (const marker of ["data-announcement-sort", "data-announcement-filter", "创建时间", "审批时间", "签字版上传时间", "签字状态", "公告日期", "↑", "↓"]) {
	assert(directory.includes(marker), `Announcement directory UI contract missing: ${marker}`);
}
for (const marker of ["statusAction(row, \"status\")", "statusAction(row, \"signature_status\")", "value === \"审核通过\"", "value === \"已签字\"", "data-announcement-route", "announcement-approval", "announcement-signed-upload"]) {
	assert(directory.includes(marker), `Announcement status jump UI contract missing: ${marker}`);
}
assert(!directory.includes("跳转审核") && !directory.includes("跳转签字"), "Announcement directory must not display jump helper text");
for (const page of [approval, approvalRecordsPage]) {
	assert(page.includes("frappe.get_route?.()") && page.includes("open_detail(routeName)"), "Announcement status jump target must auto-open the requested record");
}
assert(signedUpload.includes("open_route_target") && signedUpload.includes("upload_signed(routeName)"), "Unsigned status jump must open the targeted upload dialog");
assert(signedUpload.includes('frappe.pages["announcement-signed-upload"].on_page_show') && signedUpload.includes("open_route_target()"), "Signed upload route must be reapplied when the cached page is shown");
for (const marker of ["导出 Excel", "导出公告 Excel", "开始日期", "结束日期", "download_announcement_directory_export", "JSON.stringify(state.filters)", "start_date: values.start_date", "end_date: values.end_date", "sort_field: state.sortField"]) {
	assert(directory.includes(marker), `Announcement directory export UI contract missing: ${marker}`);
}
for (const page of [
	["hrms/hr/page/announcement_submit/announcement_submit.js", "创建时间", "提交时间"],
	["hrms/hr/page/announcement_approval/announcement_approval.js", "创建时间", "提交时间", "审批时间"],
	["hrms/hr/page/announcement_signed_upload/announcement_signed_upload.js", "创建时间", "审批时间", "签字版上传时间"],
]) {
	const pageSource = read(page[0]);
	for (const marker of page.slice(1)) assert(pageSource.includes(marker), `Announcement page timestamp UI contract missing: ${page[0]} / ${marker}`);
}
for (const marker of ["data-detail-word-preview", "preview_announcement_file", "hrms-announcement-detail-dialog", "hrms-announcement-detail-card"]) {
	assert(directory.includes(marker) || announcementCss.includes(marker), `Directory detail preview contract missing: ${marker}`);
}
for (const marker of ["content_html", "hrms-announcement-preview--rich"]) {
	assert(directory.includes(marker) || announcementJs.includes(marker) || announcementCss.includes(marker), `Directory rich body preview contract missing: ${marker}`);
}
assert(directory.includes('["word_template", "excel_template"]'), "Directory detail must avoid repeating template links");
assert(announcementJs.includes("versions(versions, exclude = [])"), "Announcement archive renderer must support filtered files");

for (const capability of ["announcement_view", "announcement_submit", "announcement_approve", "announcement_sign_upload"]) {
	assert(access.includes(`\"${capability}\"`), `Announcement capability missing: ${capability}`);
}

for (const page of ["announcement-directory", "announcement-submit", "announcement-approval", "announcement-signed-upload"]) {
	assert(sidebar.includes(page), `Announcement sidebar entry missing: ${page}`);
}
for (const recordPage of ["announcement-submission-records", "announcement-approval-records", "announcement-signed-records"]) {
	assert(!sidebar.includes(`\"link_to\": \"${recordPage}\"`), `Announcement record page must not be duplicated in the native sidebar: ${recordPage}`);
}
for (const recordLabel of ["提交记录", "公告审批记录", "签字版记录"]) {
	assert(!projectDirectory.includes(`{ label: "${recordLabel}"`), `Announcement record page must not be duplicated in the custom sidebar: ${recordLabel}`);
}
assert(topNav.includes('label: "公告"'), "Announcement top navigation entry missing");
assert(topNav.includes('route: "/desk/announcement-directory"'), "Announcement top navigation route missing");
assert(projectDirectory.includes('label: "公告"'), "Announcement project directory module missing");
for (const page of ["announcement-directory", "announcement-submit", "announcement-approval", "announcement-signed-upload"]) {
	assert(projectDirectory.includes(`slug: "${page}"`), `Announcement project directory route missing: ${page}`);
}
for (const page of ["announcement-submission-records", "announcement-approval-records", "announcement-signed-records"]) {
	assert(projectDirectory.includes(`"${page}"`), `Announcement record route missing from the direct route registry: ${page}`);
}
assert(projectDirectory.includes("var direct_announcement_page_slug = normalize_slug(current_path);"), "Announcement pages must use their URL while Frappe route state is settling");
assert(projectDirectory.includes('"announcement-submission-records"') && projectDirectory.includes('"announcement-approval-records"') && projectDirectory.includes('"announcement-signed-records"'), "Announcement record pages must be included in the direct sidebar route guard");
assert(projectDirectory.includes('label: "公告办理"'), "Announcement project directory section missing");
assert(hooks.includes("20260918-announcement-sidebar-records-v1"), "Announcement project directory cache version missing");
assert(hooks.includes("20260916-employee-relationship-v1"), "Announcement navigation cache version missing");
assert(hooks.includes("20260916-announcement-v13-signed-version-lock"), "Announcement attachment download cache version missing");
assert(api.includes('"has_signed_version": any(item.get("key") == "signed" for item in row.get("versions") or [])'), "Directory rows must expose signed-version lock state");
assert(directory.includes("isLockedUnsigned") && directory.includes("hrms-announcement-status-link--locked"), "Unsigned rows with a signed version must be non-navigable");
assert(directory.includes("data-download-url=\"${escape(row.word_template)}\"") && directory.includes("下载原件"), "Announcement directory detail must show an original download button");

console.log("Announcement four-window workflow, numbering, attachment and template contracts verified.");
