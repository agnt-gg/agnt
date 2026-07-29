# AGNT Mobile Lite (iOS)

Thin **Annie chat** client for phones. The native shell is Capacitor (iOS
today). The chat UI and pairing live on your **AGNT server** at `/m`.

| Surface | What it is |
|---------|------------|
| **Web** | Any browser: `http://<host>:3333/m` (no native build) |
| **iOS app** | Capacitor WebView + optional QR camera; Makefile targets below |

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **macOS** | Required for Xcode / Simulator / device |
| **Xcode** + CLT | App Store; `xcodebuild` must work |
| **CocoaPods** | `brew install cocoapods` or `gem install cocoapods` |
| **Node.js 20+** | For Capacitor npm deps |
| **Running AGNT** | Desktop app or `node backend/server.js` with current `frontend/dist` |

**Public npm only** for this package (`registry.npmjs.org`). See `.npmrc` and
`scripts/mobile-lite-npm-install.sh` (no Artifactory).

---

## Make targets (overview)

| Target | When to use | Needs Apple team? |
|--------|-------------|-------------------|
| **`make mobile-lite-ios-init`** | **Once** per machine / after `mobile-lite-clean` | No |
| **`make mobile-lite-ios-sync`** | After shell/config/`www` changes; also run automatically by sim/iphone | No |
| **`make mobile-lite-ios-sim`** | Day-to-day: **build + install + launch Simulator** | No |
| **`make mobile-lite-ios-devices`** | List connected iPhones (IDs for `IOS_DEVICE_UDID`) | No |
| **`make mobile-lite-ios-iphone`** | Day-to-day: **build + install + launch physical iPhone** | **Yes** (`DEVELOPMENT_TEAM`) |
| `make mobile-lite-ios-sim-build` | Build for Simulator only (no install) | No |
| `make mobile-lite-ios-build` | Build only: Sim if no team; device if `DEVELOPMENT_TEAM` set | Device only if team set |
| `make mobile-lite-ios-open` | Optional: open project in Xcode GUI | No |
| `make mobile-lite-configure` | Write Capacitor config only (no sync) | No |
| `make mobile-lite-info` | Show paths / mode | No |
| `make mobile-lite-clean` | Remove `node_modules`, `ios/`, generated config | No |

You do **not** need Xcode’s GUI for sim or device install when using the CLI targets.

---

## One-time setup

From the **repo root**:

```bash
make mobile-lite-ios-init
```

This:

1. Writes Capacitor config (`scripts/mobile-lite-configure.mjs`)
2. Installs npm deps (`scripts/mobile-lite-npm-install.sh` → public npm)
3. Adds the iOS platform if missing (`npx cap add ios`)
4. Patches ATS + **camera** permission for QR scan
5. Copies the Mac AGNT icon into the iOS AppIcon set

Re-run only if you cleaned the project or are on a new machine.

---

## Simulator

### 1. Start AGNT on the Mac

Health check:

```bash
curl -sS http://localhost:3333/api/health
# expect something like {"status":"OK",...}
```

Use the desktop AGNT app, or a local server that serves current `frontend/dist`.

### 2. Build, install, launch Simulator

```bash
make mobile-lite-ios-sim
```

What it does:

- **`mobile-lite-ios-sync`** (config + `cap sync` + icons + ATS)
- **Build** for iOS Simulator
- **Install** and **launch** the app

Default shell mode is **local bootstrap** (in-app Continue / QR / server list),
with suggested host `http://localhost:3333`. The Simulator shares the Mac’s
network, so **localhost / 127.0.0.1** reach AGNT on the same machine.

### 3. Pair (first time)

On **desktop AGNT** (signed in):

1. **Settings → Phone Access**
2. Enable access if needed (LAN for real phones; localhost is enough for Sim)
3. **Generate pairing code**
4. Either:
   - **Scan QR** in the iOS app (**Scan QR code**), or  
   - **Copy** the full link / code and paste → **Continue**

After a successful pair, later launches go straight to **Annie chat** (saved
server). To pick another host: chat drawer → **Switch server…** or open
`/m?setup=1`.

### Optional Simulator flags

```bash
# Prefer a specific simulator device name
IOS_SIM_NAME="iPhone 16" make mobile-lite-ios-sim

# Fixed WebView URL (cold-start loads server /m instead of local www)
AGNT_SERVER_MODE=fixed AGNT_SERVER_URL=http://localhost:3333 make mobile-lite-ios-sim

# Sync only (no build/install)
make mobile-lite-ios-sync
```

### Build Simulator app without launching

```bash
make mobile-lite-ios-sim-build
```

---

## Physical iPhone

### 1. One-time init (if not done)

```bash
make mobile-lite-ios-init
```

### 2. Apple Development Team

```bash
security find-identity -v -p codesigning
```

Or: **Xcode → Settings → Accounts → Team ID** (10 characters).

### 3. List devices (optional)

```bash
make mobile-lite-ios-devices
```

Shows connected iPhone/iPad **Core Device id** and hardware **UDID**. Use either
as `IOS_DEVICE_UDID` if more than one phone is plugged in.

### 4. Build, install, launch on the phone

```bash
DEVELOPMENT_TEAM=XXXXXXXXXX make mobile-lite-ios-iphone
```

Pin a device:

```bash
DEVELOPMENT_TEAM=XXXXXXXXXX \
  IOS_DEVICE_UDID=<id-from-mobile-lite-ios-devices> \
  make mobile-lite-ios-iphone
```

What it does:

- Sync + **device build** + **install** + **launch**  
- Requires a connected, unlocked iPhone that **trusts** this Mac  
- First run: **Settings → General → VPN & Device Management** → trust the developer

### 5. Network + pair on a real phone

| Do | Don’t |
|----|--------|
| Server URL / pair link with Mac **LAN** or **Tailscale** IP | `http://127.0.0.1:3333` (that is the **phone**, not the Mac) |
| Same Wi‑Fi or same Tailscale tailnet as AGNT | Mobile data alone (unless Tailscale/VPN reaches the host) |
| Phone Access **Link** (or QR scan) on Wi‑Fi / Tailscale | `http://127.0.0.1:…` on a real phone |

Example pair URL:

```text
http://192.168.x.x:3333/m/pair?c=<32-hex>
```

### Build device binary without installing

```bash
DEVELOPMENT_TEAM=XXXXXXXXXX make mobile-lite-ios-build
```

Without `DEVELOPMENT_TEAM`, `mobile-lite-ios-build` falls back to a **Simulator**
build and prints a hint.

---

## Target reference (detail)

### `make mobile-lite-ios-init`

**Once per clone/machine.** Creates `mobile/mobile-lite/ios/`, installs Capacitor
deps, patches Info.plist (HTTP cleartext + camera), installs App icon from
`build/icon.png`.

### `make mobile-lite-ios-sync`

Refreshes:

- `capacitor.config.json` / `www/boot-config.json`
- Capacitor copy into the Xcode project (`npx cap sync ios`)
- ATS + camera strings
- App icons from Mac AGNT art

Run after changing shell config or `www/`. Implied by `ios-sim` / `ios-iphone`.

### `make mobile-lite-ios-sim`

Full **Simulator** loop: sync → build → install → launch.  
No Apple Developer team required.

### `make mobile-lite-ios-devices`

Lists connected phones for `IOS_DEVICE_UDID=…`. Safe to run anytime.

### `make mobile-lite-ios-iphone`

Full **device** loop: sync → build (signed) → install → launch.  
**Requires `DEVELOPMENT_TEAM`.**

---

## Pairing (product behavior)

| Item | Detail |
|------|--------|
| QR / link | Full URL: `http://<host>:3333/m/pair?c=<code>` (code in query) |
| Copy | One **Link** row — same network URL as the QR |
| Claim API | `POST /api/pairing/claim` with `{ "code" }` |
| After pair | Session on that host; app opens Annie; host added to **saved servers** |
| QR camera | In-app **Scan QR code** (physical device; Sim may use Mac camera or paste) |

Desktop: **Settings → Phone Access**.

---

## Frontend vs shell rebuild

| You changed… | Rebuild |
|--------------|---------|
| Vue `/m` chat, pairing UI, settings | `cd frontend && npm run build`, **restart AGNT** (serves `frontend/dist`) |
| Capacitor `www/`, config, icons, native project | `make mobile-lite-ios-sim` or `…-iphone` (runs sync) |
| Both | Frontend build + restart AGNT + iOS make target |

The phone UI for Annie is mostly the **server** SPA. The native app is a shell
(bootstrap, camera, icon, deep open).

---

## Environment variables

| Variable | Used by | Meaning |
|----------|---------|---------|
| `DEVELOPMENT_TEAM` | `ios-iphone`, device `ios-build` | Apple Team ID (required for real device) |
| `IOS_DEVELOPMENT_TEAM` | same | Alias for `DEVELOPMENT_TEAM` |
| `IOS_DEVICE_UDID` | `ios-iphone` | Core Device id or hardware UDID |
| `IOS_SIM_NAME` | `ios-sim` | Simulator device name (e.g. `iPhone 16`) |
| `AGNT_SERVER_URL` | configure / sync | Suggested or fixed server origin |
| `AGNT_SERVER_MODE` | configure | `local` (default for sim) or `fixed` |

---

## Layout

```text
mobile/mobile-lite/
  package.json / package-lock.json / .npmrc
  www/                      # local bootstrap (Continue / servers / paste)
  capacitor.config.json     # generated (gitignored)
  ios/                      # generated Xcode project (gitignored)

scripts/
  mobile-lite-configure.mjs
  mobile-lite-npm-install.sh
  mobile-lite-ios-cli.sh
  mobile-lite-ios-patch-ats.sh
  mobile-lite-ios-icons.sh

frontend/src/views/MobileLite/   # /m, /m/pair, /m/chat
frontend/src/services/mobileLite*.js
build/icon.png                   # source for iOS AppIcon (same as Mac)
```

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `npm` 403 / JFrog | Pull latest lock + `.npmrc`; `rm -rf mobile/mobile-lite/node_modules` then `make mobile-lite-ios-init` |
| White screen on Sim | AGNT health OK? Prefer local bootstrap; rebuild `ios-sim` after sync fixes |
| Pair works in browser, not app | Same host? Real phone must not use `127.0.0.1` |
| No provider/model | Pick model once on desktop (saves to account); reopen chat |
| Device signing errors | Valid `DEVELOPMENT_TEAM`; trust computer; trust developer on phone |
| Wrong phone installed | `make mobile-lite-ios-devices` then set `IOS_DEVICE_UDID` |
| App switcher still shows Capacitor “X” icon | iOS **caches icons**. `make mobile-lite-ios-sim` / `…-iphone` now **uninstall then reinstall**. If still wrong: delete the app manually, reboot device/Sim, reinstall. Icons from `build/icon.png` via `scripts/mobile-lite-ios-icons.sh`. |

---

## Quick recipes

```bash
# --- Simulator ---
make mobile-lite-ios-init          # once
# start AGNT on Mac (port 3333)
make mobile-lite-ios-sim
# pair via QR or paste from Phone Access

# --- Physical iPhone ---
make mobile-lite-ios-init          # once
make mobile-lite-ios-devices       # optional
DEVELOPMENT_TEAM=XXXXXXXXXX make mobile-lite-ios-iphone
# pair with Network link / QR (LAN or Tailscale of the Mac)
```
