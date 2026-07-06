#!/usr/bin/env bash

set -euo pipefail

REPO_OWNER="${1:-jerryzz1223}"
REPO_NAME="${2:-RenziGuanli-v1}"
BRANCH="${3:-$(git rev-parse --abbrev-ref HEAD)}"
REMOTE_NAME="origin"

if ! command -v gh >/dev/null 2>&1; then
	echo "未检测到 gh CLI，请先安装并登录" >&2
	exit 1
fi

if ! command -v git >/dev/null 2>&1; then
	echo "未检测到 git，请先安装并切到项目根目录" >&2
	exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
	echo "GitHub 登录失败，请先执行 gh auth login" >&2
	exit 1
fi

echo "检查是否有需要隔离的本地文件..."
for path in ".github/helper/site_config.json" "sites/" "site_config.json" "common_site_config.json" ".env" ".env.local" ".venv" "env" "node_modules" "dist" "*.sql" "*.sql.gz" "*.sqlite" "*.sqlite3" "*.db"; do
	if ls ${path} >/dev/null 2>&1; then
		echo "发现本地环境文件/目录：${path}，发布前请确认已排除"
	fi
done

if ! gh api "/repos/${REPO_OWNER}/${REPO_NAME}" >/dev/null 2>&1; then
	echo "仓库不存在，正在创建：${REPO_OWNER}/${REPO_NAME}"
	gh repo create "${REPO_NAME}" --owner "${REPO_OWNER}" --private --source . --remote "${REMOTE_NAME}"
else
	if git remote get-url "${REMOTE_NAME}" >/dev/null 2>&1; then
		echo "已存在 remote ${REMOTE_NAME}"
	else
		gh repo set-default "${REPO_OWNER}/${REPO_NAME}" || true
		git remote add "${REMOTE_NAME}" "git@github.com:${REPO_OWNER}/${REPO_NAME}.git"
	fi
fi

echo "准备推送分支：${BRANCH}"
git status -sb
git add -A
git commit -m "chore: prepare intranet release snapshot" || true
git push -u "${REMOTE_NAME}" "${BRANCH}"
echo "推送完成：${REPO_OWNER}/${REPO_NAME} -> ${BRANCH}"
