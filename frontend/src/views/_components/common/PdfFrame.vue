<!-- PdfFrame — the ONE way AGNT shows a PDF inline.

     This iframe deliberately has NO `sandbox` attribute. Chromium (and so
     Electron) refuses to start its built-in PDF viewer inside any sandboxed
     frame, whatever tokens are granted: `sandbox=""` and
     `sandbox="allow-scripts allow-same-origin"` both render a blank white box
     with no error. Measured on Electron 33 with AGNT's main-window
     webPreferences — see tests/live/pdf-frame-electron.mjs, which renders this
     component's own attributes and fails if the PDF does not paint.

     Dropping the sandbox is safe for PDFs specifically: the server serves the
     bytes as application/pdf, so they are never parsed as an HTML document in
     our origin; the viewer runs out-of-process in Chromium's own isolated
     extension. HTML previews are a different trust problem and keep their
     sandbox — never route HTML through this component.

     Attributes such as class, tabindex and @load fall through to the iframe. -->
<template>
  <iframe :src="src || undefined" :aria-label="label || undefined"></iframe>
</template>

<script>
export default {
  name: 'PdfFrame',
  props: {
    /** URL that serves the document as application/pdf. */
    src: { type: String, default: '' },
    /** Accessible name — usually the file name. */
    label: { type: String, default: '' },
  },
};
</script>
