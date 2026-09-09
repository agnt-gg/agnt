// Validate the driver's supported positive-evidence predicates BEFORE input.
// Unsupported fields must not silently turn a requested check into a weaker one.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, names) => record(value) && Object.keys(value).every(key => names.includes(key));
export function validateVerificationPredicates(predicates) {
  if (!Array.isArray(predicates) || !predicates.length || predicates.length > 8) return 'expect must contain 1..8 predicates.';
  for (const [index, predicate] of predicates.entries()) {
    const error = `Invalid verification predicate ${index}: use a supported window or element check.`;
    if (!record(predicate) || Object.keys(predicate).length !== 1) return error;
    if (predicate.window) {
      const window = predicate.window;
      if (!only(window, ['exists', 'bounds']) || !Object.keys(window).length) return error;
      if ('exists' in window && window.exists !== true) return error;
      if ('bounds' in window) {
        const bounds = window.bounds;
        if (!only(bounds, ['x','y','width','height','tolerance_px'])) return error;
        if (!['x','y','width','height'].every(key => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]))) return error;
        if (bounds.width <= 0 || bounds.height <= 0) return error;
        if ('tolerance_px' in bounds && (typeof bounds.tolerance_px !== 'number' || !Number.isFinite(bounds.tolerance_px) || bounds.tolerance_px < 0)) return error;
      }
    } else if (predicate.element) {
      const element = predicate.element;
      if (!only(element, ['selector','exists','value_equals','enabled','selected'])) return error;
      const selector = element.selector;
      if (!only(selector, ['role','label_contains']) || !Object.keys(selector).length || !Object.values(selector).every(value => typeof value === 'string' && value.trim().length > 0)) return error;
      if (!['exists','value_equals','enabled','selected'].some(key => key in element)) return error;
      if ('exists' in element && element.exists !== true) return error;
      if ('value_equals' in element && typeof element.value_equals !== 'string') return error;
      for (const key of ['enabled','selected']) if (key in element && typeof element[key] !== 'boolean') return error;
    } else return error;
  }
  return null;
}
