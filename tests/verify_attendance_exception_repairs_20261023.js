const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function controller(response, codes = ["LATE_MARKED"]) {
    let dialog;
    const alerts = [];
    const context = { frappe: { pages: { "attendance-import-center": {} },
        ui: { Dialog: class { constructor(config) { this.config = config; dialog = this; } show() {} hide() {} } },
        show_alert: value => alerts.push(value), msgprint: message => { throw new Error(message); }
    }, __: value => value };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../hrms/hr/page/attendance_import_center/attendance_import_center.js"), "utf8") + "\nthis.Controller = AttendanceImportCenter;", context);
    const page = Object.create(context.Controller.prototype);
    page.capture_exception_scroll_position = () => ({});
    page.escape = String;
    page.attendance_date_with_weekday = String;
    page.parse_attendance_time_minutes = () => null;
    page.load_processing_exceptions = () => {};
    page.call_processing_api = (method, args, options) => {
        if (method === "get_processing_record") options.on_success({ daily_rows: [{ source_row: 10,
            exception_codes: codes, editable_fields: [{ label: "深夜班", fieldname: "深夜班", late_editor: true, value: 0 }]
        }] });
        else options.on_success(response);
    };
    return { page, alerts, dialog: () => dialog };
}
test("fixed date is distinguished from pending sibling dates", () => {
    const c = controller({ review_status: "待审核", edited_daily_row_pending: false });
    c.page.open_attendance_daily_row_editor("R", 10);
    assert.ok(c.dialog().config.fields.some(field => field.label === "深夜班"));
    c.dialog().config.primary_action({ daily_value_0: 1, review_status: "已通过", reason: "TEST" });
    assert.match(c.alerts[0].message, /本日已校验通过.*其他日期/);
});
test("unresolved target is reported explicitly", () => {
    const c = controller({ review_status: "待审核", edited_daily_row_pending: true });
    c.page.open_attendance_daily_row_editor("R", 10);
    c.dialog().config.primary_action({ daily_value_0: 1, review_status: "已通过", reason: "TEST" });
    assert.match(c.alerts[0].message, /本日仍有异常/);
});
test("a verified late fact can be saved without changing its value", () => {
    const c = controller({ review_status: "已通过", edited_daily_row_pending: false });
    c.page.open_attendance_daily_row_editor("R", 10);
    assert.ok(c.dialog().config.fields.some(field => /迟到次数无需改为 0/.test(field.options || "")));
    c.dialog().config.primary_action({ daily_value_0: 0, review_status: "已通过", reason: "核实属实" });
    assert.equal(c.alerts.length, 1);
});
test("unchanged late values still require an approved review decision", () => {
    const c = controller({});
    c.page.open_attendance_daily_row_editor("R", 10);
    assert.throws(() => c.dialog().config.primary_action({ daily_value_0: 0, review_status: "待审核", reason: "待核实" }), /未修改任何字段/);
    assert.equal(c.alerts.length, 0);
});
test("download regenerates a processed batch with invalidated export cache", () => {
    const c = controller({});
    c.page.processing_batch = { slots: [{ source_type: "attendance_draft", processed_rows: 1, processed_result: null }] };
    let downloaded;
    c.page.download_processing_result = source => downloaded = source;
    c.page.download_slot_result("attendance_draft");
    assert.equal(downloaded, "attendance_draft");
});

test("verified source conflicts accept unchanged values only with explicit approval", () => {
    for (const code of ["CLOCK_IN_MISSING", "CLOCK_OUT_MISSING", "LEAVE_PUNCH_APPROVAL_MISMATCH", "WORKDAY_OVERTIME_APPROVAL_MISMATCH"]) {
        const c = controller({ edited_daily_row_pending: false }, [code]);
        c.page.open_attendance_daily_row_editor("R", 10);
        const check = c.dialog().config.fields.find(field => field.fieldname === "confirm_source_facts");
        assert.equal(check.default, 0);
        assert.throws(() => c.dialog().config.primary_action({ daily_value_0: 0, review_status: "已通过", reason: "核实正确" }), /未修改任何字段/);
        assert.throws(() => c.dialog().config.primary_action({ daily_value_0: 0, confirm_source_facts: 1, review_status: "待审核", reason: "待核实" }), /未修改任何字段/);
        let submitted;
        c.page.call_processing_api = (method, args) => { submitted = args; };
        c.dialog().config.primary_action({ daily_value_0: 0, confirm_source_facts: 1, review_status: "已通过", reason: "核实正确" });
        assert.equal(submitted.confirm_source_facts, 1);
        assert.equal(Object.keys(submitted.changes).length, 0);
    }
});
