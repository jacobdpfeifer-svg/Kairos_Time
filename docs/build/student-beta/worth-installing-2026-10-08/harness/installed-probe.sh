#!/usr/bin/env bash
# Exercise an installed Kairos.app's bundled resources the way runtime.rs does, with a scrubbed env.
A="$1/Contents/Resources"; S="$2"; rm -rf "$S/root" "$S/home"; mkdir -p "$S/root" "$S/home"
clean() { env -i HOME="$S/home" PATH=/usr/bin:/bin PRODUCT_USER_ID=wi DEV_USER_ROOT="$S/root" AUTH_DIR="$S/root/auth/browser" KAIROS_TEMPLATES_DIR="$A/core/templates/study-packets" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1 "$@"; }
study() { (cd "$A/core/src/canvas_mcp/core" && echo "$1" | clean "$A/runtime/python/bin/python3" -s -m study --user-root "$S/root" --json run 2>&1 | tail -1 | cut -c1-260); }
echo "--- 1 study status";            study '{"cmd":"status","params":{}}'
echo "--- 2 connectors-status";       study '{"cmd":"connectors-status","params":{}}'
echo "--- 3 import template M";       study '{"cmd":"import-template","params":{"packet_id":"M"}}'
echo "--- 4 offer";                   study '{"cmd":"offer","params":{}}'
echo "--- 5 learn_loop (Plan tab)";   (cd "$A/core/src" && clean PYTHONPATH="$A/core/src" "$A/runtime/python/bin/python3" -s -m canvas_mcp.core.learn_loop --json due 2>&1 | tail -1 | cut -c1-200)
echo "--- 6 school choose (node)";    (cd "$A/core/browser" && clean "$A/runtime/node/bin/node" scripts/school.mjs choose --host canvas.example.edu --name Example --source manual 2>&1 | tail -1 | cut -c1-200)
echo "--- 7 check-session, no downloaded browsers, no channel"
(cd "$A/core/browser" && clean HEADLESS=1 PLAYWRIGHT_BROWSERS_PATH="$S/no-browsers" "$A/runtime/node/bin/node" scripts/check-canvas-session.mjs 2>&1 | grep -v "^\s*$" | tail -3 | cut -c1-260)
echo "--- 8 check-session, no downloaded browsers, PLAYWRIGHT_CHANNEL=chrome"
(cd "$A/core/browser" && clean HEADLESS=1 PLAYWRIGHT_BROWSERS_PATH="$S/no-browsers" PLAYWRIGHT_CHANNEL=chrome "$A/runtime/node/bin/node" scripts/check-canvas-session.mjs 2>&1 | grep -v "^\s*$" | tail -3 | cut -c1-260)
echo "--- 9 reconcile helper the canonical sync spawns"
ls "$A/core/scripts/py-mirror-run.sh" 2>&1 | tail -1
grep -c "reconcile-command" "$A/core/browser/scripts/sync-canvas-canonical.mjs" | sed 's/^/uses reconcile-command.mjs: /'
echo "--- 10 reconcile as the installed app will run it (bundled python, core/src)"
(cd "$A/core/src" && clean PYTHONPATH="$A/core/src" "$A/runtime/python/bin/python3" -s -m canvas_mcp.core.learn_loop reconcile 2>&1 | tail -1)
echo "--- 11 repo checkout referenced anywhere in the bundle's text resources?"
grep -rIl "Mobile Documents\|$HOME/" "$A/core" 2>/dev/null | head -3; echo "(end)"
