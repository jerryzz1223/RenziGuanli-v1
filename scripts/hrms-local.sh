#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${PROJECT_ROOT}/docker/docker-compose.yml"
BENCH_DIR="/home/frappe/frappe-bench"

bench_exec() {
	docker compose -f "${COMPOSE_FILE}" exec frappe bash -lc "cd ${BENCH_DIR} && $*"
}

require_docker() {
	if ! command -v docker >/dev/null 2>&1; then
		echo "Docker is not installed. Install Docker Desktop, then try again." >&2
		exit 1
	fi
	if ! docker info >/dev/null 2>&1; then
		echo "Docker Desktop is not running. Start it, wait until it is ready, then try again." >&2
		exit 1
	fi
	if [ ! -f "${COMPOSE_FILE}" ]; then
		echo "Compose file not found: ${COMPOSE_FILE}" >&2
		exit 1
	fi
}

show_usage() {
	cat <<'EOF'
Usage: ./scripts/hrms-local.sh <command> [argument]

Commands:
  start          Start local HRMS, MariaDB, and Redis without deleting data.
  stop           Stop local services without deleting the database volume.
  status         Show container status.
  logs [lines]   Show the latest logs (default: 200 lines).
  logs-follow    Stream service logs until Ctrl+C.
  migrate        Run Frappe database migration after code changes.
  seed [phases]  Seed local TEST-HRMS data. Default: all phases.
  seed-dry-run [phases]
                 Preview local TEST-HRMS seed without writing.
  seed-payroll   Seed foundation, employees, locked attendance, and payroll demo.
  seed-full-payroll
                 Run the complete TEST-HRMS / 2099-03 payroll trial through
                 attendance Excel import, manual correction, lock, payroll
                 source/variable imports, settlement generation and confirmation.
  seed-full-payroll-dry-run
                 Preview the full payroll trial without writing data.
  seed-attendance
                 Seed only the isolated TEST-HRMS / 2099-02 attendance closure.
  seed-attendance-dry-run
                 Preview the attendance closure seed without writing data.
  seed-status    Show local TEST-HRMS seed status.
  seed-records   List editable TEST-HRMS seed records and Frappe edit routes.
  seed-full-payroll-status
                 Show the complete TEST-HRMS / 2099-03 payroll trial status.
  seed-full-payroll-records
                 List editable form routes for the full payroll trial.
  seed-reset-full-payroll
                 Delete only the isolated TEST-HRMS / 2099-03 full payroll trial.
  seed-reset-payroll
                 Delete only TEST-HRMS local payroll seed records.
  db-shell       Open MariaDB shell for the local site.
  console        Open Frappe console for the local site.
  shell          Open a shell inside the HRMS container.
EOF
}

command="${1:-help}"

case "${command}" in
	start)
		require_docker
		docker compose -f "${COMPOSE_FILE}" up -d --build
		echo "HRMS services are starting. First initialization can take several minutes."
		echo "Open http://localhost:8000 after the frappe service is ready."
		docker compose -f "${COMPOSE_FILE}" ps
		;;
	stop)
		require_docker
		docker compose -f "${COMPOSE_FILE}" down
		echo "HRMS services stopped. The local database volume was kept."
		;;
	status)
		require_docker
		docker compose -f "${COMPOSE_FILE}" ps
		;;
	logs)
		require_docker
		lines="${2:-200}"
		if ! [[ "${lines}" =~ ^[0-9]+$ ]]; then
			echo "logs requires a numeric line count, for example: logs 200" >&2
			exit 1
		fi
		docker compose -f "${COMPOSE_FILE}" logs --tail="${lines}"
		;;
	logs-follow)
		require_docker
		docker compose -f "${COMPOSE_FILE}" logs --tail=200 -f
		;;
	migrate)
		require_docker
		bench_exec "bench --site hrms.localhost migrate"
		bench_exec "bench --site hrms.localhost clear-cache"
		;;
	seed)
		require_docker
		phases="${2:-}"
		kwargs="{\"phases\":\"${phases}\",\"dry_run\":0}"
		bench_exec "bench --site hrms.localhost execute hrms.api.demo_seed.seed_test_hrms_demo --kwargs '${kwargs}'"
		;;
	seed-dry-run)
		require_docker
		phases="${2:-}"
		kwargs="{\"phases\":\"${phases}\",\"dry_run\":1}"
		bench_exec "bench --site hrms.localhost execute hrms.api.demo_seed.seed_test_hrms_demo --kwargs '${kwargs}'"
		;;
	seed-payroll)
		require_docker
		kwargs='{"phases":"foundation,employees,attendance,payroll","dry_run":0}'
		bench_exec "bench --site hrms.localhost execute hrms.api.demo_seed.seed_test_hrms_demo --kwargs '${kwargs}'"
		;;
	seed-full-payroll)
		require_docker
		bench_exec "bench --site hrms.localhost execute hrms.api.demo_seed.seed_test_hrms_full_payroll_demo --kwargs '{\"dry_run\":0}'"
		;;
	seed-full-payroll-dry-run)
		require_docker
		bench_exec "bench --site hrms.localhost execute hrms.api.demo_seed.seed_test_hrms_full_payroll_demo --kwargs '{\"dry_run\":1}'"
		;;
	seed-attendance)
		require_docker
		bench_exec "bench --site hrms.localhost execute hrms.api.attendance_import.seed_test_attendance_demo --kwargs '{\"dry_run\":0}'"
		;;
	seed-attendance-dry-run)
		require_docker
		bench_exec "bench --site hrms.localhost execute hrms.api.attendance_import.seed_test_attendance_demo --kwargs '{\"dry_run\":1}'"
		;;
	seed-status)
		require_docker
		bench_exec "bench --site hrms.localhost execute hrms.api.demo_seed.get_test_hrms_demo_status"
		;;
	seed-records)
		require_docker
		bench_exec "bench --site hrms.localhost execute hrms.api.demo_seed.get_test_hrms_demo_records"
		;;
	seed-full-payroll-status)
		require_docker
		bench_exec "bench --site hrms.localhost execute hrms.api.demo_seed.get_test_hrms_full_payroll_demo_status"
		;;
	seed-full-payroll-records)
		require_docker
		bench_exec "bench --site hrms.localhost execute hrms.api.demo_seed.get_test_hrms_full_payroll_demo_records"
		;;
	seed-reset-full-payroll)
		require_docker
		bench_exec "bench --site hrms.localhost execute hrms.api.demo_seed.reset_test_hrms_full_payroll_demo --kwargs '{\"confirm\":\"RESET TEST-HRMS FULL PAYROLL\",\"dry_run\":0}'"
		;;
	seed-reset-payroll)
		require_docker
		kwargs='{"confirm":"RESET TEST-HRMS PAYROLL","dry_run":0}'
		bench_exec "bench --site hrms.localhost execute hrms.api.demo_seed.reset_test_hrms_payroll_seed --kwargs '${kwargs}'"
		;;
	db-shell)
		require_docker
		bench_exec "bench --site hrms.localhost mariadb"
		;;
	console)
		require_docker
		bench_exec "bench --site hrms.localhost console"
		;;
	shell)
		require_docker
		docker compose -f "${COMPOSE_FILE}" exec frappe bash
		;;
	help|-h|--help)
		show_usage
		;;
	*)
		echo "Unknown command: ${command}" >&2
		show_usage >&2
		exit 1
		;;
esac
