#!/bin/bash
# usage: memidle.sh <binary> — fresh launch, onboarding skipped, no tabs; PSS after 30 s idle
cd "$(dirname "$0")"
[ -f /tmp/wd_sid ] && node -e "fetch('http://localhost:4444/session/'+require('fs').readFileSync('/tmp/wd_sid','utf8').trim(),{method:'DELETE'}).then(r=>r.text()).then(()=>0)"
pkill -f "^/bin-perf/"; sleep 2; pkill -f voltius-bashrc; rm -rf ~/.config/voltius ~/.local/share/voltius ~/.local/share/com.voltius* 2>/dev/null
read c0 <<< "$(bash cpu.sh)"
VOLTIUS_APP_BIN=$1 node wd.mjs new >/dev/null || exit 1
for i in $(seq 1 30); do sleep 1; node wd.mjs eval 'return !![...document.querySelectorAll("button")].find(b=>b.innerText.includes("Get started"))' | grep -q true && break; done
node wd.mjs eval 'var b=[...document.querySelectorAll("button")].find(b=>b.innerText.includes("Get started")); b&&b.click(); return 1' >/dev/null
sleep 30
echo "== $1 startup+30s cpu_ms=$(bash cpu.sh)"; bash mem.sh | grep -v "bash pss"
