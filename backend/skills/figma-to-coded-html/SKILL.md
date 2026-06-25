---
name: figma-to-coded-html
description: Convert Figma designs into self-contained, shareable single-file HTML with all UI elements coded in HTML/CSS/SVG and only actual photographs embedded as inline base64. Use this skill whenever the user asks to convert a Figma file/URL to HTML, export Figma designs as code, create HTML from Figma, turn a Figma mockup into a webpage, build a coded version of a Figma design, make a shareable HTML from Figma, or mentions Figma-to-HTML, Figma export, Figma MCP, Figma conversion, or wants a portable single-file HTML version of any Figma design. Also trigger when the user pastes a Figma URL (figma.com/design/... or figma.com/file/...) and asks to make it into HTML, code it, export it, or convert it. This skill encodes the exact proven pipeline from the June 2025 YOCCI conversion — Figma MCP authentication, file structure extraction, vision-based photo/UI classification, image fill downloading, base64 embedding, and fully-coded responsive HTML output.
version: 1.0.0
---

# Figma → Coded HTML Conversion Pipeline

Convert any Figma design into a **self-contained, shareable single-file HTML** where all UI is coded and only real photographs are embedded as base64.

## Core Principles

1. **Code everything you CAN** — charts, tables, cards, navbars, buttons, progress rings, icons = HTML/CSS/SVG. Never screenshot UI and embed as an image.
2. **Only real photos as images** — model shots, product photos, background imagery, artwork — things that literally cannot be CSS.
3. **Base64 inline** — photos embedded as `data:image/jpeg;base64,...` so the file is fully portable. Zero external dependencies except Google Fonts CDN.
4. **Single file output** — save to workspace AND return in a fenced code block in chat.
5. **Don't ask, just build** — do the work thoroughly, report results when done.

## Pipeline Steps

### Step 1: Authenticate the Figma MCP

The MCP server and AGNT auth vault store tokens separately. Always sync them:

```
agnt_auth → get_valid_token(provider_id: "figma")    → get decrypted figd_xxx token
mcp__mcp-figma__set_api_key(api_key: token)          → push to MCP server config at ~/.mcp-figma/config.json
mcp__mcp-figma__check_api_key()                      → verify it took
```

**If token is expired:** Tell the user to update their Figma Personal Access Token in AGNT Settings → Connected Apps → Figma. Then retry. Tokens are generated at https://www.figma.com/settings (Security → Personal Access Tokens).

**Key gotcha:** `get_valid_token` returns the decrypted token. `retrieve_api_key` returns it encrypted — useless for the MCP. Always use `get_valid_token`.

### Step 2: Fetch the File Structure

Extract the file key from the Figma URL — it's the alphanumeric string after `/design/` or `/file/`:
- `https://www.figma.com/design/KtktcCn6MGe070tr92AbuZ/Testing` → key is `KtktcCn6MGe070tr92AbuZ`

```
mcp__mcp-figma__get_file(fileKey, depth: 4)
```

This returns a **cached JSON file on disk** (not inline), typically at `~/.mcp-figma/cache/file_KEY_TIMESTAMP.json`. Read it via `file_operations → read`, which will offload it since it's usually 50-100KB+.

Use `query_data` to explore the structure:
- `stats` → see top-level keys (document, components, styles, etc.)
- `search` for `"type": "FRAME"` → find exportable top-level frames (pages/screens)
- `search` for `"name"` → find component and frame names
- `search` for `"characters"` → extract all text content (labels, headings, prices, descriptions)

**Key structure:**
- `document.children[]` — each is a page (`CANVAS` type)
- First-level children of each page — top-level frames (your exportable screens)
- `COMPONENT` / `INSTANCE` types — reusable UI elements (cards, buttons)

### Step 3: Export Frame Images for Visual Reference

Export the main frames as PNG at 2× to see what the design looks like:

```
mcp__mcp-figma__get_image(fileKey, ids: ["node-id-1", "node-id-2"], format: "png", scale: 2)
```

Download the returned S3 URLs immediately to local files (they expire):

```javascript
const resp = await fetch(s3Url);
const buf = Buffer.from(await resp.arrayBuffer());
fs.writeFileSync(outPath, buf);
```

### Step 4: Vision-Classify Photo vs UI

Run `analyze_image` on each exported frame with a classification prompt:

> "Identify ONLY the actual photographic images in this design. List each photo with its position and content. What's a real photo vs pure UI that can be coded in HTML/CSS?"

This is faster and more reliable than parsing JSON fill types. The vision model will clearly separate:
- **Photos:** "Full-bleed hero model shot", "Product card with perfume bottle", "Night street scene"
- **UI:** "Status bar", "Search input", "Navigation tabs", "Bar chart", "Price labels"

### Step 5: Pull Actual Photos via Image Fills

```
mcp__mcp-figma__get_image_fills(fileKey)
```

This returns ALL embedded raster images (photographs, icons, artwork) as signed S3 URLs with content hashes.

**Download and catalog them:**

```javascript
for (const [hash, url] of Object.entries(fills)) {
  const resp = await fetch(url);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(\`photos/fill-\${i}-\${hash.slice(0,8)}.\${ext}\`, buf);
}
```

Then run `analyze_image` on each downloaded photo with `"What does this image show? One sentence."` to build a role-based catalog:

```javascript
const photoMap = {
  hero:     { file: 'fill-14-2b8760ff.jpg', desc: 'Male model hero shot' },
  product1: { file: 'fill-1-0537cbdf.jpg',  desc: 'Woman yellow sweater' },
  service1: { file: 'fill-15-40fd2c15.jpg', desc: 'Gucci store colorful' },
  ar:       { file: 'fill-22-9a063460.png', desc: 'Dragon artwork' },
};
```

**Skip these — they're UI elements, not design photos:**
- App icons (PayPal, etc.)
- Upload placeholder graphics
- Generic mountain/sun placeholder images
- Tiny icons or UI decorators

### Step 6: Extract Design Details for Coding

From the Figma JSON and vision analysis, extract:

| Detail | How to find |
|--------|-------------|
| **Colors** | `search` for `"color"` in the JSON, or read from vision analysis |
| **Typography** | `search` for `"fontFamily"`, `"fontSize"`, `"fontWeight"` |
| **Text content** | `search` for `"characters"` — gives every text string |
| **Layout** | `search` for `"layoutMode"` (HORIZONTAL/VERTICAL = flexbox) |
| **Spacing** | `"itemSpacing"`, `"paddingLeft"`, etc. |
| **Border radius** | `"cornerRadius"` values |

### Step 7: Build the HTML with Base64 Photos

This is the core output step. Use `execute_javascript_code` to:

1. Read each photo file and convert to base64:
```javascript
const buf = fs.readFileSync(photoPath);
const ext = photoPath.endsWith('.jpg') ? 'jpeg' : 'png';
const b64 = \`data:image/\${ext};base64,\${buf.toString('base64')}\`;
```

2. Build the complete HTML as a JavaScript template literal with `\${b64.hero}`, `\${b64.product1}`, etc. interpolated into `<img src="...">` tags.

3. Write the file:
```javascript
fs.writeFileSync(outputPath, html);
```

**This is the ONLY reliable way to embed multi-MB base64 strings.** You cannot paste them manually or use write_file with inline base64 — it must be generated and written programmatically in JavaScript.

### Step 8: Deliver

1. Save to workspace with a descriptive filename (e.g., `yocci-coded.html`)
2. Report: file size, photo count, what's coded vs what's an image
3. Return the full HTML in a fenced code block (the template code without base64 — the actual file with embedded base64 will be multi-MB)

## What to Code vs What to Embed

### Always Code in HTML/CSS/SVG
- Navigation bars, tab bars, bottom navs
- Buttons, CTAs, links
- Search inputs, form elements
- Typography, headings, labels, prices
- Bar charts (horizontal or vertical) → CSS width/height + flexbox
- Pie/donut charts → SVG paths
- Area/line charts → SVG path elements
- Tables → HTML `<table>` with styled rows
- Cards → CSS border-radius, padding, shadow
- Progress indicators → SVG circle with stroke-dasharray
- Star ratings → repeated SVG star
- Tags/badges → inline-block spans with background colors
- Phone frames → CSS border-radius: 44px, border, box-shadow
- Status bars → flexbox with text
- Pagination dots → small circles with active state
- Gradient overlays → CSS linear-gradient
- Icons → inline SVG

### Embed as Base64 Images
- Hero/background photographs
- Product photography
- Model/portrait photos
- Store/location photos
- Artwork/illustrations that aren't geometric
- Any raster content that can't be reproduced with CSS

## Size Budget

| Content | Typical Raw | As Base64 |
|---------|-------------|-----------|
| Hero photo (full-bleed) | 200-400KB | 280-530KB |
| Product card photo | 20-80KB | 27-107KB |
| Service card background | 40-80KB | 53-107KB |
| Illustration/artwork | 200-500KB | 270-670KB |
| **Total (coded + ~9 photos)** | — | **~2-3MB** |
| vs screenshot-only approach | — | **~7-8MB** |

Coding the UI instead of screenshotting it produces files that are **3-4× smaller**, fully responsive, interactive, and editable.

## Tools Reference

| Tool | Purpose |
|------|---------|
| `agnt_auth → get_valid_token` | Get decrypted Figma API token from vault |
| `mcp__mcp-figma__set_api_key` | Push token to MCP server config |
| `mcp__mcp-figma__check_api_key` | Verify MCP has a valid token |
| `mcp__mcp-figma__get_file` | Fetch full file tree (pages, frames, components) |
| `mcp__mcp-figma__get_file_nodes` | Deep dive into specific nodes with all properties |
| `mcp__mcp-figma__get_image` | Export any node as PNG/SVG at custom scale |
| `mcp__mcp-figma__get_image_fills` | Get all embedded photographs/rasters |
| `analyze_image` | Vision-classify photo vs UI; catalog image contents |
| `query_data` | Search offloaded Figma JSON for text, colors, structure |
| `execute_javascript_code` | Download images, convert to base64, template & write HTML |
| `write_file` | Save final self-contained HTML to workspace |

## Common Gotchas

1. **MCP token sync is manual** — AGNT vault and MCP server have separate token copies. Must explicitly `set_api_key` after any token refresh.
2. **`get_image_fills` ≠ `get_image`** — fills = source photos embedded in the design; get_image = rendered screenshots of frames. Use fills for photos, screenshots only for visual reference.
3. **Signed S3 URLs expire** — download all images immediately after receiving URLs. Never store URLs for later use.
4. **`get_valid_token` not `retrieve_api_key`** — retrieve_api_key returns encrypted blob, get_valid_token returns the actual usable token.
5. **Build HTML in JavaScript** — template literals + `fs.writeFileSync` is the only sane way to embed multi-MB base64 strings. Cannot use write_file with inline base64.
6. **Large Figma files get offloaded** — the JSON will be replaced with a data reference. Use `query_data` operations (stats, search, slice, json_path) to explore it.
7. **Vision analysis is faster than JSON parsing** — to figure out what's a photo vs what's UI, screenshot the frame and ask the vision model. This beats traversing nested JSON looking for IMAGE fill types.
8. **Image too large for vision** — if a photo exceeds 10MB, skip vision analysis for that one and identify it by context (it's usually the hero image).
