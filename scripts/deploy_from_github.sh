#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: $(basename "$0") <owner> <repo> <branch> [bench_dir=/home/jerry/Renzi] [site_name] [app_name=hrms]"
  echo "Example: $(basename "$0") jerryzz1223 RenziGuanli-v1 main /home/jerry/Renzi hrms.local hrms"
  exit 0
fi

OWNER="${1:?缺少仓库 owner，例如 jerryzz1223}"
REPO="${2:?缺少仓库名，例如 RenziGuanli-v1}"
BRANCH="${3:-main}"
BENCH_DIR="${4:-/home/jerry/Renzi}"
SITE_NAME="${5:-}"
APP_NAME="${6:-hrms}"

TARGET_DIR="$BENCH_DIR/apps/$APP_NAME"
TMP_DIR="$(mktemp -d "/tmp/${REPO}-deploy-XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

if [ ! -d "$BENCH_DIR" ]; then
  echo "Bench 目录不存在: $BENCH_DIR" >&2
  exit 1
fi
if [ ! -d "$BENCH_DIR/apps" ]; then
  echo "Bench 目录不是有效根目录（未检测到 apps 目录）: $BENCH_DIR" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "未找到 git，请先安装 git" >&2
  exit 1
fi
if ! command -v bench >/dev/null 2>&1; then
  echo "未找到 bench 命令，请确认已在 bench 环境下加载 CLI" >&2
  exit 1
fi

echo "[$(date '+%F %T')] 开始部署 $OWNER/$REPO@$BRANCH"

echo "[$(date '+%F %T')] 克隆仓库到临时目录 $TMP_DIR"
if ! GIT_TERMINAL_PROMPT=1 git clone --depth 1 --branch "$BRANCH" "git@github.com:${OWNER}/${REPO}.git" "$TMP_DIR/repo"; then
  echo "SSH 克隆失败，尝试 HTTPS..."
  git clone --depth 1 --branch "$BRANCH" "https://github.com/${OWNER}/${REPO}.git" "$TMP_DIR/repo"
fi

if [ -d "$TMP_DIR/repo/$APP_NAME" ]; then
  SRC_DIR="$TMP_DIR/repo/$APP_NAME"
elif [ -d "$TMP_DIR/repo/hrms" ]; then
  APP_NAME="hrms"
  TARGET_DIR="$BENCH_DIR/apps/$APP_NAME"
  SRC_DIR="$TMP_DIR/repo/hrms"
elif [ -f "$TMP_DIR/repo/hooks.py" ]; then
  SRC_DIR="$TMP_DIR/repo"
else
  echo "仓库结构异常：未找到应用目录。"
  echo "请确认仓库根目录或 hrms 目录是否存在"
  exit 1
fi

if [ -d "$TARGET_DIR" ]; then
  cp -a "$TARGET_DIR" "$BENCH_DIR/apps/.bak-$(date +%Y%m%d%H%M%S)-$APP_NAME"
  rm -rf "$TARGET_DIR"
fi
cp -a "$SRC_DIR" "$TARGET_DIR"

cd "$BENCH_DIR"

if [ -n "$SITE_NAME" ]; then
  echo "开始迁移站点: $SITE_NAME"
  bench --site "$SITE_NAME" migrate
else
  echo "未指定站点名，仅执行 bench build"
fi

bench build --app "$APP_NAME"
bench restart

echo "部署完成: $OWNER/$REPO@$BRANCH -> $TARGET_DIR"
