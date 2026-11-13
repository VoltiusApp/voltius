#!/bin/bash
# usage: launch.sh <binary>  — fresh app session, onboarding skipped, one local Bash tab tagged [data-perf]
cd "$(dirname "$0")"
[ -f /tmp/wd_sid ] && node -e "fetch('http://localhost:4444/session/'+require('fs').readFileSync('/tmp/wd_sid','utf8').trim(),{method:'DELETE'}).then(r=>r.text()).then(()=>0)"
pkill -f "^/bin-perf/" ; sleep 2; pkill -f voltius-bashrc
rm -rf ~/.config/voltius ~/.local/share/voltius ~/.local/share/com.voltius* 2>/dev/null
VOLTIUS_APP_BIN=$1 node wd.mjs new >/dev/null || exit 1
for i in $(seq 1 30); do sleep 1; node wd.mjs eval 'return !![...document.querySelectorAll("button")].find(b=>b.innerText.includes("Get started"))' | grep -q true && break; done
node wd.mjs eval 'var b=[...document.querySelectorAll("button")].find(b=>b.innerText.includes("Get started")); b&&b.click(); return 1' >/dev/null
sleep 3
node wd.mjs eval 'return (async()=>{document.querySelector("button[title=\"New session\"]").click(); await new Promise(r=>setTimeout(r,600)); const b=[...document.querySelectorAll("button")].find(b=>b.offsetParent&&b.innerText.trim()==="Bash"); b.click(); return 1})()' >/dev/null
sleep 4
node wd.mjs eval 'const ts=[...document.querySelectorAll(".xterm-helper-textarea")]; const v=ts.find(t=>!t.closest(".invisible")&&t.closest(".xterm").getBoundingClientRect().width>0); ts.forEach(t=>t.removeAttribute("data-perf")); if(v) v.setAttribute("data-perf","1"); return {n:ts.length, tagged:!!v}'
