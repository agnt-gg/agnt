import { API_CONFIG } from '@/tt.config.js';

export default {
  namespaced: true,
  state: {
    marketplaceItems: [], // Renamed from marketplaceWorkflows
    marketplaceWorkflows: [], // Computed/filtered view for backward compatibility
    marketplaceAgents: [], // NEW
    marketplaceTools: [], // NEW
    marketplacePlugins: [], // NEW - Plugins from marketplace
    featuredItems: [], // Renamed from featuredWorkflows
    featuredWorkflows: [], // Backward compatibility
    myPurchases: [],
    myInstalls: [], // NEW: User's installed items
    myPublishedItems: [], // Renamed from myPublishedWorkflows
    myPublishedWorkflows: [], // Backward compatibility
    myEarnings: null, // NEW: Earnings data
    lastEarningsFetched: null,
    lastPurchasesFetched: null,
    lastInstallsFetched: null,
    lastPublishedFetched: null,
    selectedItem: null, // Renamed from selectedWorkflow
    selectedWorkflow: null, // Backward compatibility
    filters: {
      assetType: 'all', // NEW: 'all', 'workflow', 'agent', 'tool'
      category: null,
      priceRange: 'all', // free, paid, all
      minRating: 0,
      tags: [],
      sortBy: 'popular', // popular, recent, rating, downloads, price-low, price-high
      search: '',
    },
    isLoading: false,
    error: null,
  },
  mutations: {
    SET_MARKETPLACE_ITEMS(state, items) {
      state.marketplaceItems = items;
      // Update filtered views for backward compatibility
      state.marketplaceWorkflows = items.filter((i) => i.asset_type === 'workflow');
      state.marketplaceAgents = items.filter((i) => i.asset_type === 'agent');
      state.marketplaceTools = items.filter((i) => i.asset_type === 'tool');
      state.marketplacePlugins = items.filter((i) => i.asset_type === 'plugin');
    },
    SET_MARKETPLACE_WORKFLOWS(state, workflows) {
      // Backward compatibility
      state.marketplaceWorkflows = workflows;
      state.marketplaceItems = workflows;
    },
    SET_FEATURED_ITEMS(state, items) {
      state.featuredItems = items;
      state.featuredWorkflows = items.filter((i) => i.asset_type === 'workflow');
    },
    SET_FEATURED_WORKFLOWS(state, workflows) {
      // Backward compatibility
      state.featuredWorkflows = workflows;
      state.featuredItems = workflows;
    },
    SET_MY_PURCHASES(state, purchases) {
      state.myPurchases = purchases;
    },
    SET_MY_PUBLISHED_ITEMS(state, items) {
      state.myPublishedItems = items;
      state.myPublishedWorkflows = items.filter((i) => i.asset_type === 'workflow');
    },
    SET_MY_PUBLISHED(state, workflows) {
      // Backward compatibility
      state.myPublishedWorkflows = workflows;
      state.myPublishedItems = workflows;
    },
    SET_SELECTED_ITEM(state, item) {
      state.selectedItem = item;
      state.selectedWorkflow = item; // Backward compatibility
    },
    SET_SELECTED_WORKFLOW(state, workflow) {
      // Backward compatibility
      state.selectedWorkflow = workflow;
      state.selectedItem = workflow;
    },
    UPDATE_FILTERS(state, filters) {
      state.filters = { ...state.filters, ...filters };
    },
    SET_LOADING(state, isLoading) {
      state.isLoading = isLoading;
    },
    SET_ERROR(state, error) {
      state.error = error;
    },
    CLEAR_ERROR(state) {
      state.error = null;
    },
    ADD_PUBLISHED_ITEM(state, item) {
      // Add newly published item to marketplace items
      state.marketplaceItems.push(item);

      // Update filtered views based on asset type
      if (item.asset_type === 'workflow') {
        state.marketplaceWorkflows.push(item);
      } else if (item.asset_type === 'agent') {
        state.marketplaceAgents.push(item);
      } else if (item.asset_type === 'tool') {
        state.marketplaceTools.push(item);
      }
    },
    SET_MY_EARNINGS(state, earnings) {
      state.myEarnings = earnings;
      state.lastEarningsFetched = Date.now();
    },
    SET_MY_INSTALLS(state, installs) {
      state.myInstalls = installs;
      state.lastInstallsFetched = Date.now();
    },
    SET_LAST_PURCHASES_FETCHED(state, timestamp) {
      state.lastPurchasesFetched = timestamp;
    },
    SET_LAST_PUBLISHED_FETCHED(state, timestamp) {
      state.lastPublishedFetched = timestamp;
    },
  },
  actions: {
    // NEW: Generic fetch for all item types
    async fetchMarketplaceItems({ commit, state }) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        const params = new URLSearchParams();

        if (state.filters.assetType && state.filters.assetType !== 'all') params.append('assetType', state.filters.assetType);
        if (state.filters.category) params.append('category', state.filters.category);
        if (state.filters.minRating) params.append('minRating', state.filters.minRating);
        if (state.filters.priceRange !== 'all') params.append('priceRange', state.filters.priceRange);
        if (state.filters.search) params.append('search', state.filters.search);
        if (state.filters.sortBy) params.append('sortBy', state.filters.sortBy);

        const queryString = params.toString();
        const url = `${API_CONFIG.REMOTE_URL}/marketplace/items${queryString ? `?${queryString}` : ''}`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        commit('SET_MARKETPLACE_ITEMS', data.items || []);
      } catch (error) {
        console.error('Error fetching marketplace items:', error);
        commit('SET_ERROR', error.message);
        commit('SET_MARKETPLACE_ITEMS', []);
      } finally {
        commit('SET_LOADING', false);
      }
    },

    // Backward compatibility
    async fetchMarketplaceWorkflows({ commit, state }) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        const params = new URLSearchParams();

        if (state.filters.category) params.append('category', state.filters.category);
        if (state.filters.minRating) params.append('minRating', state.filters.minRating);
        if (state.filters.priceRange !== 'all') params.append('priceRange', state.filters.priceRange);
        if (state.filters.search) params.append('search', state.filters.search);
        if (state.filters.sortBy) params.append('sortBy', state.filters.sortBy);

        const queryString = params.toString();
        const url = `${API_CONFIG.REMOTE_URL}/marketplace/workflows${queryString ? `?${queryString}` : ''}`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        commit('SET_MARKETPLACE_WORKFLOWS', data.workflows);
      } catch (error) {
        console.error('Error fetching marketplace workflows:', error);
        commit('SET_ERROR', error.message);
        commit('SET_MARKETPLACE_WORKFLOWS', []);
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async fetchFeaturedWorkflows({ commit }) {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/workflows/featured`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        commit('SET_FEATURED_WORKFLOWS', data.workflows);
      } catch (error) {
        console.error('Error fetching featured workflows:', error);
        commit('SET_ERROR', error.message);
      }
    },

    async fetchWorkflowDetails({ commit }, workflowId) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/workflows/${workflowId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        commit('SET_SELECTED_WORKFLOW', data.workflow);
        return data.workflow;
      } catch (error) {
        console.error('Error fetching workflow details:', error);
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async purchaseItem({ commit }, { itemId, successUrl, cancelUrl }) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/items/${itemId}/purchase`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            success_url: successUrl || `${window.location.origin}/marketplace?payment=success&itemId=${itemId}`,
            cancel_url: cancelUrl || `${window.location.origin}/marketplace?payment=cancelled`,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to create checkout session');
        }

        // Open Stripe checkout in external browser (for Electron)
        if (data.url) {
          if (window.electron?.openExternalUrl) {
            window.electron.openExternalUrl(data.url);
          } else {
            window.open(data.url, '_blank');
          }
        }

        return data;
      } catch (error) {
        console.error('Error purchasing item:', error);
        commit('SET_ERROR', error.message);

        // Provide specific error messages
        if (error.message.includes('Stripe price configured')) {
          throw new Error('This item has invalid payment setup. Please contact the publisher.');
        } else if (error.message.includes('Stripe Connect')) {
          throw new Error('Publisher has not completed payment setup.');
        }

        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async checkPurchaseStatus({ commit }, itemId) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          return false;
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/my-purchases`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        const purchases = data.purchases || [];

        return purchases.some((p) => p.marketplace_item_id === itemId && p.status === 'completed');
      } catch (error) {
        console.error('Error checking purchase status:', error);
        return false;
      }
    },

    async installWorkflow({ commit, dispatch, state }, { workflowId, version, auto_update, skipDependencyCheck = false }) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        // Step 1: Call remote API to get asset data and track install
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/workflows/${workflowId}/install`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ version, auto_update }),
        });

        const data = await response.json();

        if (!response.ok) {
          // If payment required, throw specific error
          if (response.status === 402) {
            const error = new Error('Payment required');
            error.code = 'PAYMENT_REQUIRED';
            error.itemId = workflowId;
            throw error;
          }
          throw new Error(data.error || 'Failed to install item');
        }

        // Step 2: Save asset to LOCAL backend based on type
        const { assetType, assetData, assetId } = data;

        // Step 2.5: Check for missing plugin dependencies (for workflows and agents)
        if (!skipDependencyCheck && (assetType === 'workflow' || assetType === 'agent')) {
          const nodes = assetData.nodes || assetData.workflow?.nodes || [];
          if (nodes.length > 0) {
            try {
              const depResponse = await fetch(`${API_CONFIG.BASE_URL}/workflows/analyze-dependencies`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ nodes }),
              });

              if (depResponse.ok) {
                const depData = await depResponse.json();
                if (!depData.allInstalled && depData.missingPlugins.length > 0) {
                  // Return dependency info for UI to handle
                  commit('SET_LOADING', false);
                  return {
                    needsPlugins: true,
                    missingPlugins: depData.missingPlugins,
                    assetType,
                    assetData,
                    assetId,
                    workflowId,
                    version,
                    auto_update,
                  };
                }
              }
            } catch (depError) {
              // If dependency check fails, continue with installation anyway
              console.warn('Failed to check dependencies, continuing with installation:', depError);
            }
          }
        }

        switch (assetType) {
          case 'workflow':
            // Save workflow to local backend
            await fetch(`${API_CONFIG.BASE_URL}/workflows/save`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ workflow: assetData }),
            });
            await dispatch('workflows/fetchWorkflows', {}, { root: true });
            break;

          case 'agent':
            // Save agent to local backend
            await fetch(`${API_CONFIG.BASE_URL}/agents/save`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ agent: assetData }),
            });
            await dispatch('agents/fetchAgents', { force: true }, { root: true });
            break;

          case 'tool':
            // Save tool to local backend
            await fetch(`${API_CONFIG.BASE_URL}/custom-tools/save`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ tool: assetData }),
            });
            await dispatch('tools/fetchTools', { force: true }, { root: true });
            break;

          case 'plugin':
            // For plugins, download and install via local plugin system
            // assetData contains: { name, downloadUrl, manifest, ... }
            const pluginInstallResponse = await fetch(`${API_CONFIG.BASE_URL}/plugins/install`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                name: assetData.name,
                version: assetData.version || 'latest',
              }),
            });

            const pluginInstallData = await pluginInstallResponse.json();
            if (!pluginInstallData.success) {
              throw new Error(pluginInstallData.error || 'Failed to install plugin');
            }

            // Refresh tools to pick up new plugin tools
            await dispatch('tools/fetchTools', { force: true }, { root: true });
            break;

          default:
            throw new Error(`Unsupported asset type: ${assetType}`);
        }

        return data;
      } catch (error) {
        console.error('Error installing item:', error);
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    /**
     * Save an already-fetched asset to local backend
     * Used after installing required plugins
     */
    async saveInstalledAsset({ commit, dispatch }, { assetType, assetData }) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        switch (assetType) {
          case 'workflow':
            await fetch(`${API_CONFIG.BASE_URL}/workflows/save`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ workflow: assetData }),
            });
            await dispatch('workflows/fetchWorkflows', {}, { root: true });
            break;

          case 'agent':
            await fetch(`${API_CONFIG.BASE_URL}/agents/save`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ agent: assetData }),
            });
            await dispatch('agents/fetchAgents', { force: true }, { root: true });
            break;

          case 'tool':
            await fetch(`${API_CONFIG.BASE_URL}/custom-tools/save`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ tool: assetData }),
            });
            await dispatch('tools/fetchTools', { force: true }, { root: true });
            break;

          default:
            throw new Error(`Unsupported asset type: ${assetType}`);
        }

        return { success: true };
      } catch (error) {
        console.error('Error saving installed asset:', error);
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    /**
     * Install a plugin by name from the marketplace
     * @param {string} pluginName - Name of the plugin to install
     * @param {boolean} skipRefresh - Skip tool refresh (for batch installs)
     */
    async installPlugin({ commit, dispatch }, { pluginName, skipRefresh = false }) {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      console.log(`[Marketplace] Installing plugin: ${pluginName}`);

      const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/install`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: pluginName }),
      });

      const data = await response.json();
      console.log(`[Marketplace] Plugin install response for ${pluginName}:`, data);

      if (!data.success) {
        throw new Error(data.error || `Failed to install plugin: ${pluginName}`);
      }

      // Only refresh tools if not doing a batch install
      if (!skipRefresh) {
        await dispatch('tools/refreshAllTools', null, { root: true });
      }

      return data;
    },

    async publishWorkflow({ commit }, workflowData) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/publish`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(workflowData),
        });

        const data = await response.json();

        // Add the newly published item to local state
        if (data.item) {
          commit('ADD_PUBLISHED_ITEM', data.item);
        }

        return data;
      } catch (error) {
        console.error('Error publishing workflow:', error);
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async updateMarketplaceItem({ commit, dispatch }, { itemId, updates }) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/items/${itemId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(updates),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to update item');
        }

        // Refresh published items
        await dispatch('fetchMyPublishedItems');
        return data;
      } catch (error) {
        console.error('Error updating marketplace item:', error);
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async deleteMarketplaceItem({ commit, dispatch }, { itemId, force = false }) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const url = `${API_CONFIG.REMOTE_URL}/marketplace/items/${itemId}${force ? '?force=true' : ''}`;
        const response = await fetch(url, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to delete item');
        }

        // Refresh published items
        await dispatch('fetchMyPublishedItems');
        return data;
      } catch (error) {
        console.error('Error deleting marketplace item:', error);
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async unpublishMarketplaceItem({ commit, dispatch }, itemId) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/items/${itemId}/unpublish`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to unpublish item');
        }

        // Refresh published items
        await dispatch('fetchMyPublishedItems');
        return data;
      } catch (error) {
        console.error('Error unpublishing marketplace item:', error);
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async republishMarketplaceItem({ commit, dispatch }, itemId) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/items/${itemId}/republish`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to republish item');
        }

        // Refresh published items
        await dispatch('fetchMyPublishedItems');
        return data;
      } catch (error) {
        console.error('Error republishing marketplace item:', error);
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async submitReview({ commit }, reviewData) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/reviews`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(reviewData),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || data.message || 'Failed to submit review');
        }

        return data;
      } catch (error) {
        console.error('Error submitting review:', error);
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async updateReview({ commit }, { reviewId, updates }) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/reviews/${reviewId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(updates),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to update review');
        }

        return data;
      } catch (error) {
        console.error('Error updating review:', error);
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async deleteReview({ commit }, reviewId) {
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/reviews/${reviewId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to delete review');
        }

        return data;
      } catch (error) {
        console.error('Error deleting review:', error);
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async voteOnReview({ commit }, { reviewId, voteType }) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/reviews/${reviewId}/vote`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ vote_type: voteType }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to vote on review');
        }

        return data;
      } catch (error) {
        console.error('Error voting on review:', error);
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async fetchRatingBreakdown({ commit }, itemId) {
      try {
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/items/${itemId}/rating-breakdown`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch rating breakdown');
        }

        return data.breakdown;
      } catch (error) {
        console.error('Error fetching rating breakdown:', error);
        return { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      }
    },

    async checkForUpdates({ commit }) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/updates`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        return data.updates;
      } catch (error) {
        console.error('Error checking for updates:', error);
        commit('SET_ERROR', error.message);
        return [];
      }
    },

    async fetchMyPurchases({ commit, state }, { force = false } = {}) {
      const now = Date.now();
      if (!force && state.myPurchases.length > 0 && state.lastPurchasesFetched && now - state.lastPurchasesFetched < 5 * 60 * 1000) {
        return;
      }
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/my-purchases`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        commit('SET_MY_PURCHASES', data.purchases);
        commit('SET_LAST_PURCHASES_FETCHED', now);
      } catch (error) {
        console.error('Error fetching purchases:', error);
        commit('SET_ERROR', error.message);
      }
    },

    async fetchMyPublishedItems({ commit, state }, { force = false } = {}) {
      const now = Date.now();
      if (!force && state.myPublishedItems.length > 0 && state.lastPublishedFetched && now - state.lastPublishedFetched < 5 * 60 * 1000) {
        return;
      }
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/my-workflows`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        // The endpoint returns 'workflows' but contains all asset types
        commit('SET_MY_PUBLISHED_ITEMS', data.workflows || data.items || []);
        commit('SET_LAST_PUBLISHED_FETCHED', now);
      } catch (error) {
        console.error('Error fetching published items:', error);
        commit('SET_ERROR', error.message);
      }
    },

    async fetchMyPublishedWorkflows({ commit }) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/my-workflows`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        commit('SET_MY_PUBLISHED', data.workflows);
      } catch (error) {
        console.error('Error fetching published workflows:', error);
        commit('SET_ERROR', error.message);
      }
    },

    async fetchMyEarnings({ commit, state }, { force = false } = {}) {
      const now = Date.now();
      if (!force && state.myEarnings && state.lastEarningsFetched && now - state.lastEarningsFetched < 5 * 60 * 1000) {
        return state.myEarnings;
      }
      commit('SET_LOADING', true);
      commit('CLEAR_ERROR');
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/my-earnings`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch earnings');
        }

        commit('SET_MY_EARNINGS', data);
        return data;
      } catch (error) {
        console.error('Error fetching earnings:', error);
        commit('SET_ERROR', error.message);
        commit('SET_MY_EARNINGS', null);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async fetchMyInstalls({ commit, state }, { force = false } = {}) {
      const now = Date.now();
      if (!force && state.myInstalls.length > 0 && state.lastInstallsFetched && now - state.lastInstallsFetched < 5 * 60 * 1000) {
        return;
      }
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/my-installs`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        commit('SET_MY_INSTALLS', data.installs || []);
      } catch (error) {
        console.error('Error fetching installs:', error);
        commit('SET_ERROR', error.message);
        commit('SET_MY_INSTALLS', []);
      }
    },

    updateFilters({ commit }, filters) {
      commit('UPDATE_FILTERS', filters);
      // Don't auto-fetch - let the component decide when to fetch
    },

    clearError({ commit }) {
      commit('CLEAR_ERROR');
    },
  },
  getters: {
    // NEW: Generic filtered items
    filteredMarketplaceItems: (state) => {
      return state.marketplaceItems;
    },
    // Backward compatibility
    filteredMarketplaceWorkflows: (state) => {
      return state.marketplaceWorkflows;
    },
    filteredMarketplaceAgents: (state) => {
      return state.marketplaceAgents;
    },
    filteredMarketplaceTools: (state) => {
      return state.marketplaceTools;
    },
    filteredMarketplacePlugins: (state) => {
      return state.marketplacePlugins;
    },
    isLoading: (state) => state.isLoading,
    error: (state) => state.error,
    selectedItem: (state) => state.selectedItem,
    selectedWorkflow: (state) => state.selectedWorkflow, // Backward compatibility
    filters: (state) => state.filters,
  },
};
