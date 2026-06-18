#!/usr/bin/env bash
# Install + launch the Voltius debug APK on a connected phone.
# Usage: scripts/android-deploy.sh /path/to/app-universal-debug.apk
#
# Reaches the device through whatever adb you have configured:
#  - native USB adb, or
#  - a Windows-hosted adb server from WSL (export ADB_SERVER_SOCKET=tcp:<win-ip>:5037).
set -euo pipefail
APK="${1:?usage: android-deploy.sh <apk-path>}"
APP_ID="com.voltius.app"
ACTIVITY="${APP_ID}/.MainActivity"

[ -f "$APK" ] || { echo "ERROR: no such APK: $APK" >&2; exit 1; }

adb get-state >/dev/null   # fails loudly if no device / not authorized
adb install -r "$APK"
adb shell am start -n "$ACTIVITY"
echo "Launched $ACTIVITY."
echo "WebView debug socket:"
adb shell grep -a webview_devtools_remote /proc/net/unix || \
  echo "  (not found yet — give the app a second, then re-check; needs a --debug build)"
