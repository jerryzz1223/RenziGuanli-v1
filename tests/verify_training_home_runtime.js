const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
	path.join(__dirname, "../hrms/hr/page/training_learning_center/training_learning_center.js"),
	"utf8",
);
const listSource = fs.readFileSync(
	path.join(__dirname, "../hrms/hr/doctype/training_program/training_program_list.js"),
	"utf8",
);
const classSource = source.slice(source.indexOf("class TrainingLearningHome"));
const dashboard = { metrics: { planned_courses: 3 }, risks: [], upcoming_events: [] };
let callCount = 0;
let route = null;
const context = {
	__: (value) => value,
	window: {},
	frappe: {
		route_options: {},
		set_route(...parts) {
			route = parts;
		},
		call() {
			callCount += 1;
			// Match the deployed Frappe contract: a thenable jQuery Deferred which
			// does not implement Promise.prototype.finally().
			return { then: (resolve) => resolve({ message: dashboard }) };
		},
		utils: { escape_html: (value) => value },
		datetime: { str_to_user: (value) => value },
		defaults: { get_user_default: () => "永新" },
	},
};
vm.createContext(context);
vm.runInContext(`${classSource}\nthis.TrainingLearningHome = TrainingLearningHome;`, context);

(async () => {
	const wrapper = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
	const page = { main: [wrapper], set_title() {} };
	const home = new context.TrainingLearningHome(page);
	home.render = (data) => { home.rendered = data; };

	const result = await home.show();
	assert.deepEqual(result, dashboard);
	assert.deepEqual(home.rendered, dashboard);
	assert.equal(home.load_promise, null, "completed dashboard loads must release the in-flight request");
	assert.equal(callCount, 1);

	home.navigate("completed-training-event");
	assert.deepEqual(route, ["List", "Training Program"]);
	assert.deepEqual({ ...context.window.hrmsTrainingPlanNavigation }, { view: "activities", status: "已完成" });

	home.navigate("training-event");
	assert.deepEqual(route, ["List", "Training Program"]);
	assert.deepEqual({ ...context.window.hrmsTrainingPlanNavigation }, { view: "activities", status: "全部" });
	for (const [card, view, status] of [
		["annual-training-program", "plans", "年度计划"],
		["implemented-training-program", "plans", "已实施"],
		["pending-training-program", "plans", "待实施"],
		["temporary-training-event", "activities", "临时新增"],
		["completed-training-event", "activities", "已完成"],
	]) {
		home.navigate(card);
		assert.deepEqual(route, ["List", "Training Program"]);
		assert.deepEqual({ ...context.window.hrmsTrainingPlanNavigation }, { view, status }, `${card} must open its matching filter`);
		assert(source.includes(`"${card}")}`) || source.includes(`data-training-home-route="${card}"`), `${card} must be wired to a home entry`);
	}

	const filterSource = listSource.slice(
		listSource.indexOf("function compare_plan_rows"),
		listSource.indexOf("function filter_options"),
	);
	const listContext = {
		planTableState: { view: "plans", status: "年度计划", query: "", person: "", department: "", trainingType: "", month: "", sort: "course", direction: "asc" },
	};
	vm.createContext(listContext);
	const navigationSource = listSource.slice(
		listSource.indexOf("function consume_training_navigation"),
		listSource.indexOf("function get_import_state"),
	);
	listContext.window = context.window;
	vm.runInContext(`${navigationSource}\n${filterSource}\nthis.consume_training_navigation = consume_training_navigation; this.plan_table_rows = plan_table_rows;`, listContext);
	for (const [card, view, status] of [
		["annual-training-program", "plans", "年度计划"],
		["implemented-training-program", "plans", "已实施"],
		["pending-training-program", "plans", "待实施"],
		["temporary-training-event", "activities", "临时新增"],
		["completed-training-event", "activities", "已完成"],
	]) {
		home.navigate(card);
		assert.equal(listContext.consume_training_navigation(), true);
		assert.equal(listContext.planTableState.view, view);
		assert.equal(listContext.planTableState.status, status);
		assert.equal(context.window.hrmsTrainingPlanNavigation, undefined);
	}
	const plans = [
		{ kind: "plan", classification: "计划", status: "已实施", course: "A" },
		{ kind: "plan", classification: "计划", status: "待实施", course: "B" },
		{ kind: "plan", classification: "临时", status: "临时课程", course: "C" },
		{ kind: "actual", classification: "实际发生", status: "临时新增", course: "D" },
	];
	listContext.planTableState.view = "plans";
	listContext.planTableState.status = "年度计划";
	assert.deepEqual(Array.from(listContext.plan_table_rows(plans), (row) => row.course), ["A", "B"]);
	listContext.planTableState.status = "已实施";
	assert.deepEqual(Array.from(listContext.plan_table_rows(plans), (row) => row.course), ["A"]);
	listContext.planTableState.status = "待实施";
	assert.deepEqual(Array.from(listContext.plan_table_rows(plans), (row) => row.course), ["B"]);
	listContext.planTableState.view = "activities";
	listContext.planTableState.status = "临时新增";
	const activities = [
		{ kind: "actual", status: "已完成", plan_match_status: "临时新增", course: "D" },
		{ kind: "actual", status: "待开展", plan_match_status: "临时新增", course: "E" },
		{ kind: "actual", status: "已完成", plan_match_status: "已匹配计划", course: "F" },
	];
	assert.deepEqual(Array.from(listContext.plan_table_rows(activities), (row) => row.course), ["D", "E"]);
	listContext.planTableState.status = "已完成";
	assert.deepEqual(Array.from(listContext.plan_table_rows(activities), (row) => row.course), ["D", "F"]);
	listContext.planTableState.status = "结果未提交";
	activities[0].event_status = "Completed";
	activities[1].event_status = "Scheduled";
	activities[2].event_status = "Completed";
	activities[2].has_submitted_result = true;
	assert.deepEqual(Array.from(listContext.plan_table_rows(activities), (row) => row.course), ["D"]);
	home.navigate("pending-training-result");
	assert.deepEqual({ ...context.window.hrmsTrainingPlanNavigation }, { view: "activities", status: "结果未提交" });

	for (const destination of ["training-result", "training-feedback", "employee-skill-map"]) {
		home.navigate(destination);
		assert.deepEqual(route, ["List", "Training Program"], `${destination} must stay in the custom training page`);
	}
	const display = new context.TrainingLearningHome(page);
	display.render({
		metrics: { planned_courses: 3, implemented_plans: 2, pending_plans: 1, participant_instances: 8, pending_results: 1 },
		department_summary: [{ department: "制造部", planned: 3, implemented: 2, pending: 1 }],
		scheduled_events_preview: [{ event_name: "待处理活动", start_time: "2026-09-16 09:20:32", is_overdue: true }],
	});
	assert(wrapper.innerHTML.includes("67%"));
	assert(wrapper.innerHTML.includes("制造部"));
	assert(wrapper.innerHTML.includes("结果未提交"));
	assert(wrapper.innerHTML.includes("待处理活动") && wrapper.innerHTML.includes("已逾期"));
	assert(!wrapper.innerHTML.includes("培训闭环"));
	console.log("Training home accepts Frappe Deferred responses without leaving the previous page mounted.");
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
