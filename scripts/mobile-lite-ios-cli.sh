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

  # Always use generic/platform=iOS for the *build*. A concrete
  # platform=iOS,id=UDID destination requires mounting the Developer Disk
  # Image (DDI); when that fails xcodebuild times out with:
  #   "The developer disk image could not be mounted on this device."
  # Signing still picks up a connected phone via -allowProvisioningDeviceRegistration.
  local udid=""
  udid="$(pick_device_udid 2>/dev/null || true)"
  if [[ -n "$udid" ]]; then
    echo "Building for iOS device (team $team, connected $udid) …"
  else
    echo "Building for generic iOS device (team $team) …"
    echo "  Tip: unlock + trust this Mac so Automatic signing can register your UDID."
  fi
  echo "  (xcodebuild — first run can take a few minutes; progress appears below)"
  # Drop stale wildcard Team profiles that omit the connected device; otherwise
  # Automatic signing reuses them and install fails with 0xe8008015 even when
  # the device is already registered on the Apple Developer portal.
  if [[ -n "$udid" ]]; then
    local hw="" resolved=""
    resolved="$(resolve_device_ids "$udid" 2>/dev/null || true)"
    hw="${resolved#*|}"
    hw="${hw%%|*}"
    if [[ -n "$hw" ]]; then
      local pdir="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
      if [[ -d "$pdir" ]]; then
        local f name
        for f in "$pdir"/*; do
          [[ -f "$f" ]] || continue
          name="$(strings "$f" 2>/dev/null | awk '/<key>Name<\/key>/{getline; gsub(/<\/?string>/,""); print; exit}')"
          case "$name" in
            "iOS Team Provisioning Profile: *"|"iOS Team Provisioning Profile: gg.agnt.chat")
              if ! strings "$f" 2>/dev/null | grep -Fq "$hw"; then
                echo "  Removing stale profile missing $hw: $name"
                rm -f "$f"
              fi
              ;;
          esac
        done
      fi
    fi
  fi
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
      -allowProvisioningDeviceRegistration \
      build
  )
  find_app iphoneos >/dev/null
  echo "✓ Device build OK"
  echo "  app: $(find_app iphoneos)"
}

# Resolve IOS_DEVICE_UDID / auto-pick into Core Device id + hardware UDID.
# Users often pass the Identifier from `devicectl list devices` (Core UUID);
# ios-deploy needs the hardware UDID (00008xxx-…).
resolve_device_ids() {
  local want="${1:-}"
  local tmp core hw name
  tmp="$(mktemp)"
  if ! xcrun devicectl list devices --json-output "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp"
    # Fall back: treat input as both if provided
    if [[ -n "$want" ]]; then
      echo "$want|$want|"
      return 0
    fi
    return 1
  fi
  # Prints: core|hw|name  (best match). Empty fields allowed.
  node -e '
    const fs = require("fs");
    const want = (process.argv[2] || "").trim().toLowerCase();
    let j; try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(1); }
    const list = j.result?.devices || j.devices || [];
    const rows = list.map((d) => {
      const c = d.connectionProperties || {};
      const p = d.deviceProperties || {};
      const h = d.hardwareProperties || {};
      const name = String(p.name || d.name || "");
      const core = String(d.identifier || "");
      const hw = String(h.udid || "");
      const transport = String(c.transportType || "").toLowerCase();
      const boot = String(p.bootState || "").toLowerCase();
      const paired = String(c.pairingState || "").toLowerCase() === "paired";
      const isPhone = /iPhone/i.test(String(h.deviceType || name));
      const isIOS = /iPhone|iPad/i.test(name) || h.platform === "iOS" || /iPhone|iPad/i.test(String(h.deviceType || ""));
      let score = 0;
      if (transport === "wired") score += 100;
      else if (transport === "localnetwork" || transport === "wifi") score += 80;
      else if (transport) score += 40;
      if (boot === "booted") score += 20;
      if (paired) score += 10;
      if (isPhone) score += 5;
      return { name, core, hw, score, isIOS };
    }).filter((r) => r.isIOS && (r.core || r.hw));

    let hit = null;
    if (want) {
      hit = rows.find((r) =>
        r.core.toLowerCase() === want ||
        r.hw.toLowerCase() === want ||
        r.name.toLowerCase() === want
      ) || null;
    }
    if (!hit) {
      rows.sort((a, b) => b.score - a.score);
      hit = rows.find((r) => r.score > 0) || rows[0] || null;
    }
    if (!hit) process.exit(1);
    process.stdout.write([hit.core, hit.hw, hit.name].join("|"));
  ' "$tmp" "$want" || { rm -f "$tmp"; return 1; }
  rm -f "$tmp"
}

pick_device_udid() {
  if [[ -n "${IOS_DEVICE_UDID:-}" ]]; then
    echo "$IOS_DEVICE_UDID"
    return
  fi

  local resolved core
  resolved="$(resolve_device_ids "" 2>/dev/null || true)"
  core="${resolved%%|*}"
  if [[ -n "$core" ]]; then
    echo "$core"
    return
  fi

  # xctrace: "Rimas's iPhone (26.x) (00008110-001A…)" — prefer non-Simulator lines
  local udid
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
  Or set IOS_DEVICE_UDID=… (Identifier from: xcrun devicectl list devices)"
}

profile_includes_device() {
  local app="$1" hw="$2"
  [[ -f "$app/embedded.mobileprovision" && -n "$hw" ]] || return 1
  strings "$app/embedded.mobileprovision" 2>/dev/null | grep -Fq "$hw"
}

provisioning_fix_die() {
  local team="$1" hw="$2" app="$3"
  local listed
  listed="$(strings "$app/embedded.mobileprovision" 2>/dev/null \
    | grep -oE '0000[0-9A-Fa-f]{4}-[0-9A-Fa-f]{16}' | sort -u | sed 's/^/    /' || true)"
  die "Install failed: provisioning profile does not include this iPhone (0xe8008015).

  Your phone hardware UDID:
    $hw

  UDIDs currently in the embedded profile:
${listed:-    (none found)}

  One-time fix — register the phone with Apple Developer team ${team:-XXXXXXXXXX}:

  A) Easiest (GUI):
     1. Unlock iPhone, keep USB connected
     2. Open Xcode → Window → Devices and Simulators → select the phone
     3. Wait until Ready (registers device + mounts DDI)
     4. Re-run:
        DEVELOPMENT_TEAM=${team:-XXXXXXXXXX} make mobile-lite-ios-iphone

  B) Portal:
     1. https://developer.apple.com/account/resources/devices/list
     2. Register device with UDID above
     3. Delete stale local profiles, then rebuild:
        rm -rf ~/Library/Developer/Xcode/UserData/Provisioning\\ Profiles/*
        DEVELOPMENT_TEAM=${team:-XXXXXXXXXX} make mobile-lite-ios-iphone"
}

cmd_device_run() {
  # Resolve device first so device-build can target that UDID for signing.
  local udid app team resolved core_id hw_udid device_name
  team="${DEVELOPMENT_TEAM:-${IOS_DEVELOPMENT_TEAM:-}}"
  udid="$(pick_device_udid)"
  export IOS_DEVICE_UDID="$udid"

  resolved="$(resolve_device_ids "$udid" 2>/dev/null || true)"
  core_id="${resolved%%|*}"
  device_name="${resolved##*|}"
  hw_udid="${resolved#*|}"
  hw_udid="${hw_udid%%|*}"
  # Prefer Core Device id for dest messages; fall back to whatever user passed
  [[ -n "$core_id" ]] || core_id="$udid"
  [[ -n "$hw_udid" ]] || hw_udid="$udid"

  cmd_device_build
  app="$(find_app iphoneos)"
  echo "Installing on ${device_name:-device} …"
  echo "  Core Device id: $core_id"
  echo "  Hardware UDID:  $hw_udid"

  if ! profile_includes_device "$app" "$hw_udid"; then
    provisioning_fix_die "$team" "$hw_udid" "$app"
  fi

  local install_err
  install_err="$(mktemp)"
  # Prefer modern installer (accepts Core Device id OR hardware UDID)
  if xcrun devicectl device install app --device "$core_id" "$app" 2>"$install_err"; then
    rm -f "$install_err"
    echo "Launching …"
    xcrun devicectl device process launch --device "$core_id" "$BUNDLE_ID" \
      || xcrun devicectl device process launch --device "$core_id" --start-stopped "$BUNDLE_ID" \
      || echo "Installed. Open AGNT Chat on the phone if launch failed."
  elif command -v ios-deploy >/dev/null; then
    # ios-deploy matches hardware UDID (00008…), not Core Device UUID — and can
    # hang forever on a mismatched --id. Always pass hw UDID + a timeout.
    echo "devicectl install failed; trying ios-deploy with hardware UDID…"
    cat "$install_err" >&2 || true
    : >"$install_err"
    if ! ios-deploy --id "$hw_udid" --bundle "$app" --justlaunch --timeout 30 2>"$install_err"; then
      if grep -qE '0xe8008015|provisioning profile' "$install_err" 2>/dev/null; then
        cat "$install_err" >&2
        rm -f "$install_err"
        provisioning_fix_die "$team" "$hw_udid" "$app"
      fi
      if grep -qiE 'developer disk image|could not be mounted|ddi' "$install_err" 2>/dev/null; then
        cat "$install_err" >&2
        rm -f "$install_err"
        die "Install/debug helpers need the Developer Disk Image mounted on the phone.

  Fix:
  1. Unlock iPhone (stay on home screen), keep USB connected
  2. Open Xcode once → Window → Devices and Simulators → select the phone
     Wait until the progress spinner finishes / device shows Ready
  3. Re-run: DEVELOPMENT_TEAM=${team:-XXXXXXXXXX} make mobile-lite-ios-iphone"
      fi
      cat "$install_err" >&2
      rm -f "$install_err"
      die "ios-deploy install failed (waited 30s for hardware UDID $hw_udid)"
    fi
    rm -f "$install_err"
  else
    cat "$install_err" >&2
    rm -f "$install_err"
    die "Install failed. Try: xcrun devicectl device install app --device $core_id $app
  Or: brew install ios-deploy"
  fi
  echo "✓ Installed on iPhone (no Xcode GUI)"
  echo "  Set Server URL in the app (LAN/Tailscale), not 127.0.0.1"
}

cmd_list_devices() {
  local tmp
  tmp="$(mktemp)"
  if ! xcrun devicectl list devices --json-output "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp"
    die "devicectl failed. Is Xcode installed? Try: xcrun devicectl list devices"
  fi
  node -e '
    const fs = require("fs");
    let j; try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(1); }
    const list = j.result?.devices || j.devices || [];
    const rows = [];
    for (const d of list) {
      const c = d.connectionProperties || {};
      const p = d.deviceProperties || {};
      const h = d.hardwareProperties || {};
      const name = String(p.name || d.name || "");
      const type = String(h.deviceType || h.marketingName || "");
      const platform = String(h.platform || "");
      if (!/iPhone|iPad/i.test(name) && platform !== "iOS" && !/iPhone|iPad/i.test(type)) continue;
      const transport = String(c.transportType || "");
      const boot = String(p.bootState || "");
      const paired = String(c.pairingState || "");
      let state = "unavailable";
      if (transport) state = `available (${transport}${boot ? ", " + boot : ""})`;
      else if (paired === "paired") state = "paired (offline)";
      rows.push({
        name,
        model: String(h.marketingName || type || ""),
        core: String(d.identifier || ""),
        hw: String(h.udid || ""),
        state,
        score: transport === "wired" ? 2 : transport ? 1 : 0,
      });
    }
    rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    if (!rows.length) {
      console.log("No physical iPhone/iPad found. Plug in USB, unlock, trust this Mac.");
      process.exit(1);
    }
    console.log("Physical iOS devices (use either ID with IOS_DEVICE_UDID=…):\n");
    for (const r of rows) {
      console.log(r.name + (r.model ? `  (${r.model})` : ""));
      console.log("  State:            " + r.state);
      console.log("  Core Device id:   " + (r.core || "(unknown)"));
      console.log("  Hardware UDID:    " + (r.hw || "(unknown)"));
      if (r.core) {
        console.log("  Example:");
        console.log("    IOS_DEVICE_UDID=" + r.core + " DEVELOPMENT_TEAM=XXXXXXXXXX make mobile-lite-ios-iphone");
      }
      console.log("");
    }
  ' "$tmp"
  local rc=$?
  rm -f "$tmp"
  return "$rc"
}

usage() {
  cat <<EOF
Usage: $0 <sim-build|sim-run|device-build|device-run|list-devices>

  sim-build      Build Debug for iOS Simulator (CLI only)
  sim-run        Build + boot Simulator + install + launch
  device-build   Build Debug for physical device (needs DEVELOPMENT_TEAM)
  device-run     Build + install + launch on connected iPhone
  list-devices   Show Core Device id + hardware UDID for connected phones/iPads

Env:
  IOS_SIM_NAME          Simulator device name (default: first available iPhone)
  DEVELOPMENT_TEAM      Apple Team ID (required for device-*)
  IOS_DEVICE_UDID       Core Device Identifier (from: list-devices)
                        or hardware UDID — both accepted
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
    list-devices|devices) cmd_list_devices ;;
    -h|--help|help|"") usage; [[ -n "$cmd" ]] || exit 1 ;;
    *) die "unknown command: $cmd" ;;
  esac
}

main "$@"
