# AGNT Docker Build & Deploy Makefile
# One Docker image, one desktop installer per platform.

# Configuration
VERSION := $(shell node -p "require('./package.json').version")
GITHUB_ORG ?= agnt-gg
IMAGE_NAME := agnt
FULL_IMAGE := ghcr.io/$(GITHUB_ORG)/$(IMAGE_NAME)

# Mobile lite (Capacitor shell + web /m — iOS and future Android).
# NOTE: "mobile-lite" is unrelated to the former AGNT Lite build variant. It is
# the Annie chat shell served at /m and wrapped by Capacitor. It stays.
# Default: local www bootstrap — paste a pair *link* (host is in the URL: LAN/Tailscale).
# Optional pin for simulator / fixed host:
#   make mobile-lite-ios-sync AGNT_SERVER_URL=http://127.0.0.1:3333
#   AGNT_SERVER_MODE=local|fixed  (fixed is implied when AGNT_SERVER_URL is set)
AGNT_SERVER_URL ?=
AGNT_SERVER_MODE ?=
MOBILE_LITE_DIR := mobile/mobile-lite
MOBILE_LITE_IOS_WORKSPACE := $(MOBILE_LITE_DIR)/ios/App/App.xcworkspace

# Data directory - $(HOME) is inherited from shell environment
AGNT_DATA_HOME := $(HOME)

# Image tags
FULL_TAG_LATEST := $(FULL_IMAGE):latest
FULL_TAG_VERSION := $(FULL_IMAGE):$(VERSION)

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

.PHONY: help
help: ## Show this help message
	@echo "$(BLUE)AGNT Build & Deploy Makefile$(NC)"
	@echo "$(YELLOW)Version: $(VERSION)$(NC)"
	@echo ""
	@echo "$(GREEN)Available targets:$(NC)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-30s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Artifacts:$(NC)"
	@echo "  $(YELLOW)Docker$(NC)     - Container image (with Chromium) - Port 3333"
	@echo "  $(YELLOW)Electron$(NC)   - Desktop installer (Windows / macOS / Linux)"
	@echo "  $(YELLOW)Mobile Lite$(NC) - Annie chat shell (/m); browser or Capacitor (iOS today)"
	@echo ""
	@echo "$(GREEN)Quick Start:$(NC)"
	@echo "  $(BLUE)Docker:$(NC)"
	@echo "    make build                       # Build the Docker image"
	@echo "    make run                         # Run the Docker image"
	@echo "    make update                      # Update from GHCR and restart"
	@echo "    make update-local                # Rebuild from source and restart"
	@echo "  $(BLUE)Electron:$(NC)"
	@echo "    make electron-build              # Build the desktop installer"
	@echo "    make electron-info               # Show Electron build info"
	@echo "  $(BLUE)Mobile lite (Annie chat):$(NC)"
	@echo "    Browser: open http://<host>:3333/m  (no make required)"
	@echo "    make mobile-lite-ios-init        # One-time Capacitor + iOS platform"
	@echo "    make mobile-lite-ios-sim         # Simulator → http://127.0.0.1:3333 by default"
	@echo "    make mobile-lite-ios-devices     # List iPhone Core Device id + hardware UDID"
	@echo "    DEVELOPMENT_TEAM=XXX make mobile-lite-ios-iphone  # Device (CLI, no 127.0.0.1 default)"
	@echo ""
	@echo "$(GREEN)Configuration:$(NC)"
	@echo "  GitHub Org: $(GITHUB_ORG)"
	@echo "  Image:      $(FULL_TAG_LATEST)"
	@echo "  Mobile server:  $(if $(AGNT_SERVER_URL),$(AGNT_SERVER_URL),(none — pair link provides host))"

# ============================================================================
# BUILD TARGETS - Build the image from scratch
# ============================================================================

.PHONY: build
build: ## Build the AGNT image from scratch
	@echo "$(BLUE)Building AGNT image...$(NC)"
	docker build \
		-f Dockerfile \
		-t $(FULL_TAG_LATEST) \
		-t $(FULL_TAG_VERSION) \
		--build-arg BUILD_DATE=$(shell date -u +'%Y-%m-%dT%H:%M:%SZ') \
		--build-arg VERSION=$(VERSION) \
		.
	@echo "$(GREEN)✓ Image built successfully$(NC)"
	@echo "  Tags: $(FULL_TAG_LATEST), $(FULL_TAG_VERSION)"

.PHONY: build-multiarch
build-multiarch: ## Build the image for multiple platforms (amd64, arm64)
	@echo "$(BLUE)Building multi-architecture image...$(NC)"
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-f Dockerfile \
		-t $(FULL_TAG_LATEST) \
		-t $(FULL_TAG_VERSION) \
		--build-arg BUILD_DATE=$(shell date -u +'%Y-%m-%dT%H:%M:%SZ') \
		--build-arg VERSION=$(VERSION) \
		--push \
		.
	@echo "$(GREEN)✓ Multi-arch image built and pushed$(NC)"

# ============================================================================
# PULL / PUSH TARGETS
# ============================================================================

.PHONY: pull
pull: ## Pull the image from GHCR
	@echo "$(BLUE)Pulling AGNT image from GHCR...$(NC)"
	docker pull $(FULL_TAG_LATEST)
	@echo "$(GREEN)✓ Image pulled successfully$(NC)"

.PHONY: pull-version
pull-version: ## Pull a specific version of the image
	@echo "$(BLUE)Pulling AGNT image v$(VERSION) from GHCR...$(NC)"
	docker pull $(FULL_TAG_VERSION)
	@echo "$(GREEN)✓ Image v$(VERSION) pulled successfully$(NC)"

.PHONY: push
push: ## Push the image to GHCR
	@echo "$(BLUE)Pushing AGNT image to GHCR...$(NC)"
	docker push $(FULL_TAG_LATEST)
	docker push $(FULL_TAG_VERSION)
	@echo "$(GREEN)✓ Image pushed successfully$(NC)"

# ============================================================================
# RUN TARGETS - Start containers
# ============================================================================

.PHONY: run
run: setup-dirs ## Run the image with docker-compose
	@echo "$(BLUE)Starting AGNT...$(NC)"
	AGNT_HOME=$(AGNT_DATA_HOME) docker-compose up -d
	@echo "$(GREEN)✓ AGNT is running at http://localhost:3333$(NC)"
	@echo "$(YELLOW)View logs: make logs$(NC)"

.PHONY: run-local
run-local: build run ## Build and run the image locally

.PHONY: run-remote
run-remote: pull setup-dirs ## Pull and run the image from GHCR
	@echo "$(BLUE)Starting AGNT (from GHCR)...$(NC)"
	AGNT_HOME=$(AGNT_DATA_HOME) docker-compose up -d
	@echo "$(GREEN)✓ AGNT is running at http://localhost:3333$(NC)"

.PHONY: setup-dirs
setup-dirs: ## Create ~/.agnt directory structure for persistent data
	@echo "$(BLUE)Setting up ~/.agnt directory structure...$(NC)"
	@mkdir -p $(AGNT_DATA_HOME)/.agnt/data \
		$(AGNT_DATA_HOME)/.agnt/plugins/installed \
		$(AGNT_DATA_HOME)/.agnt/plugins/builds \
		$(AGNT_DATA_HOME)/.agnt/logs
	@chmod -R 777 $(AGNT_DATA_HOME)/.agnt
	@echo "$(GREEN)✓ Directory structure created at ~/.agnt$(NC)"
	@echo "$(YELLOW)  Data will be stored in $(AGNT_DATA_HOME)/.agnt/data/$(NC)"

# ============================================================================
# MANAGEMENT TARGETS - Stop, restart, logs
# ============================================================================

.PHONY: stop
stop: ## Stop all running containers
	@echo "$(YELLOW)Checkpointing WAL database (if running)...$(NC)"
	@docker exec agnt sqlite3 /app/data/agnt.db "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
	@echo "$(YELLOW)Stopping AGNT containers...$(NC)"
	-AGNT_HOME=$(AGNT_DATA_HOME) docker-compose down 2>/dev/null
	@echo "$(GREEN)✓ Containers stopped$(NC)"

.PHONY: restart
restart: stop run ## Restart the image

# ============================================================================
# UPDATE TARGETS - Stop, pull-or-build, restart (with WAL checkpoint)
# ============================================================================
# Why these exist: `docker-compose down && docker-compose up -d` does NOT
# update the image. Compose reuses the cached tag unless told to pull or
# rebuild. These targets do the right thing end-to-end.
#
# - update         : pull latest from GHCR, for registry installs
# - update-local   : rebuild from local Dockerfile, for source installs
#
# After an update, old images become dangling. To reclaim disk:
#   docker image prune -f

.PHONY: update
update: stop pull run ## Update the image from GHCR and restart (registry install)
	@echo "$(GREEN)✓ AGNT updated to latest from GHCR$(NC)"
	@echo "$(YELLOW)  Reclaim disk from old image: docker image prune -f$(NC)"

.PHONY: update-local
update-local: stop build run ## Rebuild the image from source and restart (after git pull)
	@echo "$(GREEN)✓ AGNT rebuilt from source and restarted$(NC)"
	@echo "$(YELLOW)  Reclaim disk from old image: docker image prune -f$(NC)"

.PHONY: logs
logs: ## Show logs for the container
	docker-compose logs -f

.PHONY: status
status: ## Show status of running containers
	@echo "$(BLUE)AGNT Container Status:$(NC)"
	@docker ps -a --filter "name=agnt" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"

.PHONY: shell
shell: ## Open shell in the running container
	docker exec -it agnt /bin/sh

# ============================================================================
# CLEANUP TARGETS
# ============================================================================

.PHONY: clean
clean: stop ## Stop containers and remove images
	@echo "$(YELLOW)Removing AGNT images...$(NC)"
	-docker rmi $(FULL_TAG_LATEST) $(FULL_TAG_VERSION) 2>/dev/null || true
	@echo "$(GREEN)✓ Images removed$(NC)"

.PHONY: clean-volumes
clean-volumes: ## Remove all persistent volumes (WARNING: destroys data!)
	@echo "$(RED)WARNING: This will delete all AGNT data, plugins, and logs!$(NC)"
	@echo "$(YELLOW)Press Ctrl+C to cancel, or Enter to continue...$(NC)"
	@read -r
	-AGNT_HOME=$(AGNT_DATA_HOME) docker-compose down -v 2>/dev/null
	@echo "$(GREEN)✓ Volumes removed$(NC)"

.PHONY: prune
prune: ## Remove all unused Docker resources
	@echo "$(YELLOW)Pruning unused Docker resources...$(NC)"
	docker system prune -a -f
	@echo "$(GREEN)✓ Prune complete$(NC)"

# ============================================================================
# UTILITY TARGETS
# ============================================================================

.PHONY: info
info: ## Show build information
	@echo "$(BLUE)AGNT Build Information$(NC)"
	@echo "$(YELLOW)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(NC)"
	@echo "  Version:          $(VERSION)"
	@echo "  GitHub Org:       $(GITHUB_ORG)"
	@echo ""
	@echo "$(BLUE)Docker Image:$(NC)"
	@echo "  Latest Tag:       $(FULL_TAG_LATEST)"
	@echo "  Version Tag:      $(FULL_TAG_VERSION)"
	@echo ""
	@echo "$(BLUE)Dockerfile:$(NC)"
	@ls -lh Dockerfile 2>/dev/null || echo "  $(RED)Dockerfile not found$(NC)"

.PHONY: version
version: ## Show current version
	@echo "$(VERSION)"

.PHONY: inspect
inspect: ## Inspect image details
	@docker images $(FULL_IMAGE) --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"
	@echo ""
	@docker inspect $(FULL_TAG_LATEST) | grep -A 5 "Config"

.PHONY: test-image
test-image: ## Test image health
	@echo "$(BLUE)Testing image health...$(NC)"
	@docker run --rm $(FULL_TAG_LATEST) node -e "console.log('✓ Image test passed')"

# ============================================================================
# DEVELOPMENT TARGETS
# ============================================================================

.PHONY: dev-setup
dev-setup: ## Setup development environment
	@echo "$(BLUE)Setting up development environment...$(NC)"
	npm install
	cd frontend && npm install
	@echo "$(GREEN)✓ Development environment ready$(NC)"

.PHONY: build-frontend
build-frontend: ## Build frontend for production
	@echo "$(BLUE)Building frontend...$(NC)"
	cd frontend && npm run build
	@echo "$(GREEN)✓ Frontend built successfully$(NC)"

# ============================================================================
# ELECTRON BUILD TARGETS - Desktop installers
# ============================================================================

.PHONY: electron-build
electron-build: build-frontend ## Build the desktop installer for the current platform
	@echo "$(BLUE)Building Electron for current platform...$(NC)"
	npm run build
	@echo "$(GREEN)✓ Electron build complete$(NC)"
	@echo "  Output: dist/AGNT-$(VERSION)-*"

.PHONY: electron-build-win
electron-build-win: build-frontend ## Build the desktop installer for Windows
	@echo "$(BLUE)Building Electron for Windows...$(NC)"
	npm run build:win
	@echo "$(GREEN)✓ Windows build complete$(NC)"

.PHONY: electron-build-mac
electron-build-mac: build-frontend ## Build the desktop installer for macOS (x64 + ARM64)
	@echo "$(BLUE)Building Electron for macOS...$(NC)"
	npm run build:mac
	@echo "$(GREEN)✓ macOS build complete$(NC)"

.PHONY: electron-build-linux
electron-build-linux: build-frontend ## Build the desktop installer for Linux (AppImage, DEB, RPM)
	@echo "$(BLUE)Building Electron for Linux...$(NC)"
	npm run build:linux
	@echo "$(GREEN)✓ Linux build complete$(NC)"

.PHONY: electron-build-all
electron-build-all: build-frontend ## Build the desktop installer for all platforms
	@echo "$(BLUE)Building Electron for all platforms...$(NC)"
	npm run build:all
	@echo "$(GREEN)✓ All platform builds complete$(NC)"

.PHONY: electron-info
electron-info: ## Show Electron build information
	@echo "$(BLUE)Electron Build$(NC)"
	@echo "$(YELLOW)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(NC)"
	@echo ""
	@echo "$(BLUE)Desktop installer:$(NC)"
	@echo "  ✓ All features including browser automation"
	@echo "  ✓ Puppeteer web scraping"
	@echo "  ✓ Screenshot capture"
	@echo "  ✓ HTML to PDF conversion"
	@echo ""
	@echo "$(GREEN)Build Commands:$(NC)"
	@echo "  make electron-build          - Current platform"
	@echo "  make electron-build-win      - Windows"
	@echo "  make electron-build-mac      - macOS"
	@echo "  make electron-build-linux    - Linux"
	@echo "  make electron-build-all      - All platforms"

# ============================================================================
# MOBILE LITE — Annie chat (/m) + optional Capacitor shell (iOS; Android later)
# ============================================================================
# Web UI is platform-agnostic (browser/PWA on iOS and Android). Capacitor wraps
# the same /m surface. Pairing: /api/pairing/claim; chat: /orchestrator/chat.
#
# UNRELATED to the former AGNT Lite build variant. This is a distinct product
# surface and stays.
#
# Docs: mobile/mobile-lite/README.md

.PHONY: mobile-lite-configure
mobile-lite-configure: ## Write Capacitor config (pair link supplies host; optional AGNT_SERVER_URL pin)
	@echo "$(BLUE)Configuring mobile lite$(if $(AGNT_SERVER_URL), → $(AGNT_SERVER_URL), (local bootstrap; paste pair link))$(NC)"
	@AGNT_SERVER_URL="$(AGNT_SERVER_URL)" AGNT_SERVER_MODE="$(AGNT_SERVER_MODE)" node scripts/mobile-lite-configure.mjs

.PHONY: mobile-lite-ios-init
mobile-lite-ios-init: mobile-lite-configure ## One-time: Capacitor deps + iOS platform (macOS/Xcode)
	@echo "$(BLUE)Initializing mobile lite (iOS / Capacitor)...$(NC)"
	@if [ "$$(uname -s)" != "Darwin" ]; then \
		echo "$(RED)Native iOS platform requires macOS + Xcode (web /m works anywhere)$(NC)"; exit 1; \
	fi
	@command -v xcodebuild >/dev/null 2>&1 || { \
		echo "$(RED)xcodebuild not found. Install Xcode from the App Store.$(NC)"; exit 1; \
	}
	@command -v pod >/dev/null 2>&1 || { \
		echo "$(YELLOW)CocoaPods (pod) not found. Install with:$(NC)"; \
		echo "  sudo gem install cocoapods"; \
		echo "  or: brew install cocoapods"; \
		exit 1; \
	}
	@chmod +x scripts/mobile-lite-npm-install.sh
	@./scripts/mobile-lite-npm-install.sh
	@if [ ! -d "$(MOBILE_LITE_DIR)/ios" ]; then \
		echo "$(BLUE)Adding Capacitor iOS platform...$(NC)"; \
		cd $(MOBILE_LITE_DIR) && npx cap add ios; \
	else \
		echo "$(YELLOW)ios/ already present — running sync only$(NC)"; \
		cd $(MOBILE_LITE_DIR) && npx cap sync ios; \
	fi
	@chmod +x scripts/mobile-lite-ios-patch-ats.sh scripts/mobile-lite-ios-icons.sh
	@./scripts/mobile-lite-ios-patch-ats.sh
	@./scripts/mobile-lite-ios-icons.sh
	@echo "$(GREEN)✓ mobile lite iOS initialized$(NC)"
	@echo "  Browser:  http://<host>:3333/m  (no native build)"
	@echo "  Simulator: make mobile-lite-ios-sim  (defaults to http://127.0.0.1:3333)"
	@echo "  iPhone:    DEVELOPMENT_TEAM=… make mobile-lite-ios-iphone"

.PHONY: mobile-lite-ios-sync
mobile-lite-ios-sync: mobile-lite-configure ## Sync Capacitor config into the iOS project
	@echo "$(BLUE)Syncing mobile lite (iOS)...$(NC)"
	@if [ ! -d "$(MOBILE_LITE_DIR)/node_modules" ]; then \
		echo "$(YELLOW)node_modules missing — running mobile-lite-ios-init first$(NC)"; \
		$(MAKE) mobile-lite-ios-init AGNT_SERVER_URL="$(AGNT_SERVER_URL)" AGNT_SERVER_MODE="$(AGNT_SERVER_MODE)"; \
	fi
	@if [ ! -d "$(MOBILE_LITE_DIR)/ios" ]; then \
		echo "$(YELLOW)ios/ missing — running mobile-lite-ios-init first$(NC)"; \
		$(MAKE) mobile-lite-ios-init AGNT_SERVER_URL="$(AGNT_SERVER_URL)" AGNT_SERVER_MODE="$(AGNT_SERVER_MODE)"; \
	else \
		(cd $(MOBILE_LITE_DIR) && npx cap sync ios); \
		chmod +x scripts/mobile-lite-ios-patch-ats.sh scripts/mobile-lite-ios-icons.sh; \
		./scripts/mobile-lite-ios-patch-ats.sh; \
		./scripts/mobile-lite-ios-icons.sh; \
	fi
	@if [ -n "$(AGNT_SERVER_URL)" ]; then \
		echo "$(GREEN)✓ mobile lite iOS synced → $(AGNT_SERVER_URL)/m (fixed)$(NC)"; \
	else \
		echo "$(GREEN)✓ mobile lite iOS synced (local bootstrap; paste pair link for host)$(NC)"; \
	fi

.PHONY: mobile-lite-ios-open
mobile-lite-ios-open: ## Optional: open the project in Xcode GUI
	@if [ ! -d "$(MOBILE_LITE_DIR)/ios" ]; then \
		echo "$(RED)No ios/ project. Run: make mobile-lite-ios-init$(NC)"; exit 1; \
	fi
	@echo "$(BLUE)Opening Xcode...$(NC)"
	@cd $(MOBILE_LITE_DIR) && npx cap open ios
	@echo "$(GREEN)Prefer CLI: make mobile-lite-ios-sim  or  DEVELOPMENT_TEAM=… make mobile-lite-ios-iphone$(NC)"

# Simulator: default to *local bootstrap* (bundled www) with suggested host
# localhost:3333. Fixed remote server.url was painting a blank/white WKWebView
# when the load failed or the invalid ios.scheme broke navigation.
# Override fixed pin:  AGNT_SERVER_MODE=fixed AGNT_SERVER_URL=http://localhost:3333 make mobile-lite-ios-sim
.PHONY: mobile-lite-ios-sim-build
mobile-lite-ios-sim-build: ## Build for Simulator only (CLI, no install)
	@url="$(AGNT_SERVER_URL)"; \
	mode="$(AGNT_SERVER_MODE)"; \
	if [ -z "$$url" ]; then url="http://localhost:3333"; fi; \
	if [ -z "$$mode" ]; then mode="local"; fi; \
	echo "$(BLUE)Simulator build → mode=$$mode url=$$url$(NC)"; \
	$(MAKE) mobile-lite-ios-sync AGNT_SERVER_URL="$$url" AGNT_SERVER_MODE="$$mode"; \
	chmod +x scripts/mobile-lite-ios-cli.sh; \
	./scripts/mobile-lite-ios-cli.sh sim-build

.PHONY: mobile-lite-ios-sim
mobile-lite-ios-sim: ## Build + install + launch Simulator (local bootstrap; suggests localhost:3333)
	@url="$(AGNT_SERVER_URL)"; \
	mode="$(AGNT_SERVER_MODE)"; \
	if [ -z "$$url" ]; then url="http://localhost:3333"; fi; \
	if [ -z "$$mode" ]; then mode="local"; fi; \
	echo "$(BLUE)Simulator run → mode=$$mode url=$$url$(NC)"; \
	echo "$(YELLOW)Ensure AGNT is running: curl http://localhost:3333/api/health$(NC)"; \
	$(MAKE) mobile-lite-ios-sync AGNT_SERVER_URL="$$url" AGNT_SERVER_MODE="$$mode"; \
	chmod +x scripts/mobile-lite-ios-cli.sh; \
	./scripts/mobile-lite-ios-cli.sh sim-run

.PHONY: mobile-lite-ios-iphone
mobile-lite-ios-iphone: mobile-lite-ios-sync ## Build + install + launch on connected iPhone (no Xcode GUI)
	@echo "$(BLUE)iPhone run (xcodebuild + devicectl — no Xcode app required)$(NC)"
	@if [ -z "$(DEVELOPMENT_TEAM)" ] && [ -z "$(IOS_DEVELOPMENT_TEAM)" ]; then \
		echo "$(RED)Set DEVELOPMENT_TEAM to your Apple Team ID$(NC)"; \
		echo "  DEVELOPMENT_TEAM=XXXXXXXXXX make mobile-lite-ios-iphone"; \
		echo "  security find-identity -v -p codesigning"; \
		echo "  make mobile-lite-ios-devices   # list phone IDs for IOS_DEVICE_UDID"; \
		exit 1; \
	fi
	@chmod +x scripts/mobile-lite-ios-cli.sh
	@DEVELOPMENT_TEAM="$(DEVELOPMENT_TEAM)" IOS_DEVELOPMENT_TEAM="$(IOS_DEVELOPMENT_TEAM)" \
		IOS_DEVICE_UDID="$(IOS_DEVICE_UDID)" \
		./scripts/mobile-lite-ios-cli.sh device-run

.PHONY: mobile-lite-ios-devices
mobile-lite-ios-devices: ## List connected iPhone/iPad Core Device id + hardware UDID
	@chmod +x scripts/mobile-lite-ios-cli.sh
	@./scripts/mobile-lite-ios-cli.sh list-devices

.PHONY: mobile-lite-ios-build
mobile-lite-ios-build: ## Build iOS app (Simulator if no team; device when DEVELOPMENT_TEAM is set)
	@chmod +x scripts/mobile-lite-ios-cli.sh
	@url="$(AGNT_SERVER_URL)"; mode="$(AGNT_SERVER_MODE)"; \
	if [ -z "$$url" ]; then url="http://localhost:3333"; fi; \
	if [ -z "$$mode" ]; then mode="local"; fi; \
	$(MAKE) mobile-lite-ios-sync AGNT_SERVER_URL="$$url" AGNT_SERVER_MODE="$$mode"; \
	if [ -n "$(DEVELOPMENT_TEAM)$(IOS_DEVELOPMENT_TEAM)" ]; then \
		echo "$(BLUE)Device build (team $(or $(DEVELOPMENT_TEAM),$(IOS_DEVELOPMENT_TEAM)))$(NC)"; \
		DEVELOPMENT_TEAM="$(DEVELOPMENT_TEAM)" IOS_DEVELOPMENT_TEAM="$(IOS_DEVELOPMENT_TEAM)" \
			./scripts/mobile-lite-ios-cli.sh device-build; \
	else \
		echo "$(YELLOW)No DEVELOPMENT_TEAM set — building for Simulator (no signing team needed)$(NC)"; \
		echo "$(YELLOW)For a physical iPhone: DEVELOPMENT_TEAM=XXXXXXXXXX make mobile-lite-ios-build$(NC)"; \
		./scripts/mobile-lite-ios-cli.sh sim-build; \
	fi

.PHONY: mobile-lite-info
mobile-lite-info: ## Show mobile-lite paths and config
	@echo "$(BLUE)AGNT Mobile Lite$(NC)"
	@echo "$(YELLOW)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(NC)"
	@echo "  Web UI:          /m  /m/pair  /m/chat  (any browser, iOS + Android)"
	@echo "  Capacitor dir:   $(MOBILE_LITE_DIR)"
	@echo "  AGNT_SERVER_URL: $(if $(AGNT_SERVER_URL),$(AGNT_SERVER_URL),(unset))"
	@echo "  AGNT_SERVER_MODE: $(if $(AGNT_SERVER_MODE),$(AGNT_SERVER_MODE),(auto))"
	@echo "  Pairing:         paste full pair link → host + code (LAN/Tailscale)"
	@echo "  Claim API:       POST /api/pairing/claim"
	@echo "  iOS workspace:   $(MOBILE_LITE_IOS_WORKSPACE)"
	@echo "  ios/ present:    $$( [ -d $(MOBILE_LITE_DIR)/ios ] && echo yes || echo no — run make mobile-lite-ios-init )"
	@if [ -f $(MOBILE_LITE_DIR)/capacitor.config.json ]; then \
		echo "  Config URL:      $$(node -p "JSON.parse(require('fs').readFileSync('$(MOBILE_LITE_DIR)/capacitor.config.json','utf8')).server?.url || '(local www — pair link provides host)'")"; \
	fi
	@echo ""
	@echo "$(GREEN)iOS native (CLI — no Xcode GUI):$(NC)"
	@echo "  make mobile-lite-ios-init"
	@echo "  make mobile-lite-ios-build                            # Build (Sim if no team; device if DEVELOPMENT_TEAM set)"
	@echo "  make mobile-lite-ios-sim                              # Build + install + launch Simulator"
	@echo "  make mobile-lite-ios-devices                          # List Core Device id + hardware UDID"
	@echo "  DEVELOPMENT_TEAM=XXX make mobile-lite-ios-iphone      # Physical phone install/launch"
	@echo "  DEVELOPMENT_TEAM=XXX IOS_DEVICE_UDID=… make mobile-lite-ios-iphone"
	@echo "  make mobile-lite-ios-open                             # optional Xcode GUI"
	@echo "  See mobile/mobile-lite/README.md"

.PHONY: mobile-lite-clean
mobile-lite-clean: ## Remove mobile-lite node_modules and generated native projects
	@echo "$(BLUE)Cleaning mobile lite...$(NC)"
	@rm -rf $(MOBILE_LITE_DIR)/node_modules $(MOBILE_LITE_DIR)/ios $(MOBILE_LITE_DIR)/android \
		$(MOBILE_LITE_DIR)/capacitor.config.json $(MOBILE_LITE_DIR)/www/boot-config.json
	@echo "$(GREEN)✓ Cleaned$(NC)"

# Default target
.DEFAULT_GOAL := help
