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

REPO_DIR="$BENCH_DIR/apps/$APP_NAME"

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

mkdir -p "$BENCH_DIR/apps"

echo "[$(date '+%F %T')] 开始部署 $OWNER/$REPO@$BRANCH"
echo "[仓库目录: $REPO_DIR]"

if [ -d "$REPO_DIR/.git" ]; then
  echo "检测到已存在仓库，执行更新"
  git -C "$REPO_DIR" fetch --all --prune
  git -C "$REPO_DIR" checkout "$BRANCH"
  if git -C "$REPO_DIR" rev-parse --verify "origin/$BRANCH" >/dev/null 2>&1; then
    git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
  fi
  git -C "$REPO_DIR" pull --ff-only "origin" "$BRANCH"
elif [ -d "$REPO_DIR" ] && [ -n "$(ls -A "$REPO_DIR")" ]; then
  echo "错误: 目标目录 '$REPO_DIR' 已存在且不是 git 仓库，无法直接 clone。"
  echo "请先备份或清空目录后重试："
  echo "  mv \"$REPO_DIR\" \"$REPO_DIR.bak.$(date +%Y%m%d%H%M%S)\""
  echo "  mkdir -p \"$REPO_DIR\""
  exit 1
else
  echo "首次部署，克隆仓库到 $REPO_DIR"
  if ! GIT_TERMINAL_PROMPT=1 git clone --depth 1 --branch "$BRANCH" "git@github.com:${OWNER}/${REPO}.git" "$REPO_DIR"; then
    echo "SSH 克隆失败，尝试 HTTPS..."
    git clone --depth 1 --branch "$BRANCH" "https://github.com/${OWNER}/${REPO}.git" "$REPO_DIR"
  fi
fi

cd "$BENCH_DIR/apps/$APP_NAME"

if [ -n "$SITE_NAME" ]; then
  echo "开始迁移站点: $SITE_NAME"
  bench --site "$SITE_NAME" migrate
else
  echo "未指定站点名，仅执行 bench build"
fi

bench build --app "$APP_NAME"
bench restart

echo "部署完成: $OWNER/$REPO@$BRANCH -> $REPO_DIR"
