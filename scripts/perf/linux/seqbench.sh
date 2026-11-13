#!/bin/bash
# usage: [REMOTE=1] seqbench.sh <N> [label] — types `seq 1 N` into the [data-perf] terminal, waits for CPU to
# settle back to the idle rate, prints gross and idle-subtracted CPU ms (main/web)
cd "$(dirname "$0")"
N=${1:-400000}
rm -f /tmp/seqdone
read a0 b0 <<< "$(bash cpu2.sh)"; sleep 5; read a1 b1 <<< "$(bash cpu2.sh)"
idle=$(( (a1+b1-a0-b0)/5 ))
read m0 w0 <<< "$(bash cpu2.sh)"; t0=$(date +%s%N)
node wd.mjs type '[data-perf]' "seq 1 $N; touch /tmp/seqdone"$'\n' >/dev/null
if [ -n "$REMOTE" ]; then sleep 2; else until [ -e /tmp/seqdone ]; do sleep 0.2; done; fi
read pm pw <<< "$(bash cpu2.sh)"; quiet=0
while [ $quiet -lt 3 ]; do sleep 1; read cm cw <<< "$(bash cpu2.sh)"; if [ $((cm+cw-pm-pw)) -lt $((idle+100)) ]; then quiet=$((quiet+1)); else quiet=0; fi; pm=$cm; pw=$cw; done
t1=$(date +%s%N); wall=$(( (t1-t0)/1000000 - 3000 ))
tot=$((pm+pw-m0-w0)); net=$(( tot - idle*(wall+3000)/1000 ))
echo "seq $N ${2:-}: net_ms=$net total_ms=$tot main_ms=$((pm-m0)) web_ms=$((pw-w0)) idle_ms_per_s=$idle wall_ms=$wall"
