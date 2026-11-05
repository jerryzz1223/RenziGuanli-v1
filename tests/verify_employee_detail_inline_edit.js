const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../hrms/hr/page/employee_detail/employee_detail.js'), 'utf8');
const requests = [], messages = [], routes = [];
let failSave = false;
const context = {
    console, Promise, Set, Date,
    __: (s) => s,
    window: {},
    frappe: {
        pages: {'employee-detail': {}},
        utils: {escape_html: String},
        msgprint: (s) => messages.push(s),
        show_alert() {},
        set_route: (...args) => routes.push(args),
        call: (options) => {
            requests.push(options);
            // Emulate an old Frappe then-only Deferred.
            return {then(resolve, reject) {
                if (failSave) reject(new Error('server validation failed'));
                else resolve({message: {modified: 'new', header: {}, sections: []}});
            }};
        },
    },
};
vm.createContext(context);
vm.runInContext(source + '\nglobalThis.Page = EmployeeDetailPage;', context);
function makePage() {
    const p = new context.Page({main: [{}]});
    p.employee = 'E1';
    p.active_tab = '个人信息';
    p.detail = {modified: 'old', permissions: {can_edit_employee_detail: true}, sections: [{label: '个人信息', fields: [
        {fieldname: 'cell_number', field_label: '手机', value: 'old', editable: true},
        {fieldname: 'custom_work_nature', field_label: '工作性质', value: '在职·试用期', editable: false},
    ]}]};
    p.render = () => {p.renders = (p.renders || 0) + 1;};
    return p;
}
(async () => {
    const p = makePage();
    await p.start_profile_edit();
    assert.equal(p.profile_editing, true);
    assert.equal(routes.length, 0, 'editing must stay on the current page');
    const html = p.render_section_tab('个人信息');
    assert(html.includes('data-profile-field="cell_number"'));
    assert(!html.includes('data-profile-field="custom_work_nature"'));
    assert(html.includes('data-action="save-profile"'));
    assert(html.includes('data-action="cancel-profile"'));
    p.loaded_tab_groups.add('profile:在职信息');
    p.profile_controls = [{field: {fieldname: 'cell_number'}, control: {get_value: () => 'cross-tab'}}];
    await p.open_tab('在职信息');
    assert.equal(p.active_tab, '在职信息');
    assert.equal(p.profile_draft.cell_number, 'cross-tab');
    assert.equal(p.profile_editing, true);
    assert.equal(messages.length, 0);
    const emptyBlock = {label: '紧急联系人', record_editor: {fields: [{fieldname: 'value_0', label: '姓名'}], rows: []}};
    const emptyHtml = p.render_related_detail(emptyBlock);
    assert(emptyHtml.includes('data-add-record'));
    p.profile_record_draft['紧急联系人'] = [{value_0: '联系人'}];
    assert(p.render_related_detail(emptyBlock).includes('data-remove-record'));

    p.profile_controls = [{field: {fieldname: 'cell_number', value: 'old'}, control: {get_value: () => 'new'}}];
    await p.save_profile_edit();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].args.modified, 'old');
    assert.equal(requests[0].args.values, '{"cell_number":"new"}');
    assert.deepEqual(JSON.parse(requests[0].args.records), {'紧急联系人': [{value_0: '联系人'}]});
    assert.equal(p.profile_editing, false);
    assert.equal(p.detail.modified, 'new');
    assert.equal(routes.length, 0);

    const failed = makePage();
    await failed.start_profile_edit();
    failed.profile_controls = [{field: {fieldname: 'cell_number', value: 'old'}, control: {get_value: () => 'draft'}}];
    failSave = true;
    await failed.save_profile_edit();
    assert.equal(failed.profile_editing, true);
    assert.equal(failed.profile_draft.cell_number, 'draft', 'failed save retains typed data');
    assert.equal(failed.profile_saving, false);

    const unchanged = makePage();
    await unchanged.start_profile_edit();
    unchanged.profile_controls = [{field: {fieldname: 'cell_number', value: 'old'}, control: {get_value: () => 'old'}}];
    const count = requests.length;
    await unchanged.save_profile_edit();
    assert.equal(requests.length, count, 'unchanged profile must not be submitted');
    assert.equal(unchanged.profile_editing, false);

    const across = makePage();
    await across.start_profile_edit();
    across.profile_controls = [{field: {fieldname: 'cell_number'}, control: {get_value: () => 'tab-one'}}];
    across.render_tab_loading = () => {};
    failSave = false;
    const originalCall = context.frappe.call;
    context.frappe.call = () => Promise.resolve({message: {
        sections: [{label: '在职信息', fields: [{fieldname: 'designation', editable: true, value: 'old-job'}]}],
        related_records: {'在职信息': []},
    }});
    across.detail.related_records = {'个人信息': [{label: '教育经历'}]};
    await across.open_tab('在职信息');
    assert.equal(across.detail.sections.length, 2, 'lazy tabs must merge sections instead of overwriting');
    assert(across.detail.related_records['个人信息'], 'previous related records must remain available');
    across.profile_controls = [{field: {fieldname: 'designation'}, control: {get_value: () => 'tab-two'}}];
    context.frappe.call = originalCall;
    await across.save_profile_edit();
    assert.deepEqual(JSON.parse(requests.at(-1).args.values), {cell_number: 'tab-one', designation: 'tab-two'});

    const overview = makePage();
    overview.active_tab = '概览';
    await overview.start_profile_edit();
    assert.equal(overview.active_tab, '概览', 'global edit mode must not force another tab');
    assert(overview.render_profile_actions().includes('保存全部'));
    assert.equal(overview.has_profile_changes(), false);

    const denied = makePage();
    denied.detail.permissions.can_edit_employee_detail = false;
    await denied.start_profile_edit();
    assert.equal(denied.profile_editing, false);
    console.log('Employee editing passed: global mode, cross-tab drafts and atomic payload, lazy-tab merge, empty-record add/remove, workflow locks, Deferred save, failure retention and permissions.');
})().catch((error) => {console.error(error); process.exitCode = 1;});
