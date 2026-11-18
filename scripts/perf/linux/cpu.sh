# total CPU ms (utime+stime, incl. threads) of voltius main + WebKit web process
t=0; for p in $(pgrep -f "voltius|WebKitWebProcess"); do read -r a b <<< "$(awk '{print $14, $15}' /proc/$p/stat)"; t=$((t+a+b)); done; echo $((t*1000/$(getconf CLK_TCK)))
