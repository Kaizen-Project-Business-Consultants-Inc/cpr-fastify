#!/bin/bash
# Production CPR App Deploy — pulls from Fastify repo, builds backend, deploys
# Frontend dist must be uploaded separately (vite build exceeds server memory)
LOG=/home/kaizenmo/deploy-production.log
SRC=/home/kaizenmo/cpr.kpbc.ca-src
APP=/home/kaizenmo/cpr.kpbc.ca
REPO=https://github.com/Kaizenpbc/cpr-fastify.git
export PATH="/opt/alt/alt-nodejs20/root/usr/bin:$PATH"

echo "$(date) — Starting production deploy" >> "$LOG"

# Clone fresh from Fastify repo (replacing old Express source)
if [ ! -d "$SRC/.git" ] || ! git -C "$SRC" remote get-url origin 2>/dev/null | grep -q cpr-fastify; then
  echo "$(date) — Switching to Fastify repo" >> "$LOG"
  rm -rf "$SRC"
  git clone "$REPO" "$SRC" >> "$LOG" 2>&1
  if [ $? -ne 0 ]; then
    echo "$(date) — Clone failed" >> "$LOG"
    exit 1
  fi
  echo "$(date) — Fresh clone from cpr-fastify complete" >> "$LOG"
else
  cd "$SRC" || exit 1
  OLD_HEAD=$(git rev-parse HEAD)
  # Reset any local changes (e.g. lockfile drift from npm install)
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

# Backup old dist before replacing
if [ -d "$APP/backend/dist" ]; then
  rm -rf "$APP/backend/dist-backup"
  cp -r "$APP/backend/dist" "$APP/backend/dist-backup"
  echo "$(date) — Old dist backed up to dist-backup" >> "$LOG"
fi

# Deploy backend
mkdir -p "$APP/backend/dist"
rm -rf "$APP/backend/dist/"*
cp -r "$SRC/backend/dist/"* "$APP/backend/dist/"
cp "$SRC/backend/package.json" "$APP/backend/package.json"

# Copy lockfile from source for reliable npm install
if [ -f "$SRC/backend/package-lock.json" ]; then
  cp "$SRC/backend/package-lock.json" "$APP/backend/package-lock.json"
elif [ -f "$SRC/package-lock.json" ]; then
  # Workspace root lockfile — copy it and install from there
  cp "$SRC/package-lock.json" "$APP/backend/package-lock.json"
fi

# Install production backend deps
cd "$APP/backend" || exit 1
npm install --omit=dev --ignore-scripts >> "$LOG" 2>&1
if [ $? -ne 0 ]; then
  echo "$(date) — npm install failed, trying without lockfile" >> "$LOG"
  rm -f package-lock.json
  npm install --omit=dev --ignore-scripts >> "$LOG" 2>&1
fi

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

echo "$(date) — Production deploy complete" >> "$LOG"
