#!/bin/bash
# CPR Production Deploy — build locally, upload via FTPS
# Usage: FTP_SERVER=... FTP_USERNAME=... FTP_PASSWORD=... bash deploy.sh [backend|frontend|all]
#
# Credentials are read from the environment only. They are never stored in this file.
set -e

: "${FTP_SERVER:?Set FTP_SERVER (e.g. export FTP_SERVER=host)}"
: "${FTP_USERNAME:?Set FTP_USERNAME}"
: "${FTP_PASSWORD:?Set FTP_PASSWORD}"

SERVER="$FTP_SERVER"
USER="$FTP_USERNAME"
PASS="$FTP_PASSWORD"
APP_DIR="cpr.kpbc.ca"
ROOT="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-all}"

upload() {
  local src="$1" dst="$2"
  curl --ssl-reqd -u "$USER:$PASS" -T "$src" "ftp://$SERVER/$APP_DIR/$dst" --create-dirs 2>/dev/null
}

upload_dir() {
  local src_dir="$1" dst_dir="$2"
  find "$src_dir" -type f | while read -r file; do
    rel="${file#$src_dir/}"
    upload "$file" "$dst_dir/$rel"
    echo "  $dst_dir/$rel"
  done
}

restart_passenger() {
  echo "Restarting Passenger..."
  MSYS_NO_PATHCONV=1 curl -s -u "$USER:$PASS" \
    "https://$SERVER:2083/json-api/cpanel?cpanel_jsonapi_version=2&cpanel_jsonapi_module=Fileman&cpanel_jsonapi_func=savefile&dir=/home/$USER/$APP_DIR/tmp&filename=restart.txt&content=restart$(date +%s)" \
    > /dev/null 2>&1
  echo "Passenger restarted."
}

if [ "$TARGET" = "backend" ] || [ "$TARGET" = "all" ]; then
  echo "=== Building backend ==="
  cd "$ROOT/backend"
  npx tsc
  echo "=== Uploading backend dist ==="
  upload_dir "$ROOT/backend/dist" "backend/dist"
  echo "Backend deployed."
fi

if [ "$TARGET" = "frontend" ] || [ "$TARGET" = "all" ]; then
  echo "=== Building frontend ==="
  cd "$ROOT/frontend"
  VITE_API_URL=https://cpr.kpbc.ca/api/v1 npx vite build
  echo "=== Uploading frontend dist ==="
  upload_dir "$ROOT/frontend/dist" "public"
  echo "Frontend deployed."
fi

restart_passenger

echo ""
echo "=== Deploy complete ==="
sleep 5
STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://cpr.kpbc.ca/api/v1/health)
if [ "$STATUS" = "200" ]; then
  echo "Health check: OK (200)"
else
  echo "Health check: FAILED ($STATUS) — check logs"
fi
