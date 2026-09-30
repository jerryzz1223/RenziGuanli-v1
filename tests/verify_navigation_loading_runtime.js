const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../hrms/public/js/hrms_top_nav.js'), 'utf8');
const navigate = source.slice(source.indexOf('\tfunction navigate(route) {'), source.indexOf('\n\tfunction currentUserId('));
const render = source.slice(source.indexOf('\tfunction render() {'), source.indexOf('\n\tfunction scheduleRender()'));
const affects = source.slice(source.indexOf('\tfunction affectsNavigationShell('), source.indexOf('\n\tnew MutationObserver((mutations)'));
const routeCalls = [], routeEvents = [];
const navigationContext = {
 window: {frappe: {}, location: {href: ''}, dispatchEvent: (event) => routeEvents.push(event)},
 frappe: {set_route: (...parts) => routeCalls.push(parts)},
 CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
};
vm.createContext(navigationContext);
vm.runInContext(navigate, navigationContext);
navigationContext.navigate('/desk/organizational-chart');
assert.deepEqual(routeCalls, [['organizational-chart']], 'top nav must delegate Desk navigation to the Frappe router');
assert.equal(routeEvents.length, 0, 'top nav must not announce a completed route before the router mounts the target page');
navigationContext.navigate('/login');
assert.equal(navigationContext.window.location.href, '/login', 'non-Desk routes must keep full-page navigation');
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
console.log('Navigation runtime: router-safe top-nav transitions, unchanged DOM reuse, module/user changes and targeted mutation handling passed.');

const shellSource = fs.readFileSync(path.join(__dirname, '../hrms/public/js/hrms_home_redirect_v6.js'), 'utf8');
const shellNavigation = shellSource.slice(shellSource.indexOf('\tfunction route_to_parts(route) {'), shellSource.indexOf('\n\t// Sidebar order is a personal display preference.'));
const shellRoutes = [], shellEvents = [];
const shellContext = {
 window: {frappe: {}, location: {href: ''}, dispatchEvent: event => shellEvents.push(event)},
 frappe: {set_route: (...parts) => shellRoutes.push(parts)},
 route_to_slug: route => route.replace('/desk/', ''),
 hrms_expected_route_slug: '',
};
vm.createContext(shellContext);
vm.runInContext(shellNavigation, shellContext);
shellContext.navigate_hrms_sidebar('/desk/personnel-home', 'personnel-home');
assert.deepEqual(shellRoutes, [['personnel-home']], 'sidebar must ask the Desk router to navigate once');
assert.equal(shellEvents.length, 0, 'sidebar must not announce a second, premature route change');
assert.equal(shellContext.hrms_expected_route_slug, 'personnel-home');
