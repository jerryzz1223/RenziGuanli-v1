const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { Blob } = require("buffer");
const source = fs.readFileSync(path.join(__dirname, "../hrms/public/js/hrms_employee_history_export.js"), "utf8");
const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const zip = new Blob([new Uint8Array([0x50, 0x4b, 3, 4]), "client-signature-test"]);
const response = (type = mime, blob = zip) => ({ ok: true, headers: { get: () => type }, blob: async () => blob });
function harness() {
    const state = { calls: [], frozen: 0, alerts: [], clicked: [], revoked: [], timers: new Map(), nextTimer: 0, removed: 0 };
    const context = {
        Set, String, Uint8Array, AbortController, encodeURIComponent,
        window: {},
        frappe: {
            csrf_token: "test",
            dom: { freeze() { state.frozen++; }, unfreeze() { state.frozen--; } },
            utils: { escape_html: text => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") },
            msgprint(message) { state.alerts.push(message); },
        },
        __: value => value,
        fetch: (url, options) => new Promise((resolve, reject) => {
            state.calls.push({ url, options, resolve, reject });
            options.signal.addEventListener("abort", () => {
                const error = new Error("aborted"); error.name = "AbortError"; reject(error);
            });
        }),
        URL: { createObjectURL: () => "blob:test", revokeObjectURL: value => state.revoked.push(value) },
        setTimeout: (fn, delay) => { const id = ++state.nextTimer; state.timers.set(id, { fn, delay }); return id; },
        clearTimeout: id => state.timers.delete(id),
        document: {
            body: { appendChild() {}, classList: { add() {} } },
            createElement() { return { click() { if (state.failClick) throw new Error("download blocked"); state.clicked.push({ href: this.href, name: this.download }); }, remove() { state.removed++; } }; },
        },
    };
    state.fireTimers = delay => {
        for (const [id, timer] of [...state.timers]) if (timer.delay === delay) { state.timers.delete(id); timer.fn(); }
    };
    vm.runInNewContext(source, context);
    return { state, context, exportHistory: context.window.hrmsExportEmployeeHistory };
}

async function run() {
    {
        const { state, exportHistory } = harness();
        await exportHistory("");
        assert.strictEqual(state.calls.length, 0);
        const first = exportHistory("EMP A&company=other");
        await exportHistory("EMP A&company=other");
        assert.strictEqual(state.calls.length, 1);
        assert(state.calls[0].url.endsWith("employee=EMP%20A%26company%3Dother"));
        assert.strictEqual(state.calls[0].options.credentials, "same-origin");
        state.calls[0].resolve(response(mime.toUpperCase() + "; charset=binary"));
        await first;
        assert.strictEqual(state.frozen, 0);
        assert.strictEqual(state.clicked.length, 1);
        assert(![...state.timers.values()].some(t => t.delay === 180000));
        state.fireTimers(60000);
        assert.deepStrictEqual(state.revoked, ["blob:test"]);
    }
    for (const invalid of [
        { ok: false, headers: { get: () => "application/json" }, json: async () => ({}) },
        response("text/html"), response("text/plain"),
        response(mime, new Blob(["upstream error"])), response("application/octet-stream", new Blob([])),
    ]) {
        const { state, exportHistory } = harness();
        const failed = exportHistory("EMP-A");
        state.calls[0].resolve(invalid);
        await failed;
        assert.strictEqual(state.alerts.length, 1);
        assert.strictEqual(state.frozen, 0);
        assert.strictEqual(state.clicked.length, 0, "Error bodies must never be downloaded as XLSX");
    }
    {
        const { state, exportHistory } = harness();
        const failed = exportHistory("EMP-A");
        state.calls[0].resolve({ ok: false, headers: { get: () => "application/json" }, json: async () => ({ _server_messages: JSON.stringify([JSON.stringify({ message: "来源超限<img src=x>" })]) }) });
        await failed;
        assert(state.alerts[0].message.includes("来源超限&lt;img"), "User-facing source errors must be escaped and retained");
    }
    {
        const { state, exportHistory } = harness();
        const failed = exportHistory("EMP-A");
        state.fireTimers(180000);
        await failed;
        assert(state.calls[0].options.signal.aborted);
        assert(state.alerts[0].message.includes("超时"));
        assert.strictEqual(state.frozen, 0);
        const retry = exportHistory("EMP-A");
        state.calls[1].resolve(response("application/octet-stream"));
        await retry;
        assert.strictEqual(state.clicked.length, 1, "A timed-out export must be retryable");
    }
    {
        const { state, exportHistory } = harness();
        const one = exportHistory("EMP-A"), two = exportHistory("EMP-B");
        assert.strictEqual(state.frozen, 1);
        state.calls[0].resolve(response()); await one;
        assert.strictEqual(state.frozen, 1, "Keep UI frozen while another export is pending");
        state.calls[1].resolve(response()); await two;
        assert.strictEqual(state.frozen, 0);
    }
    {
        const { state, exportHistory } = harness();
        state.failClick = true;
        const blocked = exportHistory("EMP-A"); state.calls[0].resolve(response()); await blocked;
        state.fireTimers(60000);
        assert.strictEqual(state.removed, 1);
        assert.deepStrictEqual(state.revoked, ["blob:test"], "Even a blocked click must release its Blob URL");
        assert.strictEqual(state.frozen, 0);
    }
    {
        const { context } = harness();
        let action, asset, requestedEmployee;
        context.frappe.pages = { "employee-detail": {} };
        context.frappe.require = (url, callback) => { asset = url; callback(); };
        context.window.hrmsExportEmployeeHistory = employee => { requestedEmployee = employee; };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../hrms/hr/page/employee_detail/employee_detail.js"), "utf8") + "\nthis.Detail = EmployeeDetailPage;", context);
        const page = { main: [{}], set_secondary_action() {}, add_inner_button(label, callback) { assert.strictEqual(label, "导出全履历"); action = callback; } };
        const detail = new context.Detail(page);
        detail.set_breadcrumb = () => {}; detail.refresh_from_route = () => {}; detail.show();
        action(); assert.strictEqual(requestedEmployee, undefined);
        detail.employee = "EMP-B"; detail.detail = {}; action();
        assert.strictEqual(asset, "/assets/hrms/js/hrms_employee_history_export.js");
        assert.strictEqual(requestedEmployee, "EMP-B");
    }
    console.log("employee history export runtime: MIME/ZIP, escaped errors, timeout/retry, concurrency, cleanup and entry passed");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
