const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../hrms/public/js/hrms_top_nav.js'), 'utf8');
const render = source.slice(source.indexOf('\tfunction render() {'), source.indexOf('\n\tfunction scheduleRender()'));
const affects = source.slice(source.indexOf('\tfunction affectsNavigationShell('), source.indexOf('\n\tnew MutationObserver((mutations)'));
let replacements = 0, active = '人事', user = 'A', titleUpdates = 0;
const target = {};
const element = () => ({appendChild() {}, addEventListener() {}, dataset: {}});
const nav = {parentElement: target, dataset: {}, replaceChildren() {replacements++;}, appendChild() {}};
const context = {
 document: {body: {classList: {contains: () => false}}, getElementById: () => nav, createElement: element},
 window: {}, NAV_ID: 'nav', DEFAULT_BRAND_LOGO: 'logo', brandLogoUrl: 'logo',
 SHOW_COMPANY_CONTEXT_IN_NAV: false, modules: [],
 isDeskPage: () => true, mountPoint: () => target, activeLabel: () => active,
 isDingtalkIntegrationRoute: () => false, routeSlug: () => 'employee',
 currentUserId: () => user, displayName: () => user, renderAvatar: () => 'avatar',
 currentUserRoles: () => ['HR Manager'], getCurrentCompany: () => 'Company A',
 decoratePageTitle: () => titleUpdates++, renderContextualAdminBar() {},
 loadCurrentUser() {}, bindMoreDocumentEvents() {}, removeRedundantFrameworkControls() {},
 renderSidebarToggle: element, loadBrandLogo() {}, renderMore: element, renderAccountMenu: element,
 shellSelector: '.navbar, .page-head, #nav',
};
vm.createContext(context);
vm.runInContext(render + '\n' + affects, context);
context.render(); context.render(); context.render();
assert.equal(replacements, 1, 'unchanged focus/route refresh must preserve navigation DOM');
assert.equal(titleUpdates, 3, 'new page titles must still be decorated with a reused nav');
active = '薪酬'; context.render();
assert.equal(replacements, 2, 'changing modules updates the nav');
user = 'B'; context.render();
assert.equal(replacements, 3, 'changing users updates the account menu');
const plainNode = {nodeType: 1, closest: () => null, matches: () => false, querySelector: () => null};
assert.equal(context.affectsNavigationShell({target: plainNode, addedNodes: [plainNode], removedNodes: []}), false);
assert.equal(context.affectsNavigationShell({target: plainNode, addedNodes: [{nodeType: 3}], removedNodes: []}), false);
assert.equal(context.affectsNavigationShell({target: {...plainNode, closest: () => ({})}, addedNodes: [], removedNodes: []}), true);
assert.equal(context.affectsNavigationShell({target: plainNode, addedNodes: [], removedNodes: [{...plainNode, matches: () => true}]}), true);
console.log('Navigation runtime: unchanged DOM reuse, module/user changes and targeted mutation handling passed.');
