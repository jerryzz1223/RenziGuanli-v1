const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../hrms/hr/doctype/training_program/training_program_list.js"), "utf8");
const start = source.indexOf("function schedule_training_activity(");
const end = source.indexOf("function open_training_import(", start);
assert(start > 0 && end > start);

class Wrapper {
	constructor() { this.handlers = {}; this.search = ""; }
	html(value) { this.markup = value; return this; }
	on(event, selector, handler) { if (!event.startsWith("keydown")) this.handlers[selector] = handler; return this; }
	off() { return this; }
	find(selector) {
		if (selector === "[data-schedule-participant]") return [];
		return { val: () => this.search };
	}
}

test("a course can seed each session while its instructor and hours remain independently editable", async () => {
	const calls = [];
	const messages = [];
	let dialog;
	const fixedNow = new Date(2026, 8, 29, 23, 30);
	class FixedDate extends Date {
		constructor(...args) { super(...(args.length ? args : [fixedNow.getTime()])); }
		static now() { return fixedNow.getTime(); }
	}
	const employee = { employee: "HR-0001", employee_code: "3649", employee_name: "王晶", department: "工程课" };
	const defaults = { course: "L1/L2线亏损检讨", owner_department: "工程课", training_category: "内部培训", training_mode: "内部", location: "品管交接班处", target_audience: "工程模具员", trainer_name: "课程默认讲师" };
	const context = {
		Date: FixedDate,
		__: (message, values = []) => values.reduce((text, value, index) => text.replace(`{${index}}`, value), message),
		workflowApi: "hrms.api.training_learning",
		currentCompany: () => "永新",
		escape: (text) => String(text ?? ""),
		window: { hrmsCapabilities: { require: () => true } },
		frappe: {
			ui: { Dialog: class {
				constructor(config) {
					dialog = this;
					this.config = config;
					this.values = Object.fromEntries(config.fields.filter((field) => field.fieldname).map((field) => [field.fieldname, field.default || ""]));
					this.fields_dict = { participant_picker: { $wrapper: new Wrapper() }, instructor_picker: { $wrapper: new Wrapper() }, session_progress: { $wrapper: new Wrapper() }, session_time_picker: { $wrapper: new Wrapper() } };
				}
				show() {}
				hide() { this.hidden = true; }
				get_value(field) { return this.values[field]; }
				get_values() { return { ...this.values }; }
				set_df_property(field, property, value) { this.fields_dict[field] ||= {}; this.fields_dict[field][property] = value; }
				async set_value(field, value) {
					this.values[field] = value;
					this.config.fields.find((item) => item.fieldname === field)?.onchange?.();
				}
			} },
			call({ method, args }) {
				calls.push({ method, args });
				if (method.endsWith("get_training_course_defaults")) return Promise.resolve({ message: defaults });
				if (method.endsWith("find_training_employees")) return Promise.resolve({ message: [employee] });
				if (method.endsWith("create_training_activity")) return Promise.resolve({ message: { name: "S1" } });
				throw new Error(method);
			},
			show_alert() {},
			msgprint(message) { messages.push(message); },
		},
	};
	vm.createContext(context);
	vm.runInContext(`${source.slice(start, end)}\nthis.schedule_training_activity = schedule_training_activity;`, context);
	context.schedule_training_activity(null, "课程1");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(dialog.get_value("course"), defaults.course);
	assert.equal(dialog.get_value("location"), defaults.location);
	assert.equal(dialog.get_value("trainer_name"), defaults.trainer_name);
	assert.equal(dialog.get_value("course_hours"), "", "the plan's total hours must not become each session's hours");
	assert.equal(dialog.config.fields.some((field) => field.fieldtype === "Datetime" && ["start_time", "end_time"].includes(field.fieldname)), false);
	const today = fixedNow;
	const todayString = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
	const timePicker = dialog.fields_dict.session_time_picker.$wrapper;
	assert.match(timePicker.markup, new RegExp(`data-training-time-date="start" value="${todayString}"`));
	assert.match(timePicker.markup, /data-training-time-date="end" value="2026-09-30"/, "the default end time crosses midnight when needed");
	assert.match(timePicker.markup, /data-training-time-wheel="start:hour"/);
	assert.match(timePicker.markup, /data-training-time-wheel="start:minute"/);
	assert.match(timePicker.markup, /<style>[\s\S]*scroll-snap-type:y mandatory[\s\S]*<\/style>/, "the wheel style must load with the dialog");
	assert.match(timePicker.markup, /hrms-training-time-selection/, "the two columns share a centered wheel selection");
	assert.doesNotMatch(timePicker.markup, /<button[^>]*data-training-time-option/, "time values must not render as a button grid");
	const setDate = (which, value) => timePicker.handlers["[data-training-time-date]"].call({ dataset: { trainingTimeDate: which }, value });
	const selectTime = (which, part, value) => {
		const option = { dataset: { trainingTimeOption: `${which}:${part}:${value}` }, classList: { toggle() {} }, setAttribute() {} };
		option.closest = () => ({ scrollTo() {}, querySelectorAll: () => [option] });
		timePicker.handlers["[data-training-time-option]"].call(option);
	};

	const instructorPicker = dialog.fields_dict.instructor_picker.$wrapper;
	instructorPicker.search = "3649";
	instructorPicker.handlers["[data-instructor-search-button]"]();
	await new Promise((resolve) => setImmediate(resolve));
	await instructorPicker.handlers["[data-instructor-select]"].call({ dataset: { instructorSelect: "0" } });
	assert.equal(dialog.get_value("trainer_name"), employee.employee_name);
	await dialog.set_value("trainer_name", "外部讲师");
	assert.match(instructorPicker.markup, /外部授课人可直接填写/);
	setDate("start", "2026-08-25");
	setDate("end", "2026-08-24");
	selectTime("start", "hour", 9);
	selectTime("start", "minute", 0);
	selectTime("end", "hour", 10);
	selectTime("end", "minute", 0);
	await dialog.config.secondary_action();
	assert.equal(calls.filter((call) => call.method.endsWith("create_training_activity")).length, 0, "an end before start must not save");
	assert.match(messages.at(-1), /结束时间必须晚于开始时间/);
	setDate("end", "2026-08-25");
	await dialog.config.secondary_action();
	assert.equal(JSON.parse(calls.at(-1).args.payload).trainer_employee_code, "", "editing the instructor name must clear the roster link");
	assert.equal(JSON.parse(calls.at(-1).args.payload).start_time, "2026-08-25 09:00", "seconds must not be included");
	assert.equal(dialog.hidden, undefined, "continuing must keep the scheduler open");
	assert.match(timePicker.markup, new RegExp(`data-training-time-date="start" value="${todayString}"`), "the next session defaults back to today");
	assert.equal(dialog.get_value("course"), defaults.course, "course defaults stay available for the next session");
	assert.match(dialog.fields_dict.session_progress.$wrapper.markup, /本次已保存 1 场/);
	instructorPicker.search = "3649";
	instructorPicker.handlers["[data-instructor-search-button]"]();
	await new Promise((resolve) => setImmediate(resolve));
	await instructorPicker.handlers["[data-instructor-select]"].call({ dataset: { instructorSelect: "0" } });
	await dialog.set_value("location", "第二场教室");
	await dialog.set_value("course_hours", 1.5);
	setDate("start", "2026-08-31");
	setDate("end", "2026-08-31");
	selectTime("start", "hour", 9);
	selectTime("start", "minute", 0);
	selectTime("end", "hour", 10);
	selectTime("end", "minute", 0);
	await dialog.config.primary_action({ ...dialog.values });
	const payload = JSON.parse(calls.at(-1).args.payload);
	assert.equal(payload.training_program, "课程1");
	assert.equal(payload.trainer_employee_code, "3649");
	assert.equal(payload.location, "第二场教室");
	assert.equal(payload.course_hours, 1.5);
	assert.equal(payload.start_time, "2026-08-31 09:00");
	assert.equal(payload.end_time, "2026-08-31 10:00");
	assert.equal(dialog.hidden, true);
});
