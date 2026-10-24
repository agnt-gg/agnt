<!-- MCP servers: add, edit, test and remove MCP servers, and find them on NPM.
     Moved out of the Plugins screen (Connectors.vue) so AGNT One's Apps page
     can show it as a tab too (2026-10-23); both use this one component. -->
<template>
  <div class="mcp-servers-panel">
    <SimpleModal ref="modalRef" />
      <!-- Hidden as a tab (the tab says what this is). -->
      <div v-if="!compact" class="content-header">
        <h2 class="content-title">MCP / NPM Library</h2>
        <p class="content-subtitle">Manage Model Context Protocol server connections. Enjoy access to over 2 million packages via NPM.</p>
      </div>
      <div class="connectors-grid">
        <div class="connectors-section full-width">
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
          <Teleport to="body"><div v-if="showNPMBrowser" class="mcp-server-form-overlay" @click.self="showNPMBrowser = false">
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
          </div></Teleport>

          <!-- Add/Edit Server Form -->
          <Teleport to="body"><div v-if="showAddMCPServerForm || editingMCPServer" class="mcp-server-form-overlay" @click.self="closeMCPServerForm">
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
          </div></Teleport>
        </div>
      </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import BaseInput from '@/views/Terminal/_components/BaseInput.vue';
import BaseSelect from '@/views/Terminal/_components/BaseSelect.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

export default {
  name: 'McpServers',
  props: { compact: { type: Boolean, default: false } },
  components: { BaseButton, BaseInput, BaseSelect, SimpleModal },
  setup() {
    const store = useStore();
    const modalRef = ref(null);
    const planType = computed(() => store.getters['userAuth/planType'] || 'free');
    const isPro = computed(() => planType.value !== 'free');
    async function showAlert(title, message) {
      await modalRef.value?.showModal({ title, message, confirmText: 'OK', showCancel: false });
    }

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
    }

    // Watch for NPM browser opening to load popular servers
    async function openNPMBrowser() {
      showNPMBrowser.value = true;
      if (popularPackages.value.length === 0) {
        await loadPopularServers();
      }
    }

    onMounted(() => {
      if (store.state.mcpServers.servers.length === 0) store.dispatch('mcpServers/fetchServers');
    });

    return {
      modalRef,
      isPro,
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
      npmSearchQuery,
      npmSearchResults,
      isSearchingNPM,
      popularPackages,
      loadingPopular,
      searchNPMPackages,
      selectNPMPackage,
      openNPMBrowser,
    };
  },
};
</script>

<style scoped>
/* Moved from Connectors.vue with the markup (MCP-only rules), then copies of
   the shared section rules this markup also uses. */
.pro-badge-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.5em;
  color: var(--text-yellow);
  background: rgba(var(--yellow-rgb), 0.15);
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

.loading {
  color: var(--color-grey);
  font-size: 1.1em;
  padding: 24px 0;
  text-align: center;
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

.mcp-server-card {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 12px 16px;
  transition: all 0.2s ease;
}

.mcp-server-card.locked {
  filter: grayscale(100%);
  opacity: 0.5;
}

body.dark .mcp-server-card {
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
  background: rgba(var(--blue-rgb), 0.2);
  color: var(--text-blue);
}

.server-type-badge.stdio {
  background: rgba(var(--indigo-rgb), 0.2);
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

/* NPM Package Browser Styles */
.npm-packages-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  max-height: 500px;
  overflow-y: auto;
}

.npm-package-card {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

body.dark .npm-package-card {
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
  background: var(--color-darker-0);
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

.npm-link:hover {
  color: var(--text-green);
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
  background: var(--color-darker-0);
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

.connectors-content {
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
  /* color: var(--text-green); */
  font-size: 1.8em;
  font-weight: 600;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.content-subtitle {
  color: var(--color-light-med-navy);
  font-size: 1em;
  margin: 0;
  opacity: 0.8;
  line-height: 1.4;
}

.connectors-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  margin: 0;
}

.connectors-section {
  background: transparent;
  border: none;
  padding: 24px;
  transition: all 0.3s ease;
  border-radius: 16px;
}

.form-row.full-width {
  flex-direction: column;
}

/* MCP Server Form Overlay */
.mcp-server-form-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--scrim);
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
  background: var(--surface-active);
  color: var(--text-green);
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

.oauth-config-section .form-field,
.oauth-config-section .form-group {
  width: 100% !important;
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

.add-btn {
  background: var(--color-green);
  color: var(--text-primary);
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

@media (max-width: 800px) { .vault-content { padding: 12px; } .vault-content .controls-bar { flex-wrap: wrap; gap: 12px; } .vault-content .search-wrapper { width: 100%; flex: 1 0 100%; } .vault-content .controls-group { justify-content: space-between; width: 100%; } .vault-content .content-title-row { flex-wrap: wrap; gap: 10px; } .vault-connection { padding: 12px; gap: 8px; } }
</style>
