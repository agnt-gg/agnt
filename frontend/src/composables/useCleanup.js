import { onBeforeUnmount } from 'vue';

/**
 * Composable for managing cleanup of event listeners, intervals, and timeouts
 * Automatically cleans up on component unmount
 */
export function useCleanup() {
  const cleanupTasks = [];

  /**
   * Register an event listener that will be automatically cleaned up
   * @param {EventTarget} target - The event target (window, document, element)
   * @param {string} event - The event name
   * @param {Function} handler - The event handler
   * @param {Object} options - Event listener options
   */
  const addEventListener = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    cleanupTasks.push(() => target.removeEventListener(event, handler, options));
  };

  /**
   * Register an interval that will be automatically cleared
   * @param {Function} callback - The callback function
   * @param {number} delay - The delay in milliseconds
   * @returns {number} The interval ID
   */
  const setInterval = (callback, delay) => {
    const id = window.setInterval(callback, delay);
    cleanupTasks.push(() => window.clearInterval(id));
    return id;
  };

  /**
   * Register a timeout that will be automatically cleared
   * @param {Function} callback - The callback function
   * @param {number} delay - The delay in milliseconds
   * @returns {number} The timeout ID
   */
  const setTimeout = (callback, delay) => {
    const id = window.setTimeout(callback, delay);
    cleanupTasks.push(() => window.clearTimeout(id));
    return id;
  };

  /**
   * Manually register a cleanup task
   * @param {Function} task - The cleanup function to run
   */
  const registerCleanup = (task) => {
    cleanupTasks.push(task);
  };

  /**
   * Manually run all cleanup tasks (useful for testing or manual cleanup)
   */
  const cleanup = () => {
    cleanupTasks.forEach((task) => {
      try {
        task();
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
    });
    cleanupTasks.length = 0;
  };

  // Automatically cleanup on component unmount
  onBeforeUnmount(() => {
    cleanup();
  });

  return {
    addEventListener,
    setInterval,
    setTimeout,
    registerCleanup,
    cleanup,
  };
}
