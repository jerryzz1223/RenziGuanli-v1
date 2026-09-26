const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms/api/attendance_processing_center.py"), "utf8");
const page = fs.readFileSync(path.join(root, "hrms/hr/page/attendance_import_center/attendance_import_center.js"), "utf8");
const shell = fs.readFileSync(path.join(root, "hrms/public/js/hrms_home_redirect_v6.js"), "utf8");

test("attendance dashboards and queues avoid whole-batch hydration", () => {
	const recognition = api.slice(
		api.indexOf("def _monthly_final_employee_recognition"),
		api.indexOf("@frappe.whitelist()\ndef get_processing_batch"),
	);
	assert.doesNotMatch(recognition, /_result_rows\(/);
	assert.match(api, /hydrate_daily_details and not result\["daily_exception_lines"\]/);
	assert.match(api, /queue_index_fields/);
	assert.match(api, /_exception_queue_payload/);
});

test("processing results use bounded server pagination and compact rows", () => {
	assert.match(api, /page_length: int = 25/);
	assert.match(api, /_processing_result_table_payload/);
	assert.match(page, /processing_result_page_size = 25/);
	assert.match(page, /data-processing-result-page/);
	assert.match(page, /total_count/);
});

test("route changes do not schedule a second whole-document localization pass", () => {
	assert.match(shell, /if \(hrms_full_localization_done\) return;/);
	assert.match(shell, /schedule_hrms_dynamic_localization\(changed_nodes\)/);
});
