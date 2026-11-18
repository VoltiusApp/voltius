#!/bin/bash
# usage: resizebench.sh <label> [n]  — alternates window size n times, prints CPU ms per resize (until settle)
cd "$(dirname "$0")"
n=${2:-6}
sid=$(cat /tmp/wd_sid)
rect(){ node -e "fetch('http://localhost:4444/session/$sid/window/rect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({width:$1,height:$2})}).then(r=>r.text()).then(()=>0)"; }
read a0 b0 <<< "$(bash cpu2.sh)"; sleep 5; read a1 b1 <<< "$(bash cpu2.sh)"; idle=$(( (a1+b1-a0-b0)/5 ))
out=""
for i in $(seq 1 $n); do
  if [ $((i%2)) -eq 1 ]; then w=1000; h=700; else w=1200; h=800; fi
  read m0 w0 <<< "$(bash cpu2.sh)"; t0=$(date +%s%N)
  rect $w $h
  sleep 1; read pm pw <<< "$(bash cpu2.sh)"; quiet=0
  while [ $quiet -lt 2 ]; do sleep 1; read cm cw <<< "$(bash cpu2.sh)"; if [ $((cm+cw-pm-pw)) -lt $((idle+60)) ]; then quiet=$((quiet+1)); else quiet=0; fi; pm=$cm; pw=$cw; done
  t1=$(date +%s%N); el=$(( (t1-t0)/1000000 ))
  tot=$((pm+pw-m0-w0)); net=$(( tot - idle*el/1000 ))
  out="$out $net"
done
echo "resize $1: net_ms_per_resize=[$out ] idle_ms_per_s=$idle"
