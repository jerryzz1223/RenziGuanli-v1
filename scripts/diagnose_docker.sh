#!/usr/bin/env bash
# Read-only incident report. Do not print site configs, passwords or file bodies.
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose() { docker compose -f "${PROJECT_ROOT}/docker/docker-compose.yml" "$@"; }
if [[ ${EUID} -ne 0 ]]; then
    exec sudo bash "$0" "$@"
fi
git -C "${PROJECT_ROOT}" -c safe.directory="${PROJECT_ROOT}" rev-parse --short HEAD
compose ps -a
CONTAINER="$(compose ps -a -q frappe)"
if [[ -z "${CONTAINER}" ]]; then
    echo "No Frappe container found. No services have been created or changed."
    exit 1
fi
docker inspect "${CONTAINER}" --format 'State={{.State.Status}} Image={{.Image}} Mounts={{json .Mounts}}'
if [[ "$(docker inspect "${CONTAINER}" --format '{{.State.Running}}')" == true ]]; then
    compose exec -T frappe bash -lc '
        cd /home/frappe/frappe-bench
        for app in frappe erpnext hrms; do
            if [ -d "apps/$app" ]; then
                printf "%s commit: " "$app"
                git -C "apps/$app" rev-parse --short HEAD || true
                git -C "apps/$app" describe --tags --always || true
            else
                printf "%s: SOURCE MISSING\n" "$app"
            fi
        done
        ./env/bin/python --version
        ./env/bin/python /workspace/docker/check_site_ready.py hrms.localhost
    ' || true
fi
# Root password is read inside MariaDB, never included in this report.
compose exec -T mariadb sh -c '
    export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
    exec mariadb -uroot --batch
' <<'SQL'
SELECT table_schema, COUNT(*) AS table_count FROM information_schema.tables
WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys')
GROUP BY table_schema;
SELECT table_schema, table_name, column_name FROM information_schema.columns
WHERE table_name IN ('tabInstalled Application','tabInstalled Applications')
ORDER BY table_schema, table_name, ordinal_position;
-- The incident's existing database; skip safely if the table is unavailable.
SET @report_sql = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = '_0734c5df697fa9d2'
       AND table_name = 'tabInstalled Application'
       AND column_name IN ('app_name', 'app_version')) = 2,
    'SELECT app_name, app_version FROM `_0734c5df697fa9d2`.`tabInstalled Application`',
    'SELECT "Application version table unavailable; inspect the schema above" AS version_status'
);
PREPARE report_statement FROM @report_sql;
EXECUTE report_statement;
DEALLOCATE PREPARE report_statement;
SQL
echo "Read-only report complete. No database, site, or container was modified."
