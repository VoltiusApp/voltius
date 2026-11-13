#!/bin/bash
# usage: opentabs.sh <n> [fill-lines] — opens n local Bash tabs, each printing `seq 1 fill-lines`
cd "$(dirname "$0")"
n=${1:-20}; fill=${2:-3000}
for i in $(seq 1 $n); do
  node wd.mjs eval 'return (async()=>{document.querySelector("button[title=\"New session\"]").click(); await new Promise(r=>setTimeout(r,500)); const b=[...document.querySelectorAll("button")].find(b=>b.offsetParent&&b.innerText.trim()==="Bash"); b.click(); await new Promise(r=>setTimeout(r,1500)); const ts=[...document.querySelectorAll(".xterm-helper-textarea")]; const v=ts.find(t=>!t.closest(".invisible")&&t.closest(".xterm").getBoundingClientRect().width>0); ts.forEach(t=>t.removeAttribute("data-perf")); if(v) v.setAttribute("data-perf","1"); return ts.length})()' >/dev/null
  node wd.mjs type '[data-perf]' "seq 1 $fill"$'\n' >/dev/null
done
sleep 5
node wd.mjs eval 'return document.querySelectorAll(".xterm").length'
