# CPU ms of the app main process and the WebKit web process: "<main> <web>"
hz=$(getconf CLK_TCK); m=0; w=0
for p in $(pgrep -f "^/bin-perf/|target/.*/voltius$"); do read -r a b <<< "$(awk '{print $14, $15}' /proc/$p/stat)"; m=$((m+a+b)); done
for p in $(pgrep -f "WebKitWebProcess"); do read -r a b <<< "$(awk '{print $14, $15}' /proc/$p/stat)"; w=$((w+a+b)); done
echo $((m*1000/hz)) $((w*1000/hz))
