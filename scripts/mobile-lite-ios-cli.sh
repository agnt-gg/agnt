#!/usr/bin/env bash
# Build / install / launch AGNT mobile-lite without opening the Xcode GUI.
# Still requires Xcode + CLT installed (xcodebuild / simctl / devicectl).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS_APP_DIR="$ROOT/mobile/mobile-lite/ios/App"
WORKSPACE="$IOS_APP_DIR/App.xcworkspace"
SCHEME="App"
BUNDLE_ID="gg.agnt.chat"
DERIVED="${MOBILE_LITE_DERIVED:-$ROOT/mobile/mobile-lite/build/DerivedData}"
CONFIG="${MOBILE_LITE_CONFIGURATION:-Debug}"

# Prefer a concrete simulator name when set; otherwise first available iPhone.
IOS_SIM_NAME="${IOS_SIM_NAME:-}"

die() { echo "error: $*" >&2; exit 1; }

need_workspace() {
  [[ -d "$WORKSPACE" ]] || die "No iOS project at $WORKSPACE — run: make mobile-lite-ios-init"
  command -v xcodebuild >/dev/null || die "xcodebuild not found (install Xcode)"
}

find_app() {
  local sdk="$1"
  local app
  app="$(find "$DERIVED" -path "*/Build/Products/${CONFIG}-${sdk}/App.app" -type d 2>/dev/null | head -1 || true)"
  [[ -n "$app" && -d "$app" ]] || die "App.app not found under $DERIVED (build failed?)"
  echo "$app"
}

pick_simulator_udid() {
  if [[ -n "$IOS_SIM_NAME" ]]; then
    xcrun simctl list devices available -j | node -e '
      const fs=require("fs");
      const j=JSON.parse(fs.readFileSync(0,"utf8"));
      const want=process.env.IOS_SIM_NAME;
      for (const devs of Object.values(j.devices||{})) {
        for (const d of devs) {
          if (d.isAvailable!==false && d.name===want) { console.log(d.udid); process.exit(0); }
        }
      }
      process.exit(1);
    ' || die "Simulator not found: $IOS_SIM_NAME (set IOS_SIM_NAME to a name from: xcrun simctl list devices available)"
    return
  fi
  # First available iPhone simulator (any runtime)
  xcrun simctl list devices available -j | node -e '
    const fs=require("fs");
    const j=JSON.parse(fs.readFileSync(0,"utf8"));
    const phones=[];
    for (const devs of Object.values(j.devices||{})) {
      for (const d of devs) {
        if (d.isAvailable===false) continue;
        if (/iPhone/i.test(d.name)) phones.push(d);
      }
    }
    if (!phones.length) process.exit(1);
    // Prefer already Booted
    const booted=phones.find(d=>d.state==="Booted");
    console.log((booted||phones[0]).udid);
  ' || die "No available iPhone simulators"
}

boot_simulator() {
  local udid="$1"
  local state
  state="$(xcrun simctl list devices -j | node -e '
    const fs=require("fs");
    const udid=process.argv[1];
    const j=JSON.parse(fs.readFileSync(0,"utf8"));
    for (const devs of Object.values(j.devices||{})) {
      for (const d of devs) if (d.udid===udid) { console.log(d.state||""); process.exit(0); }
    }
  ' "$udid")"
  if [[ "$state" != "Booted" ]]; then
    echo "Booting simulator $udid …"
    xcrun simctl boot "$udid" 2>/dev/null || true
  fi
  # Show Simulator.app UI (still not Xcode)
  open -a Simulator 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b 2>/dev/null || sleep 2
}

cmd_sim_build() {
  need_workspace
  local dest udid
  udid="$(pick_simulator_udid)"
  # Resolve name for -destination (more reliable than id= for some Xcode versions)
  local name
  name="$(xcrun simctl list devices -j | node -e '
    const fs=require("fs");
    const udid=process.argv[1];
    const j=JSON.parse(fs.readFileSync(0,"utf8"));
    for (const devs of Object.values(j.devices||{})) {
      for (const d of devs) if (d.udid===udid) { console.log(d.name); process.exit(0); }
    }
  ' "$udid")"
  dest="platform=iOS Simulator,name=${name}"
  echo "Building for Simulator ($name) …"
  mkdir -p "$DERIVED"
  (
    cd "$IOS_APP_DIR"
    xcodebuild \
      -workspace App.xcworkspace \
      -scheme "$SCHEME" \
      -configuration "$CONFIG" \
      -sdk iphonesimulator \
      -destination "$dest" \
      -derivedDataPath "$DERIVED" \
      CODE_SIGNING_ALLOWED=NO \
      build
  )
  find_app iphonesimulator >/dev/null
  echo "✓ Simulator build OK"
  echo "  app: $(find_app iphonesimulator)"
}

cmd_sim_run() {
  cmd_sim_build
  local udid app
  udid="$(pick_simulator_udid)"
  app="$(find_app iphonesimulator)"
  boot_simulator "$udid"
  echo "Installing $BUNDLE_ID …"
  xcrun simctl install "$udid" "$app"
  echo "Launching …"
  xcrun simctl launch "$udid" "$BUNDLE_ID"
  echo "✓ Running on Simulator (no Xcode GUI)"
}

cmd_device_build() {
  need_workspace
  local team="${DEVELOPMENT_TEAM:-${IOS_DEVELOPMENT_TEAM:-}}"
  [[ -n "$team" ]] || die "Set DEVELOPMENT_TEAM (Apple Team ID), e.g. DEVELOPMENT_TEAM=ABCDE12345 make mobile-lite-ios-iphone
  Find IDs:  security find-identity -v -p codesigning
  Or Xcode → Settings → Accounts → Team"

  echo "Building for physical iPhone (team $team) …"
  mkdir -p "$DERIVED"
  (
    cd "$IOS_APP_DIR"
    xcodebuild \
      -workspace App.xcworkspace \
      -scheme "$SCHEME" \
      -configuration "$CONFIG" \
      -sdk iphoneos \
      -destination 'generic/platform=iOS' \
      -derivedDataPath "$DERIVED" \
      DEVELOPMENT_TEAM="$team" \
      CODE_SIGN_STYLE=Automatic \
      -allowProvisioningUpdates \
      build
  )
  find_app iphoneos >/dev/null
  echo "✓ Device build OK"
  echo "  app: $(find_app iphoneos)"
}

pick_device_udid() {
  if [[ -n "${IOS_DEVICE_UDID:-}" ]]; then
    echo "$IOS_DEVICE_UDID"
    return
  fi

  local tmp udid
  tmp="$(mktemp)"
  # Xcode 15+ devicectl JSON
  if xcrun devicectl list devices --json-output "$tmp" 2>/dev/null; then
    udid="$(node -e '
      const fs=require("fs");
      let j; try { j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); } catch { process.exit(1); }
      const list = j.result?.devices || j.devices || [];
      const phys = list.filter((d) => {
        const name = String(d.deviceProperties?.name || d.name || "");
        const platform = String(d.hardwareProperties?.platform || "");
        return /iPhone|iPad/i.test(name) || platform === "iOS";
      });
      const hit =
        phys.find((d) => /connected/i.test(String(d.connectionProperties?.state || ""))) ||
        phys[0];
      if (!hit) process.exit(1);
      const id = hit.identifier || hit.hardwareProperties?.udid || hit.udid;
      if (!id) process.exit(1);
      process.stdout.write(String(id));
    ' "$tmp" 2>/dev/null || true)"
    rm -f "$tmp"
    if [[ -n "${udid:-}" ]]; then
      echo "$udid"
      return
    fi
  else
    rm -f "$tmp"
  fi

  # xctrace: "Rimas's iPhone (26.x) (00008110-001A…)"
  udid="$(xcrun xctrace list devices 2>/dev/null \
    | grep -vi Simulator \
    | grep -iE 'iPhone|iPad' \
    | head -1 \
    | sed -n 's/.*(\([0-9A-Fa-f-]\{20,\}\)).*/\1/p' \
    || true)"
  if [[ -n "${udid:-}" ]]; then
    echo "$udid"
    return
  fi

  die "No physical iOS device found. Plug in iPhone, trust this Mac, unlock phone.
  Or set IOS_DEVICE_UDID=…"
}

cmd_device_run() {
  cmd_device_build
  local udid app
  udid="$(pick_device_udid)"
  app="$(find_app iphoneos)"
  echo "Installing on device $udid …"
  if xcrun devicectl device install app --device "$udid" "$app" 2>/dev/null; then
    echo "Launching …"
    xcrun devicectl device process launch --device "$udid" "$BUNDLE_ID" \
      || xcrun devicectl device process launch --device "$udid" --start-stopped "$BUNDLE_ID" \
      || echo "Installed. Open AGNT Chat on the phone if launch failed."
  elif command -v ios-deploy >/dev/null; then
    ios-deploy --bundle "$app" --justlaunch
  else
    die "Install failed. Try: xcrun devicectl device install app --device $udid $app
  Or: brew install ios-deploy"
  fi
  echo "✓ Installed on iPhone (no Xcode GUI)"
  echo "  Set Server URL in the app (LAN/Tailscale), not 127.0.0.1"
}

usage() {
  cat <<EOF
Usage: $0 <sim-build|sim-run|device-build|device-run>

  sim-build      Build Debug for iOS Simulator (CLI only)
  sim-run        Build + boot Simulator + install + launch
  device-build   Build Debug for physical device (needs DEVELOPMENT_TEAM)
  device-run     Build + install + launch on connected iPhone

Env:
  IOS_SIM_NAME          Simulator device name (default: first available iPhone)
  DEVELOPMENT_TEAM      Apple Team ID (required for device-*)
  IOS_DEVICE_UDID       Target device UDID (optional)
  MOBILE_LITE_DERIVED   DerivedData path (default: mobile/mobile-lite/build/DerivedData)
  MOBILE_LITE_CONFIGURATION  Debug|Release (default: Debug)
EOF
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    sim-build) cmd_sim_build ;;
    sim-run) cmd_sim_run ;;
    device-build) cmd_device_build ;;
    device-run) cmd_device_run ;;
    -h|--help|help|"") usage; [[ -n "$cmd" ]] || exit 1 ;;
    *) die "unknown command: $cmd" ;;
  esac
}

main "$@"
