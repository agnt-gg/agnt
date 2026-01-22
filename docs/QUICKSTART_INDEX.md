# AGNT Quick Start Guides

Choose your installation method and get AGNT running in under 5 minutes.

## 🚀 Choose Your Quick Start Guide

### 🐳 Docker Installations (Server/Multi-Device)

| Guide | Size | Browser | Best For |
|-------|------|---------|----------|
| **[Docker Full](QUICKSTART_DOCKER_FULL.md)** | ~1.5GB | ✅ Yes | Multi-device + browser automation |
| **[Docker Lite](QUICKSTART_DOCKER_LITE.md)** | ~715MB | ❌ No | Multi-device, lightweight |

### 💻 Electron Installations (Desktop Apps)

| Guide | Size | Browser | Best For |
|-------|------|---------|----------|
| **[Electron Full](QUICKSTART_ELECTRON_FULL.md)** | ~150-200MB | ✅ Yes | Single device + browser automation |
| **[Electron Lite](QUICKSTART_ELECTRON_LITE.md)** | ~80-120MB | ❌ No | Single device, lightweight |

### 🔀 Hybrid Mode (Best of Both Worlds)

| Guide | Components | Best For |
|-------|------------|----------|
| **[Hybrid Mode](QUICKSTART_HYBRID.md)** | Docker + Electron + Web | Mix native apps + browser + shared backend |

---

## 🤔 Which Guide Should I Use?

### Start Here: Answer These Questions

**Question 1: How many devices will you use?**
- ☑️ **Multiple devices** (phone, laptop, tablet) → Use Docker guides
- ☑️ **Just one device** → Use Electron guides

**Question 2: Will you share with others?**
- ☑️ **Yes** (family/team 2-10 people) → Use Docker or Hybrid
- ☑️ **No** (just me) → Use Electron

**Question 3: Do you need browser automation?**
- ☑️ **Yes** (web scraping, screenshots) → Use Full version
- ☑️ **No** → Use Lite version (smaller, faster)

**Question 4: Do you want native desktop app + shared data?**
- ☑️ **Yes** → Use Hybrid Mode
- ☑️ **No** → Use Docker (browser only) or Electron (single device)

---

## 📋 Quick Decision Matrix

### Scenario 1: Just Me, One Computer
→ **[Electron Full](QUICKSTART_ELECTRON_FULL.md)** or **[Electron Lite](QUICKSTART_ELECTRON_LITE.md)**

### Scenario 2: Just Me, Multiple Devices
→ **[Docker Full](QUICKSTART_DOCKER_FULL.md)** or **[Docker Lite](QUICKSTART_DOCKER_LITE.md)**

### Scenario 3: Family/Team (Browser Access Only)
→ **[Docker Full](QUICKSTART_DOCKER_FULL.md)** or **[Docker Lite](QUICKSTART_DOCKER_LITE.md)**

### Scenario 4: Family/Team (Some Want Native Apps)
→ **[Hybrid Mode](QUICKSTART_HYBRID.md)**

### Scenario 5: Remote Team with Central Server
→ **[Hybrid Mode](QUICKSTART_HYBRID.md)**

---

## 📖 What's In Each Guide?

All quickstart guides include:

- ✅ **Prerequisites** - What you need before starting
- ✅ **Installation** - Step-by-step setup (3 options each)
- ✅ **First Steps** - Getting started after install
- ✅ **Common Commands** - Daily operations
- ✅ **Data Location** - Where your data is stored
- ✅ **Features Available** - What works in this mode
- ✅ **Troubleshooting** - Common issues and fixes
- ✅ **Next Steps** - Where to go from here

**Average time to complete:** 5-10 minutes

---

## 🔄 Can I Switch Later?

**Yes!** You can switch between installation methods:

### Docker Full ↔️ Docker Lite
```bash
# Stop current container
docker stop agnt

# Start other variant (uses same data)
docker-compose -f docker-compose.lite.yml up -d
```

### Electron Full → Electron Lite
1. Uninstall Electron Full
2. Install Electron Lite
3. Data location is the same (preserved)

### Electron → Docker (or vice versa)
1. Export your data
2. Install other variant
3. Import data

See [Migration Guide](MIGRATION_GUIDE.md) for details.

---

## 📚 Other Documentation

After completing your quickstart:

- **[User Guide](USER_GUIDE.md)** - How to use AGNT
- **[Self-Hosting Guide](SELF_HOSTING.md)** - Advanced configuration
- **[Plugin Development](../backend/plugins/README.md)** - Create plugins
- **[API Documentation](_API-DOCUMENTATION.md)** - REST API reference
- **[Lite Mode Guide](LITE_MODE.md)** - Understanding Lite mode
- **[Electron vs Web](ELECTRON_VS_WEB.md)** - Desktop vs Docker

---

## 🆘 Need Help?

- **Issues**: [GitHub Issues](https://github.com/agnt-gg/agnt/issues)
- **Discord**: [Join community](https://discord.gg/agnt)
- **Website**: [agnt.gg](https://agnt.gg)

---

## 🎯 Quick Links

**Download Pre-built Installers:**
- [agnt.gg/downloads](https://agnt.gg/downloads)

**GitHub Repository:**
- [github.com/agnt-gg/agnt](https://github.com/agnt-gg/agnt)

**Docker Hub:**
- [hub.docker.com/r/agnt/agnt](https://hub.docker.com/r/agnt/agnt)

---

**Ready to start?** Choose your guide above and get AGNT running in 5 minutes! 🚀
