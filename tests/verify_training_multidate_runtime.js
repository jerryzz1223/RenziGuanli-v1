const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../hrms/hr/doctype/training_program/training_program_list.js"), "utf8");
const functions = [
	source.slice(source.indexOf("function participant_rows("), source.indexOf("function roster_rows_from_dom(")),
	source.slice(source.indexOf("function execution_sessions("), source.indexOf("function render_training_detail(")),
];
const context = {
	__: (message, values = []) => values.reduce((text, value, index) => text.replace(`{${index}}`, value), message),
	escape: (value) => String(value ?? ""),
	detail_field: (label, value) => `${label}: ${value};`,
};
vm.createContext(context);
vm.runInContext(`${functions.join("\n")}\nthis.participant_rows = participant_rows; this.execution_sessions = execution_sessions; this.event_detail_html = event_detail_html; this.toggle_session_panel = toggle_session_panel;`, context);

test("260825/260831 displays as two dated sessions with one shared attendance record", () => {
	const event = {
		name: "SOURCE-EVENT-1", course: "2607月月报", event_name: "2607月月报",
		session_dates: ["2026-08-25", "2026-08-31"], session_count: 2,
		source_actual_dates: "260825 /260831", source_course_hours: 0.5,
		participant_count: 18, participants: [{ employee_code: "3649", employee_name: "王晶" }],
	};
	const sessions = context.execution_sessions([event]);
	assert.equal(sessions.length, 2);
	const cards = sessions.map(context.event_detail_html);
	assert.match(cards[0], /2026-08-25 · 第 1\/2 场/);
	assert.match(cards[1], /2026-08-31 · 第 2\/2 场/);
	for (const card of cards) {
		assert.match(card, /2 场合计 18 人次，原表未区分每场人员与学时/);
		assert.match(card, /来源课时（多场合并）: 0.5/);
		assert.match(card, /data-training-edit-roster="SOURCE-EVENT-1"/);
		assert.match(card, /来源表仅保存了跨日期合并的参训名单/);
		assert.match(card, /王晶/);
	}
	const participants = context.participant_rows([event]);
	assert.equal(participants.length, 1, "the source participant must not be duplicated for each date");
	assert.equal(participants[0].event_date, "2026-08-25 / 2026-08-31（合并记录）");
});

test("separate sessions show only their own employees and expand independently", () => {
	const events = [
		{ name: "EVENT-1", course: "12月KPI月会", start_time: "2026-09-02 09:00:00", participant_count: 1, participants: [{ employee_code: "1001", employee_name: "第一场员工", attendance: "Present", study_hours: 1 }] },
		{ name: "EVENT-2", course: "12月KPI月会", start_time: "2026-09-16 09:00:00", participant_count: 1, participants: [{ employee_code: "2002", employee_name: "第二场员工", attendance: "Absent", study_hours: 0 }] },
		{ name: "EVENT-3", course: "12月KPI月会", start_time: "2026-09-23 09:00:00", participant_count: 1, participants: [{ employee_code: "3003", employee_name: "第三场员工", attendance: "Present", study_hours: 1 }] },
	];
	const sessions = context.execution_sessions(events);
	const first = context.event_detail_html(sessions[0], 0);
	const second = context.event_detail_html(sessions[1], 1);
	assert.match(first, /第一场员工/);
	assert.doesNotMatch(first, /第二场员工/);
	assert.match(second, /第二场员工/);
	assert.doesNotMatch(second, /第一场员工/);
	assert.doesNotMatch(second, /第三场员工/);
	assert.match(first, /data-training-session-panel hidden/);
	assert.match(second, /data-training-session-panel hidden/);

	const cards = events.map((item, index) => {
		const panel = { hidden: true };
		const button = { dataset: { trainingSessionCount: "1", trainingSessionCombined: "0" }, setAttribute(name, value) { this[name] = value; } };
		return { dataset: { trainingSessionKey: `${item.name}:0` }, panel, button, querySelector(selector) { return selector === "[data-training-session-panel]" ? panel : button; } };
	});
	const workspace = { querySelectorAll: () => cards };
	context.toggle_session_panel(workspace, "EVENT-1:0");
	assert.equal(cards[0].panel.hidden, false);
	assert.equal(cards[1].panel.hidden, true);
	context.toggle_session_panel(workspace, "EVENT-2:0");
	context.toggle_session_panel(workspace, "EVENT-3:0");
	assert.equal(cards[0].panel.hidden, false, "opening another session does not close the first");
	assert.equal(cards[1].panel.hidden, false);
	assert.equal(cards[2].panel.hidden, false);
	context.toggle_session_panel(workspace, "EVENT-1:0");
	assert.equal(cards[0].panel.hidden, true);
	assert.equal(cards[1].panel.hidden, false);
	assert.equal(cards[2].panel.hidden, false);
});
