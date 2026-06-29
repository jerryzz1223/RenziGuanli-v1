#!/usr/bin/env bash
set -euo pipefail

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

if [ -d "/home/frappe/frappe-bench/apps/frappe" ]; then
    echo "Bench already exists, skipping init"
    cd frappe-bench
    link_hrms_assets
    bench start
else
    echo "Creating new bench..."
fi

git config --global http.version HTTP/1.1 || true

if [ ! -d "/home/frappe/frappe-src" ]; then
    run_with_retries git clone --depth 1 --branch develop --single-branch https://gitee.com/mirrors/frappe.git /home/frappe/frappe-src
fi
sed -i 's|"PyPika @ git+https://github.com/frappe/pypika@[^"]*"|"PyPika~=0.48.9"|' /home/frappe/frappe-src/pyproject.toml
sed -i 's|"gunicorn @ git+https://github.com/frappe/gunicorn@[^"]*"|"gunicorn~=23.0.0"|' /home/frappe/frappe-src/pyproject.toml

bench init --skip-redis-config-generation --frappe-path /home/frappe/frappe-src frappe-bench

cd frappe-bench
patch_chinese_chart_periods

# Use containers instead of localhost
bench set-mariadb-host mariadb
bench set-redis-cache-host redis://redis:6379
bench set-redis-queue-host redis://redis:6379
bench set-redis-socketio-host redis://redis:6379

# Remove redis, watch from Procfile
sed -i '/redis/d' ./Procfile || true
sed -i '/watch/d' ./Procfile || true

if [ ! -d "apps/erpnext" ]; then
    run_with_retries bench get-app --branch develop https://gitee.com/mirrors/erpnext.git
fi
add_local_hrms_app
link_hrms_assets

bench new-site hrms.localhost \
--force \
--mariadb-root-password 123 \
--admin-password admin \
--no-mariadb-socket

bench --site hrms.localhost install-app erpnext
bench --site hrms.localhost install-app hrms
bench --site hrms.localhost execute hrms.localize_zh.apply_hrms_desktop_customizations
bench --site hrms.localhost execute hrms.localize_zh.apply_expense_claim_translations
bench --site hrms.localhost set-config developer_mode 1
bench --site hrms.localhost enable-scheduler
bench --site hrms.localhost clear-cache
bench use hrms.localhost

bench start
