/** Browser-serializable research collector. No app/store imports or network. */
export function collectPalette({ themes, mapping }) {
  const ctx = document.createElement('canvas').getContext('2d');
  function sample(value, resolvedExpression, tokens) {
    const missingTokens = tokens.filter((token) => !getComputedStyle(document.body).getPropertyValue(token).trim());
    const syntaxSupported = CSS.supports('background-color', resolvedExpression);
    const element = document.createElement('div');
    element.style.backgroundColor = value;
    document.body.append(element);
    const acceptedStyle = element.style.backgroundColor;
    const computed = getComputedStyle(element).backgroundColor;
    const reasons = [];
    if (missingTokens.length) reasons.push(`Missing tokens: ${missingTokens.join(', ')}`);
    if (!syntaxSupported) reasons.push('Resolved expression unsupported or invalid');
    if (!acceptedStyle) reasons.push('Style assignment rejected');
    if (!CSS.supports('color', computed)) reasons.push('Computed color invalid');
    // Canvas does not resolve var(). Validate the already-computed color and
    // detect rejected assignments against two sentinels, including a legitimate
    // color that happens to equal one sentinel.
    ctx.fillStyle = '#010203'; ctx.fillStyle = computed;
    const first = ctx.fillStyle;
    ctx.fillStyle = '#040506'; ctx.fillStyle = computed;
    if (first !== ctx.fillStyle) reasons.push('Canvas rejected computed color');
    let pixel = null;
    if (!reasons.length) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      pixel = [...ctx.getImageData(0, 0, 1, 1).data];
    }
    element.remove();
    return { acceptedStyle, syntaxSupported, computed, pixel, valid: !reasons.length, reasons };
  }
  function pair(triplet, color) {
    const style = getComputedStyle(document.body);
    const legacy = sample(`rgba(var(${triplet}), .9)`, `rgba(${style.getPropertyValue(triplet).trim()}, .9)`, [triplet]);
    const relative = sample(`rgb(from var(${color}) r g b / .9)`, `rgb(from ${style.getPropertyValue(color).trim()} r g b / .9)`, [color]);
    const equalPixels = legacy.valid && relative.valid ? JSON.stringify(legacy.pixel) === JSON.stringify(relative.pixel) : null;
    return { legacy, relative, equalPixels, status: equalPixels === null ? 'inconclusive' : equalPixels ? 'equal' : 'different',
      reasons: [...legacy.reasons.map((r) => `legacy: ${r}`), ...relative.reasons.map((r) => `relative: ${r}`)] };
  }
  const comparisons = [];
  for (const theme of themes) {
    document.body.className = theme;
    for (const [triplet, color] of Object.entries(mapping)) {
      comparisons.push({ theme: theme || 'light', triplet, color, ...pair(triplet, color) });
    }
  }
  document.body.className = 'dark midnight';
  // Reproduce applyCurrentThemeBackground's assignment, not its runtime flow.
  document.body.style.setProperty('--color-background', 'transparent');
  const customBackground = pair('--color-background-rgb', '--color-background');
  document.body.style.removeProperty('--color-background');
  ctx.fillStyle = '#010203';
  ctx.fillStyle = 'rgba(var(--green-rgb), .2)';
  return { userAgent: navigator.userAgent,
    relativeSyntaxSupported: CSS.supports('color', 'rgb(from #19ef83 r g b / .1)'),
    alpha: 0.9, comparisons, customBackground,
    unresolvedCanvas: { sentinel: '#010203', afterAssignment: ctx.fillStyle } };
}
