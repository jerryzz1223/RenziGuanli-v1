#!/usr/bin/env bash

set -euo pipefail

OWNER="${1:?缺少仓库 owner，例如 jerryzz1223}"
REPO="${2:?缺少仓库名，例如 RenziGuanli-v1}"
BRANCH="${3:-main}"
BENCH_DIR="${4:-/home/jerry/Renzi}"
SITE_NAME="${5:-}"
APP_NAME="${6:-hrms}"

if [[ "$BRANCH" == "--help" || "$BRANCH" == "-h" ]]; then
  echo "Usage: $(basename "$0") <owner> <repo> <branch> [bench_dir=/home/jerry/Renzi] [site_name] [app_name=hrms]"
  echo "Example: $(basename "$0") jerryzz1223 RenziGuanli-v1 main /home/jerry/Renzi hrms.local hrms"
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  echo "未找到 git，请先安装 git" >&2
  exit 1
fi

if [ ! -d "$BENCH_DIR" ]; then
  echo "Bench 目录不存在: $BENCH_DIR" >&2
  exit 1
fi

if [ ! -d "$BENCH_DIR/apps" ] || [ ! -x "$BENCH_DIR/apps" ]; then
  echo "Bench 目录不是 frappe bench 根目录（未检测到 apps 目录）: $BENCH_DIR" >&2
  exit 1
fi

if ! command -v bench >/dev/null 2>&1; then
  echo "未找到 bench 命令，请确认已在 bench 环境下加载 CLI" >&2
  exit 1
fi

echo "[$(date '+%F %T')] 开始部署 $OWNER/$REPO:$BRANCH 到 $BENCH_DIR"

tmp_dir=$(mktemp -d "/tmp/${REPO}-deploy-XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir"

auto_clone() {
  local url="git@github.com:${OWNER}/${REPO}.git"
  if ! git clone --depth 1 --branch "$BRANCH" "$url" "$tmp_dir/repo"; then
    echo "SSH 拉取失败，尝试 HTTPS..."
    git clone --depth 1 --branch "$BRANCH" "https://github.com/${OWNER}/${REPO}.git" "$tmp_dir/repo"
  fi
}

auto_clone

if [ ! -d "$tmp_dir/repo/$APP_NAME" ]; then
  if [ -d "$tmp_dir/repo/hrms" ]; then
    APP_NAME="hrms"
  else
    echo "仓库根目录未发现应用目录，请确认 APP_NAME 参数是否正确" >&2
    exit 1
  fi
fi

target_dir="$BENCH_DIR/apps/$APP_NAME"
backup_dir="$BENCH_DIR/apps/.bak-$(date +%Y%m%d%H%M%S)-$APP_NAME"

if [ -d "$target_dir" ]; then
  cp -a "$target_dir" "$backup_dir"
  echo "已备份旧版本到: $backup_dir"
  rm -rf "$target_dir"
fi

mkdir -p "$BENCH_DIR/apps"
cp -a "$tmp_dir/repo/$APP_NAME" "$target_dir"

cd "$BENCH_DIR"

if [ -n "$SITE_NAME" ]; then
  echo "开始迁移站点: $SITE_NAME"
  bench --site "$SITE_NAME" migrate
else
  echo "未指定站点名，仅执行 bench build"
fi

bench build --app "$APP_NAME"
bench restart

echo "部署完成: $OWNER/$REPO:$BRANCH -> $target_dir"
