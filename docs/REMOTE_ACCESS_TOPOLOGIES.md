# Remote access: where your backend lives, and how devices reach it

AGNT has two features that compose:

- **Phone Access** — pair a phone by scanning a QR code (Settings → Configuration → Phone Access)
- **Connection** — point the desktop app at a backend running somewhere else (Settings → Configuration → Connection)

Together they cover six deployments. **Five need no configuration at all.**

The reason it works everywhere is one rule:

> The pairing QR encodes **the address you used to reach the server** — not an
> address the server guesses about itself.

If your desktop just reached the backend at `https://agnt.example.com`, that is
what your phone gets. If you reached it over Tailscale, your phone gets the
tailnet address. Nothing to configure, because the working address has already
been demonstrated by the request asking for the code.

---

## Pick your setup

| # | Where the backend runs | How you reach it | Config needed |
|---|------------------------|------------------|---------------|
| 1 | Your own desktop | Same Wi-Fi | none |
| 2 | A home server / NAS | Same Wi-Fi or LAN | none |
| 3 | A home server, you are elsewhere | Via the remote-backend setting | none |
| 4 | Anywhere, over **Tailscale/VPN** | Tailnet address | none |
| 5 | A VPS behind **nginx/Caddy + HTTPS** | Public hostname | 1–2 settings |
| 6 | A machine on several networks at once | You choose | none |

---

## 1. Desktop is the server

The default. Nothing is running anywhere else.

1. Settings → Configuration → **Phone Access** → toggle on
2. **Restart the backend** when prompted
3. **Generate pairing code**, scan with your phone

The panel names the Wi-Fi network your phone must join, and tells you whether
anything has actually reached the server yet — so a phone on mobile data is
distinguishable from a broken server.

---

## 2. Home server, everyone on the LAN

One always-on backend; desktops, phones and browsers all talk to it.

**On the server:** enable Phone Access (or set `BIND_HOST=0.0.0.0`), restart.

**On each desktop:** Settings → Configuration → **Connection** → *Remote backend*
→ `http://<server-ip>:3333`, then fully quit and relaunch the app.

**On phones:** browse to `http://<server-ip>:3333`, or pair by QR.

In remote mode the desktop app starts **no backend of its own** — it loads the UI
from the server it talks to. Same origin, so there is no second login, no CORS
configuration, and no version skew between UI and API.

---

## 3. Administer the server while you are away from it

This is the combination the two features unlock together.

Your laptop is connected to the home server (as in #2), but you are at a café.
Open Settings → Phone Access and you are looking at **the server's** access
state: its network interfaces, its bind address, whether anything external has
reached it, and codes that are valid on it.

So you can onboard a phone to a machine you are not sitting next to.

The phone receives **the token of whoever generated the code**, so it gets
exactly your laptop's capabilities and nothing more.

> **Limit worth knowing:** a desktop in remote mode runs no local backend, so it
> cannot pair a phone to *itself*. It pairs phones to the server it is pointed
> at — which is the useful direction anyway.

---

## 4. Tailscale / VPN — private access from anywhere

Best option for "full AGNT on my phone, anywhere, without exposing anything to
the internet". No port forwarding, no certificates, no open inbound ports.

1. Install Tailscale on the server and on your phone; sign both into the same
   tailnet
2. On the server: enable Phone Access (or `BIND_HOST=0.0.0.0`) and restart
3. Find the server's tailnet address — `tailscale ip -4`, e.g. `100.101.102.103`
4. From any device on the tailnet, open `http://100.101.102.103:3333`

Generate a pairing code and the QR encodes the **`100.x`** address. The panel
also changes its wording: it asks for *"the same VPN or tailnet"* rather than
*"the same Wi-Fi"*, because sending someone to check their Wi-Fi when the
address is a tailnet address wastes time on a network that was never involved.

`BIND_HOST=0.0.0.0` binds the tailnet interface **and** the LAN interface. On an
untrusted network, use your OS firewall to allow port 3333 only on the Tailscale
interface.

---

## 5. Public hostname behind a reverse proxy

For a VPS reachable over HTTPS.

Keep AGNT bound to loopback — that is the correct configuration behind a proxy —
and let nginx/Caddy terminate TLS. The example config in
[SELF_HOSTING.md](SELF_HOSTING.md#reverse-proxy-configuration) already forwards
everything pairing needs, so QR codes will encode `https://agnt.example.com`
rather than a container-internal IP.

Two settings, each for one specific situation:

| Situation | Setting |
|---|---|
| The proxy is **not on the same machine** (e.g. a sibling container in `docker-compose`) | `TRUST_PROXY=private` |
| The public address is a **tunnel or CNAME** the proxy does not forward (split-horizon DNS, Cloudflare Tunnel) | `PUBLIC_ORIGIN=https://agnt.example.com` |

`X-Forwarded-*` headers are only trusted from loopback by default, because those
headers decide where a pairing code is sent and anyone able to reach the port can
invent them.

---

## 6. A machine on several networks at once

Wi-Fi plus a VPN, or several interfaces. The server can enumerate its candidate
addresses but cannot know which one **your phone** has a route to.

So it lists them. Pick one and the QR re-renders instantly.

The same code works from any of them — it lives in the server's memory keyed only
by itself, with no origin attached. That is what makes offering the choice honest
rather than decorative.

---

## Troubleshooting

**"Restart required" keeps showing.** The toggle writes a config file; the open
socket does not move until the process restarts. Until then the QR would encode
an address nothing is listening on, so pairing refuses rather than handing you a
valid code on a dead URL.

**The phone scans but the page never loads.** Look at the witness line under the
QR. *"Nothing has reached this server yet"* means the phone never arrived — wrong
network, AP client isolation, or a firewall. Anything else means it arrived and
something later went wrong, which is a different investigation.

**"This server is only listening on localhost."** Phone Access is off, or the
backend has not been restarted since you turned it on. Behind a reverse proxy
this message will *not* appear: a live proxied request proves something external
can reach the server, whatever interface it bound.

**The desktop app shows an empty AGNT.** It is still on its own local backend.
Check Settings → Configuration → Connection, and relaunch the app fully — the
connection is read once at startup.

---

## Related

- [Self-Hosting Guide](SELF_HOSTING.md) — environment variables, reverse proxy, Docker
- [Hybrid Mode](QUICKSTART_HYBRID.md) — mixing desktop apps, browsers and a shared backend
- [API Documentation](_API-DOCUMENTATION.md#pairing-routes) — the pairing protocol and origin-resolution rules
