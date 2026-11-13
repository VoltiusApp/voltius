#!/bin/bash
# usage: tabbench.sh <label> [n] — idle CPU over 20 s, then CPU per Ctrl+Tab (settle-to-idle), n switches
cd "$(dirname "$0")"
n=${2:-10}
read a0 b0 <<< "$(bash cpu2.sh)"; sleep 20; read a1 b1 <<< "$(bash cpu2.sh)"
idle20=$((a1+b1-a0-b0)); idle=$((idle20/20))
out=""
for i in $(seq 1 $n); do
  read m0 w0 <<< "$(bash cpu2.sh)"; t0=$(date +%s%N)
  node wd.mjs eval 'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",code:"Tab",ctrlKey:true,bubbles:true,cancelable:true})); return 1' >/dev/null
  sleep 1; read pm pw <<< "$(bash cpu2.sh)"; quiet=0
  while [ $quiet -lt 1 ]; do sleep 1; read cm cw <<< "$(bash cpu2.sh)"; if [ $((cm+cw-pm-pw)) -lt $((idle+40)) ]; then quiet=$((quiet+1)); else quiet=0; fi; pm=$cm; pw=$cw; done
  t1=$(date +%s%N); el=$(( (t1-t0)/1000000 ))
  out="$out $(( pm+pw-m0-w0 - idle*el/1000 ))"
done
echo "tabs $1: idle_20s_ms=$idle20 (main $((a1-a0)) web $((b1-b0))) net_ms_per_switch=[$out ]"
