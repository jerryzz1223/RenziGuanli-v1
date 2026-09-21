#!/usr/bin/env bash
set -euo pipefail

BENCH_DIR=/home/frappe/frappe-bench
SITES_DIR=/home/frappe/frappe-sites
SITE_NAME="${HRMS_SITE:-hrms.localhost}"

if [[ ! "${SITE_NAME}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
	echo "Invalid HRMS_SITE: ${SITE_NAME}" >&2
	exit 2
fi

if [[ ! -x "${BENCH_DIR}/env/bin/python" || ! -d "${BENCH_DIR}/apps/frappe" ]]; then
	echo "Persisted Frappe bench is missing; refusing to bootstrap or replace it." >&2
	exit 1
fi
if [[ ! -d "${BENCH_DIR}/apps/erpnext" || ! -e "${BENCH_DIR}/apps/hrms" ]]; then
	echo "Persisted ERPNext/HRMS application source is incomplete." >&2
	exit 1
fi
if [[ ! -f "${SITES_DIR}/${SITE_NAME}/site_config.json" ]]; then
	echo "Persisted site configuration is missing for ${SITE_NAME}." >&2
	exit 1
fi
if [[ ! -L "${BENCH_DIR}/sites" || "$(readlink -f "${BENCH_DIR}/sites")" != "${SITES_DIR}" ]]; then
	echo "Bench sites must be linked to ${SITES_DIR}; refusing an automatic merge." >&2
	exit 1
fi

if [[ -n "${NVM_DIR:-}" && -n "${NODE_VERSION_DEVELOP:-}" ]]; then
	export PATH="${NVM_DIR}/versions/node/v${NODE_VERSION_DEVELOP}/bin:${PATH}"
elif [[ -n "${NVM_DIR:-}" ]]; then
	NODE_BIN="$(find "${NVM_DIR}/versions/node" -maxdepth 2 -type d -name bin 2>/dev/null | sort -V | tail -1 || true)"
	if [[ -n "${NODE_BIN}" ]]; then
		export PATH="${NODE_BIN}:${PATH}"
	fi
fi

cd "${BENCH_DIR}"
./env/bin/python /workspace/docker/prepare_runtime_paths.py
./env/bin/python /workspace/docker/check_site_ready.py "${SITE_NAME}"

bench set-mariadb-host mariadb
bench set-redis-cache-host redis://redis:6379
bench set-redis-queue-host redis://redis:6379
bench set-redis-socketio-host redis://redis:6379

mkdir -p sites/assets
ln -sfn /workspace/hrms/public sites/assets/hrms

# Redis is provided by a separate container; Vite watch is not a production
# process. Keep all other processes from the preserved Procfile intact.
sed -i '/^redis_/d; /^watch:/d' Procfile
if bench serve --help 2>&1 | grep -q -- '--host'; then
	WEB_COMMAND="web: bench --site ${SITE_NAME} serve --host 0.0.0.0 --port 8000 --noreload"
else
	WEB_COMMAND="web: bench --site ${SITE_NAME} serve --port 8000 --noreload"
fi
if grep -qE '^web:' Procfile; then
	sed -i -E "s|^web:.*$|${WEB_COMMAND}|" Procfile
else
	printf '\n%s\n' "${WEB_COMMAND}" >> Procfile
fi

exec bench start
