# PDFKit Generation v2

## Description

Generate professional PDFs using PDFKit in Node.js with AGNT brand styling, embedded images, and proper handling of large scripts. Use this skill when creating pitch decks, reports, branded documents, or styled PDFs. Also use when the user mentions PDF generation, document creation with images, or wants to produce any kind of professional PDF output — even if they don't explicitly say "PDFKit." This skill covers the critical workflow for bypassing command-line size limits, image embedding (Sharp + file path), Unicode-safe character usage, ES module compatibility, and reusable design patterns.

---

# PDFKit Generation Guide v2

## Critical Workflow: The 3-Step Pattern

### The Problem

`execute_javascript_code` passes code via command line with ~8KB limit. Large PDF scripts (20KB+) fail with `ENAMETOOLONG`. Also, the `execute_javascript` and `execute_javascript_code` tools cannot use `require()` or `import` statements directly.

### The Solution

```
+-------------------------------------------------------------+
|  1. file_system_operation (writeFile): Write .js script      |
|  2. file_system_operation (executeFile): Run the script      |
|  3. file_system_operation (listFiles): Verify PDF created    |
+-------------------------------------------------------------+
```

**Critical: Use `file_system_operation` for ALL three steps.** The `executeFile` operation runs the file with Node.js directly, supporting ES module imports. Do NOT use `execute_javascript_code` or `execute_javascript` for PDF generation — they cannot handle imports/requires.

### Implementation

```javascript
// Step 1: Write script
file_system_operation({
  operation: "writeFile",
  rootDirectory: ".",
  path: "generate-pdf.js",
  content: scriptContent
});

// Step 2: Execute
file_system_operation({
  operation: "executeFile",
  rootDirectory: ".",
  path: "generate-pdf.js"
});

// Step 3: Verify
file_system_operation({
  operation: "listFiles",
  rootDirectory: ".",
  path: "."
});
```

---

## Module Format: ES Modules (import)

The backend project uses `"type": "module"` in package.json. **Always use ES module syntax** — `require()` will throw `ReferenceError: require is not defined`.

```javascript
// CORRECT — ES Modules
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

```javascript
// WRONG — CommonJS (will fail)
const PDFDocument = require('pdfkit');  // ❌ ReferenceError
```

**File extensions:** Use `.js` (treated as ESM due to package.json). Do NOT use `.cjs` or `.mjs` — the `executeFile` operation only supports `.js` and `.py` extensions.

---

## Image Embedding

PDFKit supports embedding JPEG and PNG images. Images are the key to making PDFs visually rich rather than just shapes and text.

### Three Proven Methods

#### Method 1: File Path (Most Reliable)

Load images from disk by absolute path. This is the most reliable method and works with any existing PNG/JPG file.

```javascript
const imgDir = 'C:\\path\\to\\images';
doc.image(path.join(imgDir, 'logo.png'), 72, 100, { width: 200 });
doc.image(path.join(imgDir, 'photo.jpg'), 72, 350, { fit: [468, 200] });
```

**AGNT frontend assets are at:**
```
C:\Users\Studio\Documents\DevelopmentProjects\AGNT\repos\agnt-pro\frontend\public\images\
├── agnt-logo.png          (22KB - main logo)
├── agnt-logo-avatar.png   (22KB - avatar version)
├── agnt-sm.png            (5KB - small logo, light)
├── agnt-sm-dark.png       (5KB - small logo, dark bg)
├── backgrounds/bg7.jpg    (243KB - background image)
└── patterns/              (workflow diagrams)
    ├── recipe-routing-dark.png
    ├── recipe-simple-agent-dark.png
    ├── recipe-prompt-chaining-dark.png
    ├── recipe-aggregation-dark.png
    ├── recipe-conditional-dark.png
    └── recipe-agent-critic-dark.png
```

#### Method 2: Sharp-Generated PNG Buffer

Use `sharp` (installed in the project) to generate images programmatically, then embed as Buffer.

```javascript
import sharp from 'sharp';

// Solid color block
const pngBuffer = await sharp({
  create: { width: 200, height: 100, channels: 3, background: { r: 229, g: 61, b: 143 } }
}).png().toBuffer();
doc.image(pngBuffer, 72, 100, { width: 200 });

// Pixel-by-pixel gradient
const width = 400, height = 100, channels = 3;
const pixels = Buffer.alloc(width * height * channels);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    const t = x / width;
    pixels[i]     = Math.round(0xe5 * (1-t) + 0x12 * t); // R: pink→cyan
    pixels[i + 1] = Math.round(0x3d * (1-t) + 0xe0 * t); // G
    pixels[i + 2] = Math.round(0x8f * (1-t) + 0xff * t); // B
  }
}
const gradientBuf = await sharp(pixels, { raw: { width, height, channels } }).png().toBuffer();
doc.image(gradientBuf, 72, 250, { width: 400 });
```

#### Method 3: Sharp Save-to-Disk then Embed

For complex generated images, save to disk first then embed by path. Useful when you need to reuse the same image multiple times.

```javascript
const tempImg = path.join(__dirname, 'temp-gradient.png');
await sharp(pixels, { raw: { width, height, channels } }).png().toFile(tempImg);
doc.image(tempImg, 72, 100, { width: 300 });
// Clean up after doc.end()
```

### Image Sizing Options

```javascript
// Fixed width (height scales proportionally)
doc.image(imgPath, x, y, { width: 200 });

// Fixed height
doc.image(imgPath, x, y, { height: 100 });

// Fit within bounding box (preserves aspect ratio)
doc.image(imgPath, x, y, { fit: [468, 200], align: 'center', valign: 'center' });

// Explicit dimensions (may stretch)
doc.image(imgPath, x, y, { width: 200, height: 100 });

// Scale factor
doc.image(imgPath, x, y, { scale: 0.5 });
```

### Supported Formats

| Format | Support | Notes |
|--------|---------|-------|
| **JPEG** | ✅ Full | Best for photos, smaller file size |
| **PNG** | ✅ Full | Supports transparency |
| **GIF** | ⚠️ First frame | No animation support |
| **SVG** | ❌ None | Convert to PNG first using Sharp |

### Image Gotchas

- **Emojis are NOT images** — `doc.text('🤖')` will crash with WinAnsi encoding error. Use Unicode-safe characters or generate emoji-like icons with Sharp.
- **Buffer vs path** — Both work, but file paths are more reliable for large images (>100KB).
- **Verify file size** — If the final PDF is suspiciously small (<5KB for a document with images), the images likely didn't embed. A single embedded PNG should add at least a few KB.
- **Transparency** — PNG transparency works. The image background will be transparent, showing whatever is behind it in the PDF.

---

## Unicode-Safe Characters

PDFKit's built-in Helvetica font only supports WinAnsi encoding. Emojis and most non-Latin characters will cause errors.

### What Works

```javascript
// Arrows & pointers
'►' '▶' '→' '←' '↑' '↓' '»' '«'

// Bullets & shapes
'●' '○' '■' '□' '◆' '◇' '▲' '▼'

// Checks & marks
'✓' '✗' '+' '×'

// Math & symbols
'±' '÷' '≤' '≥' '≠' '∞' '°' '™' '©' '®'

// Currency
'$' '€' '£' '¥'
```

### What Breaks

```javascript
// ❌ ALL of these will crash:
'🤖' '🚀' '📊' '✅' '❌' '🎯' '💡' '🔥'
// Error: WinAnsi cannot encode "..." (0x1f916)
```

### Workaround for Icons

Instead of emojis, use colored shapes or Sharp-generated icon images:

```javascript
// Colored circle "icon"
doc.circle(x + 15, y + 15, 12).fill(PINK);
doc.fontSize(14).fillColor('#ffffff').text('A', x + 9, y + 8);

// Or generate a proper icon with Sharp
const iconBuf = await sharp({
  create: { width: 30, height: 30, channels: 4, background: { r: 229, g: 61, b: 143, alpha: 1 } }
}).png().toBuffer();
doc.image(iconBuf, x, y, { width: 30 });
```

---

## AGNT Brand Design System

### Colors

```javascript
// Primary accents
const PINK   = '#e53d8f';  // Headers, CTAs, primary accent
const CYAN   = '#12e0ff';  // Highlights, secondary accent
const GREEN  = '#19ef83';  // Success, positive metrics
const GOLD   = '#ffd700';  // Warnings, special callouts
const PURPLE = '#7d3de5';  // Tables, tertiary accent

// Backgrounds
const BG_DARK  = '#0d1117';  // Main page background
const BG_CARD  = '#161b22';  // Card/section backgrounds
const BG_ALT   = '#1a2030';  // Alternate rows

// Text
const TEXT_LIGHT = '#e0e0e0';  // Body text
const TEXT_GRAY  = '#8b949e';  // Muted text, labels
const TEXT_DIM   = '#484f58';  // Footer, watermarks

// UI
const BORDER = '#30363d';  // Borders, dividers
```

### Gradient Bar (5-Color Strip)

```javascript
const BRAND_COLORS = [PINK, CYAN, GREEN, GOLD, PURPLE];

function drawGradientBar(doc, y, height) {
  const segW = 612 / BRAND_COLORS.length;
  BRAND_COLORS.forEach((c, i) => {
    doc.rect(i * segW, y, segW, height).fill(c);
  });
}
```

### Reusable Components

```javascript
// Rounded rectangle card
function drawCard(doc, x, y, w, h, accentColor) {
  doc.roundedRect(x, y, w, h, 8).fill(BG_CARD);
  if (accentColor) doc.rect(x, y, 4, h).fill(accentColor);
}

// Stat box with large number
function drawStatBox(doc, x, y, w, h, value, label, color) {
  drawCard(doc, x, y, w, h, color);
  doc.fontSize(28).fillColor(color).font('Helvetica-Bold');
  doc.text(value, x + 16, y + (h/2 - 22));
  doc.fontSize(10).fillColor(TEXT_GRAY).font('Helvetica');
  doc.text(label, x + 16, y + (h/2 + 8));
}

// Section header with accent line
function drawSectionHeader(doc, title, y, color = PINK) {
  doc.fontSize(20).fillColor(color).font('Helvetica-Bold');
  doc.text(title, 72, y);
  doc.rect(72, y + 28, 100, 3).fill(color);
  return y + 45;
}
```

---

## Page Layout

### Letter Size (Default)

```javascript
const doc = new PDFDocument({ size: 'letter', margin: 0 });

const PAGE = {
  WIDTH: 612,
  HEIGHT: 792,
  MARGIN: 72,
  CONTENT_WIDTH: 468,  // 612 - 72*2
  CONTENT_HEIGHT: 648, // 792 - 72*2
};
```

### Safe Zones

```
+--612px------------------------------------+
| [4px gradient bar]                         |
+--------------------------------------------+
|                                            |
|  <72px>                           <72px>   |
|  +--468px content area-----------+         |
|  |                               |         |
|  |                               |         |
|  |                               |         |
|  +-------------------------------+         |
|                                   Page N → |
+--------------------------------------------+
| [50px footer zone]                         |
+--------------------------------------------+
```

### Footer Pattern

```javascript
function addFooter(doc, pageNum, totalPages) {
  doc.save();
  doc.fontSize(8).fillColor(TEXT_DIM).font('Helvetica');
  doc.text(`Page ${pageNum} of ${totalPages}`, 72, 755, { align: 'center', width: 468 });
  doc.restore();
}
```

---

## Complete Template

This is a copy-paste-ready starting point for any PDF:

```javascript
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputPath = path.join(__dirname, 'output.pdf');

// ---- Document Setup ----
const doc = new PDFDocument({
  size: 'letter',
  margin: 0,
  info: {
    Title: 'Document Title',
    Author: 'AGNT Platform',
    Subject: 'Description',
  }
});
const stream = fs.createWriteStream(outputPath);
doc.pipe(stream);

// ---- Brand Colors ----
const PINK = '#e53d8f', CYAN = '#12e0ff', GREEN = '#19ef83';
const GOLD = '#ffd700', PURPLE = '#7d3de5';
const BG_DARK = '#0d1117', BG_CARD = '#161b22';
const TEXT_LIGHT = '#e0e0e0', TEXT_GRAY = '#8b949e', TEXT_DIM = '#484f58';
const BRAND_COLORS = [PINK, CYAN, GREEN, GOLD, PURPLE];

// ---- Image Paths ----
const IMG_DIR = 'C:\\Users\\Studio\\Documents\\DevelopmentProjects\\AGNT\\repos\\agnt-pro\\frontend\\public\\images';

// ---- Helpers ----
function drawGradientBar(y, h) {
  BRAND_COLORS.forEach((c, i) => doc.rect(i * 122.4, y, 122.4, h).fill(c));
}

function drawCard(x, y, w, h, accent) {
  doc.roundedRect(x, y, w, h, 8).fill(BG_CARD);
  if (accent) doc.rect(x, y, 4, h).fill(accent);
}

function newPage() {
  doc.addPage();
  doc.rect(0, 0, 612, 792).fill(BG_DARK);
  drawGradientBar(0, 4);
}

function footer(num) {
  doc.fontSize(8).fillColor(TEXT_DIM).text(`Page ${num}`, 72, 755, { align: 'center', width: 468 });
}

// ---- PAGE 1 ----
doc.rect(0, 0, 612, 792).fill(BG_DARK);
drawGradientBar(0, 8);

// Logo
doc.image(path.join(IMG_DIR, 'agnt-logo.png'), 72, 50, { height: 40 });

// Title
doc.fontSize(36).fillColor(PINK).font('Helvetica-Bold');
doc.text('Document Title', 72, 110);

// ... add content ...

footer(1);

// ---- FINALIZE ----
doc.end();
stream.on('finish', () => {
  console.log('PDF created:', outputPath);
  console.log('Size:', (fs.statSync(outputPath).size / 1024).toFixed(1), 'KB');
});
```

---

## Cleanup Pattern

Always clean up temporary script files after PDF generation:

```javascript
// Write cleanup into the same script, or as a separate step:
// After confirming PDF was created successfully:
file_system_operation({
  operation: "writeFile",
  rootDirectory: ".",
  path: "cleanup.js",
  content: `
    import fs from 'fs';
    ['generate-pdf.js', 'temp-image.png', 'cleanup.js'].forEach(f => {
      try { fs.unlinkSync(f); } catch(e) {}
    });
    console.log('Cleaned up');
  `
});
file_system_operation({ operation: "executeFile", rootDirectory: ".", path: "cleanup.js" });
```

---

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `ENAMETOOLONG` | Script too big for CLI | Write to `.js` file, execute via `file_system_operation` |
| `require is not defined` | Project uses ES modules | Use `import` syntax, not `require()` |
| `Unsupported file type` | Used `.cjs` or `.mjs` extension | Use `.js` extension only |
| `WinAnsi cannot encode` | Emoji in text | Use Unicode-safe chars (►, ●, ■) or Sharp-generated icons |
| `Cannot find module 'pdfkit'` | Missing dependency | `npm install pdfkit` |
| Blank page / missing content | Y-position tracking error | Use explicit Y tracking; avoid `continued: true` across large gaps |
| Images don't appear | Using emoji chars as "images" | Embed real PNG/JPEG files or Sharp buffers |
| PDF suspiciously small (<5KB) | Images didn't embed | Check file paths exist; use absolute paths; verify with file size |
| `doc is not defined` | Split script execution | Keep ALL code in one self-contained file |
| Empty PDF | Missing `doc.end()` | Always call `doc.end()` before stream closes |

---

## Workflow Checklist

Before generating a PDF:

- [ ] Plan page count and content structure
- [ ] Use `file_system_operation` writeFile to create the `.js` script
- [ ] Use ES module syntax (`import`, not `require`)
- [ ] Use `.js` file extension (not `.cjs` or `.mjs`)
- [ ] Avoid emojis — use Unicode-safe characters or Sharp-generated icons
- [ ] Keep script as a single self-contained file
- [ ] Include absolute paths for any image files
- [ ] Always call `doc.end()` at the end
- [ ] Execute via `file_system_operation` executeFile
- [ ] Verify output file exists and size is reasonable
- [ ] Clean up temporary script/image files
