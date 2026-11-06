#!/usr/bin/env bash
# Local development backend (WSL): FastAPI on 0.0.0.0:8000 with the PARDISO CLI when built.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$REPO/build/ubuntu-24.04-mkl/bin/katai"
[ -x "$CLI" ] || CLI="$REPO/build/ubuntu-24.04/bin/katai"
export KATAI_CLI="$CLI"
export KATAI_DATA_DIR="${KATAI_DATA_DIR:-/root/katai-web-data}"
mkdir -p "$KATAI_DATA_DIR"
cd "$REPO/web/server" || exit 1
exec .venv/bin/python -m uvicorn app:app --host 0.0.0.0 --port 8000
