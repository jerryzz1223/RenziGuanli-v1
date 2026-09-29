const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
	path.join(__dirname, "../hrms/hr/page/training_learning_center/training_learning_center.js"),
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
		defaults: { get_user_default: () => "永新" },
	},
};
vm.createContext(context);
vm.runInContext(`${classSource}\nthis.TrainingLearningHome = TrainingLearningHome;`, context);

(async () => {
	const wrapper = { innerHTML: "", querySelectorAll: () => [] };
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

	for (const destination of ["training-result", "training-feedback", "employee-skill-map"]) {
		home.navigate(destination);
		assert.deepEqual(route, ["List", "Training Program"], `${destination} must stay in the custom training page`);
	}
	console.log("Training home accepts Frappe Deferred responses without leaving the previous page mounted.");
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
