#!/usr/bin/env bash
# iOS-only: allow LAN/localhost HTTP (cleartext) for AGNT Phone Access / Simulator.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$ROOT/mobile/mobile-lite/ios/App/App/Info.plist"

if [[ ! -f "$PLIST" ]]; then
  echo "Info.plist not found yet (run make mobile-lite-ios-init first): $PLIST" >&2
  exit 1
fi

/usr/libexec/PlistBuddy -c 'Add :NSAppTransportSecurity dict' "$PLIST" 2>/dev/null || true

set_bool() {
  local key="$1"
  /usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:${key} bool true" "$PLIST" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Set :NSAppTransportSecurity:${key} true" "$PLIST"
}

# Full cleartext — local networking alone is not enough for all iOS Simulator builds.
set_bool NSAllowsArbitraryLoads
set_bool NSAllowsLocalNetworking
set_bool NSAllowsArbitraryLoadsInWebContent

# Camera for Phone Access QR scan (getUserMedia in WKWebView).
/usr/libexec/PlistBuddy -c 'Add :NSCameraUsageDescription string Scan the AGNT Phone Access QR code to pair this device.' "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c 'Set :NSCameraUsageDescription Scan the AGNT Phone Access QR code to pair this device.' "$PLIST"

echo "Patched ATS + NSCameraUsageDescription on $PLIST"
