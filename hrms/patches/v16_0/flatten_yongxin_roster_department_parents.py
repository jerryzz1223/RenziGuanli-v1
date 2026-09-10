def execute():
	from hrms.setup import flatten_yongxin_roster_department_parents, hide_roster_department_tree_columns

	flatten_yongxin_roster_department_parents()
	hide_roster_department_tree_columns()
