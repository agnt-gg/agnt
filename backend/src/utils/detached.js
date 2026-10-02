/**
 * Run follow-up work that must never affect the caller: not by throwing
 * synchronously, not by rejecting, and not by returning something that is not
 * a promise (a mock returning undefined made `.catch` a TypeError that escaped
 * a goal loop AFTER the goal had passed).
 *
 * @param {string} label   names the work in the warning
 * @param {() => any} task
 */
export function detached(label, task) {
  const warn = (error) => console.warn(`[${label}] failed (non-critical):`, error?.message || error);
  try {
    Promise.resolve(task()).catch(warn);
  } catch (error) {
    warn(error);
  }
}

export default detached;
