/**
 * useLicense Composable
 *
 * Vue composable for accessing license state and features in components.
 * Use this instead of directly accessing the Vuex store for license checks.
 *
 * The license system uses cryptographic verification to ensure only
 * genuine AGNT licenses can unlock premium features.
 */

import { computed } from 'vue';
import { useStore } from 'vuex';

/**
 * Main composable for license access
 *
 * @returns {Object} License state and helper functions
 */
export function useLicense() {
  const store = useStore();

  // Core license state
  const license = computed(() => store.getters['userAuth/license']);
  const licenseStatus = computed(() => store.getters['userAuth/licenseStatus']);
  const signedLicense = computed(() => store.getters['userAuth/signedLicense']);

  // Plan information
  const planType = computed(() => store.getters['userAuth/planType']);
  const planFeatures = computed(() => store.getters['userAuth/planFeatures']);

  /**
   * Check if license is valid and verified
   * This is the primary check - use this to gate ANY premium functionality
   */
  const hasValidLicense = computed(() => store.getters['userAuth/hasValidLicense']);

  /**
   * Check if user has premium access (valid license + non-free plan)
   * Use this as a simple "is pro" check
   */
  const isPremium = computed(() => store.getters['userAuth/isPremium']);

  /**
   * Check if user is on free tier
   */
  const isFree = computed(() => planType.value === 'free');

  /**
   * Check if license is in offline mode
   */
  const isOffline = computed(() => licenseStatus.value === 'offline');

  /**
   * Get rate limits from license
   */
  const rateLimits = computed(() => store.getters['userAuth/rateLimits']);

  /**
   * Time until license expires (seconds)
   */
  const expiresIn = computed(() => store.getters['userAuth/licenseExpiresIn']);

  /**
   * Check if a specific feature is enabled
   *
   * @param {string} featureName - Name of the feature to check
   * @returns {boolean|Object} False if not enabled, or feature config if enabled
   */
  const hasFeature = (featureName) => {
    return store.getters['userAuth/getLicenseFeature'](featureName);
  };

  /**
   * Get a feature's configuration value
   *
   * @param {string} featureName - Name of the feature
   * @param {string} property - Property within the feature config
   * @param {*} defaultValue - Default value if not found
   * @returns {*} The property value or default
   */
  const getFeatureValue = (featureName, property, defaultValue = null) => {
    const feature = hasFeature(featureName);
    if (!feature || typeof feature !== 'object') return defaultValue;
    return feature[property] !== undefined ? feature[property] : defaultValue;
  };

  /**
   * Check if webhooks are enabled
   */
  const hasWebhooks = computed(() => {
    const feature = hasFeature('webhooks');
    return feature && feature.enabled;
  });

  /**
   * Get webhook interval (milliseconds)
   */
  const webhookInterval = computed(() => {
    return getFeatureValue('webhooks', 'interval', 900000); // 15 min default
  });

  /**
   * Check if email server is enabled
   */
  const hasEmailServer = computed(() => {
    const feature = hasFeature('emailServer');
    return feature && feature.enabled;
  });

  /**
   * Get email server interval (milliseconds)
   */
  const emailInterval = computed(() => {
    return getFeatureValue('emailServer', 'interval', 900000); // 15 min default
  });

  /**
   * Check if plugins are enabled
   */
  const hasPlugins = computed(() => {
    const feature = hasFeature('plugins');
    return feature && feature.enabled;
  });

  /**
   * Get max plugins count
   */
  const maxPlugins = computed(() => {
    return getFeatureValue('plugins', 'maxCount', 0);
  });

  /**
   * Check if cloud sync is enabled
   */
  const hasCloudSync = computed(() => {
    const feature = hasFeature('cloudSync');
    return feature && feature.enabled;
  });

  /**
   * Get cloud sync interval (milliseconds)
   */
  const syncInterval = computed(() => {
    return getFeatureValue('cloudSync', 'interval', null);
  });

  /**
   * Check if API access is enabled
   */
  const hasApiAccess = computed(() => {
    const feature = hasFeature('apiAccess');
    return feature && feature.enabled;
  });

  /**
   * Check if multi-user is enabled
   */
  const hasMultiUser = computed(() => {
    const feature = hasFeature('multiUser');
    return feature && feature.enabled;
  });

  /**
   * Get max seats for multi-user
   */
  const maxSeats = computed(() => {
    return getFeatureValue('multiUser', 'maxSeats', 1);
  });

  /**
   * Check if white-label is enabled
   */
  const hasWhiteLabel = computed(() => {
    return hasFeature('whiteLabel') === true;
  });

  /**
   * Check if SLA is enabled
   */
  const hasSLA = computed(() => {
    return hasFeature('sla') === true;
  });

  /**
   * Manually trigger license validation
   */
  const validateLicense = () => {
    return store.dispatch('userAuth/validateLicense');
  };

  /**
   * Refresh license if needed
   */
  const refreshIfNeeded = () => {
    return store.dispatch('userAuth/refreshLicenseIfNeeded');
  };

  return {
    // Core state
    license,
    licenseStatus,
    signedLicense,
    planType,
    planFeatures,

    // Status checks
    hasValidLicense,
    isPremium,
    isFree,
    isOffline,

    // Rate limits
    rateLimits,
    expiresIn,

    // Feature checks
    hasFeature,
    getFeatureValue,

    // Specific feature shortcuts
    hasWebhooks,
    webhookInterval,
    hasEmailServer,
    emailInterval,
    hasPlugins,
    maxPlugins,
    hasCloudSync,
    syncInterval,
    hasApiAccess,
    hasMultiUser,
    maxSeats,
    hasWhiteLabel,
    hasSLA,

    // Actions
    validateLicense,
    refreshIfNeeded,
  };
}

export default useLicense;
