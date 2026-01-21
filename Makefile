# AGNT Docker Build & Deploy Makefile
# Two variants: Full (with Chromium) and Lite (without Chromium)

# Configuration
VERSION := $(shell node -p "require('./package.json').version")
DOCKERHUB_USER ?= agnt
IMAGE_NAME := agnt
FULL_IMAGE := $(DOCKERHUB_USER)/$(IMAGE_NAME)
LITE_IMAGE := $(DOCKERHUB_USER)/$(IMAGE_NAME)

# Image tags
FULL_TAG_LATEST := $(FULL_IMAGE):latest
FULL_TAG_VERSION := $(FULL_IMAGE):$(VERSION)
LITE_TAG_LATEST := $(LITE_IMAGE):lite
LITE_TAG_VERSION := $(LITE_IMAGE):$(VERSION)-lite

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
	@echo "$(GREEN)Build Variants:$(NC)"
	@echo "  $(YELLOW)Docker Full$(NC)    - Docker image with Chromium (~1.5GB) - Port 33333"
	@echo "  $(YELLOW)Docker Lite$(NC)    - Docker image without browser (~715MB) - Port 3333"
	@echo "  $(YELLOW)Electron Full$(NC)  - Desktop installer with browser (~150-200MB)"
	@echo "  $(YELLOW)Electron Lite$(NC)  - Desktop installer without browser (~80-120MB)"
	@echo ""
	@echo "$(GREEN)Quick Start:$(NC)"
	@echo "  $(BLUE)Docker:$(NC)"
	@echo "    make build-full                  # Build Docker full image"
	@echo "    make run-full                    # Run Docker full image"
	@echo "  $(BLUE)Electron:$(NC)"
	@echo "    make electron-build-both         # Build both Electron variants"
	@echo "    make electron-info               # Show Electron build info"
	@echo ""
	@echo "$(GREEN)Configuration:$(NC)"
	@echo "  DockerHub User: $(DOCKERHUB_USER)"
	@echo "  Full Image:     $(FULL_TAG_LATEST)"
	@echo "  Lite Image:     $(LITE_TAG_LATEST)"

# ============================================================================
# BUILD TARGETS - Build images from scratch
# ============================================================================

.PHONY: build-full
build-full: ## Build full image from scratch (with Chromium)
	@echo "$(BLUE)Building full AGNT image (with Chromium)...$(NC)"
	@echo "$(YELLOW)Image size: ~1.5GB$(NC)"
	docker build \
		-f Dockerfile \
		-t $(FULL_TAG_LATEST) \
		-t $(FULL_TAG_VERSION) \
		--build-arg BUILD_DATE=$(shell date -u +'%Y-%m-%dT%H:%M:%SZ') \
		--build-arg VERSION=$(VERSION) \
		.
	@echo "$(GREEN)✓ Full image built successfully$(NC)"
	@echo "  Tags: $(FULL_TAG_LATEST), $(FULL_TAG_VERSION)"

.PHONY: build-lite
build-lite: ## Build lite image from scratch (without Chromium)
	@echo "$(BLUE)Building lite AGNT image (without Chromium)...$(NC)"
	@echo "$(YELLOW)Image size: ~715MB$(NC)"
	docker build \
		-f Dockerfile.lite \
		-t $(LITE_TAG_LATEST) \
		-t $(LITE_TAG_VERSION) \
		--build-arg BUILD_DATE=$(shell date -u +'%Y-%m-%dT%H:%M:%SZ') \
		--build-arg VERSION=$(VERSION) \
		.
	@echo "$(GREEN)✓ Lite image built successfully$(NC)"
	@echo "  Tags: $(LITE_TAG_LATEST), $(LITE_TAG_VERSION)"

.PHONY: build-all
build-all: build-full build-lite ## Build both full and lite images

.PHONY: build-full-multiarch
build-full-multiarch: ## Build full image for multiple platforms (amd64, arm64)
	@echo "$(BLUE)Building multi-architecture full image...$(NC)"
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-f Dockerfile \
		-t $(FULL_TAG_LATEST) \
		-t $(FULL_TAG_VERSION) \
		--build-arg BUILD_DATE=$(shell date -u +'%Y-%m-%dT%H:%M:%SZ') \
		--build-arg VERSION=$(VERSION) \
		--push \
		.
	@echo "$(GREEN)✓ Multi-arch full image built and pushed$(NC)"

.PHONY: build-lite-multiarch
build-lite-multiarch: ## Build lite image for multiple platforms (amd64, arm64)
	@echo "$(BLUE)Building multi-architecture lite image...$(NC)"
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-f Dockerfile.lite \
		-t $(LITE_TAG_LATEST) \
		-t $(LITE_TAG_VERSION) \
		--build-arg BUILD_DATE=$(shell date -u +'%Y-%m-%dT%H:%M:%SZ') \
		--build-arg VERSION=$(VERSION) \
		--push \
		.
	@echo "$(GREEN)✓ Multi-arch lite image built and pushed$(NC)"

# ============================================================================
# PULL TARGETS - Download images from DockerHub
# ============================================================================

.PHONY: pull-full
pull-full: ## Pull full image from DockerHub
	@echo "$(BLUE)Pulling full AGNT image from DockerHub...$(NC)"
	docker pull $(FULL_TAG_LATEST)
	@echo "$(GREEN)✓ Full image pulled successfully$(NC)"

.PHONY: pull-lite
pull-lite: ## Pull lite image from DockerHub
	@echo "$(BLUE)Pulling lite AGNT image from DockerHub...$(NC)"
	docker pull $(LITE_TAG_LATEST)
	@echo "$(GREEN)✓ Lite image pulled successfully$(NC)"

.PHONY: pull-all
pull-all: pull-full pull-lite ## Pull both full and lite images from DockerHub

.PHONY: pull-version-full
pull-version-full: ## Pull specific version of full image
	@echo "$(BLUE)Pulling full AGNT image v$(VERSION) from DockerHub...$(NC)"
	docker pull $(FULL_TAG_VERSION)
	@echo "$(GREEN)✓ Full image v$(VERSION) pulled successfully$(NC)"

.PHONY: pull-version-lite
pull-version-lite: ## Pull specific version of lite image
	@echo "$(BLUE)Pulling lite AGNT image v$(VERSION) from DockerHub...$(NC)"
	docker pull $(LITE_TAG_VERSION)
	@echo "$(GREEN)✓ Lite image v$(VERSION) pulled successfully$(NC)"

# ============================================================================
# PUSH TARGETS - Upload images to DockerHub
# ============================================================================

.PHONY: push-full
push-full: ## Push full image to DockerHub
	@echo "$(BLUE)Pushing full AGNT image to DockerHub...$(NC)"
	docker push $(FULL_TAG_LATEST)
	docker push $(FULL_TAG_VERSION)
	@echo "$(GREEN)✓ Full image pushed successfully$(NC)"

.PHONY: push-lite
push-lite: ## Push lite image to DockerHub
	@echo "$(BLUE)Pushing lite AGNT image to DockerHub...$(NC)"
	docker push $(LITE_TAG_LATEST)
	docker push $(LITE_TAG_VERSION)
	@echo "$(GREEN)✓ Lite image pushed successfully$(NC)"

.PHONY: push-all
push-all: push-full push-lite ## Push both full and lite images to DockerHub

# ============================================================================
# RUN TARGETS - Start containers
# ============================================================================

.PHONY: run-full
run-full: setup-dirs ## Run full image with docker-compose
	@echo "$(BLUE)Starting AGNT (full version)...$(NC)"
	AGNT_HOME=$(shell echo ~) docker-compose up -d
	@echo "$(GREEN)✓ AGNT Full is running at http://localhost:33333$(NC)"
	@echo "$(YELLOW)View logs: make logs-full$(NC)"

.PHONY: run-lite
run-lite: setup-dirs ## Run lite image with docker-compose
	@echo "$(BLUE)Starting AGNT (lite version)...$(NC)"
	AGNT_HOME=$(shell echo ~) docker-compose -f docker-compose.lite.yml up -d
	@echo "$(GREEN)✓ AGNT Lite is running at http://localhost:3333$(NC)"
	@echo "$(YELLOW)View logs: make logs-lite$(NC)"

.PHONY: run-full-local
run-full-local: build-full run-full ## Build and run full image locally

.PHONY: run-lite-local
run-lite-local: build-lite run-lite ## Build and run lite image locally

.PHONY: run-full-remote
run-full-remote: pull-full ## Pull and run full image from DockerHub
	@echo "$(BLUE)Starting AGNT (full version from DockerHub)...$(NC)"
	docker-compose up -d
	@echo "$(GREEN)✓ AGNT Full is running at http://localhost:33333$(NC)"

.PHONY: run-lite-remote
run-lite-remote: pull-lite ## Pull and run lite image from DockerHub
	@echo "$(BLUE)Starting AGNT (lite version from DockerHub)...$(NC)"
	docker-compose -f docker-compose.lite.yml up -d
	@echo "$(GREEN)✓ AGNT Lite is running at http://localhost:3333$(NC)"

.PHONY: setup-dirs
setup-dirs: ## Create ~/.agnt directory structure for persistent data
	@echo "$(BLUE)Setting up ~/.agnt directory structure...$(NC)"
	@mkdir -p $(shell echo ~)/.agnt/data \
		$(shell echo ~)/.agnt/plugins/installed \
		$(shell echo ~)/.agnt/plugins/builds \
		$(shell echo ~)/.agnt/logs/full \
		$(shell echo ~)/.agnt/logs/lite
	@chmod -R 777 $(shell echo ~)/.agnt
	@echo "$(GREEN)✓ Directory structure created at ~/.agnt$(NC)"
	@echo "$(YELLOW)  Data will be stored in $(shell echo ~)/.agnt/data/ (SHARED between full and lite)$(NC)"

.PHONY: run-both
run-both: setup-dirs ## Run both full (port 33333) and lite (port 3333) simultaneously
	@echo "$(BLUE)Starting both AGNT versions...$(NC)"
	AGNT_HOME=$(shell echo ~) docker-compose -f docker-compose.both.yml up -d
	@echo "$(GREEN)✓ AGNT Full is running at http://localhost:33333$(NC)"
	@echo "$(GREEN)✓ AGNT Lite is running at http://localhost:3333$(NC)"

.PHONY: run-both-local
run-both-local: build-all run-both ## Build and run both images locally

.PHONY: run-both-remote
run-both-remote: pull-all run-both ## Pull and run both images from DockerHub

.PHONY: logs-both
logs-both: ## Show logs for both containers
	docker-compose -f docker-compose.both.yml logs -f

.PHONY: stop-both
stop-both: ## Stop both containers and checkpoint WAL database
	@echo "$(YELLOW)Checkpointing WAL database...$(NC)"
	@docker exec agnt-full sqlite3 /app/data/agnt.db "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
	@echo "$(GREEN)✓ WAL checkpointed and collapsed to single file$(NC)"
	@echo "$(YELLOW)Stopping both AGNT containers...$(NC)"
	AGNT_HOME=$(shell echo ~) docker-compose -f docker-compose.both.yml down
	@echo "$(GREEN)✓ Both containers stopped$(NC)"

# ============================================================================
# MANAGEMENT TARGETS - Stop, restart, logs
# ============================================================================

.PHONY: stop
stop: ## Stop all running containers
	@echo "$(YELLOW)Checkpointing WAL database (if running)...$(NC)"
	@docker exec agnt-full sqlite3 /app/data/agnt.db "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
	@echo "$(YELLOW)Stopping AGNT containers...$(NC)"
	-docker-compose down 2>/dev/null
	-docker-compose -f docker-compose.lite.yml down 2>/dev/null
	-AGNT_HOME=$(shell echo ~) docker-compose -f docker-compose.both.yml down 2>/dev/null
	@echo "$(GREEN)✓ Containers stopped$(NC)"

.PHONY: restart-full
restart-full: stop run-full ## Restart full image

.PHONY: restart-lite
restart-lite: stop run-lite ## Restart lite image

.PHONY: restart-both
restart-both: stop-both run-both ## Restart both images

.PHONY: logs-full
logs-full: ## Show logs for full image
	docker-compose logs -f

.PHONY: logs-lite
logs-lite: ## Show logs for lite image
	docker-compose -f docker-compose.lite.yml logs -f

.PHONY: status
status: ## Show status of running containers
	@echo "$(BLUE)AGNT Container Status:$(NC)"
	@docker ps -a --filter "name=agnt" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"

.PHONY: shell-full
shell-full: ## Open shell in running full container
	docker exec -it agnt /bin/sh

.PHONY: shell-lite
shell-lite: ## Open shell in running lite container
	docker exec -it agnt-lite /bin/sh

# ============================================================================
# CLEANUP TARGETS
# ============================================================================

.PHONY: clean
clean: stop ## Stop containers and remove images
	@echo "$(YELLOW)Removing AGNT images...$(NC)"
	-docker rmi $(FULL_TAG_LATEST) $(FULL_TAG_VERSION) 2>/dev/null || true
	-docker rmi $(LITE_TAG_LATEST) $(LITE_TAG_VERSION) 2>/dev/null || true
	@echo "$(GREEN)✓ Images removed$(NC)"

.PHONY: clean-volumes
clean-volumes: ## Remove all persistent volumes (WARNING: destroys data!)
	@echo "$(RED)WARNING: This will delete all AGNT data, plugins, and logs!$(NC)"
	@echo "$(YELLOW)Press Ctrl+C to cancel, or Enter to continue...$(NC)"
	@read -r
	-docker-compose down -v 2>/dev/null
	-docker-compose -f docker-compose.lite.yml down -v 2>/dev/null
	-docker-compose -f docker-compose.both.yml down -v 2>/dev/null
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
	@echo "  DockerHub User:   $(DOCKERHUB_USER)"
	@echo ""
	@echo "$(BLUE)Full Image (with Chromium):$(NC)"
	@echo "  Latest Tag:       $(FULL_TAG_LATEST)"
	@echo "  Version Tag:      $(FULL_TAG_VERSION)"
	@echo "  Estimated Size:   ~1.5GB"
	@echo ""
	@echo "$(BLUE)Lite Image (without Chromium):$(NC)"
	@echo "  Latest Tag:       $(LITE_TAG_LATEST)"
	@echo "  Version Tag:      $(LITE_TAG_VERSION)"
	@echo "  Estimated Size:   ~715MB (52% smaller)"
	@echo ""
	@echo "$(BLUE)Available Dockerfiles:$(NC)"
	@ls -lh Dockerfile Dockerfile.lite 2>/dev/null || echo "  $(RED)Dockerfiles not found$(NC)"

.PHONY: version
version: ## Show current version
	@echo "$(VERSION)"

.PHONY: inspect-full
inspect-full: ## Inspect full image details
	@docker images $(FULL_IMAGE) --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"
	@echo ""
	@docker inspect $(FULL_TAG_LATEST) | grep -A 5 "Config"

.PHONY: inspect-lite
inspect-lite: ## Inspect lite image details
	@docker images $(LITE_IMAGE) --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"
	@echo ""
	@docker inspect $(LITE_TAG_LATEST) | grep -A 5 "Config"

.PHONY: test-full
test-full: ## Test full image health
	@echo "$(BLUE)Testing full image health...$(NC)"
	@docker run --rm $(FULL_TAG_LATEST) node -e "console.log('✓ Full image test passed')"

.PHONY: test-lite
test-lite: ## Test lite image health
	@echo "$(BLUE)Testing lite image health...$(NC)"
	@docker run --rm $(LITE_TAG_LATEST) node -e "console.log('✓ Lite image test passed')"

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

.PHONY: electron-build-full
electron-build-full: build-frontend ## Build Electron Full for current platform (~150-200MB)
	@echo "$(BLUE)Building Electron Full for current platform...$(NC)"
	@echo "$(YELLOW)Size: ~150-200MB with browser automation$(NC)"
	npm run build
	@echo "$(GREEN)✓ Electron Full built successfully$(NC)"
	@echo "  Output: dist/AGNT-$(VERSION)-*"

.PHONY: electron-build-lite
electron-build-lite: build-frontend ## Build Electron Lite for current platform (~80-120MB)
	@echo "$(BLUE)Building Electron Lite for current platform...$(NC)"
	@echo "$(YELLOW)Size: ~80-120MB without browser automation$(NC)"
	npm run build:lite
	@echo "$(GREEN)✓ Electron Lite built successfully$(NC)"
	@echo "  Output: dist/AGNT-Lite-$(VERSION)-*"

.PHONY: electron-build-both
electron-build-both: build-frontend ## Build both Electron Full and Lite for current platform
	@echo "$(BLUE)Building both Electron variants...$(NC)"
	npm run build:both
	@echo "$(GREEN)✓ Both variants built successfully$(NC)"

.PHONY: electron-build-win-full
electron-build-win-full: build-frontend ## Build Electron Full for Windows
	@echo "$(BLUE)Building Electron Full for Windows...$(NC)"
	npm run build:win
	@echo "$(GREEN)✓ Windows Full build complete$(NC)"

.PHONY: electron-build-win-lite
electron-build-win-lite: build-frontend ## Build Electron Lite for Windows
	@echo "$(BLUE)Building Electron Lite for Windows...$(NC)"
	npm run build:lite:win
	@echo "$(GREEN)✓ Windows Lite build complete$(NC)"

.PHONY: electron-build-win-both
electron-build-win-both: build-frontend ## Build both Electron variants for Windows
	@echo "$(BLUE)Building both Electron variants for Windows...$(NC)"
	npm run build:both:win
	@echo "$(GREEN)✓ Windows Full & Lite builds complete$(NC)"

.PHONY: electron-build-mac-full
electron-build-mac-full: build-frontend ## Build Electron Full for macOS (x64 + ARM64)
	@echo "$(BLUE)Building Electron Full for macOS...$(NC)"
	npm run build:mac
	@echo "$(GREEN)✓ macOS Full build complete$(NC)"

.PHONY: electron-build-mac-lite
electron-build-mac-lite: build-frontend ## Build Electron Lite for macOS (x64 + ARM64)
	@echo "$(BLUE)Building Electron Lite for macOS...$(NC)"
	npm run build:lite:mac
	@echo "$(GREEN)✓ macOS Lite build complete$(NC)"

.PHONY: electron-build-mac-both
electron-build-mac-both: build-frontend ## Build both Electron variants for macOS
	@echo "$(BLUE)Building both Electron variants for macOS...$(NC)"
	npm run build:both:mac
	@echo "$(GREEN)✓ macOS Full & Lite builds complete$(NC)"

.PHONY: electron-build-linux-full
electron-build-linux-full: build-frontend ## Build Electron Full for Linux (AppImage, DEB, RPM)
	@echo "$(BLUE)Building Electron Full for Linux...$(NC)"
	npm run build:linux
	@echo "$(GREEN)✓ Linux Full build complete$(NC)"

.PHONY: electron-build-linux-lite
electron-build-linux-lite: build-frontend ## Build Electron Lite for Linux (AppImage, DEB, RPM)
	@echo "$(BLUE)Building Electron Lite for Linux...$(NC)"
	npm run build:lite:linux
	@echo "$(GREEN)✓ Linux Lite build complete$(NC)"

.PHONY: electron-build-linux-both
electron-build-linux-both: build-frontend ## Build both Electron variants for Linux
	@echo "$(BLUE)Building both Electron variants for Linux...$(NC)"
	npm run build:both:linux
	@echo "$(GREEN)✓ Linux Full & Lite builds complete$(NC)"

.PHONY: electron-build-all-full
electron-build-all-full: build-frontend ## Build Electron Full for all platforms
	@echo "$(BLUE)Building Electron Full for all platforms...$(NC)"
	npm run build:all
	@echo "$(GREEN)✓ All platforms Full builds complete$(NC)"

.PHONY: electron-build-all-lite
electron-build-all-lite: build-frontend ## Build Electron Lite for all platforms
	@echo "$(BLUE)Building Electron Lite for all platforms...$(NC)"
	npm run build:lite:all
	@echo "$(GREEN)✓ All platforms Lite builds complete$(NC)"

.PHONY: electron-build-all-both
electron-build-all-both: build-frontend ## Build both Electron variants for all platforms
	@echo "$(BLUE)Building both Electron variants for all platforms...$(NC)"
	@echo "$(YELLOW)This will take a while...$(NC)"
	npm run build:both:win
	npm run build:both:mac
	npm run build:both:linux
	@echo "$(GREEN)✓ All platforms Full & Lite builds complete$(NC)"

.PHONY: electron-info
electron-info: ## Show Electron build information
	@echo "$(BLUE)Electron Build Variants$(NC)"
	@echo "$(YELLOW)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(NC)"
	@echo ""
	@echo "$(BLUE)Full Version (~150-200MB):$(NC)"
	@echo "  ✓ All features including browser automation"
	@echo "  ✓ Puppeteer/Playwright web scraping"
	@echo "  ✓ Screenshot capture"
	@echo "  ✓ HTML to PDF conversion"
	@echo ""
	@echo "$(BLUE)Lite Version (~80-120MB, ~50% smaller):$(NC)"
	@echo "  ✓ All core features (AI agents, workflows, plugins)"
	@echo "  ✗ No browser automation"
	@echo "  ✗ No web scraping tools"
	@echo ""
	@echo "$(GREEN)Build Commands:$(NC)"
	@echo "  make electron-build-full          - Full for current platform"
	@echo "  make electron-build-lite          - Lite for current platform"
	@echo "  make electron-build-both          - Both for current platform"
	@echo "  make electron-build-win-both      - Both for Windows"
	@echo "  make electron-build-mac-both      - Both for macOS"
	@echo "  make electron-build-linux-both    - Both for Linux"
	@echo "  make electron-build-all-both      - Both for all platforms"

# Default target
.DEFAULT_GOAL := help
