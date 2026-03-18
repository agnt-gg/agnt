---
name: pdfkit-generation
description: "Generate professional PDFs with PDFKit in Node.js. Use when creating pitch decks, reports, or styled documents with AGNT branding. Covers large script handling, Unicode-safe characters, and brand design patterns."
allowed-tools: Bash Read Write Edit
---

---
name: "PDFKit Generation"
description: "Generate professional PDFs with PDFKit in Node.js. Use when creating pitch decks, reports, or styled documents with AGNT branding. Covers large script handling, Unicode-safe characters, and brand design patterns."
category: "document-processing"
icon: "fas fa-file-pdf"
allowed-tools:
  - file_operations
  - execute_javascript_code
  - execute_shell_command
---

# PDFKit Generation

## Description

Generate professional PDFs using PDFKit in a Node.js environment, with AGNT brand styling and proper handling of large scripts. This skill covers the critical workflow for bypassing command-line size limits, Unicode-safe character usage, and reusable design patterns.

## Source

agnt (custom)

## When to Use

Use this skill when:
- Creating pitch decks, reports, or styled PDF documents
- Generating PDFs with AGNT brand colors and styling
- Working with large PDF generation scripts that exceed CLI limits
- You need Unicode-safe alternatives to emojis in PDFs
- Building multi-page documents with consistent theming

---

# PDFKit Generation Guide

## Critical Pattern: Large Script Handling

### The Problem

`execute_javascript_code` passes code via command line, which has ~8KB limit on Windows. Large PDF generation scripts (often 20KB+) will fail with:

```
Error: spawn ENAMETOOLONG
```

### The Solution: 3-Step Pattern

```
+-------------------------------------------------------------+
|  1. file_operations: WRITE compact script to .js/.cjs file  |
|  2. execute_shell_command: node filename.js                 |
|  3. file_operations: VERIFY the PDF was created             |
+-------------------------------------------------------------+
```

**Implementation:**

```javascript
// Step 1: Generate self-contained script
const script = `
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const outputPath = path.join(process.cwd(), 'output.pdf');
const doc = new PDFDocument({ size: 'letter', margin: 0 });
const stream = fs.createWriteStream(outputPath);
doc.pipe(stream);

// ... ALL PDF generation code ...

doc.end();
stream.on('finish', () => console.log('Done'));
`;

// Step 2: Write to file
file_operations({ 
  operation: "write", 
  path: "generate.cjs",
  content: script 
});

// Step 3: Execute via shell
execute_shell_command({ command: "node generate.cjs" });

// Step 4: Verify
file_operations({ operation: "list", path: "." });
```

---

## Common Pitfalls

### Pitfall 1: Script Too Large for execute_javascript_code

| Wrong | Right |
|-------|-------|
| `execute_javascript_code({ code: largeScript })` | Write to file, execute via shell |
| Fails with `ENAMETOOLONG` | Works for any size script |

### Pitfall 2: Splitting Scripts Across Executions

| Wrong | Right |
|-------|-------|
| Execute script in parts | Single self-contained file |
| Variables don't persist | All code in one execution |

### Pitfall 3: Unicode/Emoji Characters

```
Error: WinAnsi cannot encode "..." (0x1f916)
```

PDFKit's standard fonts only support WinAnsi encoding. Emojis will break.

**Wrong:**
```javascript
doc.text('AI Agents', 72, y);
doc.text('Analytics', 72, y);
```

**Right - Use Unicode-safe alternatives:**
```javascript
// Option 1: Text symbols
doc.text('► AI Agents', 72, y);
doc.text('● Analytics', 72, y);

// Option 2: Colored text headers
doc.fillColor(CYAN).text('AI AGENTS', 72, y);
```

**Safe Unicode Characters:**
- Check marks: `+` `x` `*`
- Arrows: `>` `<` `^` `v`
- Shapes: `*` `o` `#`
- Bullets: `-` `*` `.`

### Pitfall 4: Module Format Issues

| Wrong | Right |
|-------|-------|
| `import PDFDocument from 'pdfkit'` | `const PDFDocument = require('pdfkit')` |
| ES modules syntax | CommonJS or `.cjs` extension |

---

## AGNT Brand Design System

### Colors

```javascript
// Primary accents
const PINK = '#e53d8f';    // Headers, CTAs, primary accent
const CYAN = '#12e0ff';    // Highlights, secondary accent
const GREEN = '#19ef83';   // Success, positive metrics
const GOLD = '#ffd700';    // Warnings, special callouts
const PURPLE = '#7d3de5';  // Tables, tertiary accent

// Backgrounds
const DARK = '#0d1117';    // Main background
const DARK2 = '#161b22';   // Card backgrounds
const DARK3 = '#1a2030';   // Alternate rows

// Text
const GRAY = '#8b949e';    // Muted text, labels
const LIGHT = '#e0e0e0';   // Body text
const WHITE = '#ffffff';   // Headlines

// UI
const BORDER = '#30363d';  // Borders, dividers
```

### Gradient Bar

```javascript
const GRADIENT = [PINK, CYAN, GREEN, GOLD, PURPLE];

function drawGradientBar(y, height) {
  const segW = 612 / GRADIENT.length;
  GRADIENT.forEach((c, i) => {
    doc.rect(i * segW, y, segW, height).fill(c);
  });
}
```

### Page Background

```javascript
function drawPageBg() {
  doc.rect(0, 0, 612, 792).fill(DARK);
  drawGradientBar(0, 4);
  doc.opacity(0.3).rect(0, 0, 3, 792).fill(PINK).opacity(1);
}
```

### Stat Box

```javascript
function drawStatBox(x, y, w, h, num, label, color) {
  doc.roundedRect(x, y, w, h, 8).fill(DARK2);
  doc.roundedRect(x, y, w, h, 8).lineWidth(1).stroke(BORDER);
  doc.rect(x, y, 4, h).fill(color);
  doc.fontSize(28).fillColor(color).font('Helvetica-Bold')
    .text(num, x + 15, y + 15);
  doc.fontSize(10).fillColor(GRAY).font('Helvetica')
    .text(label, x + 15, y + 50);
}
```

### Feature Card

```javascript
function drawFeatureCard(x, y, w, h, title, desc, color) {
  doc.roundedRect(x, y, w, h, 8).fill(DARK2);
  doc.roundedRect(x, y, w, h, 8).lineWidth(1).stroke(BORDER);
  doc.rect(x, y, 4, h).fill(color);
  doc.fontSize(14).fillColor(color).font('Helvetica-Bold')
    .text(title, x + 12, y + 12);
  doc.fontSize(10).fillColor(LIGHT).font('Helvetica')
    .text(desc, x + 12, y + 35, { width: w - 24 });
}
```

---

## Page Layout

### Letter Size (Default)

```javascript
const doc = new PDFDocument({ 
  size: 'letter',  // 612 x 792 points
  margin: 0
});

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const CONTENT_WIDTH = 468;
```

### Safe Zones

```
+------------------------------------+
| ^4px - Gradient bar                |
+------------------------------------+
|                                    |
|  <72px>                    <72px>  |
|  +----------------------------+    |
|  |                            | ^  |
|  |     CONTENT AREA           | |  |
|  |     468 x 680 px           | |  |
|  |                            | v  |
|  +----------------------------+    |
|                          Page N <--+
+------------------------------------+
| ^50px - Footer area                |
+------------------------------------+
```

---

## Complete Template

```javascript
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const outputPath = path.join(process.cwd(), 'output.pdf');
const doc = new PDFDocument({ size: 'letter', margin: 0 });
const stream = fs.createWriteStream(outputPath);
doc.pipe(stream);

// Colors
const PINK = '#e53d8f', CYAN = '#12e0ff', GREEN = '#19ef83';
const GOLD = '#ffd700', PURPLE = '#7d3de5';
const DARK = '#0d1117', DARK2 = '#161b22', DARK3 = '#1a2030';
const GRAY = '#8b949e', LIGHT = '#e0e0e0', BORDER = '#30363d';
const GRADIENT = [PINK, CYAN, GREEN, GOLD, PURPLE];

// Helpers
function drawGradientBar(y, h) {
  GRADIENT.forEach((c, i) => doc.rect(i * 122.4, y, 122.4, h).fill(c));
}
function drawPageBg() {
  doc.rect(0, 0, 612, 792).fill(DARK);
  drawGradientBar(0, 4);
  doc.opacity(0.3).rect(0, 0, 3, 792).fill(PINK).opacity(1);
}
function drawFooter(p) {
  doc.fontSize(8).fillColor(GRAY)
    .text('Document | Confidential', 72, 760)
    .text('Page ' + p, 500, 760, { width: 40, align: 'right' });
}
function drawTitle(t, y) {
  doc.fontSize(28).fillColor(CYAN).font('Helvetica-Bold').text(t, 72, y);
  return y + 40;
}

// PAGE 1: Cover
doc.rect(0, 0, 612, 792).fill(DARK);
drawGradientBar(0, 8);
// ... add content ...

// PAGE 2: Content
doc.addPage();
drawPageBg();
drawFooter(2);
let y = drawTitle('Section Title', 40);
// ... add content ...

// Finalize
doc.end();
stream.on('finish', () => {
  const size = fs.statSync(outputPath).size;
  console.log('PDF created: ' + outputPath);
  console.log('Size: ' + (size / 1024).toFixed(1) + ' KB');
});
```

---

## Workflow Checklist

Before starting PDF generation:

- [ ] Plan page count and content structure
- [ ] Use `file_operations` to write script (not `execute_javascript_code`)
- [ ] Use `execute_shell_command` to run
- [ ] Avoid emojis - use Unicode-safe characters or colored text
- [ ] Keep script as single self-contained file
- [ ] Use CommonJS syntax (`require`, not `import`)
- [ ] Test with simple page first, then expand
- [ ] Verify output file exists after generation

---

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `ENAMETOOLONG` | Script too big for CLI | Write to file, execute via shell |
| `Cannot find module 'pdfkit'` | Missing dependency | `npm install pdfkit` |
| `WinAnsi cannot encode` | Emoji/Unicode in text | Use safe characters or colored headers |
| `doc is not defined` | Split script execution | Keep all code in one file |
| `Unexpected token import` | ES modules syntax | Use `require()` or `.cjs` extension |
| Empty PDF | Missing `doc.end()` | Always call `doc.end()` |
| No file created | Stream not finished | Use `stream.on('finish', ...)` |

---

## Example Output Structures

### Pitch Deck (14 pages)

| Page | Content | Elements |
|------|---------|----------|
| 1 | Cover | Logo, tagline, key metrics boxes |
| 2 | Problem | 4 problem cards with accent bars |
| 3 | Solution | 5 module cards, differentiator box |
| 4 | Market | TAM/SAM/SOM boxes, growth chart |
| 5 | Competition | Comparison table, advantages list |
| 6 | Product | Architecture diagram layers |
| 7 | Features | Category cards, highlight box |
| 8 | Business | Pricing tiers, revenue table |
| 9 | GTM | Phase cards with timeline |
| 10 | Traction | Metric boxes, milestone list |
| 11 | Team | Role cards with backgrounds |
| 12 | Ask | Fund allocation bars, milestones |
| 13 | Closing | Why now cards, quote box |
| 14 | Contact | Centered contact info |

---

*Key insight: Always write PDF generation scripts to files and execute via shell commands. Never pass large scripts directly to code execution tools.*

