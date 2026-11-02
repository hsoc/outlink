#!/usr/bin/env bash
# Run on a disposable emulator against the actual optimized release APK.
set -euo pipefail
apk=${1:?Pass the release APK}
package=io.github.hsoc.outlink
reports=release/android-smoke
mkdir -p "$reports"
cleanup() {
  adb logcat -d > "$reports/logcat.txt" 2>&1 || true
  adb exec-out screencap -p > "$reports/screen.png" 2>/dev/null || true
}
trap cleanup EXIT
adb install -r "$apk"
adb shell input keyevent 82
adb logcat -b all -c
adb shell am start -W -n "$package/.MainActivity"
ready=false
for attempt in $(seq 1 20); do
  sleep 3
  adb shell uiautomator dump /sdcard/outlink-window.xml >/dev/null 2>&1 || continue
  adb pull /sdcard/outlink-window.xml "$reports/window.xml" >/dev/null 2>&1 || continue
  if grep -q 'Nearby' "$reports/window.xml" && grep -q 'Location channels' "$reports/window.xml"; then
    ready=true
    break
  fi
done
if [[ "$ready" != true ]]; then
  echo 'Optimized app did not render its conversation screen.' >&2
  exit 1
fi
if grep -q 'Unable to connect or send' "$reports/window.xml"; then
  echo 'App reported an initialization failure.' >&2
  exit 1
fi
sleep 10
adb shell pidof "$package" >/dev/null
adb logcat -b crash -d > "$reports/crashes.txt"
if grep -Eq "Process: $package|>>> $package <<<" "$reports/crashes.txt"; then
  echo 'Optimized app crashed during startup.' >&2
  exit 1
fi
echo 'Optimized release APK rendered Nearby/Location controls and remained running.'
