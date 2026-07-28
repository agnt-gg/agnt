#!/usr/bin/env bash
# Generate iOS AppIcon + Splash from Mac AGNT art (build/icon.png).
# Uses plain filenames (no @ in paths) so sips never mis-writes assets.
# Bumps CURRENT_PROJECT_VERSION so reinstalls are treated as new builds.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/build/icon.png"
[[ -f "$SRC" ]] || SRC="$ROOT/build/icons/512x512.png"

ICONSET="$ROOT/mobile/mobile-lite/ios/App/App/Assets.xcassets/AppIcon.appiconset"
SPLASHSET="$ROOT/mobile/mobile-lite/ios/App/App/Assets.xcassets/Splash.imageset"
PBX="$ROOT/mobile/mobile-lite/ios/App/App.xcodeproj/project.pbxproj"

if [[ ! -f "$SRC" ]]; then
  echo "No source icon at build/icon.png — skip iOS icon sync" >&2
  exit 0
fi
if [[ ! -d "$ICONSET" ]]; then
  echo "AppIcon.appiconset missing (run make mobile-lite-ios-init): $ICONSET" >&2
  exit 1
fi
command -v sips >/dev/null || { echo "sips not found" >&2; exit 1; }

# Wipe previous generated PNGs so nothing stale remains
find "$ICONSET" -name '*.png' -delete 2>/dev/null || true

resize() {
  local px="$1" name="$2"
  local out="$ICONSET/$name"
  # Stage without special chars, then move into place
  local tmp
  tmp="$(mktemp /tmp/agnt-icon-XXXXXX.png)"
  sips -s format png -z "$px" "$px" "$SRC" --out "$tmp" >/dev/null
  mv -f "$tmp" "$out"
  # Sanity: reject tiny/corrupt outputs
  local bytes
  bytes=$(wc -c <"$out" | tr -d ' ')
  if [[ "$bytes" -lt 500 ]]; then
    echo "error: icon $name is only ${bytes} bytes — generation failed" >&2
    exit 1
  fi
}

# iPhone + marketing (classic Contents.json slots)
resize 40  "Icon-20-2x.png"      # 20pt @2x
resize 60  "Icon-20-3x.png"      # 20pt @3x
resize 58  "Icon-29-2x.png"      # 29pt @2x
resize 87  "Icon-29-3x.png"      # 29pt @3x
resize 80  "Icon-40-2x.png"      # 40pt @2x
resize 120 "Icon-40-3x.png"      # 40pt @3x
resize 120 "Icon-60-2x.png"      # 60pt @2x  ← app switcher / home @2x
resize 180 "Icon-60-3x.png"      # 60pt @3x  ← app switcher / home @3x
resize 1024 "Icon-1024.png"      # App Store / marketing

cat > "$ICONSET/Contents.json" <<'EOF'
{
  "images" : [
    { "size" : "20x20", "idiom" : "iphone", "filename" : "Icon-20-2x.png", "scale" : "2x" },
    { "size" : "20x20", "idiom" : "iphone", "filename" : "Icon-20-3x.png", "scale" : "3x" },
    { "size" : "29x29", "idiom" : "iphone", "filename" : "Icon-29-2x.png", "scale" : "2x" },
    { "size" : "29x29", "idiom" : "iphone", "filename" : "Icon-29-3x.png", "scale" : "3x" },
    { "size" : "40x40", "idiom" : "iphone", "filename" : "Icon-40-2x.png", "scale" : "2x" },
    { "size" : "40x40", "idiom" : "iphone", "filename" : "Icon-40-3x.png", "scale" : "3x" },
    { "size" : "60x60", "idiom" : "iphone", "filename" : "Icon-60-2x.png", "scale" : "2x" },
    { "size" : "60x60", "idiom" : "iphone", "filename" : "Icon-60-3x.png", "scale" : "3x" },
    { "size" : "1024x1024", "idiom" : "ios-marketing", "filename" : "Icon-1024.png", "scale" : "1x" }
  ],
  "info" : { "version" : 1, "author" : "xcode" }
}
EOF

# Splash = AGNT art (replace Capacitor default)
if [[ -d "$SPLASHSET" ]]; then
  for name in splash-2732x2732.png splash-2732x2732-1.png splash-2732x2732-2.png; do
    tmp="$(mktemp /tmp/agnt-splash-XXXXXX.png)"
    sips -s format png -z 2732 2732 "$SRC" --out "$tmp" >/dev/null
    mv -f "$tmp" "$SPLASHSET/$name"
  done
  echo "Splash updated from $(basename "$SRC")"
fi

# Bump build so SpringBoard sees a new version
if [[ -f "$PBX" ]]; then
  VER="$(date +%s)"
  sed -i '' -E "s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = ${VER};/g" "$PBX"
  echo "CURRENT_PROJECT_VERSION → ${VER}"
fi

# Wipe DerivedData so asset catalog recompiles from scratch
DD="$ROOT/mobile/mobile-lite/build/DerivedData"
if [[ -d "$DD" ]]; then
  rm -rf "$DD"
  echo "Cleared mobile-lite DerivedData"
fi

echo "iOS AppIcon updated from $(basename "$SRC")"
echo "NOTE: Delete AGNT Chat from the device/Sim before reinstalling, or icons stay cached."
