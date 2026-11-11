#!/usr/bin/env bash
set -euo pipefail

source="${1:?usage: verify-cli-policy.sh <Voltius.dmg | Voltius.app>}"

profile_dir="/Library/Managed Preferences"
profile="$profile_dir/com.voltius.app.plist"
policy_dir="/Library/Application Support/Voltius"
policy="$policy_dir/policy.json"
domain=com.voltius.app
profile_url=https://profile.example.com
file_url=https://file.example.com
user_url=https://user.example.com

work=$(mktemp -d)
mount=""
made_profile_dir=false
made_policy_dir=false
wrote_default=false
failures=0

cleanup() {
  set +e
  [ -n "$mount" ] && hdiutil detach "$mount" > /dev/null
  sudo rm -f "$profile" "$policy"
  if $made_profile_dir; then sudo rmdir "$profile_dir"; fi
  if $made_policy_dir; then sudo rmdir "$policy_dir"; fi
  if $wrote_default; then defaults delete "$domain" server_url; fi
  rm -rf "$work"
}
trap cleanup EXIT

expect() {
  local id=$1 expected=$2 observed=$3
  if [ "$observed" = "$expected" ]; then
    echo "PASS $id $observed"
  else
    echo "FAIL $id expected=$expected observed=$observed"
    failures=$((failures + 1))
  fi
}

cli() {
  local who=$1
  shift
  code=0
  if [ "$who" = root ]; then
    sudo "$cli_bin" --no-color "$@" > "$work/out" 2> "$work/err" || code=$?
  else
    "$cli_bin" --no-color "$@" > "$work/out" 2> "$work/err" || code=$?
  fi
  out=$(< "$work/out")
  err=$(< "$work/err")
  echo "  [$who] voltius-cli $* -> $code"
  if [ -n "$out" ]; then echo "    stdout: $out"; fi
  if [ -n "$err" ]; then echo "    stderr: $err"; fi
}

field() {
  jq -r "$1" <<< "$out" 2> /dev/null || echo "<not json>"
}

contains() {
  case "$1" in *"$2"*) echo yes ;; *) echo no ;; esac
}

server_url() {
  local id=$1 value=$2
  cli user config get server.url --json
  expect "$id.exit" 0 "$code"
  expect "$id.value" "$value" "$(field .value)"
  expect "$id.source" "machine policy" "$(field .source)"
}

case "$source" in
  *.dmg)
    mount="$work/mnt"
    mkdir "$mount"
    hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$source" > /dev/null
    ditto "$mount/Voltius.app" "$work/Voltius.app"
    hdiutil detach "$mount" > /dev/null
    mount=""
    app="$work/Voltius.app"
    ;;
  *) app="$source" ;;
esac
cli_bin="$app/Contents/MacOS/voltius-cli"

sw_vers
"$cli_bin" --version
ls -ld "$profile_dir" "$policy_dir" 2> /dev/null || true
for f in "$profile" "$policy"; do
  if [ -e "$f" ]; then
    echo "refusing to run: $f already exists"
    exit 1
  fi
done
if defaults read "$domain" server_url > /dev/null 2>&1; then
  echo "refusing to run: the $domain user default server_url already exists"
  exit 1
fi

echo "== 1 no profile, no policy file"
cli user policy check --json
expect 1.exit 0 "$code"
expect 1.issues 0 "$(field '.issues | length')"
expect 1.warnings 0 "$(field '.warnings | length')"
expect 1.profile null "$(field .profile)"

echo "== 2 a root-owned binary profile"
cat > "$work/profile.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>server_url</key><string>$profile_url</string></dict></plist>
EOF
plutil -convert binary1 "$work/profile.plist"
if [ ! -d "$profile_dir" ]; then
  sudo install -d -o root -g wheel -m 0755 "$profile_dir"
  made_profile_dir=true
fi
sudo install -o root -g wheel -m 0644 "$work/profile.plist" "$profile"
ls -ld "$profile_dir" "$profile"
expect 2.binary bplist00 "$(head -c 8 "$profile")"
server_url 2 "$profile_url"

echo "== 3 policy.json disagrees with the profile"
if [ ! -d "$policy_dir" ]; then made_policy_dir=true; fi
cli root policy set server.url "$file_url"
expect 3.set.exit 0 "$code"
expect 3.set.warns yes "$(contains "$err" "policy.server.url: set by the configuration profile; the value in policy.json is ignored")"
expect 3.file "$file_url" "$(jq -r '.policy["server.url"]' "$policy" 2> /dev/null || echo "<unreadable>")"
cli user policy check --json
expect 3.check.exit 0 "$code"
expect 3.check.issues 0 "$(field '.issues | length')"
expect 3.check.warnings 1 "$(field '.warnings | length')"
expect 3.check.warning.key server.url "$(field '.warnings[0].key')"
expect 3.check.profile "$profile" "$(field .profile)"
server_url 3 "$profile_url"

echo "== 3b removing a key the profile still sets"
cli root policy unset server.url
expect 3b.unset.exit 0 "$code"
expect 3b.unset.warns yes "$(contains "$err" "policy.server.url: removed from policy.json, but the configuration profile still sets it")"
server_url 3b "$profile_url"
cli root policy set server.url "$file_url"
expect 3b.reset.exit 0 "$code"

echo "== 4 a profile standard users can change is ignored"
sudo chown "$(id -un)" "$profile"
ls -l "$profile"
cli user policy check --json
expect 4.check.exit 3 "$code"
expect 4.check.unprotected 1 "$(field '[.issues[] | select(.kind == "unprotected")] | length')"
server_url 4 "$file_url"

echo "== 5 the user domain is never read"
sudo rm -f "$profile"
defaults write "$domain" server_url "$user_url"
wrote_default=true
expect 5.default "$user_url" "$(defaults read "$domain" server_url)"
server_url 5 "$file_url"

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all checks passed"
