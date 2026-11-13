tot=0; for p in $(pgrep -f "WebKitWebProcess|WebKitNetworkProcess|WebKitGPUProcess|voltius"); do
  n=$(tr '\0' ' ' </proc/$p/cmdline | awk '{print $1}' | xargs basename); v=$(awk '/^Pss:/{print $2}' /proc/$p/smaps_rollup 2>/dev/null); [ -n "$v" ] || continue
  echo "  $n pid=$p pss=$((v/1024))MB"; tot=$((tot+v)); done; echo "  TOTAL pss=$((tot/1024))MB"
