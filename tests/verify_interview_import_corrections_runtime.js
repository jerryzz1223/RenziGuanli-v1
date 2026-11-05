const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../hrms/hr/page/recruitment_center/recruitment_center.js'), 'utf8');
const dialogs = [], calls = [], messages = [];
const escape = (v) => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
class Dialog {
    constructor(options) {
        this.options = options;
        this.inputs = [{ value: '专科' }, { value: '' }];
        const element = {
            querySelector: (selector) => selector === '[data-apply-suggestions]' ? {
                addEventListener: (_, callback) => { this.apply = callback; },
            } : this.inputs[Number(selector.match(/"(\d+)"/)[1])],
        };
        Object.defineProperty(element, 'innerHTML', { set: (html) => { this.html = html; } });
        this.fields_dict = { review: { $wrapper: [element] } };
        dialogs.push(this);
    }
    get_primary_btn() { return { prop: (_, value) => { this.disabled = value; } }; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
}
let failImport = true, failPreview = false;
const frappe = {
    pages: { 'recruitment-center': {} }, utils: { escape_html: escape }, ui: { Dialog },
    msgprint: (message) => messages.push(message),
    call(request) {
        calls.push(request);
        const edits = JSON.parse(request.args.corrections);
        // Deliberately return a then-only Deferred, as older Frappe versions do.
        return { then(resolve, reject) {
            if (request.method.endsWith('import_registrations')) {
                if (failImport) { failImport = false; return reject(new Error('insert failed')); }
                assert.equal(edits.length, 2);
                return resolve({ message: { imported: 1, skipped: 0 } });
            }
            if (failPreview) { failPreview = false; return reject(new Error('temporary failure')); }
            const corrected = edits.length > 0;
            resolve({ message: { total: 1, pending: corrected ? 1 : 0, skipped: 0, fingerprint: 'token',
                corrections: edits.map((e) => ({ ...e, label: e.field === 'education' ? '学历' : '联系电话', original: e.field === 'education' ? '专科' : '' })),
                errors: corrected ? [] : [
                    { row: 4, field: 'education', label: '学历', value: '专科', suggestion: '大专', options: ['', '大专'], message: '学历：请选择', candidate_name: '<img src=x>' },
                    { row: 4, field: 'phone', label: '联系电话', value: '', suggestion: null, message: '联系电话：不能为空' },
                ],
            } });
        } };
    },
};
const context = vm.createContext({ frappe });
vm.runInContext(`${source}\nthis.Center = RecruitmentCenter;`, context);
const center = Object.create(context.Center.prototype);
center.refresh_register = () => { center.refreshed = true; };
(async () => {
    await center.preview_workbook({ company: 'A', file_url: '/private/files/test.xlsx' }, []);
    const errors = dialogs[0];
    assert.match(errors.html, /一键填入建议修正/);
    assert.match(errors.html, /&lt;img src=x&gt;/);
    assert.doesNotMatch(errors.html, /<img src=x>/);
    assert.equal(errors.inputs[0].value, '专科', 'Suggestions require a deliberate click');
    errors.apply();
    assert.equal(errors.inputs[0].value, '大专');
    assert.equal(errors.inputs[1].value, '', 'Missing facts must never be invented');
    errors.inputs[1].value = '13900000001';
    failPreview = true;
    await errors.options.primary_action();
    assert.equal(errors.visible, true);
    assert.equal(errors.disabled, false);
    assert.equal(errors.inputs[1].value, '13900000001');
    await errors.options.primary_action();
    const confirmation = dialogs[1];
    assert.equal(errors.visible, false);
    assert.match(confirmation.html, /学历/);
    assert.match(confirmation.html, /专科/);
    assert.match(confirmation.html, /大专/);
    assert.equal(calls.filter((c) => c.method.endsWith('import_registrations')).length, 0);
    await confirmation.options.primary_action();
    await new Promise(setImmediate);
    const retry = dialogs[2];
    assert.equal(retry.visible, true);
    assert.match(retry.html, /13900000001/);
    await retry.options.primary_action();
    assert.equal(retry.visible, false);
    assert.equal(center.refreshed, true);
    assert.ok(messages.some((m) => m.includes('新增 1 条')));
    failPreview = true;
    await center.preview_workbook({ company: 'A', file_url: '/private/files/test.xlsx' }, []);
    const firstFailure = dialogs[3];
    assert.equal(firstFailure.options.primary_action_label, '重新校验');
    assert.equal(firstFailure.visible, true);
    await firstFailure.options.primary_action();
    assert.equal(firstFailure.visible, false);
    assert.equal(dialogs[4].visible, true);
    assert.match(dialogs[4].html, /一键填入建议修正/);
    console.log('Interview import correction, retry, review, escaping and Deferred runtime checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
