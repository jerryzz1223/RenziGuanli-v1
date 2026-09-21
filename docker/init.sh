#!/usr/bin/env bash
set -euo pipefail

BENCH_DIR=/home/frappe/frappe-bench
PERSISTENT_SITES_DIR=/home/frappe/frappe-sites

# Recovery intentionally keeps the existing container alive while replacing an
# incomplete runtime. Keep the marker on failure so the next restart is safe.
if [ -f "${PERSISTENT_SITES_DIR}/.hrms-recovery-in-progress" ]; then
    echo "HRMS recovery is in progress. Resume the recovery script; web startup is paused."
    exec sleep infinity
fi

link_persistent_sites() {
    mkdir -p "${PERSISTENT_SITES_DIR}"
    if [ -L "${BENCH_DIR}/sites" ]; then
        if [ "$(readlink -f "${BENCH_DIR}/sites")" != "${PERSISTENT_SITES_DIR}" ]; then
            echo "Unexpected sites symlink; inspect mounts before starting." >&2
            exit 1
        fi
        return
    fi
    if [ -d "${BENCH_DIR}/sites" ]; then
        if find "${PERSISTENT_SITES_DIR}" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
            echo "Persistent sites directory is nonempty; refusing to overwrite or merge it automatically." >&2
            exit 1
        fi
        cp -a "${BENCH_DIR}/sites/." "${PERSISTENT_SITES_DIR}/"
        # Preserve the original directory even after a successful copy.
        SITES_ARCHIVE="$(mktemp -d "${BENCH_DIR}/sites-before-link.XXXXXX")"
        mv "${BENCH_DIR}/sites" "${SITES_ARCHIVE}/sites"
    fi
    ln -s "${PERSISTENT_SITES_DIR}" "${BENCH_DIR}/sites"
}

if [ -n "${NVM_DIR:-}" ] && [ -n "${NODE_VERSION_DEVELOP:-}" ]; then
    export PATH="${NVM_DIR}/versions/node/v${NODE_VERSION_DEVELOP}/bin/:${PATH}"
elif [ -n "${NVM_DIR:-}" ]; then
    NODE_BIN="$(find "${NVM_DIR}/versions/node" -maxdepth 2 -type d -name bin 2>/dev/null | sort -V | tail -1 || true)"
    if [ -n "${NODE_BIN}" ]; then
        export PATH="${NODE_BIN}:${PATH}"
    fi
fi

run_with_retries() {
    local attempt=1
    local max_attempts=5
    until "$@"; do
        if [ "${attempt}" -ge "${max_attempts}" ]; then
            return 1
        fi
        echo "Command failed, retrying (${attempt}/${max_attempts}): $*"
        attempt=$((attempt + 1))
        sleep 10
    done
}

add_local_hrms_app() {
    if [ ! -e "apps/hrms" ]; then
        ln -s /workspace apps/hrms
    fi
    touch sites/apps.txt
    if [ -s sites/apps.txt ] && [ "$(tail -c 1 sites/apps.txt)" != "" ]; then
        printf "\n" >> sites/apps.txt
    fi
    if ! grep -q "^hrms$" sites/apps.txt; then
        printf "hrms\n" >> sites/apps.txt
    fi
    ./env/bin/python -m pip install --quiet -e apps/hrms
}

link_hrms_assets() {
    mkdir -p sites/assets
    ln -sfn /workspace/hrms/public sites/assets/hrms
}

patch_chinese_chart_periods() {
    ./env/bin/python /workspace/docker/patch_chinese_chart_periods.py
}

configure_web_bind() {
    local site="${HRMS_SITE:-hrms.localhost}"
    if [[ ! "${site}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
        echo "Invalid HRMS_SITE" >&2
        exit 1
    fi
    # Bench defaults to 127.0.0.1. Bind all container interfaces so the
    # published Docker port is reachable from the host and the LAN.
    if grep -qE '^web:' ./Procfile; then
        sed -i -E "s|^web:.*$|web: bench --site ${site} serve --host 0.0.0.0 --port 8000 --noreload|" ./Procfile
    else
        printf '\nweb: bench --site %s serve --host 0.0.0.0 --port 8000 --noreload\n' "${site}" >> ./Procfile
    fi
}

configure_container_hosts() {
    # These settings must also be applied when an already-created bench is
    # restarted. Otherwise an old Procfile/common_site_config can still point
    # to localhost and socketio will try 127.0.0.1:11000.
    bench set-mariadb-host mariadb
    bench set-redis-cache-host redis://redis:6379
    bench set-redis-queue-host redis://redis:6379
    bench set-redis-socketio-host redis://redis:6379
}

if [ -d "${BENCH_DIR}/apps/frappe" ]; then
    echo "Bench already exists, skipping init"
    cd "${BENCH_DIR}"
    link_persistent_sites
    ./env/bin/python /workspace/docker/prepare_runtime_paths.py
    ./env/bin/python /workspace/docker/check_site_ready.py "${HRMS_SITE:-hrms.localhost}"
    configure_container_hosts
    link_hrms_assets
    configure_web_bind
    exec bench start
else
    echo "Bench runtime is missing. Automatic rebuilding is disabled to preserve recovery evidence." >&2
    echo "Restore the original runtime/site and confirm application versions before bootstrapping." >&2
    if [ "${HRMS_ALLOW_BOOTSTRAP:-0}" != "1" ]; then
        exit 1
    fi
    : "${FRAPPE_REF:?Set the reviewed Frappe branch or tag before bootstrapping}"
    : "${ERPNEXT_REF:?Set the matching ERPNext branch or tag before bootstrapping}"
    echo "Creating explicitly requested bench..."
fi

git config --global http.version HTTP/1.1 || true

if [ ! -d "/home/frappe/frappe-src" ]; then
    run_with_retries git clone --depth 1 --branch "${FRAPPE_REF}" --single-branch https://gitee.com/mirrors/frappe.git /home/frappe/frappe-src
fi
python3 - <<'PY'
from pathlib import Path
import re

pyproject = Path("/home/frappe/frappe-src/pyproject.toml")
text = pyproject.read_text()
text = re.sub(
    r"PyPika\s*@\s*git\+https://github\.com/frappe/pypika@[^\s\"']+",
    "PyPika~=0.48.9",
    text,
)
text = re.sub(
    r"gunicorn\s*@\s*git\+https://github\.com/frappe/gunicorn@[^\s\"']+",
    "gunicorn~=23.0.0",
    text,
)
pyproject.write_text(text)
PY

bench init --skip-redis-config-generation --frappe-path /home/frappe/frappe-src frappe-bench

cd "${BENCH_DIR}"
link_persistent_sites
./env/bin/python /workspace/docker/prepare_runtime_paths.py
patch_chinese_chart_periods

# Use containers instead of localhost
configure_container_hosts

# Remove redis, watch from Procfile
sed -i '/redis/d' ./Procfile || true
sed -i '/watch/d' ./Procfile || true
configure_web_bind

if [ ! -d "apps/erpnext" ]; then
    run_with_retries bench get-app --branch "${ERPNEXT_REF}" https://gitee.com/mirrors/erpnext.git
fi
add_local_hrms_app
link_hrms_assets

if [ -f "sites/hrms.localhost/site_config.json" ]; then
    echo "Existing site configuration found; preserving the existing database."
else
    echo "Site configuration sites/hrms.localhost/site_config.json is missing." >&2
    echo "Refusing to create a new empty site. Restore the existing site configuration first." >&2
    exit 1
fi

bench --site hrms.localhost set-config developer_mode 1
bench --site hrms.localhost enable-scheduler
bench --site hrms.localhost clear-cache
bench use hrms.localhost

./env/bin/python /workspace/docker/check_site_ready.py hrms.localhost
exec bench start
