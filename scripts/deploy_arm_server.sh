#!/usr/bin/env bash

# One-command deployment entry point for the ARM64 server.
# Usage: ./scripts/deploy_arm_server.sh "feat: describe this update" [--skip-deps]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export HRMS_DEPLOY_REMOTE="${HRMS_DEPLOY_REMOTE:-jerry@192.168.1.253}"
export HRMS_DEPLOY_ROOT="${HRMS_DEPLOY_ROOT:-/home/jerry/Renzi/app}"
export HRMS_DEPLOY_SITE="${HRMS_DEPLOY_SITE:-hrms.localhost}"
export HRMS_EXPECTED_ARCH="arm64"

exec "${SCRIPT_DIR}/deploy_to_server.sh" "$@"
