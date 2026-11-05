#!/usr/bin/env bash
set -euo pipefail

if [[ "$(. /etc/os-release && echo "$ID:$VERSION_ID")" != "ubuntu:24.04" ]]; then
  echo "This installer targets Ubuntu 24.04." >&2; exit 1
fi
if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "This installer targets x86_64." >&2; exit 1
fi
if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi

APP_ROOT="${KATAI_INSTALL_ROOT:-/opt/katai2d}"
DOMAIN="${KATAI_DOMAIN:-}"
TOKEN="${KATAI_ACCESS_TOKEN:-}"
if [[ -z "$DOMAIN" || -z "$TOKEN" ]]; then
  echo "Set KATAI_DOMAIN to a DNS name pointing to this server and KATAI_ACCESS_TOKEN to a long random secret." >&2
  exit 2
fi
if [[ ! "$DOMAIN" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]]; then
  echo "KATAI_DOMAIN must be a DNS hostname without a scheme, path, or port." >&2
  exit 2
fi
if [[ ! "$TOKEN" =~ ^[A-Za-z0-9._~-]{32,}$ ]]; then
  echo "KATAI_ACCESS_TOKEN must contain at least 32 URL-safe characters." >&2
  exit 2
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential cmake ninja-build git python3 python3-dev python3-venv python3-pip nodejs npm caddy
if ! id katai >/dev/null 2>&1; then useradd --system --home-dir /var/lib/katai-web --shell /usr/sbin/nologin katai; fi
install -d -o katai -g katai /var/lib/katai-web /var/lib/katai-web/projects /var/lib/katai-web/jobs
if [[ ! -d "$APP_ROOT/.git" ]]; then
  git clone https://github.com/fkkarakurt/katai2d.git "$APP_ROOT"
fi
cd "$APP_ROOT"
python3 -m venv "$APP_ROOT/.venv"
"$APP_ROOT/.venv/bin/pip" install --upgrade pip
"$APP_ROOT/.venv/bin/pip" install -r web/server/requirements.txt
"$APP_ROOT/.venv/bin/pip" install nanobind numpy
PYTHON="$APP_ROOT/.venv/bin/python" scripts/build-linux.sh
ln -sf "$APP_ROOT/build/ubuntu-24.04/bin/katai" /usr/local/bin/katai
cd web/client
npm ci
npm run build
cat > /etc/systemd/system/katai-web.service <<EOF
[Unit]
Description=KATAI 2D owner web service
After=network.target
[Service]
Type=simple
User=katai
Group=katai
WorkingDirectory=$APP_ROOT/web/server
EnvironmentFile=/etc/katai-web.env
ExecStart=$APP_ROOT/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/katai-web
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictSUIDSGID=true
RestrictRealtime=true
SystemCallArchitectures=native
[Install]
WantedBy=multi-user.target
EOF
cat >/etc/katai-web.env <<EOF
KATAI_DOMAIN=$DOMAIN
KATAI_ACCESS_TOKEN=$TOKEN
KATAI_DATA_DIR=/var/lib/katai-web
KATAI_CLI=/usr/local/bin/katai
EOF
chmod 0600 /etc/katai-web.env
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    encode zstd gzip
    @api path /api/*
    reverse_proxy @api 127.0.0.1:8000
    root * $APP_ROOT/web/client/dist
    try_files {path} /index.html
    file_server
    header {
        X-Content-Type-Options nosniff
        Referrer-Policy no-referrer
        X-Frame-Options DENY
        Permissions-Policy camera=(), microphone=(), geolocation=()
        -Server
    }
}
EOF
systemctl daemon-reload
systemctl enable --now katai-web.service caddy.service
echo "KATAI 2D web is configured at https://$DOMAIN. The owner token is stored in /etc/katai-web.env."
