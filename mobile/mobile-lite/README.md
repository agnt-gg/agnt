# AGNT Mobile Lite

**Platform-agnostic** Annie chat for phones:

| Surface | Platforms |
|---------|-----------|
| Web UI `/m`, `/m/pair`, `/m/chat` | Any browser (iOS Safari, Android Chrome, desktop) |
| Capacitor shell in this folder | **iOS** targets below; Android later (`cap add android`) |

Server address is set **in the app** (saved on device) and/or carried by the
pair link — not required at Makefile build time.

## Browser (no native build)

```text
http://<host>:3333/m
http://<host>:3333/m/pair?c=<code>
```

Works on iPhone and Android. Pair via desktop **Settings → Phone Access**.

## npm (public registry only)

This package uses **registry.npmjs.org** only (see `.npmrc`). Do not point
`mobile/mobile-lite` at Artifactory/JFrog. `make mobile-lite-ios-init` runs
`scripts/mobile-lite-npm-install.sh`, which rewrites any accidental JFrog
`resolved` URLs in `package-lock.json` and installs via the public registry.

If install still hits a corporate mirror, clear the local npm cache for this
folder and retry:

```bash
cd mobile/mobile-lite
rm -rf node_modules
npm cache clean --force   # optional
cd ../..
make mobile-lite-ios-init
```

## Capacitor iOS (optional native shell)

Requires macOS, **Xcode installed** (for `xcodebuild` / SDK), CocoaPods, Node 20+.
You do **not** need to open the Xcode GUI.

### Simulator (CLI)

```bash
make mobile-lite-ios-init    # once
make mobile-lite-ios-sim     # defaults AGNT_SERVER_URL=http://127.0.0.1:3333
```

Override host if needed: `AGNT_SERVER_URL=http://192.168.x.x:3333 make mobile-lite-ios-sim`  
In-app Server URL UI only: `AGNT_SERVER_MODE=local make mobile-lite-ios-sim`

### Physical iPhone (CLI)

```bash
# Apple Team ID (10 chars) — once you know it:
#   security find-identity -v -p codesigning
make mobile-lite-ios-init    # once
DEVELOPMENT_TEAM=XXXXXXXXXX make mobile-lite-ios-iphone
```

In the app: set **Server URL** to your Mac’s LAN/Tailscale IP (not `127.0.0.1` on a real phone), pair, chat.

Optional: `IOS_SIM_NAME="iPhone 16"`, `IOS_DEVICE_UDID=…`

| Target | Purpose |
|--------|---------|
| `mobile-lite-ios-init` | One-time Capacitor + iOS platform |
| `mobile-lite-ios-sync` | Refresh config/www into iOS project |
| `mobile-lite-ios-sim` | **Build + install + launch Simulator (no Xcode GUI)** |
| `mobile-lite-ios-iphone` | **Build + install + launch device (no Xcode GUI)** |
| `mobile-lite-ios-build` | Build only: **Simulator** if no `DEVELOPMENT_TEAM`; **device** if team is set |
| `mobile-lite-ios-sim-build` | Simulator build only (never needs a team) |
| `mobile-lite-ios-open` | Optional: open Xcode GUI |
| `mobile-lite-configure` | Config files only |
| `mobile-lite-info` / `clean` | Status / wipe |

## Layout

```
mobile/mobile-lite/     Capacitor project (shared shell assets)
  www/                  Bootstrap when no fixed server.url
  ios/                  Generated (gitignored)

frontend/src/views/MobileLite/   Vue routes /m/*
frontend/src/services/mobileLite*.js
```

## Pairing

- Full web: `/pair`
- Mobile lite: `/m/pair` (`liteUrl` on mint)
- Claim: `POST /api/pairing/claim` (code only; host from the link)
