/**
 * Test utility for triggering rate limit banner
 *
 * Usage in browser console:
 * 1. Import this in your component or use window.testRateLimit()
 * 2. Call testRateLimit() to simulate a 429 error
 * 3. Call clearRateLimit() to clear the rate limit state
 */

import { triggerRateLimit } from './axiosInterceptor';
import store from '@/store/state';

/**
 * Simulate a rate limit error for testing
 * @param {Object} options - Optional configuration
 */
export function testRateLimit(options = {}) {
  const defaultOptions = {
    resetAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
    limit: 1000,
    window: 'hour',
    currentPlan: 'free',
    message: 'Hourly limit of 1000 requests exceeded (TEST)',
  };

  const rateLimitInfo = { ...defaultOptions, ...options };

  console.log('🧪 Testing rate limit banner with:', rateLimitInfo);
  triggerRateLimit(rateLimitInfo);
  console.log('✅ Rate limit banner should now be visible (if you are on free plan)');
}

/**
 * Clear the rate limit state
 */
export function clearRateLimit() {
  console.log('🧹 Clearing rate limit state...');
  store.dispatch('theme/clearRateLimit');
  store.dispatch('theme/setRateLimitBannerClosed', false);
  console.log('✅ Rate limit state cleared');
}

/**
 * Test with different scenarios
 */
export function testScenarios() {
  console.log('🧪 Testing different rate limit scenarios...');

  // Test 1: Hourly limit
  console.log('\n1️⃣ Testing hourly limit (resets in 5 minutes)...');
  testRateLimit({
    resetAt: Date.now() + 5 * 60 * 1000,
    limit: 1000,
    window: 'hour',
  });

  setTimeout(() => {
    clearRateLimit();

    // Test 2: Daily limit
    console.log('\n2️⃣ Testing daily limit (resets in 2 hours)...');
    testRateLimit({
      resetAt: Date.now() + 2 * 60 * 60 * 1000,
      limit: 10000,
      window: 'day',
    });
  }, 3000);
}

// Make functions available globally for console testing
if (typeof window !== 'undefined') {
  window.testRateLimit = testRateLimit;
  window.clearRateLimit = clearRateLimit;
  window.testRateLimitScenarios = testScenarios;

  console.log('🧪 Rate limit test utilities loaded!');
  console.log('   - window.testRateLimit() - Trigger rate limit banner');
  console.log('   - window.clearRateLimit() - Clear rate limit state');
  console.log('   - window.testRateLimitScenarios() - Test different scenarios');
}
