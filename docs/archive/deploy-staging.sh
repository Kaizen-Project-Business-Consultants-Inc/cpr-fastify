#!/bin/bash
# Staging CPR App Deploy — pulls from GitHub, builds backend, deploys
# Frontend dist must be uploaded separately (vite build exceeds server memory)
LOG=/home/kaizenmo/deploy-staging.log
SRC=/home/kaizenmo/stagecprapp.kpbc.ca-src
APP=/home/kaizenmo/stagecprapp.kpbc.ca
REPO=https://github.com/Kaizenpbc/cpr-fastify.git
export PATH="/opt/alt/alt-nodejs20/root/usr/bin:$PATH"

echo "$(date) — Starting staging deploy" >> "$LOG"

# Clone or pull
if [ ! -d "$SRC/.git" ]; then
  git clone "$REPO" "$SRC" >> "$LOG" 2>&1
  if [ $? -ne 0 ]; then
    echo "$(date) — Clone failed" >> "$LOG"
    exit 1
  fi
  echo "$(date) — Initial clone complete" >> "$LOG"
else
  cd "$SRC" || exit 1
  OLD_HEAD=$(git rev-parse HEAD)
  git checkout -- . >> "$LOG" 2>&1
  git pull origin master >> "$LOG" 2>&1
  NEW_HEAD=$(git rev-parse HEAD)
  if [ "$OLD_HEAD" = "$NEW_HEAD" ] && [ -d "$APP/backend/dist" ]; then
    echo "$(date) — No changes, skipping build" >> "$LOG"
    exit 0
  fi
  echo "$(date) — Build needed" >> "$LOG"
fi

cd "$SRC" || exit 1

# Install dependencies
echo "$(date) — Installing dependencies" >> "$LOG"
npm ci --ignore-scripts >> "$LOG" 2>&1
if [ $? -ne 0 ]; then
  npm install --legacy-peer-deps >> "$LOG" 2>&1
fi

# Build backend only (frontend built locally, uploaded via cPanel)
echo "$(date) — Building backend" >> "$LOG"
cd "$SRC/backend" || exit 1
npx tsc >> "$LOG" 2>&1
if [ $? -ne 0 ]; then
  echo "$(date) — Backend build failed" >> "$LOG"
  exit 1
fi
echo "$(date) — Backend build complete" >> "$LOG"

# Deploy backend
mkdir -p "$APP/backend/dist"
rm -rf "$APP/backend/dist/"*
cp -r "$SRC/backend/dist/"* "$APP/backend/dist/"
cp "$SRC/backend/package.json" "$APP/backend/package.json"

# Install production backend deps
cd "$APP/backend" || exit 1
npm install --omit=dev --ignore-scripts >> "$LOG" 2>&1

# Create server.js (with NODE_PATH for ESM module resolution)
cat > "$APP/server.js" << 'SERVERJS'
// Passenger entry point — sets NODE_PATH before ESM import
process.env.NODE_PATH = __dirname + "/backend/node_modules";
require('module').Module._initPaths();
process.chdir(__dirname + "/backend");
import(__dirname + "/backend/dist/index.js").catch(err => {
  console.error("Failed to start backend:", err);
  process.exit(1);
});
SERVERJS

# Restart Passenger
mkdir -p "$APP/tmp"
touch "$APP/tmp/restart.txt"

echo "$(date) — Staging deploy complete" >> "$LOG"
