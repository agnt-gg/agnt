<template>
  <BaseScreen
    ref="baseScreenRef"
    :activeRightPanel="activeRightPanel"
    screenId="SecretsScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    :panelProps="{ form: form, typeOptions: typeOptions }"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <!-- Providers Section -->
      <div v-if="activeSection === 'providers'" class="secrets-content">
        <div class="content-header">
          <h2 class="content-title">Default AI Provider</h2>
          <p class="content-subtitle">
            Choose your default AI service provider and model. This will be the provider and model used by Annie throughout the app.
          </p>
        </div>
        <div class="secrets-grid">
          <div class="secrets-section full-width">
            <ProviderSelector />
          </div>
        </div>
      </div>

      <!-- OAuth Connections Section -->
      <div v-else-if="activeSection === 'oauth'" class="secrets-content">
        <div class="content-header">
          <h2 class="content-title">Auth Connections</h2>
          <p class="content-subtitle">Manage your API key and OAuth connections. Add, connect, use.</p>
        </div>
        <div class="secrets-grid">
          <div class="secrets-section">
            <!-- Search and Controls Bar -->
            <div class="controls-bar">
              <div class="search-wrapper">
                <BaseInput v-model="oauthSearch" placeholder="Search App Connections..." :clearable="true" @input="handleOAuthSearch" />
              </div>
              <div class="controls-group">
                <BaseSelect
                  v-model="connectionStatusFilter"
                  :options="[
                    { value: 'all', label: 'All' },
                    { value: 'connected', label: 'Connected' },
                    { value: 'not-connected', label: 'Not Connected' },
                  ]"
                />
                <div class="view-toggle">
                  <Tooltip text="Grid View" width="auto">
                    <button class="view-btn" :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'">
                      <i class="fas fa-th"></i>
                    </button>
                  </Tooltip>
                  <Tooltip text="List View" width="auto">
                    <button class="view-btn" :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'">
                      <i class="fas fa-list"></i>
                    </button>
                  </Tooltip>
                </div>
                <button class="add-btn" @click="openAddProviderModal"><i class="fas fa-plus"></i> Add</button>
              </div>
            </div>

            <!-- Category Filter Pills -->
            <div class="category-pills">
              <button
                class="category-pill"
                :class="{ active: selectedCategory === 'all' }"
                @click="
                  selectedCategory = 'all';
                  currentPage = 1;
                "
              >
                All ({{ categoryCounts.all || 0 }})
              </button>
              <button
                v-for="category in availableCategories"
                :key="category"
                class="category-pill"
                :class="{ active: selectedCategory === category }"
                @click="
                  selectedCategory = category;
                  currentPage = 1;
                "
              >
                {{ category }} ({{ categoryCounts[category] || 0 }})
              </button>
            </div>

            <!-- Results Count -->
            <div class="results-info">Showing {{ paginatedProviders.length }} of {{ filteredOAuthProviders.length }} providers</div>

            <!-- Providers List -->
            <div class="oauth-providers-list">
              <div v-if="isLoadingProviders" class="loading">Loading providers...</div>
              <div v-else-if="filteredOAuthProviders.length === 0" class="loading">No providers found. Try adjusting your filters.</div>

              <!-- Grid View -->
              <div v-else-if="viewMode === 'grid'" class="oauth-app-grid">
                <div v-for="provider in paginatedProviders" :key="provider.id" class="oauth-app-item" :class="{ connected: provider.connected }">
                  <Tooltip text="Edit Provider" width="auto">
                    <button class="edit-provider-btn" @click.stop="editProvider(provider)">
                      <i class="fas fa-edit"></i>
                    </button>
                  </Tooltip>
                  <div class="oauth-app-content" @click="handleOAuthAppClick(provider)">
                    <div class="oauth-app-icon">
                      <SvgIcon :name="provider.icon" />
                    </div>
                    <span class="oauth-app-name">{{ provider.name }}</span>
                    <span class="connection-status" :class="{ connected: provider.connected }">
                      {{ provider.connected ? 'Connected' : 'Not Connected' }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- List View -->
              <div v-else class="oauth-app-list">
                <div v-for="provider in paginatedProviders" :key="provider.id" class="oauth-list-item" :class="{ connected: provider.connected }">
                  <div class="list-item-icon">
                    <SvgIcon :name="provider.icon" />
                  </div>
                  <div class="list-item-content" @click="handleOAuthAppClick(provider)">
                    <div class="list-item-name">{{ provider.name }}</div>
                    <div class="list-item-categories">
                      <span v-for="cat in provider.categories" :key="cat" class="category-tag">{{ cat }}</span>
                    </div>
                  </div>
                  <div class="list-item-status">
                    <span class="connection-status" :class="{ connected: provider.connected }">
                      {{ provider.connected ? 'Connected' : 'Not Connected' }}
                    </span>
                  </div>
                  <div class="list-item-actions">
                    <Tooltip text="Edit" width="auto">
                      <button class="action-btn" @click.stop="editProvider(provider)">
                        <i class="fas fa-edit"></i>
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </div>

            <!-- Pagination -->
            <div v-if="totalPages > 1" class="pagination">
              <button class="page-btn" :disabled="currentPage === 1" @click="currentPage--"><i class="fas fa-chevron-left"></i> Prev</button>
              <span class="page-info">Page {{ currentPage }} of {{ totalPages }}</span>
              <button class="page-btn" :disabled="currentPage === totalPages" @click="currentPage++">
                Next <i class="fas fa-chevron-right"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- MCP Servers Section -->
      <div v-else-if="activeSection === 'mcp-servers'" class="secrets-content">
        <div class="content-header">
          <h2 class="content-title">MCP / NPM Library</h2>
          <p class="content-subtitle">Manage Model Context Protocol server connections. Enjoy access to over 2 million packages via NPM.</p>
        </div>
        <div class="secrets-grid">
          <div class="secrets-section full-width">
            <div class="plugins-header">
              <h3>
                MCP Manager
                <span v-if="!isPro" class="pro-badge-label"> <i class="fas fa-lock"></i> PRO </span>
              </h3>
              <p class="subtitle">Install and manage plugins to extend AGNT functionality</p>
            </div>
            <!-- Search and Controls Bar -->
            <div class="controls-bar" style="margin-bottom: 16px">
              <div class="search-wrapper">
                <BaseInput v-model="mcpSearch" placeholder="Search MCP servers..." :clearable="true" />
              </div>
              <div class="controls-group">
                <button class="add-btn" @click="openNPMBrowser"><i class="fas fa-search"></i> Browse NPM</button>
                <button class="add-btn" @click="showAddMCPServerForm = true"><i class="fas fa-plus"></i> Add Server</button>
              </div>
            </div>
            <div v-if="isLoadingMCPServers" class="loading">Loading servers...</div>

            <div v-else-if="filteredMCPServers.length === 0" class="loading">No MCP servers configured yet.</div>

            <div v-else class="mcp-servers-list">
              <div v-for="server in filteredMCPServers" :key="server.name" class="mcp-server-card">
                <div class="server-header">
                  <div class="server-info">
                    <h3 class="server-name">{{ server.name }}</h3>
                    <span class="server-type-badge" :class="server.transport.type">{{ server.transport.type.toUpperCase() }}</span>
                  </div>
                  <div class="server-actions">
                    <BaseButton
                      variant="secondary"
                      size="small"
                      @click="toggleCapabilities(server.name)"
                      :disabled="loadingCapabilities === server.name"
                    >
                      <i class="fas fa-tools"></i> {{ loadingCapabilities === server.name ? 'Loading...' : 'Tools' }}
                    </BaseButton>
                    <BaseButton
                      variant="secondary"
                      size="small"
                      @click="testMCPConnection(server.name)"
                      :disabled="testingConnection === server.name"
                    >
                      <i class="fas fa-plug"></i> {{ testingConnection === server.name ? 'Testing...' : 'Test' }}
                    </BaseButton>
                    <BaseButton variant="secondary" size="small" @click="editMCPServer(server)">
                      <i class="fas fa-edit"></i>
                    </BaseButton>
                    <BaseButton variant="danger" size="small" @click="deleteMCPServerConfirm(server)">
                      <i class="fas fa-trash"></i>
                    </BaseButton>
                  </div>
                </div>
                <div class="server-details">
                  <div v-if="server.transport.type === 'http'" class="detail-item">
                    <span class="detail-label">Endpoint:</span>
                    <span class="detail-value">{{ server.transport.endpoint }}</span>
                  </div>
                  <div v-else-if="server.transport.type === 'stdio'">
                    <div class="detail-item">
                      <span class="detail-label">Command:</span>
                      <span class="detail-value">{{ server.transport.command }}</span>
                    </div>
                    <div v-if="server.transport.args && server.transport.args.length" class="detail-item">
                      <span class="detail-label">Args:</span>
                      <span class="detail-value">{{ server.transport.args.join(' ') }}</span>
                    </div>
                    <div v-if="server.transport.env && Object.keys(server.transport.env).length" class="detail-item">
                      <span class="detail-label">Environment:</span>
                      <span class="detail-value">{{ Object.keys(server.transport.env).length }} variable(s)</span>
                    </div>
                  </div>
                </div>

                <!-- Server Capabilities -->
                <div v-if="expandedServers.has(server.name) && serverCapabilities[server.name]" class="server-capabilities">
                  <div class="capabilities-section">
                    <h4><i class="fas fa-tools"></i> Tools ({{ serverCapabilities[server.name].tools.length }})</h4>
                    <div v-if="serverCapabilities[server.name].tools.length" class="capabilities-list">
                      <div v-for="tool in serverCapabilities[server.name].tools" :key="tool.name" class="capability-item">
                        <strong>{{ tool.name }}</strong>
                        <p>{{ tool.description }}</p>
                      </div>
                    </div>
                    <p v-else class="no-items">No tools available</p>
                  </div>

                  <div class="capabilities-section">
                    <h4><i class="fas fa-database"></i> Resources ({{ serverCapabilities[server.name].resources.length }})</h4>
                    <div v-if="serverCapabilities[server.name].resources.length" class="capabilities-list">
                      <div v-for="resource in serverCapabilities[server.name].resources" :key="resource.uri" class="capability-item">
                        <strong>{{ resource.name || resource.uri }}</strong>
                        <p>{{ resource.description }}</p>
                      </div>
                    </div>
                    <p v-else class="no-items">No resources available</p>
                  </div>

                  <div v-if="serverCapabilities[server.name].prompts && serverCapabilities[server.name].prompts.length" class="capabilities-section">
                    <h4><i class="fas fa-comment-dots"></i> Prompts ({{ serverCapabilities[server.name].prompts.length }})</h4>
                    <div class="capabilities-list">
                      <div v-for="prompt in serverCapabilities[server.name].prompts" :key="prompt.name" class="capability-item">
                        <strong>{{ prompt.name }}</strong>
                        <p>{{ prompt.description }}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- NPM Browser Modal -->
            <div v-if="showNPMBrowser" class="mcp-server-form-overlay" @click.self="showNPMBrowser = false">
              <div class="mcp-server-form" style="max-width: 1048px">
                <div class="form-header">
                  <h3>Browse NPM Packages</h3>
                  <button class="close-btn" @click="showNPMBrowser = false">
                    <i class="fas fa-times"></i>
                  </button>
                </div>

                <div class="form-body">
                  <!-- Search -->
                  <div style="margin-bottom: 16px">
                    <BaseInput
                      v-model="npmSearchQuery"
                      placeholder="Search NPM packages (e.g., mcp-server, github, filesystem)..."
                      :clearable="true"
                      @keyup.enter="searchNPMPackages"
                    />
                    <BaseButton variant="primary" @click="searchNPMPackages" style="margin-top: 8px; width: 100%">
                      <i class="fas fa-search"></i> Search NPM Registry
                    </BaseButton>
                  </div>

                  <!-- Popular Servers -->
                  <div v-if="!npmSearchResults.length && !isSearchingNPM" style="margin-bottom: 24px">
                    <h4 style="margin: 0 0 12px 0; color: var(--color-text)">Popular MCP Servers</h4>
                    <div v-if="loadingPopular" class="loading" style="padding: 12px 0">Loading popular servers...</div>
                    <div v-else class="npm-packages-grid">
                      <div v-for="pkg in popularPackages" :key="pkg.name" class="npm-package-card" @click="selectNPMPackage(pkg)">
                        <div class="package-header">
                          <h4 class="package-name">{{ pkg.name }}</h4>
                          <span class="package-version">v{{ pkg.version }}</span>
                        </div>
                        <p class="package-description">{{ pkg.description || 'No description available' }}</p>
                        <div class="package-footer">
                          <BaseButton variant="primary" size="small" @click.stop="selectNPMPackage(pkg)">
                            <i class="fas fa-plus"></i> Use This
                          </BaseButton>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Search Results -->
                  <div v-if="npmSearchResults.length > 0">
                    <h4 style="margin: 0 0 12px 0; color: var(--color-text)">Search Results ({{ npmSearchResults.length }})</h4>
                    <div v-if="isSearchingNPM" class="loading" style="padding: 12px 0">Searching...</div>
                    <div v-else class="npm-packages-grid">
                      <div v-for="pkg in npmSearchResults" :key="pkg.name" class="npm-package-card" @click="selectNPMPackage(pkg)">
                        <div class="package-header">
                          <h4 class="package-name">{{ pkg.name }}</h4>
                          <span class="package-version">v{{ pkg.version }}</span>
                        </div>
                        <p class="package-description">{{ pkg.description || 'No description available' }}</p>
                        <div class="package-meta">
                          <span v-if="pkg.author" class="package-author"> <i class="fas fa-user"></i> {{ pkg.author }} </span>
                          <span v-if="pkg.score" class="package-score"> <i class="fas fa-star"></i> {{ Math.round(pkg.score * 100) }}% </span>
                        </div>
                        <div class="package-footer">
                          <BaseButton variant="primary" size="small" @click.stop="selectNPMPackage(pkg)">
                            <i class="fas fa-plus"></i> Use This
                          </BaseButton>
                          <a v-if="pkg.npm" :href="pkg.npm" target="_blank" class="npm-link" @click.stop>
                            <i class="fas fa-external-link-alt"></i>
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- No Results -->
                  <div v-if="!isSearchingNPM && npmSearchResults.length === 0 && npmSearchQuery" class="loading">
                    No packages found. Try a different search term.
                  </div>
                </div>
              </div>
            </div>

            <!-- Add/Edit Server Form -->
            <div v-if="showAddMCPServerForm || editingMCPServer" class="mcp-server-form-overlay" @click.self="closeMCPServerForm">
              <div class="mcp-server-form">
                <div class="form-header">
                  <h3>{{ editingMCPServer ? 'Edit MCP Server' : 'Add MCP Server' }}</h3>
                  <button class="close-btn" @click="closeMCPServerForm">
                    <i class="fas fa-times"></i>
                  </button>
                </div>

                <div class="form-body">
                  <BaseInput v-model="mcpServerForm.name" label="Server Name" placeholder="e.g., github-local, chrome-devtools" :required="true" />

                  <BaseSelect v-model="mcpServerForm.transportType" label="Transport Type" :options="mcpTransportTypes" :required="true" />

                  <!-- HTTP Transport Fields -->
                  <div class="form-wrapper" v-if="mcpServerForm.transportType === 'http'">
                    <BaseInput v-model="mcpServerForm.endpoint" label="Endpoint URL" placeholder="e.g., http://localhost:3001/sse" :required="true" />
                  </div>

                  <!-- STDIO Transport Fields -->
                  <div class="form-wrapper" v-if="mcpServerForm.transportType === 'stdio'">
                    <BaseInput v-model="mcpServerForm.command" label="Command" placeholder="e.g., docker, npx, node" :required="true" />

                    <div class="form-group">
                      <label>Arguments (one per line)</label>
                      <textarea
                        v-model="mcpServerForm.argsText"
                        placeholder="e.g.,&#10;run&#10;-i&#10;--rm"
                        rows="4"
                        class="form-textarea"
                      ></textarea>
                    </div>

                    <div class="form-group">
                      <label>Environment Variables (KEY=VALUE, one per line)</label>
                      <textarea
                        v-model="mcpServerForm.envText"
                        placeholder="e.g.,&#10;GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_TOKEN}&#10;API_KEY=${API_KEY}"
                        rows="4"
                        class="form-textarea"
                      ></textarea>
                    </div>
                  </div>
                </div>

                <div class="form-footer">
                  <BaseButton variant="secondary" @click="closeMCPServerForm">Cancel</BaseButton>
                  <BaseButton variant="primary" @click="saveMCPServer" :disabled="!isMCPServerFormValid">
                    <i class="fas fa-save"></i> {{ editingMCPServer ? 'Update' : 'Add' }} Server
                  </BaseButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Webhooks Section -->
      <div v-else-if="activeSection === 'webhooks'" class="secrets-content">
        <div class="content-header">
          <h2 class="content-title">Webhooks</h2>
          <p class="content-subtitle">View and manage your active webhooks</p>
        </div>
        <div class="secrets-grid">
          <div class="secrets-section full-width">
            <Webhooks @open-workflow="openWorkflow" />
          </div>
        </div>
      </div>

      <!-- Email Server Section -->
      <div v-else-if="activeSection === 'email-server'" class="secrets-content">
        <div class="content-header">
          <h2 class="content-title">Email Server</h2>
          <p class="content-subtitle">Configure and manage your email server connections</p>
        </div>
        <div class="secrets-grid">
          <div class="secrets-section full-width">
            <EmailServer @open-workflow="openWorkflow" />
          </div>
        </div>
      </div>

      <!-- Plugins Section -->
      <div v-else-if="activeSection === 'plugins'" class="secrets-content" @click="handlePluginAreaClick">
        <div class="content-header">
          <h2 class="content-title">My Plugins</h2>
          <p class="content-subtitle">
            Extend AGNT with community plugins. Install tools like Discord, Slack, GitHub and more without bloating your app.
          </p>
        </div>
        <div class="secrets-grid">
          <div class="secrets-section full-width">
            <Plugins @show-alert="showAlert" />
          </div>
        </div>
      </div>

      <!-- Add/Edit Provider Modal -->
      <div v-if="showEditProviderModal || showAddProviderModal" class="mcp-server-form-overlay" @click.self="closeProviderModal">
        <div class="mcp-server-form">
          <div class="form-header">
            <h3>{{ editingProvider ? 'Edit Provider' : 'Add New Integration' }}</h3>
            <button class="close-btn" @click="closeProviderModal">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div class="form-body">
            <BaseInput
              v-model="providerForm.id"
              label="Provider ID"
              placeholder="e.g., openrouter, custom-service"
              :disabled="!!editingProvider"
              :required="true"
            />
            <BaseInput v-model="providerForm.name" label="Provider Name" placeholder="e.g., OpenRouter" :required="true" />
            <BaseInput v-model="providerForm.icon" label="Icon" placeholder="e.g., fas fa-robot, custom-icon" />
            <BaseSelect v-model="providerForm.connectionType" label="Connection Type" :options="connectionTypeOptions" :required="true" />
            <BaseInput v-model="providerForm.categories" label="Categories" placeholder="e.g., ai, productivity (comma-separated)" />

            <div class="form-group">
              <label>Instructions</label>
              <textarea v-model="providerForm.instructions" placeholder="Help text for users" rows="3" class="form-textarea"></textarea>
            </div>

            <div v-if="providerForm.connectionType === 'apikey'" class="form-group">
              <label>Custom Prompt</label>
              <textarea v-model="providerForm.customPrompt" placeholder="Custom prompt for API key input" rows="2" class="form-textarea"></textarea>
            </div>

            <!-- OAuth Configuration Fields -->
            <div v-if="providerForm.connectionType === 'oauth'" class="oauth-config-section">
              <h4 style="margin: 16px 0 12px 0; color: var(--color-text); font-size: 1.1em">OAuth Configuration</h4>

              <BaseInput v-model="providerForm.redirectUri" label="Redirect URI" placeholder="Leave empty to use default" />
              <BaseInput v-model="providerForm.scope" label="Scope" placeholder="e.g., read write user:email" />

              <BaseInput v-model="providerForm.authUrl" label="Authorization URL" placeholder="e.g., https://provider.com/oauth/authorize" />

              <div class="form-group">
                <label>Auth Parameters (JSON)</label>
                <textarea
                  v-model="providerForm.authParams"
                  placeholder='e.g., {"response_type": "code"}'
                  rows="3"
                  class="form-textarea code-textarea"
                ></textarea>
              </div>

              <BaseInput v-model="providerForm.tokenUrl" label="Token URL" placeholder="e.g., https://provider.com/oauth/token" />

              <div class="form-group">
                <label>Token Parameters (JSON)</label>
                <textarea
                  v-model="providerForm.tokenParams"
                  placeholder='e.g., {"grant_type": "authorization_code"}'
                  rows="3"
                  class="form-textarea code-textarea"
                ></textarea>
              </div>

              <div class="form-group">
                <label>Token Headers (JSON)</label>
                <textarea
                  v-model="providerForm.tokenHeaders"
                  placeholder='e.g., {"Accept": "application/json"}'
                  rows="3"
                  class="form-textarea code-textarea"
                ></textarea>
              </div>

              <BaseInput v-model="providerForm.refreshUrl" label="Refresh Token URL" placeholder="Leave empty if no refresh support" />

              <div class="form-group">
                <label>Refresh Parameters (JSON)</label>
                <textarea
                  v-model="providerForm.refreshParams"
                  placeholder='e.g., {"grant_type": "refresh_token"}'
                  rows="3"
                  class="form-textarea code-textarea"
                ></textarea>
              </div>

              <div class="form-group">
                <label>Refresh Headers (JSON)</label>
                <textarea
                  v-model="providerForm.refreshHeaders"
                  placeholder='e.g., {"Content-Type": "application/json"}'
                  rows="3"
                  class="form-textarea code-textarea"
                ></textarea>
              </div>

              <div class="form-group">
                <label>Provider Code (JavaScript)</label>
                <p style="font-size: 0.85em; color: var(--color-light-med-navy); margin: 0 0 8px 0">
                  Define custom OAuth flow functions. Leave empty to use config-based flow.
                </p>
                <textarea
                  v-model="providerForm.providerCode"
                  placeholder="async function getAuthorizationUrl(params, credentials, config) { ... }"
                  rows="12"
                  class="form-textarea code-textarea"
                  style="font-family: var(--font-family-mono); font-size: 0.85em"
                  spellcheck="false"
                ></textarea>
              </div>
            </div>
          </div>

          <div class="form-footer">
            <BaseButton v-if="editingProvider" variant="danger" @click="deleteProviderConfirm" style="margin-right: auto">
              <i class="fas fa-trash"></i> Delete
            </BaseButton>
            <BaseButton variant="secondary" @click="closeProviderModal">Cancel</BaseButton>
            <BaseButton v-if="editingProvider" variant="primary" @click="updateProvider" :disabled="!isProviderFormValid">
              <i class="fas fa-save"></i> Update
            </BaseButton>
            <BaseButton v-else variant="primary" @click="saveProviderFromModal" :disabled="!isProviderFormValid">
              <i class="fas fa-save"></i> Create
            </BaseButton>
          </div>
        </div>
      </div>

      <!-- Add Provider Section -->
      <div v-else-if="activeSection === 'add-provider'" class="secrets-content">
        <div class="content-header">
          <h2 class="content-title">Add New Integration</h2>
          <p class="content-subtitle">Create a new app provider to connect additional services</p>
        </div>
        <div class="secrets-grid">
          <div class="secrets-section">
            <div class="add-provider-form">
              <div class="form-row">
                <BaseInput v-model="providerForm.id" label="Provider ID" placeholder="e.g., openrouter, custom-service" :required="true" />
                <BaseInput v-model="providerForm.name" label="Provider Name" placeholder="e.g., OpenRouter, Custom Service" :required="true" />
              </div>

              <div class="form-row">
                <BaseInput v-model="providerForm.icon" label="Icon" placeholder="e.g., fas fa-robot, custom-icon" />
                <BaseSelect v-model="providerForm.connectionType" label="Connection Type" :options="connectionTypeOptions" :required="true" />
              </div>

              <div class="form-row">
                <BaseInput
                  v-model="providerForm.categories"
                  label="Categories"
                  placeholder="e.g., ai, productivity, communication (comma-separated)"
                />
              </div>

              <div class="form-row full-width">
                <div class="form-group">
                  <label>Instructions</label>
                  <textarea
                    v-model="providerForm.instructions"
                    placeholder="Help text for users connecting to this provider"
                    rows="3"
                    class="form-textarea"
                  ></textarea>
                </div>
              </div>

              <div class="form-row full-width" v-if="providerForm.connectionType === 'apikey'">
                <div class="form-group">
                  <label>Custom Prompt</label>
                  <textarea
                    v-model="providerForm.customPrompt"
                    placeholder="Custom prompt for API key input (optional)"
                    rows="2"
                    class="form-textarea"
                  ></textarea>
                </div>
              </div>

              <div class="form-actions">
                <BaseButton variant="primary" @click="saveProvider" :disabled="!isProviderFormValid">
                  <i class="fas fa-save"></i> Create Provider
                </BaseButton>
                <BaseButton variant="secondary" @click="resetProviderForm"> <i class="fas fa-times"></i> Clear Form </BaseButton>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- API Keys Section -->
      <div v-else-if="activeSection === 'api-keys'" class="secrets-content">
        <div class="content-header">
          <h2 class="content-title">API Keys</h2>
          <p class="content-subtitle">Manage your API keys and credentials</p>
        </div>
        <div class="secrets-grid">
          <div class="secrets-section">
            <BaseTable
              :items="filteredSecrets"
              :columns="tableColumns"
              :selected-id="selectedSecret?.id"
              :show-search="true"
              :search-placeholder="'Search API Keys...'"
              :search-keys="['key', 'description']"
              :no-results-text="'No API keys found.'"
              @row-click="selectSecret"
              @search="handleSearch"
            >
              <template #value="{ item }">
                <span class="secret-value">••••••••</span>
              </template>
              <template #actions="{ item }">
                <BaseButton variant="secondary" @click.stop="editSecret(item)">
                  <i class="fas fa-edit"></i>
                </BaseButton>
                <BaseButton variant="danger" @click.stop="deleteSecretConfirm(item)">
                  <i class="fas fa-trash"></i>
                </BaseButton>
              </template>
            </BaseTable>
          </div>
        </div>
      </div>

      <!-- Environment Variables Section -->
      <div v-else-if="activeSection === 'env-vars'" class="secrets-content">
        <div class="content-header">
          <h2 class="content-title">Environment Variables</h2>
          <p class="content-subtitle">Manage your environment variables</p>
        </div>
        <div class="secrets-grid">
          <div class="secrets-section">
            <BaseTable
              :items="filteredSecrets"
              :columns="tableColumns"
              :selected-id="selectedSecret?.id"
              :show-search="true"
              :search-placeholder="'Search Environment Variables...'"
              :search-keys="['key', 'description']"
              :no-results-text="'No environment variables found.'"
              @row-click="selectSecret"
              @search="handleSearch"
            >
              <template #value="{ item }">
                <span class="secret-value">••••••••</span>
              </template>
              <template #actions="{ item }">
                <BaseButton variant="secondary" @click.stop="editSecret(item)">
                  <i class="fas fa-edit"></i>
                </BaseButton>
                <BaseButton variant="danger" @click.stop="deleteSecretConfirm(item)">
                  <i class="fas fa-trash"></i>
                </BaseButton>
              </template>
            </BaseTable>
          </div>
          <div class="secrets-section full-width">
            <ResourcesSection />
          </div>
        </div>
      </div>

      <SimpleModal ref="modalRef" />
      <Popup v-if="popup.show" :show="popup.show" :type="popup.type" :message="popup.message" :icon="popup.icon" @close="popup.show = false" />

      <!-- Tutorial -->
      <PopupTutorial :config="tutorialConfig" :startTutorial="startTutorial" tutorialId="secrets" @close="onTutorialClose" />
    </template>
  </BaseScreen>
</template>

<script>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import BaseScreen from '../../BaseScreen.vue';
import BaseTable from '../../../_components/BaseTable.vue';
import BaseForm from '../../../_components/BaseForm.vue';
import BaseInput from '../../../_components/BaseInput.vue';
import BaseSelect from '../../../_components/BaseSelect.vue';
import BaseButton from '../../../_components/BaseButton.vue';
import Popup from '../../../_components/Popup.vue';
import TerminalHeader from '../../../_components/TerminalHeader.vue';
import ListWithSearch from '../../../_components/ListWithSearch.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { API_CONFIG } from '@/tt.config.js';
import SecretsPanel from '@/views/Terminal/RightPanel/types/SecretsPanel/SecretsPanel.vue';
import { encrypt } from '@/views/_utils/encryption.js';
import { useTutorial } from './useTutorial.js';
import PopupTutorial from '../../../../_components/utility/PopupTutorial.vue';
import ProviderSelector from '../Settings/components/ProviderSelector/ProviderSelector.vue';
import ResourcesSection from '../../../../_components/common/ResourcesSection.vue';
import Webhooks from './components/Webhooks.vue';
import EmailServer from './components/EmailServer.vue';
import Plugins from './components/Plugins.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'SecretsScreen',
  components: {
    BaseScreen,
    BaseTable,
    BaseForm,
    BaseInput,
    BaseSelect,
    BaseButton,
    Popup,
    TerminalHeader,
    ListWithSearch,
    SvgIcon,
    SimpleModal,
    SecretsPanel,
    PopupTutorial,
    ProviderSelector,
    ResourcesSection,
    Webhooks,
    EmailServer,
    Plugins,
    Tooltip,
  },
  setup(props, { emit }) {
    const store = useStore();
    const route = useRoute();
    const router = useRouter();
    const baseScreenRef = ref(null);
    const terminalLines = ref(['Welcome to the Secrets Manager!', 'Store and manage your environment variables and API keys securely.']);
    const activeSection = ref('plugins');
    const searchQuery = ref('');
    const selectedSecret = ref(null);
    const form = ref({
      id: null,
      type: 'env',
      key: '',
      value: '',
      description: '',
    });
    const popup = ref({ show: false, type: 'success', message: '', icon: '' });

    const activeRightPanel = computed(() => (store.getters['secrets/selectedPlugin'] ? 'SecretsPanel' : 'NewsPanel'));

    // Provider form state
    const providerForm = ref({
      id: '',
      name: '',
      icon: '',
      categories: '',
      connectionType: 'apikey',
      instructions: '',
      customPrompt: '',
      // OAuth config fields
      redirectUri: '',
      scope: '',
      authUrl: '',
      authParams: '',
      tokenUrl: '',
      tokenParams: '',
      tokenHeaders: '',
      refreshUrl: '',
      refreshParams: '',
      refreshHeaders: '',
      providerCode: '',
    });
    const editingProvider = ref(null);
    const showEditProviderModal = ref(false);
    const showAddProviderModal = ref(false);

    const typeOptions = [
      { value: 'env', label: 'Environment Variable' },
      { value: 'api', label: 'API Key' },
    ];
    const connectionTypeOptions = [
      { value: 'apikey', label: 'API Key' },
      { value: 'oauth', label: 'OAuth' },
    ];
    const tableColumns = [
      { key: 'type', label: 'Type', width: '120px' },
      { key: 'key', label: 'Key', width: '2fr' },
      { key: 'value', label: 'Value', width: '1fr' },
      { key: 'description', label: 'Description', width: '2fr' },
      { key: 'actions', label: '', width: '100px' },
    ];

    const allSecrets = computed(() => store.getters['secrets/allSecrets']);
    const filteredSecrets = computed(() => {
      // Filter based on current section
      let type = 'env';
      if (activeSection.value === 'api-keys') type = 'api';
      else if (activeSection.value === 'env-vars') type = 'env';

      let items = allSecrets.value.filter((s) => s.type === type);
      if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        items = items.filter((item) => [item.key, item.description].some((val) => val && String(val).toLowerCase().includes(q)));
      }
      return items;
    });

    // --- OAuth Providers State ---
    const connectedApps = computed(() => store.state.appAuth.connectedApps || []);
    const allProviders = computed(() => store.state.appAuth.allProviders || []);
    const oauthProviders = computed(() =>
      allProviders.value.map((p) => ({
        ...p,
        categories: Array.isArray(p.categories) ? p.categories : p.categories ? JSON.parse(p.categories) : [],
        connected: connectedApps.value.includes(p.id),
        connectionType: p.connectionType || p.connection_type,
      }))
    );
    const oauthSearch = ref('');
    const modalRef = ref(null);
    const isLoadingProviders = ref(false);

    // New filtering state
    const selectedCategory = ref('all');
    const connectionStatusFilter = ref('all'); // 'all', 'connected', 'not-connected'
    const viewMode = ref('grid'); // 'grid' or 'list'
    const itemsPerPage = ref(50);
    const currentPage = ref(1);

    // --- MCP Servers State ---
    const mcpServers = computed(() => store.getters['mcpServers/allServers'] || []);
    const isLoadingMCPServers = computed(() => store.state.mcpServers.loading);
    const mcpSearch = ref('');
    const showAddMCPServerForm = ref(false);
    const showNPMBrowser = ref(false);
    const editingMCPServer = ref(null);
    const testingConnection = ref(null);
    const loadingCapabilities = ref(null);
    const serverCapabilities = ref({});
    const expandedServers = ref(new Set());
    const mcpServerForm = ref({
      name: '',
      transportType: 'http',
      endpoint: '',
      command: '',
      argsText: '',
      envText: '',
    });
    const mcpTransportTypes = [
      { value: 'http', label: 'HTTP' },
      { value: 'stdio', label: 'STDIO' },
    ];

    // NPM Browser State
    const npmSearchQuery = ref('');
    const npmSearchResults = ref([]);
    const isSearchingNPM = ref(false);
    const popularPackages = ref([]);
    const loadingPopular = ref(false);

    const filteredMCPServers = computed(() => {
      let filtered = mcpServers.value;
      if (mcpSearch.value && mcpSearch.value.trim() !== '') {
        const q = mcpSearch.value.toLowerCase();
        filtered = filtered.filter((s) => s.name && s.name.toLowerCase().includes(q));
      }
      return filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
    });

    const isMCPServerFormValid = computed(() => {
      if (!mcpServerForm.value.name.trim()) return false;
      if (mcpServerForm.value.transportType === 'http') {
        return mcpServerForm.value.endpoint.trim() !== '';
      } else if (mcpServerForm.value.transportType === 'stdio') {
        return mcpServerForm.value.command.trim() !== '';
      }
      return false;
    });

    // Tutorial setup
    const { tutorialConfig, startTutorial, currentStep, onTutorialClose, nextStep, initializeTutorial } = useTutorial();
    const isLoggedIn = computed(() => store.getters['userAuth/isAuthenticated']);

    // PRO status
    const planType = computed(() => store.getters['userAuth/planType'] || 'free');
    const isPro = computed(() => planType.value !== 'free');

    // Helper function to capitalize first letter of each word
    const capitalizeCategory = (category) => {
      return category
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    };

    // Get unique categories from all providers (normalized and capitalized)
    const availableCategories = computed(() => {
      const categoriesMap = new Map(); // Use Map to track normalized -> display name
      oauthProviders.value.forEach((p) => {
        if (Array.isArray(p.categories)) {
          p.categories.forEach((cat) => {
            const normalized = cat.toLowerCase();
            if (!categoriesMap.has(normalized)) {
              categoriesMap.set(normalized, capitalizeCategory(cat));
            }
          });
        }
      });
      return Array.from(categoriesMap.values()).sort();
    });

    // Debounced search
    let searchTimeout = null;
    const debouncedSearch = ref('');
    function handleOAuthSearch(value) {
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        debouncedSearch.value = value;
      }, 300);
    }

    const filteredOAuthProviders = computed(() => {
      let filtered = oauthProviders.value;

      // Apply category filter (case-insensitive)
      if (selectedCategory.value !== 'all') {
        const selectedLower = selectedCategory.value.toLowerCase();
        filtered = filtered.filter((p) => Array.isArray(p.categories) && p.categories.some((cat) => cat.toLowerCase() === selectedLower));
      }

      // Apply connection status filter
      if (connectionStatusFilter.value === 'connected') {
        filtered = filtered.filter((p) => p.connected);
      } else if (connectionStatusFilter.value === 'not-connected') {
        filtered = filtered.filter((p) => !p.connected);
      }

      // Apply search filter (use debounced value)
      const searchTerm = debouncedSearch.value || oauthSearch.value || '';
      if (searchTerm && typeof searchTerm === 'string' && searchTerm.trim() !== '') {
        const q = searchTerm.toLowerCase();
        filtered = filtered.filter((p) => {
          const nameMatch = p.name && p.name.toLowerCase().includes(q);
          const categoryMatch = Array.isArray(p.categories) && p.categories.some((cat) => cat.toLowerCase().includes(q));
          return nameMatch || categoryMatch;
        });
      }

      // Always sort A-Z by name
      return filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
    });

    // Paginated providers for performance
    const paginatedProviders = computed(() => {
      const start = (currentPage.value - 1) * itemsPerPage.value;
      const end = start + itemsPerPage.value;
      return filteredOAuthProviders.value.slice(start, end);
    });

    const totalPages = computed(() => {
      return Math.ceil(filteredOAuthProviders.value.length / itemsPerPage.value);
    });

    // Category counts (case-insensitive)
    const categoryCounts = computed(() => {
      const counts = { all: oauthProviders.value.length };
      availableCategories.value.forEach((cat) => {
        const catLower = cat.toLowerCase();
        counts[cat] = oauthProviders.value.filter(
          (p) => Array.isArray(p.categories) && p.categories.some((c) => c.toLowerCase() === catLower)
        ).length;
      });
      return counts;
    });

    // Provider form validation
    const isProviderFormValid = computed(() => {
      return providerForm.value.id.trim() !== '' && providerForm.value.name.trim() !== '' && providerForm.value.connectionType !== '';
    });

    async function showAlert(title, message) {
      await modalRef.value?.showModal({
        title,
        message,
        confirmText: 'OK',
        showCancel: false,
      });
    }

    async function connectOAuthApp(app) {
      try {
        const token = localStorage.getItem('token');
        // Pass origin as query parameter for reliable Electron support
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/connect/${app.id}?origin=${encodeURIComponent(window.location.origin)}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data.authUrl) {
          // Open OAuth in popup window
          const width = 600;
          const height = 700;
          const left = window.screenX + (window.outerWidth - width) / 2;
          const top = window.screenY + (window.outerHeight - height) / 2;

          const popup = window.open(
            data.authUrl,
            `oauth_${app.id}`,
            `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
          );

          if (!popup) {
            await showAlert('Popup Blocked', 'Please allow popups for this site to connect integrations.');
            return;
          }

          // Monitor popup for completion
          const checkPopup = setInterval(() => {
            if (popup.closed) {
              clearInterval(checkPopup);
              // Refresh providers after popup closes
              store.dispatch('appAuth/fetchConnectedApps');
              store.dispatch('appAuth/fetchAllProviders');
            }
          }, 500);
        } else {
          throw new Error('No authUrl provided in the response');
        }
      } catch (error) {
        await showAlert('Connection Error', `Failed to connect to ${app.name}: ${error.message}`);
      }
    }

    async function disconnectApp(app) {
      const confirmDisconnect = await modalRef.value?.showModal({
        title: 'Confirm Disconnection',
        message: `Are you sure you want to disconnect from ${app.name}?`,
        confirmText: 'Disconnect',
        cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });
      if (!confirmDisconnect) return;
      try {
        const token = localStorage.getItem('token');
        // Use local backend which will disconnect both locally and remotely
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/disconnect/${app.id}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data.success) {
          // Refresh the connected apps list to update UI
          await store.dispatch('appAuth/fetchConnectedApps');
          await store.dispatch('appAuth/fetchAllProviders');
          await showAlert('Success', `Successfully disconnected from ${app.name}`);

          // Add to terminal log
          terminalLines.value.push(`[Disconnect] Successfully disconnected from ${app.name}`);
          nextTick(() => baseScreenRef.value?.scrollToBottom());
        } else {
          throw new Error('Disconnection failed');
        }
      } catch (error) {
        await showAlert('Disconnection Error', `Failed to disconnect from ${app.name}: ${error.message}`);

        // Add error to terminal log
        terminalLines.value.push(`[Disconnect] Failed to disconnect from ${app.name}: ${error.message}`);
        nextTick(() => baseScreenRef.value?.scrollToBottom());
      }
    }

    async function promptApiKey(app) {
      // Use instructions as the message, or fall back to custom_prompt or default
      const promptMessage = app.instructions || app.custom_prompt || `Enter API Key for ${app.name}:`;
      const apiKey = await showPrompt(`Connect to ${app.name}`, promptMessage, '', {
        confirmText: 'Save',
        cancelText: 'Cancel',
        confirmClass: 'btn-primary',
        cancelClass: 'btn-secondary',
        inputType: 'password',
      });
      if (apiKey) {
        await saveApiKey(app, apiKey);
      }
    }

    async function showPrompt(title, message, defaultValue = '', options = {}) {
      const result = await modalRef.value?.showModal({
        title,
        message,
        isPrompt: true,
        isTextArea: options.isTextArea || false,
        inputType: options.inputType || 'password',
        placeholder: defaultValue,
        defaultValue: defaultValue,
        confirmText: options.confirmText || 'Save',
        cancelText: options.cancelText || 'Cancel',
        confirmClass: options.confirmClass || 'btn-primary',
        cancelClass: options.cancelClass || 'btn-secondary',
        showCancel: options.showCancel !== undefined ? options.showCancel : true,
      });
      return result === null ? null : result || defaultValue;
    }

    async function saveApiKey(app, apiKey) {
      try {
        const token = localStorage.getItem('token');
        const encryptedApiKey = encrypt(apiKey);
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/apikeys/${app.id}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ apiKey: encryptedApiKey }),
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        if (result.success) {
          app.connected = true;
          await store.dispatch('appAuth/fetchConnectedApps');
          await showAlert('Success', `API key for ${app.name} saved successfully!`);
        } else {
          throw new Error(result.message || 'Failed to save API key');
        }
      } catch (error) {
        await showAlert('Error', `Failed to save API key for ${app.name}: ${error.message}`);
      }
    }

    function handleOAuthAppClick(app) {
      if (app.connected) {
        disconnectApp(app);
      } else if (app.connectionType === 'oauth') {
        connectOAuthApp(app);
      } else if (app.connectionType === 'apikey') {
        promptApiKey(app);
      } else {
        showAlert('Unsupported App Type', `Cannot connect to ${app.name}: unsupported connection type.`);
      }
    }

    function handleSearch(query) {
      searchQuery.value = query;
    }
    function selectSecret(secret) {
      selectedSecret.value = secret;
      form.value = { ...secret };
    }
    function editSecret(secret) {
      form.value = { ...secret };
      selectedSecret.value = secret;
    }
    function resetForm() {
      // Determine type based on current section
      let type = 'env';
      if (activeSection.value === 'api-keys') type = 'api';
      else if (activeSection.value === 'env-vars') type = 'env';

      form.value = {
        id: null,
        type: type,
        key: '',
        value: '',
        description: '',
      };
      selectedSecret.value = null;
    }
    function showPopup(type, message, icon = '') {
      popup.value = { show: true, type, message, icon };
      setTimeout(() => (popup.value.show = false), 2500);
    }
    function saveSecret() {
      if (!form.value.key || !form.value.value) return;
      if (form.value.id) {
        store.dispatch('secrets/updateSecret', { ...form.value });
        showPopup('success', 'Secret updated!', 'fas fa-check-circle');
        terminalLines.value.push(`[Secrets] Updated secret: ${form.value.key}`);
      } else {
        const id = 'secret-' + Date.now();
        store.dispatch('secrets/addSecret', { ...form.value, id });
        showPopup('success', 'Secret added!', 'fas fa-check-circle');
        terminalLines.value.push(`[Secrets] Added secret: ${form.value.key}`);
      }
      resetForm();
      nextTick(() => baseScreenRef.value?.scrollToBottom());
    }
    async function deleteSecretConfirm(secret) {
      const confirmed = await modalRef.value?.showModal({
        title: 'Delete Secret?',
        message: `Delete secret '${secret.key}'? This cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });

      if (!confirmed) return;

      store.dispatch('secrets/deleteSecret', secret.id);
      showPopup('success', 'Secret deleted.', 'fas fa-trash');
      terminalLines.value.push(`[Secrets] Deleted secret: ${secret.key}`);
      resetForm();
      nextTick(() => baseScreenRef.value?.scrollToBottom());
    }
    function initializeScreen() {
      // Background load secrets
      store.dispatch('secrets/loadSecrets');
      terminalLines.value = ['Welcome to the Secrets Manager!', 'Store and manage your environment variables and API keys securely.'];
      resetForm();
      nextTick(() => baseScreenRef.value?.scrollToBottom());

      // Pre-refresh marketplace data in background if needed (respects cache)
      store.dispatch('marketplace/fetchMyPurchases');
      store.dispatch('marketplace/fetchMyInstalls');

      // Start tutorial after 2 seconds only if user is logged in
      if (isLoggedIn.value) {
        setTimeout(() => {
          initializeTutorial();
        }, 2000);
      }
    }
    function handlePanelAction(action, payload) {
      if (action === 'save') {
        saveSecret();
      } else if (action === 'cancel') {
        resetForm();
      } else if (action === 'secrets-nav') {
        activeSection.value = payload;
        resetForm();
        selectedSecret.value = null;
        store.dispatch('secrets/selectPlugin', null);
      }
    }

    // Provider management functions
    async function saveProvider() {
      if (!isProviderFormValid.value) return;

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          await showAlert('Error', 'Authentication required to create providers.');
          return;
        }

        // Process categories - convert comma-separated string to array
        const categoriesArray = providerForm.value.categories
          .split(',')
          .map((cat) => cat.trim())
          .filter((cat) => cat.length > 0);

        const providerData = {
          id: providerForm.value.id.trim(),
          name: providerForm.value.name.trim(),
          icon: providerForm.value.icon.trim() || 'fas fa-plug',
          categories: categoriesArray,
          connectionType: providerForm.value.connectionType,
          instructions: providerForm.value.instructions.trim(),
          customPrompt: providerForm.value.customPrompt.trim(),
        };

        // Use local backend - it will proxy to remote AND cache locally
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/providers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(providerData),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        // Show success message
        await showAlert('Success', `Provider "${providerData.name}" created successfully!`);

        // Add to terminal log
        terminalLines.value.push(`[Providers] Created new provider: ${providerData.name}`);
        nextTick(() => baseScreenRef.value?.scrollToBottom());

        // Reset form and refresh providers list
        resetProviderForm();
        await store.dispatch('appAuth/fetchAllProviders');

        // Switch to OAuth tab to see the new provider
        activeTab.value = 'oauth';
      } catch (error) {
        console.error('Error creating provider:', error);
        await showAlert('Error', `Failed to create provider: ${error.message}`);
      }
    }

    function resetProviderForm() {
      providerForm.value = {
        id: '',
        name: '',
        icon: '',
        categories: '',
        connectionType: 'apikey',
        instructions: '',
        customPrompt: '',
        // OAuth config fields
        redirectUri: '',
        scope: '',
        authUrl: '',
        authParams: '',
        tokenUrl: '',
        tokenParams: '',
        tokenHeaders: '',
        refreshUrl: '',
        refreshParams: '',
        refreshHeaders: '',
        providerCode: '',
      };
      editingProvider.value = null;
    }

    function editProvider(provider) {
      editingProvider.value = provider.id;
      const categoriesStr = Array.isArray(provider.categories) ? provider.categories.join(', ') : provider.categories || '';

      providerForm.value = {
        id: provider.id,
        name: provider.name,
        icon: provider.icon || '',
        categories: categoriesStr,
        connectionType: provider.connection_type || 'apikey',
        instructions: provider.instructions || '',
        customPrompt: provider.custom_prompt || '',
        // OAuth config fields - handle both snake_case and camelCase
        redirectUri: provider.redirect_uri || '',
        scope: provider.scope || '',
        authUrl: provider.auth_url || '',
        authParams: provider.auth_params || '',
        tokenUrl: provider.token_url || '',
        tokenParams: provider.token_params || '',
        tokenHeaders: provider.token_headers || '',
        refreshUrl: provider.refresh_url || '',
        refreshParams: provider.refresh_params || '',
        refreshHeaders: provider.refresh_headers || '',
        providerCode: provider.provider_code || '',
      };
      showEditProviderModal.value = true;
    }

    function closeEditProviderModal() {
      showEditProviderModal.value = false;
      resetProviderForm();
    }

    async function updateProvider() {
      if (!isProviderFormValid.value) return;

      try {
        const categoriesArray = providerForm.value.categories
          .split(',')
          .map((cat) => cat.trim())
          .filter((cat) => cat.length > 0);

        const providerData = {
          name: providerForm.value.name.trim(),
          icon: providerForm.value.icon.trim() || 'custom',
          categories: categoriesArray,
          connectionType: providerForm.value.connectionType,
          instructions: providerForm.value.instructions.trim(),
          customPrompt: providerForm.value.customPrompt.trim(),
          // Include OAuth config fields
          redirectUri: providerForm.value.redirectUri.trim(),
          scope: providerForm.value.scope.trim(),
          authUrl: providerForm.value.authUrl.trim(),
          authParams: providerForm.value.authParams.trim(),
          tokenUrl: providerForm.value.tokenUrl.trim(),
          tokenParams: providerForm.value.tokenParams.trim(),
          tokenHeaders: providerForm.value.tokenHeaders.trim(),
          refreshUrl: providerForm.value.refreshUrl.trim(),
          refreshParams: providerForm.value.refreshParams.trim(),
          refreshHeaders: providerForm.value.refreshHeaders.trim(),
          providerCode: providerForm.value.providerCode.trim(),
        };

        const result = await store.dispatch('appAuth/updateProvider', {
          id: providerForm.value.id,
          providerData,
        });

        if (result.success) {
          await showAlert('Success', `Provider "${providerForm.value.name}" updated successfully!`);
          terminalLines.value.push(`[Providers] Updated provider: ${providerForm.value.name}`);
          nextTick(() => baseScreenRef.value?.scrollToBottom());
          closeEditProviderModal();
        } else {
          throw new Error(result.error || 'Failed to update provider');
        }
      } catch (error) {
        console.error('Error updating provider:', error);
        await showAlert('Error', `Failed to update provider: ${error.message}`);
      }
    }

    async function deleteProviderConfirm() {
      const confirmDelete = await modalRef.value?.showModal({
        title: 'Confirm Deletion',
        message: `Are you sure you want to delete the provider "${providerForm.value.name}"? This cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });

      if (!confirmDelete) return;

      try {
        const result = await store.dispatch('appAuth/deleteProvider', providerForm.value.id);

        if (result.success) {
          await showAlert('Success', `Provider "${providerForm.value.name}" deleted successfully!`);
          terminalLines.value.push(`[Providers] Deleted provider: ${providerForm.value.name}`);
          nextTick(() => baseScreenRef.value?.scrollToBottom());
          closeEditProviderModal();
        } else {
          throw new Error(result.error || 'Failed to delete provider');
        }
      } catch (error) {
        console.error('Error deleting provider:', error);
        await showAlert('Error', `Failed to delete provider: ${error.message}`);
      }
    }

    function openAddProviderModal() {
      resetProviderForm();
      showAddProviderModal.value = true;
    }

    function closeProviderModal() {
      showEditProviderModal.value = false;
      showAddProviderModal.value = false;
      resetProviderForm();
    }

    async function saveProviderFromModal() {
      if (!isProviderFormValid.value) return;

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          await showAlert('Error', 'Authentication required to create providers.');
          return;
        }

        const categoriesArray = providerForm.value.categories
          .split(',')
          .map((cat) => cat.trim())
          .filter((cat) => cat.length > 0);

        const providerData = {
          id: providerForm.value.id.trim(),
          name: providerForm.value.name.trim(),
          icon: providerForm.value.icon.trim() || 'fas fa-plug',
          categories: categoriesArray,
          connectionType: providerForm.value.connectionType,
          instructions: providerForm.value.instructions.trim(),
          customPrompt: providerForm.value.customPrompt.trim(),
        };

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/providers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(providerData),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        await showAlert('Success', `Provider "${providerData.name}" created successfully!`);
        terminalLines.value.push(`[Providers] Created new provider: ${providerData.name}`);
        nextTick(() => baseScreenRef.value?.scrollToBottom());

        closeProviderModal();
        await store.dispatch('appAuth/fetchAllProviders');
      } catch (error) {
        console.error('Error creating provider:', error);
        await showAlert('Error', `Failed to create provider: ${error.message}`);
      }
    }

    // OAuth callback completion function
    async function completeOAuth(code, state, provider) {
      try {
        const token = localStorage.getItem('token');

        // Split state into its components
        const stateParts = state.split(':');
        const providerId = stateParts[0]; // Take the first part as provider

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/callback`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            state, // Send the entire state string
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.success) {
          // Refresh the connected apps list
          await store.dispatch('appAuth/fetchConnectedApps');
          await store.dispatch('appAuth/fetchAllProviders');

          // Show success message
          await showAlert('Success', `Successfully connected to ${data.provider || provider}`);

          // Add to terminal log
          terminalLines.value.push(`[OAuth] Successfully connected to ${data.provider || provider}`);
          nextTick(() => baseScreenRef.value?.scrollToBottom());
        } else {
          throw new Error('OAuth completion failed');
        }
      } catch (error) {
        console.error('Error completing OAuth:', error);
        await showAlert('OAuth Error', `Failed to complete OAuth: ${error.message}`);

        // Add error to terminal log
        terminalLines.value.push(`[OAuth] Failed to complete OAuth: ${error.message}`);
        nextTick(() => baseScreenRef.value?.scrollToBottom());
      }
    }

    function handleOAuthMessage(event) {
      // Handle legacy oauth-success message
      if (event.data && event.data.type === 'oauth-success') {
        store.dispatch('appAuth/fetchConnectedApps');
        showAlert('Success', 'OAuth connection successful!');
      }
      // Handle new oauth-callback message from postMessage approach (for Electron)
      else if (event.data && event.data.type === 'oauth-callback') {
        console.log('OAuth callback received via postMessage:', event.data);
        const { code, state, provider } = event.data;
        if (code && state) {
          // Complete the OAuth flow
          completeOAuth(code, state, provider);
        }
      }
    }

    // MCP Server management functions
    function closeMCPServerForm() {
      showAddMCPServerForm.value = false;
      editingMCPServer.value = null;
      mcpServerForm.value = {
        name: '',
        transportType: 'http',
        endpoint: '',
        command: '',
        argsText: '',
        envText: '',
      };
    }

    function editMCPServer(server) {
      editingMCPServer.value = server.name;
      mcpServerForm.value = {
        name: server.name,
        transportType: server.transport.type,
        endpoint: server.transport.endpoint || '',
        command: server.transport.command || '',
        argsText: server.transport.args ? server.transport.args.join('\n') : '',
        envText: server.transport.env
          ? Object.entries(server.transport.env)
              .map(([key, value]) => `${key}=${value}`)
              .join('\n')
          : '',
      };
    }

    async function saveMCPServer() {
      if (!isMCPServerFormValid.value) return;

      try {
        // Build server configuration
        const serverConfig = {
          name: mcpServerForm.value.name.trim(),
          transport: {
            type: mcpServerForm.value.transportType,
          },
        };

        if (mcpServerForm.value.transportType === 'http') {
          serverConfig.transport.endpoint = mcpServerForm.value.endpoint.trim();
        } else if (mcpServerForm.value.transportType === 'stdio') {
          serverConfig.transport.command = mcpServerForm.value.command.trim();

          // Parse args from text
          if (mcpServerForm.value.argsText.trim()) {
            serverConfig.transport.args = mcpServerForm.value.argsText
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
          }

          // Parse env from text
          if (mcpServerForm.value.envText.trim()) {
            serverConfig.transport.env = {};
            mcpServerForm.value.envText
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
              .forEach((line) => {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                  serverConfig.transport.env[key.trim()] = valueParts.join('=').trim();
                }
              });
          }
        }

        let result;
        if (editingMCPServer.value) {
          // Update existing server
          result = await store.dispatch('mcpServers/updateServer', {
            oldName: editingMCPServer.value,
            server: serverConfig,
          });
        } else {
          // Add new server
          result = await store.dispatch('mcpServers/addServer', serverConfig);
        }

        if (result.success) {
          // Refresh the servers list from the backend to ensure UI is in sync
          await store.dispatch('mcpServers/fetchServers');

          await showAlert('Success', result.message || 'Server saved successfully!');
          terminalLines.value.push(`[MCP] ${editingMCPServer.value ? 'Updated' : 'Added'} server: ${serverConfig.name}`);
          nextTick(() => baseScreenRef.value?.scrollToBottom());
          closeMCPServerForm();
        } else {
          throw new Error(result.error || 'Failed to save server');
        }
      } catch (error) {
        console.error('Error saving MCP server:', error);
        await showAlert('Error', `Failed to save server: ${error.message}`);
      }
    }

    async function deleteMCPServerConfirm(server) {
      const confirmDelete = await modalRef.value?.showModal({
        title: 'Confirm Deletion',
        message: `Are you sure you want to delete the MCP server "${server.name}"? This cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });

      if (!confirmDelete) return;

      try {
        const result = await store.dispatch('mcpServers/deleteServer', server.name);
        if (result.success) {
          // Refresh the servers list from the backend to ensure UI is in sync
          await store.dispatch('mcpServers/fetchServers');

          await showAlert('Success', result.message || 'Server deleted successfully!');
          terminalLines.value.push(`[MCP] Deleted server: ${server.name}`);
          nextTick(() => baseScreenRef.value?.scrollToBottom());
        } else {
          throw new Error(result.error || 'Failed to delete server');
        }
      } catch (error) {
        console.error('Error deleting MCP server:', error);
        await showAlert('Error', `Failed to delete server: ${error.message}`);
      }
    }

    async function testMCPConnection(serverName) {
      testingConnection.value = serverName;
      try {
        const result = await store.dispatch('mcpServers/testConnection', serverName);
        if (result.success) {
          if (result.connected === true) {
            await showAlert('Connection Test', `✓ ${result.message}`);
          } else if (result.connected === false) {
            await showAlert('Connection Test', `✗ ${result.message}`);
          } else {
            await showAlert('Connection Test', result.message);
          }
        } else {
          throw new Error(result.error || 'Connection test failed');
        }
      } catch (error) {
        console.error('Error testing MCP connection:', error);
        await showAlert('Connection Test', `Failed to test connection: ${error.message}`);
      } finally {
        testingConnection.value = null;
      }
    }

    async function toggleCapabilities(serverName) {
      // Toggle expansion
      if (expandedServers.value.has(serverName)) {
        expandedServers.value.delete(serverName);
        return;
      }

      // Fetch capabilities if not already loaded
      if (!serverCapabilities.value[serverName]) {
        loadingCapabilities.value = serverName;
        try {
          const result = await store.dispatch('mcpServers/getServerCapabilities', serverName);
          if (result.success) {
            serverCapabilities.value[serverName] = result.capabilities;
            expandedServers.value.add(serverName);
          } else {
            await showAlert('Error', result.error || 'Failed to fetch capabilities');
          }
        } catch (error) {
          await showAlert('Error', `Failed to fetch capabilities: ${error.message}`);
        } finally {
          loadingCapabilities.value = null;
        }
      } else {
        expandedServers.value.add(serverName);
      }
    }

    // NPM Browser functions
    async function searchNPMPackages() {
      if (!npmSearchQuery.value.trim()) return;

      isSearchingNPM.value = true;
      try {
        const result = await store.dispatch('mcpServers/searchNPMPackages', npmSearchQuery.value);
        if (result.success) {
          npmSearchResults.value = result.packages;
        } else {
          await showAlert('Search Error', result.error || 'Failed to search NPM packages');
        }
      } catch (error) {
        console.error('Error searching NPM:', error);
        await showAlert('Search Error', `Failed to search: ${error.message}`);
      } finally {
        isSearchingNPM.value = false;
      }
    }

    async function loadPopularServers() {
      loadingPopular.value = true;
      try {
        const result = await store.dispatch('mcpServers/fetchPopularServers');
        if (result.success) {
          popularPackages.value = result.packages;
        }
      } catch (error) {
        console.error('Error loading popular servers:', error);
      } finally {
        loadingPopular.value = false;
      }
    }

    function selectNPMPackage(pkg) {
      // Auto-fill the form with NPM package details - keep the original package name
      mcpServerForm.value = {
        name: pkg.name,
        transportType: 'stdio',
        endpoint: '',
        command: 'npx',
        argsText: `-y\n${pkg.name}`,
        envText: '',
      };

      // Close NPM browser and open add form
      showNPMBrowser.value = false;
      showAddMCPServerForm.value = true;

      terminalLines.value.push(`[NPM] Selected package: ${pkg.name}`);
      nextTick(() => baseScreenRef.value?.scrollToBottom());
    }

    // Watch for NPM browser opening to load popular servers
    async function openNPMBrowser() {
      showNPMBrowser.value = true;
      if (popularPackages.value.length === 0) {
        await loadPopularServers();
      }
    }

    onMounted(async () => {
      window.addEventListener('message', handleOAuthMessage);

      // Load MCP servers for all users
      if (store.state.mcpServers.servers.length === 0) {
        store.dispatch('mcpServers/fetchServers');
      }

      // Check for OAuth callback parameters
      const code = route.query.code;
      const state = route.query.state;
      const provider = route.query.provider;

      if (code && state) {
        console.log('OAuth callback detected in Secrets screen:', { code, state, provider });

        // Process the OAuth callback
        await completeOAuth(code, state, provider);

        // Clean up the URL by removing query parameters
        router.replace({ query: {} });
      }
    });

    onUnmounted(() => {
      window.removeEventListener('message', handleOAuthMessage);
    });

    function openWorkflow(workflowId) {
      router.push({ path: '/workflow-forge', query: { id: workflowId } });
    }

    // Handle click-away to close the right plugin panel
    function handlePluginAreaClick(event) {
      // Check if the click target is a plugin card or inside one
      const pluginCard = event.target.closest('.plugin-card');
      if (!pluginCard) {
        // Clicked outside plugin cards, deselect the plugin to close the right panel
        store.dispatch('secrets/selectPlugin', null);
      }
    }

    return {
      baseScreenRef,
      activeRightPanel,
      showAlert,
      terminalLines,
      activeSection,
      tableColumns,
      filteredSecrets,
      selectSecret,
      editSecret,
      deleteSecretConfirm,
      form,
      saveSecret,
      resetForm,
      handleSearch,
      typeOptions,
      popup: popup.value,
      initializeScreen,
      emit,
      selectedSecret,
      oauthProviders,
      oauthSearch,
      connectOAuthApp,
      disconnectApp,
      handleOAuthAppClick,
      isLoadingProviders,
      modalRef,
      handlePanelAction,
      filteredOAuthProviders,
      // New filtering features
      selectedCategory,
      connectionStatusFilter,
      viewMode,
      currentPage,
      availableCategories,
      paginatedProviders,
      totalPages,
      categoryCounts,
      handleOAuthSearch,
      // Provider form
      providerForm,
      connectionTypeOptions,
      isProviderFormValid,
      saveProvider,
      resetProviderForm,
      editProvider,
      updateProvider,
      deleteProviderConfirm,
      closeEditProviderModal,
      showEditProviderModal,
      showAddProviderModal,
      editingProvider,
      openAddProviderModal,
      closeProviderModal,
      saveProviderFromModal,
      // Tutorial
      tutorialConfig,
      startTutorial,
      currentStep,
      onTutorialClose,
      nextStep,
      // MCP Servers
      mcpServers,
      isLoadingMCPServers,
      mcpSearch,
      filteredMCPServers,
      showAddMCPServerForm,
      showNPMBrowser,
      editingMCPServer,
      testingConnection,
      loadingCapabilities,
      serverCapabilities,
      expandedServers,
      mcpServerForm,
      mcpTransportTypes,
      isMCPServerFormValid,
      closeMCPServerForm,
      editMCPServer,
      saveMCPServer,
      deleteMCPServerConfirm,
      testMCPConnection,
      toggleCapabilities,
      // NPM Browser
      npmSearchQuery,
      npmSearchResults,
      isSearchingNPM,
      popularPackages,
      loadingPopular,
      searchNPMPackages,
      selectNPMPackage,
      openNPMBrowser,
      openWorkflow,
      handlePluginAreaClick,
      isPro,
    };
  },
};
</script>

<style scoped>
.secrets-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1048px;
  margin: 0 auto;
  align-items: flex-start;
}

.content-header {
  padding: 0;
  border-bottom: 1px solid var(--terminal-border-color);
  padding-bottom: 16px;
  width: 100%;
  max-width: 1048px;
}

.content-title {
  /* color: var(--color-green); */
  font-size: 1.8em;
  font-weight: 600;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.pro-badge-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.5em;
  color: var(--color-yellow);
  background: rgba(255, 215, 0, 0.15);
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid rgba(255, 215, 0, 0.4);
  font-weight: 600;
}

.form-wrapper {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.content-subtitle {
  color: var(--color-light-med-navy);
  font-size: 1em;
  margin: 0;
  opacity: 0.8;
  line-height: 1.4;
}

.secrets-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  margin: 0;
}

.secrets-section {
  background: var(--color-dull-white);
  border: 1px solid var(--color-light-navy);
  padding: 24px;
  transition: all 0.3s ease;
  border-radius: 16px;
}

body.dark .secrets-section {
  background: rgba(0, 0, 0, 10%);
  border: 1px solid var(--terminal-border-color);
}

.secrets-section.full-width,
body.dark .secrets-section.full-width {
  background: transparent;
  border: none;
}

.add-provider-form {
  background: transparent;
  padding: 0;
  border: none;
  max-width: 100%;
}
.form-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.form-row.full-width {
  flex-direction: column;
}

.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--terminal-border-color);
}

.plugins-header {
  margin-bottom: 24px;
}

.plugins-header h3 {
  margin: 0 0 8px 0;
  font-size: 1.5em;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 12px;
}

body.dark .form-actions {
  border-top: 1px solid var(--terminal-border-color);
}
.secret-value {
  letter-spacing: 0.2em;
  color: var(--color-grey);
  font-size: 1.1em;
}

.oauth-providers-list {
  background: transparent;
  border-radius: 0;
  padding: 0;
  border: none;
}
.oauth-app-grid {
  display: flex;
  gap: 8.6px;
  flex-wrap: wrap;
  flex-direction: row;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
}

.oauth-app-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  border: 2px solid var(--color-text-muted);
  border-radius: 8px;
  /* padding: 8px 0 0; */
  transition: all 0.3s ease;
  min-width: 88px;
  min-height: 88px;
  justify-content: center;
}

.oauth-app-item.connected {
  border-color: var(--color-green);
}

.edit-provider-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  background: rgba(127, 129, 147, 0.1);
  border: 1px solid rgba(127, 129, 147, 0.2);
  color: var(--color-med-navy);
  border-radius: 4px;
  padding: 4px 6px;
  cursor: pointer;
  font-size: 0.7em;
  opacity: 0;
  transition: all 0.2s ease;
  z-index: 10;
}

.oauth-app-item:hover .edit-provider-btn {
  opacity: 1;
}

.edit-provider-btn:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: var(--color-green);
  color: var(--color-green);
}

.oauth-app-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  width: 100%;
}

.oauth-app-icon :deep(svg) {
  width: 32px;
  height: 32px;
  margin-bottom: 3px;
}

.oauth-app-item:not(.connected) .oauth-app-name {
  color: var(--color-text-muted);
}

.oauth-app-item:not(.connected) .connection-status {
  font-weight: 600;
}

.oauth-app-name {
  margin-top: 4px;
  font-weight: 500;
  text-align: center;
  font-size: 0.9em;
}

.connection-status {
  font-size: 0.8em;
  color: var(--color-text-muted);
}

.connection-status.connected {
  color: var(--color-green);
}

.loading {
  color: var(--color-grey);
  font-size: 1.1em;
  padding: 24px 0;
  text-align: center;
}

::v-deep .col-actions {
  gap: 8px;
  justify-content: flex-end;
}

/* MCP Servers Styles */
.mcp-servers-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: relative;
}

.mcp-servers-list.locked {
  pointer-events: none;
  user-select: none;
}

.locked-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  background: rgba(0, 0, 0, 0.8);
  padding: 24px 32px;
  border-radius: 12px;
  border: 2px solid var(--color-yellow);
  pointer-events: all;
  z-index: 10;
}

.locked-overlay i {
  font-size: 2.5em;
  color: var(--color-yellow);
  margin-bottom: 12px;
  display: block;
}

.locked-overlay p {
  margin: 0;
  color: #fff;
  font-weight: 600;
  font-size: 1.1em;
}

.mcp-server-card {
  background: var(--color-dull-white);
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  padding: 12px 16px;
  transition: all 0.2s ease;
}

.mcp-server-card.locked {
  filter: grayscale(100%);
  opacity: 0.5;
}

body.dark .mcp-server-card {
  background: rgba(0, 0, 0, 10%);
  border: 1px solid var(--terminal-border-color);
}

.mcp-server-card:hover {
  border-color: var(--color-green);
  box-shadow: 0 2px 8px rgba(var(--green-rgb), 0.1);
}

.server-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.server-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.server-name {
  font-size: 1.1em;
  font-weight: 600;
  margin: 0;
  color: var(--color-text);
}

.server-type-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 600;
  text-transform: uppercase;
}

.server-type-badge.http {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.server-type-badge.stdio {
  background: rgba(168, 85, 247, 0.2);
  color: var(--color-indigo);
}

.server-actions {
  display: flex;
  gap: 8px;
}

.server-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-item {
  display: flex;
  gap: 8px;
  font-size: 0.9em;
}

.detail-label {
  font-weight: 600;
  color: var(--color-light-med-navy);
  min-width: 100px;
}

.detail-value {
  color: var(--color-text);
  word-break: break-all;
}

/* MCP Server Form Overlay */
.mcp-server-form-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.mcp-server-form {
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  max-width: 600px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.form-header h3 {
  margin: 0;
  font-size: 1.3em;
  color: var(--color-text);
}

.close-btn {
  background: none;
  border: none;
  color: var(--color-text);
  font-size: 1.5em;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-green);
}

.form-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* .form-group label {
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.9em;
} */
/* 
.form-textarea {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: 0.9em;
  resize: vertical;
  min-height: 80px;
} */
/* 
.form-textarea:focus {
  outline: none;
  border-color: var(--color-green);
} */

.form-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px;
  border-top: 1px solid var(--terminal-border-color);
}

/* NPM Package Browser Styles */
.npm-packages-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  max-height: 500px;
  overflow-y: auto;
}

.npm-package-card {
  background: var(--color-dull-white);
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

body.dark .npm-package-card {
  background: rgba(0, 0, 0, 10%);
  border: 1px solid var(--terminal-border-color);
}

.npm-package-card:hover {
  border-color: var(--color-green);
  box-shadow: 0 2px 8px rgba(var(--green-rgb), 0.1);
  transform: translateY(-2px);
}

.package-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.package-name {
  font-size: 0.95em;
  font-weight: 600;
  margin: 0;
  color: var(--color-text);
  word-break: break-word;
  flex: 1;
}

.package-version {
  font-size: 0.75em;
  color: var(--color-light-med-navy);
  background: rgba(127, 129, 147, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.package-description {
  font-size: 0.85em;
  color: var(--color-light-med-navy);
  margin: 0;
  line-height: 1.4;
  display: -webkit-box;
  /* -webkit-line-clamp: 2; */
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.package-meta {
  display: flex;
  gap: 12px;
  font-size: 0.75em;
  color: var(--color-light-med-navy);
  margin-top: 4px;
}

.package-author,
.package-score {
  display: flex;
  align-items: center;
  gap: 4px;
}

.package-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
  padding-top: 8px;
}

.npm-link {
  color: var(--color-light-med-navy);
  font-size: 0.9em;
  transition: color 0.2s ease;
  padding: 4px;
}

.oauth-config-section {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
}

.oauth-config-section .form-field,
.oauth-config-section .form-group {
  width: 100% !important;
}

.npm-link:hover {
  color: var(--color-green);
}

/* Server Capabilities Styles */
.server-capabilities {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--terminal-border-color);
}

.capabilities-section {
  margin-bottom: 16px;
}

.capabilities-section:last-child {
  margin-bottom: 0;
}

.capabilities-section h4 {
  margin: 0 0 8px 0;
  color: var(--color-text);
  font-size: 0.95em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.capabilities-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.capability-item {
  background: rgba(127, 129, 147, 0.05);
  padding: 8px 12px;
  border-radius: 4px;
  border-left: 3px solid var(--color-green);
}

body.dark .capability-item {
  background: rgba(var(--green-rgb), 0.05);
}

.capability-item strong {
  display: block;
  color: var(--color-text);
  margin-bottom: 4px;
  font-size: 0.9em;
}

.capability-item p {
  margin: 0;
  font-size: 0.85em;
  color: var(--color-light-med-navy);
  line-height: 1.4;
}

.no-items {
  color: var(--color-grey);
  font-style: italic;
  margin: 0;
  font-size: 0.9em;
}

/* New Filtering UI Styles */
.controls-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
}

.search-wrapper {
  flex: 1;
  min-width: 0;
}

.controls-group {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.controls-group :deep(.custom-select),
.controls-group :deep(.base-select),
.controls-group :deep(select) {
  min-width: 160px !important;
  width: auto !important;
}

.controls-group :deep(.custom-select .select-wrapper),
.controls-group :deep(.base-select .select-wrapper) {
  min-width: 180px !important;
  width: auto !important;
}
/* 
.controls-group :deep(.base-button),
.controls-group :deep(button.base-button) {
  height: 100% !important;
  min-height: auto !important;
  max-height: none !important;
} */

.view-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--color-light-navy);
}

body.dark .view-toggle {
  border-color: var(--terminal-border-color);
}

.view-btn {
  background: transparent;
  border: none;
  padding: 8px 12px;
  cursor: pointer;
  color: var(--color-text);
  transition: all 0.2s ease;
  font-size: 0.9em;
}

.view-btn:hover {
  background: rgba(127, 129, 147, 0.1);
}

.view-btn.active {
  background: var(--color-green);
  color: var(--color-dark-navy);
}

.view-btn:not(:last-child) {
  border-right: 1px solid var(--color-light-navy);
}

body.dark .view-btn:not(:last-child) {
  border-right-color: var(--terminal-border-color);
}

.add-btn {
  background: var(--color-green);
  color: var(--color-navy);
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
  font-weight: 500;
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.add-btn:hover {
  background: transparent;
  outline: 2px solid var(--color-green);
  color: var(--color-text);
  /* transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(var(--green-rgb), 0.3); */
}

/* Category Pills */
.category-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-light-navy);
}

body.dark .category-pills {
  border-bottom-color: var(--terminal-border-color);
}

.category-pill {
  background: var(--color-dull-white);
  border: 2px solid var(--color-light-navy);
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text);
  white-space: nowrap;
}

body.dark .category-pill {
  background: rgba(0, 0, 0, 20%);
  border-color: var(--terminal-border-color);
}

.category-pill:hover {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.1);
  transform: translateY(-1px);
}

.category-pill.active {
  background: var(--color-green);
  border-color: var(--color-green) !important;
  /* color: var(--color-primary); */
  /* font-weight: 600; */
}

/* Results Info */
.results-info {
  font-size: 0.9em;
  color: var(--color-light-med-navy);
  margin-bottom: 16px;
  padding: 8px 12px;
  background: rgba(127, 129, 147, 0.05);
  border-radius: 6px;
  border-left: 3px solid var(--color-green);
}

body.dark .results-info {
  background: rgba(var(--green-rgb), 0.05);
}

/* List View Styles */
.oauth-app-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.oauth-list-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: var(--color-dull-white);
  border: 2px solid var(--color-light-navy);
  border-radius: 8px;
  transition: all 0.2s ease;
  cursor: pointer;
}

body.dark .oauth-list-item {
  background: rgba(0, 0, 0, 10%);
  border-color: var(--terminal-border-color);
}

.oauth-list-item:hover {
  border-color: var(--color-green);
  box-shadow: 0 2px 8px rgba(var(--green-rgb), 0.1);
  transform: translateX(4px);
}

.oauth-list-item.connected {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.03);
}

.list-item-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.list-item-icon :deep(svg) {
  width: 32px;
  height: 32px;
}

.list-item-content {
  flex: 1;
  min-width: 0;
}

.list-item-name {
  font-weight: 600;
  font-size: 1em;
  color: var(--color-text);
  margin-bottom: 4px;
}

.list-item-categories {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.category-tag {
  font-size: 0.75em;
  padding: 2px 8px;
  background: rgba(127, 129, 147, 0.15);
  border-radius: 10px;
  color: var(--color-light-med-navy);
  font-weight: 500;
}

body.dark .category-tag {
  background: rgba(127, 129, 147, 0.25);
}

.list-item-status {
  flex-shrink: 0;
  min-width: 120px;
  text-align: right;
}

.list-item-status .connection-status {
  font-size: 0.85em;
  font-weight: 600;
}

.list-item-actions {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
}

.action-btn {
  background: rgba(127, 129, 147, 0.1);
  border: 1px solid var(--color-light-navy);
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  color: var(--color-text);
  transition: all 0.2s ease;
  font-size: 0.9em;
}

body.dark .action-btn {
  border-color: var(--terminal-border-color);
}

.action-btn:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: var(--color-green);
  color: var(--color-green);
}

/* Pagination Styles */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--color-light-navy);
}

body.dark .pagination {
  border-top-color: var(--terminal-border-color);
}

.page-btn {
  background: var(--color-dull-white);
  border: 2px solid var(--color-light-navy);
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
  color: var(--color-text);
  font-weight: 500;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;
}

body.dark .page-btn {
  background: rgba(0, 0, 0, 10%);
  border-color: var(--terminal-border-color);
}

.page-btn:hover:not(:disabled) {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.1);
  transform: translateY(-1px);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: 0.9em;
  color: var(--color-text);
  font-weight: 500;
  padding: 0 8px;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .controls-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .search-wrapper {
    width: 100%;
  }

  .controls-group {
    justify-content: space-between;
  }

  .category-pills {
    max-height: 120px;
    overflow-y: auto;
  }

  .oauth-list-item {
    flex-wrap: wrap;
  }

  .list-item-status {
    order: 3;
    width: 100%;
    text-align: left;
    margin-top: 8px;
  }
}
</style>
