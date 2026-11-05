const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../hrms/hr/page/payroll_input_center/payroll_input_center.js'), 'utf8');
const method = source.slice(source.indexOf('\tload_monthly_workbench() {'), source.indexOf('\n\tformat_dashboard_money'));
const context = { Promise, __: x => x };
vm.createContext(context);
vm.runInContext(`this.Page = class { ${method} };`, context);
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const page = new context.Page();
    const dashboard = { innerHTML: '' }, table = { innerHTML: '' };
    const body = { innerHTML: '', querySelector: () => ({ addEventListener() {} }) };
    Object.assign(page, {
        active_tab: 'monthly-workbench', body: () => body, escape: x => x,
        format_payroll_month: () => '2026-08', scope_args: extra => ({ company: 'ACME', ...extra }),
        wrapper: { querySelector: selector => selector.includes('dashboard-content') ? dashboard : table },
        render_payroll_home_dashboard: data => `total:${data.summary.net_pay}`,
        render_monthly_calculation_table: (target, rows) => { target.innerHTML = `rows:${rows.length}`; },
        load_attendance_dependency: () => { throw Error('Homepage must not sync attendance'); },
    });
    return { page, dashboard, table };
}
(async () => {
    {
        const { page, dashboard, table } = fixture();
        const calls = [];
        page.call_payroll_api = options => {
            calls.push(options);
            if (options.method.endsWith('get_payroll_home_dashboard')) return Promise.resolve({message: {summary: {net_pay: 42}, attendance_lock_version: 'v2'}});
            options.callback({message: [{name: 'row'}]});
            return Promise.resolve({message: []});
        };
        page.load_monthly_workbench(); await tick();
        assert.equal(dashboard.innerHTML, 'total:42');
        assert.equal(table.innerHTML, 'rows:1');
        assert.equal(calls.length, 2);
        assert.equal(calls[0].args.attendance_lock_version, '');
        assert.equal(calls[1].args.attendance_lock_version, 'v2');
    }
    {
        const { page, dashboard } = fixture();
        page.call_payroll_api = () => Promise.reject(Error('offline'));
        page.load_monthly_workbench(); await tick();
        assert.match(dashboard.innerHTML, /加载失败/);
    }
    {
        const { page, dashboard } = fixture(); let resolve;
        page.call_payroll_api = () => new Promise(r => { resolve = r; });
        page.load_monthly_workbench(); page.active_tab = 'other';
        resolve({message: {summary: {net_pay: 99}, attendance_lock_version: 'v1'}});
        await tick(); assert.equal(dashboard.innerHTML, '');
    }
    {
        const { page, table } = fixture(); let calls = 0;
        page.call_payroll_api = () => { calls++; return Promise.resolve({message: {summary: {net_pay: 0}}}); };
        page.load_monthly_workbench(); await tick();
        assert.equal(calls, 1); assert.equal(table.innerHTML, 'rows:0');
    }
    {
        const dependency = source.slice(source.indexOf('\tload_attendance_dependency({'), source.indexOf('\n\tbody() {'));
        vm.runInContext(`this.DependencyPage = class { ${dependency} };`, context);
        const page = new context.DependencyPage();
        page.active_tab = 'monthly-workbench';
        page.call_payroll_api = () => { throw Error('Homepage render must not start sync'); };
        assert.equal(await page.load_attendance_dependency(), null);
    }
    console.log('Payroll dashboard runtime: 5 cases passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
