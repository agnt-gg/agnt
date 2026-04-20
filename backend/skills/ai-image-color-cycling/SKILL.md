---
name: ai-image-color-cycling
description: Generate an AI image, quantize it to a 256-color indexed palette, and produce BOTH a self-contained HTML artifact AND a perfect-loop animated GIF that bring the image to life via classic 1990s palette cycling — the trick where rotating palette entries makes water flow, fire flicker, and stars twinkle without ever redrawing pixels. Optionally freeze a subject (character, object) AND/OR UI elements (text boxes, menus, HUD) so they stay perfectly still while only the background animates. Masks are derived DIRECTLY from the indexed image — never from a second generate_image call — so alignment is guaranteed pixel-perfect. Use this skill whenever the user asks to "color cycle an image", "make a generated image animate", "old-school palette animation", "Mark Ferrari style", "8-bit/16-bit animated scene", "make this picture come alive", "pixelize and animate", "indexed-color animation", "animated gif from a generated image", or anything that combines AI image generation with retro pixel-art motion. Also use when the user references the canvascycle library, palette rotation, color rotation, or wants flowing water / glowing rivers / waving fire / drifting clouds in a generated image, or wants to keep a character (and any UI) STILL while the rest of the image animates.
---

# AI Image → Palette Cycling Pipeline

This skill turns a freshly generated AI image into a living scene using **palette cycling** — a 1990s technique made famous by Mark J. Ferrari (LucasArts, *Loom*). The image is downscaled to pixel-art resolution, quantized to a 256-color indexed palette, and emitted as **two artifacts**:

1. A **self-contained HTML file** with controls, BlendShift mode, and a live palette swatch strip
2. A **seamlessly-looping animated GIF** ready to drop into Discord, slides, or anywhere

Every run produces both. Don't skip the GIF — even if the user only asks for cycling, the GIF is the most shareable, immediate result and the user always wants it.

## When to use this

Trigger this skill whenever the user wants to:

- Generate an AI image and animate parts of it (water, fire, lava, sky, glow, neon)
- Make any image color-cycle "Ferrari-style" / "canvascycle-style"
- Produce an 8-bit or 16-bit retro animated scene from a prompt
- Create an **animated GIF** of a pixel-art scene with looping motion
- Pixelize and animate a generated image
- **Freeze a character/object** while the rest of the image animates ("don't animate the dragon", "keep Pikachu still", "the subject should stay static")
- **Freeze UI elements** like RPG text boxes, menus, HUD panels — anything that looks like flat-color UI and shouldn't cycle

Don't use it for: video generation, frame-by-frame character animation, or anything that needs to actually move pixels around. This is *only* for palette rotation effects on a static indexed image.

## How the trick works (so you can explain it)

A 256-color indexed image stores one byte per pixel — that byte is an index into a 256-entry color lookup table (the **palette**). If you change palette entry 17 from cyan to bright cyan, *every pixel referencing slot 17 instantly flips* — no redraw, no pixel walk. By rotating a *contiguous range* of palette entries (e.g. slots 16–63 shift down by one each frame), pixels that reference that range appear to flow.

The art is in **arranging the palette so similar colors sit next to each other** — then rotation looks like motion instead of strobing. This skill sorts the palette by hue/luminance after quantization, then auto-detects ranges of bright cyans, magentas, blues, etc. that make good cycling candidates.

**Masking trick (critical section — read carefully):** If a subject (character) or a UI element (text box, menu) shares colors with a cycling range, those pixels animate too — usually undesirable. The fix is to build a binary mask of the thing that should stay still, then for every masked pixel whose palette index is in a cycling range, reassign it to the nearest palette entry that *isn't* cycling. The palette is unchanged; only specific pixel→palette pointers move. The visual color stays essentially the same (we pick the closest RGB match), but those pixels no longer rotate.

⚠️ **DO NOT generate a separate mask image by calling `generate_image` a second time.** AI models do not produce pixel-aligned silhouettes — the subject's pose, size, and position will drift, and masking with a misaligned silhouette leaves a ghost fringe of cycling color around your subject. The correct approach is to **derive the mask directly from the indexed image itself** using palette classification, connected-component analysis, and/or vision-assisted bounding boxes. Alignment is then guaranteed pixel-perfect because the mask is built from the exact same pixels as the scene.

## Pipeline overview

```
[1] generate_image (Gemini nano-banana-pro-preview)
        ↓ image ID
[2] fetch /api/images/:id  →  raw JPEG/PNG bytes
        ↓
[3] sharp.metadata() → READ SOURCE DIMENSIONS  ← critical step!
        ↓
[4] sharp .resize(W, H) preserving exact source ratio  →  RGBA
        ↓
[5] median-cut quantize → 256-entry palette
        ↓
[6] sort palette by hue/luminance → re-map indexed buffer
        ↓
[7] auto-detect cycling ranges (cyan, magenta, orange, yellow, etc.)
        ↓
[8] OPTIONAL: build mask(s) from the indexed image → remap masked pixels
             out of cycling ranges. Can layer multiple masks.
        ↓
[9] deflate-compress indexed buffer → base64
        ↓
[10] inject into cycler-template.html → write final .html
        ↓
[11] render N frames + ffmpeg 2-pass → write seamless .gif   ← MANDATORY
```

Steps 3–7, 9 live in `scripts/quantize.js`. Step 8 splits across `build-mask.js` (builds the mask) and `mask-and-remap.js` (applies it). Step 10 is `render-html.js`. Step 11 is `encode-gif.js`.

## The exact workflow

### Step 1: Craft a cycling-friendly prompt

The image must have **clear color regions that the cycling effect can target**. Bad: a soft watercolor portrait. Good: a scene with a glowing river, waving fire, neon signs, lava flow, aurora, starfield, waterfall, or any well-separated chromatic feature.

Always append these phrases to the user's prompt to maximize the effect:

```
Limited color palette, 16-bit JRPG aesthetic (Secret of Mana, Chrono Trigger).
Crisp pixels, no anti-aliasing, flat shading, clear color separation between regions.
Strong horizontal banding in [the cycling feature] for color cycling.
```

Generate at `aspectRatio: "4:3"` *but be aware Gemini may not honor it* — the actual image dimensions can be 16:9 or wider. The pipeline detects the actual ratio in step 3.

### Step 2: Get the image ID

`generate_image` returns `{{IMAGE_REF:img-XXXX-0}}`. **Extract the bare ID** (`img-XXXX-0`) — that's what you'll pass to the script.

### Step 3: Run the quantizer

```bash
node scripts/quantize.js --image-id <IMAGE_ID> --out /tmp/cycle-data.json
```

**Don't pass `--width`/`--height` unless you have a specific reason.** The script reads the source dimensions and auto-picks a target that preserves the **exact source ratio** with ~38000 pixels — this is the single most important fix to avoid squashed/cropped images.

The script emits:
```
✓ Source dims: 1408×768 (ratio 1.8333)
✓ Auto-picked target: 264×144 (ratio 1.8333, 38016 px)
✓ Quantized to 256 colors in 35 ms
✓ Auto-detected ranges:
    cyan     71..98   (28 entries)
    yellow   9..53    (45 entries)
    blue     99..211  (113 entries)
    ...
```

### Step 4: Pick the cycling ranges

The script suggests ranges, but **you choose which ones to actually cycle**. Read the suggested ranges, look at the user's prompt, and pick the 1–3 ranges that match what *should* be moving.

⚠️ **Critical**: ranges are completely image-specific because of palette sorting. **Don't reuse ranges from a previous run.** ALWAYS read the latest `data.json` ranges before picking.

| User wanted to animate | Pick range |
| --- | --- |
| Glowing river / bioluminescence / lava-cool / aurora | cyan |
| Lava / fire / sunset / neon pink | orange + yellow (or magenta + light) |
| Sky / aurora / ocean / storm | blue |
| Stars / lightning / sparkle | light (+ alternating dark/bright) |

For HTML, pick rates that *feel* right (3.0–6.0 fast, 1.5–2.5 medium, 0.5–1.0 slow). For GIF, the rate is **auto-computed from loop duration** so you don't need to pass one.

For a really alive scene, **pair two ranges going in opposite directions** — e.g. the bright glow flowing forward, the mid-tones flowing back. That sells the parallax.

### Step 5 (OPTIONAL but common): Freeze the subject

If the user wants the character to stay still while the background animates, build a subject mask from the indexed image.

**5a. Profile the palette to find the subject's colors.** Run a quick inspection to list which palette indices fall in the subject's color families. The trick is: after quantization, palette entries are sorted by hue, so a subject's primary colors tend to cluster into a contiguous index range.

A short node one-liner works — read `data.paletteB64`, convert each entry to HSL, and filter. For Pikachu (yellow body, red cheeks):

```js
// yellow: hue 35–75, saturation >0.55, lightness 0.45–0.85
// red:    hue 340–20 (wraps), saturation >0.55, lightness 0.25–0.65
```

Note the indices that match and their usage counts (how many pixels reference them). Top-usage indices in each color family ARE your subject's body colors.

**5b. Build the subject mask.** Call `build-mask.js` in `subject` mode with the color specs you just derived:

```bash
node scripts/build-mask.js \
  --data /tmp/cycle-data.json --mode subject \
  --colors '{"yellow":{"h":[35,75],"s":[0.55,1],"l":[0.45,0.85]},
             "red":{"h":[340,20],"s":[0.55,1],"l":[0.25,0.65]}}' \
  --center-y '[0.40,1.0]' \
  --min-blob-frac 0.05 \
  --close 3 --dilate 2 \
  --out /tmp/subject-mask.png \
  --preview-out /tmp/subject-preview.png
```

What this does, under the hood:

1. **Classify palette entries** matching your color specs → marks ~10–20 "subject-colored" palette indices
2. **Seed** every pixel whose index is subject-colored
3. **Connected-component labeling** (4-connected flood) → finds blobs
4. **Filter blobs** by: (a) size ≥ `min-blob-frac` × biggest blob, (b) centroid inside `center-y` / `center-x` bounds (rejects stray subject-color pixels that happen to land in the sky, like scattered yellow lightning bolts)
5. **Morphological close** (dilate then erode by `--close`) to fill interior gaps where the subject has small wrong-color pixels like eyes or shading
6. **Final dilate** by `--dilate` to grab the dark outline and a 1-px fringe (this is what makes the freeze look clean — without this you'd see a thin rim of cycling color around the subject)

**5c. Preview the mask.** The `--preview-out` flag dumps a debug image: subject bright, everything else dimmed 30%. Open it (or pass it to `analyze_image`) to verify the mask cleanly covers the subject without stray regions. Common fixes:

- Mask covers stray sky regions → tighten `--center-y` (Pikachu sits in the bottom 60% of the image, so `[0.40, 1.0]` excludes top-half yellow lightning)
- Mask missing the tail / ears → raise `--dilate` from 2 to 3
- Mask has holes in the body → raise `--close` from 3 to 4

Iterate 2–3 times — it's fast.

**5d. (If needed) refine with vision.** For truly difficult subjects, ask `analyze_image` on the preview whether the mask is clean, and parse its feedback. The vision model is very good at "the bright region covers Pikachu's body but misses the tail and grabs some scattered yellow in the sky."

### Step 6 (OPTIONAL): Freeze UI elements (text boxes, menus, HUD)

Many AI-generated game scenes include incidental RPG UI — dialogue boxes, battle menus, HUD panels. If the user wants these frozen too, **do not treat them as part of the subject mask**. Build a separate UI mask and union it onto the subject mask.

There are two ways to build the UI mask:

**Method A — Vision-assisted (most reliable, recommended).** Render the current indexed image at 3–4× scale and ask `analyze_image` for the exact bounding boxes:

```
prompt: "This is a 792×432 image which is the 264×144 source at 3× scale.
Identify each RPG UI element (text box, menu). For each, give me the
bounding box in ORIGINAL 264×144 coordinates. Return JSON array of
{name, left, top, right, bottom}. Divide pixel coords by 3."
```

The vision model returns precise bboxes like:
```json
[
  {"name": "dialogue", "left": 5, "top": 3, "right": 255, "bottom": 29},
  {"name": "menu",     "left": 144, "top": 104, "right": 255, "bottom": 143}
]
```

Stamp those as mask rectangles, unioned onto the subject mask:

```bash
node scripts/build-mask.js \
  --data /tmp/cycle-data.json --mode boxes \
  --boxes '[{"left":5,"top":3,"right":255,"bottom":29},
            {"left":144,"top":104,"right":255,"bottom":143}]' \
  --merge /tmp/subject-mask.png \
  --out /tmp/combined-mask.png \
  --preview-out /tmp/combined-preview.png
```

The `--merge` flag unions the new boxes with an existing mask. Output is the union.

**Method B — Algorithmic auto-detect (works for flat UI on busy backgrounds).** RPG text boxes are dense clusters of near-black fill + near-white text inside rectangles. `ui-auto` mode finds horizontal row bands with a high density of UI-colored pixels, clusters them, and stamps their extent:

```bash
node scripts/build-mask.js \
  --data /tmp/cycle-data.json --mode ui-auto \
  --exclude /tmp/subject-mask.png \
  --dense-row-thresh 35 \
  --merge /tmp/subject-mask.png \
  --out /tmp/combined-mask.png \
  --preview-out /tmp/combined-preview.png
```

The `--exclude` flag is critical: it ignores UI-colored pixels inside the subject mask so the subject's black outline doesn't count as "UI". Method B is faster but can misfire if the scene has large flat-color regions that aren't UI. Method A is more reliable.

**Always preview both masks combined** before applying the remap. Check that:
- Subject is fully covered (bright region in preview)
- All UI boxes are covered (usually tinted differently in preview)
- No stray regions in sky/background (those would become static "holes" in the animation)

### Step 7: Apply the mask (remap cycling pixels)

Once your combined mask PNG is built, apply it:

```bash
node scripts/mask-and-remap.js \
  --data /tmp/cycle-data.json \
  --mask-png /tmp/combined-mask.png \
  --cycles '[{"lo":71,"hi":98},{"lo":99,"hi":200}]'
```

The script:
- Loads the mask, binarizes at threshold 128
- For every masked pixel using a cycling palette index, remaps it to the nearest non-cycling palette entry
- Reports pixel count and average RGB shift
- Updates `data.indexedB64` in place

**Typical results:** avg shift < 15 RGB means visually imperceptible. 20–50 means the subject's body color is close to the cycling range — still fine. >50 means the subject's primary color is dead-center in the cycling range and you may want to narrow the cycling range to leave the subject's actual color un-cycled.

For the Pikachu example: UI remap averaged ~45 RGB (text box interior goes from mid-blue to nearest non-cycling blue — visually identical in context), subject fringe remap averaged ~20 RGB.

### Step 8: Render the HTML

```bash
node scripts/render-html.js \
  --data /tmp/cycle-data.json \
  --template assets/cycler-template.html \
  --cycles '[{"lo":71,"hi":98,"rate":6.0,"dir":1},{"lo":99,"hi":200,"rate":1.5,"dir":-1}]' \
  --title "Pikachu Electric Storm" \
  --out /tmp/cycling.html
```

The template includes the cycling engine, BlendShift toggle, speed slider, direction toggle, and a live palette swatch strip with cycling indices outlined in green.

### Step 9: Render the GIF (MANDATORY — always do this)

```bash
node scripts/encode-gif.js \
  --data /tmp/cycle-data.json \
  --cycles '[{"lo":71,"hi":98,"dir":1},{"lo":99,"hi":200,"dir":-1}]' \
  --duration 4 --fps 20 --scale 4 \
  --out /path/to/output.gif
```

**Note**: cycle entries don't need `rate` for the GIF — the script auto-computes `rate = entries / duration` so each cycle completes EXACTLY one rotation in the loop period. This guarantees a mathematically perfect seamless loop.

Defaults that work great:
- `--duration 4` (4 seconds, long enough to read the motion, short enough to share)
- `--fps 20` (50ms per frame, smooth)
- `--scale 4` (4× nearest-neighbor upscale; on a 264×144 source → 1056×576 output)

### Step 10: Verify the freeze (trust but verify)

After generating the GIF, **sample a few frames and pixel-diff the masked regions** to prove they're truly frozen:

```js
const sharp = require('sharp');
const { spawnSync } = require('child_process');
// extract every 20th frame from the GIF
spawnSync('ffmpeg', ['-y', '-i', GIF, '-vf', 'select=not(mod(n\\,20))', '-vsync', 'vfr', 'f%02d.png']);
// load mask at GIF resolution
const m = await sharp(MASK).resize(W, H, {kernel:'nearest'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
// for each masked pixel, compare RGB across frames — should be 0 different pixels
```

Expected results for a correctly-masked subject+UI:
- Masked region: **0 differing pixels across frames** ✅
- Background region: **several differing frames** (cycling works) ✅

If the masked region shows differing pixels, investigate: did the cycle ranges change since the remap? Is the mask being loaded at the wrong resolution? (Always `resize with kernel: nearest`.)

### Step 11: Show the user

In your chat response:
1. Show the original generated image with `<img src="{{IMAGE_REF:...}}">`
2. Describe which ranges you chose to cycle and why
3. Describe what's frozen (subject, UI) and how you built the masks (palette classification + connected components + morphology, plus vision-derived UI bboxes if you used any)
4. Include verification stats if you did Step 10 ("0 of N masked pixels change across frames")
5. **Mention both files** — the HTML path and the GIF path
6. Inline the entire HTML in a single ` ```html ` code block so it renders live (if it fits — ~40 KB chat-message limit; if not, describe and link)

## Common pitfalls (every one of these has bitten me)

**Image looks squashed or cropped.** You used a `--width`/`--height` whose ratio doesn't match the source. Run `quantize.js` without those flags and let it auto-pick.

**The image came out smooth/painterly instead of pixel-art.** Add stronger "16-bit, flat shading, no anti-aliasing" instructions to the prompt and regenerate. Sharp's lanczos resize will smear soft edges, killing the indexed-color illusion.

**Cycling looks like strobing instead of flowing.** Your range covers colors that aren't actually adjacent in hue. Either pick a tighter range, or trust the auto-detected ranges — they're sorted to be smooth.

**The wrong region is animating.** The image's dominant color and the auto-detected range don't line up with what the user wanted. Either re-prompt the image (push the cycling-feature color harder), or manually pick a range by reading the script's "Top-10 most-used palette entries" output.

**The character is animating with the background.** Use Steps 5–7 to build a subject mask directly from the indexed image. See the next two pitfalls for why NOT to do it the obvious wrong way.

**⛔ Generated a second image as a mask and it looks misaligned.** This is the wrong approach — AI models do not produce pixel-aligned silhouettes. The subject's pose, size, arm position, ear angle etc. will all drift. Masking with a misaligned silhouette leaves a ghost fringe of cycling color around the subject, or freezes regions where the subject isn't. **Always derive the mask from the indexed image itself** using `build-mask.js --mode subject`.

**⛔ UI still cycles even though I masked the subject.** The subject mask doesn't include the text box or menu. Build a SEPARATE UI mask (Method A: vision → boxes, or Method B: ui-auto) and union it with the subject mask via `--merge`. Verify in the preview image that BOTH subject and UI appear masked before running remap.

**Subject mask has scattered fragments in the sky.** The subject's color (e.g. Pikachu's yellow) also appears elsewhere in the scene (yellow lightning). Tighten `--center-y` to restrict to the subject's actual vertical band. Also keep `--min-blob-frac` at 0.05+ so only substantial blobs qualify.

**Subject mask has holes inside the body.** Raise `--close` from 3 to 4 (fills bigger interior gaps). If that's still not enough, the subject's interior has regions whose color is outside your spec — add more color families to `--colors` (e.g. include brown for Pikachu's tail base).

**Mask looks perfect in the preview but pixels still cycle after remap.** The cycle ranges you passed to `mask-and-remap.js` don't match what you're passing to `render-html.js` / `encode-gif.js`. They MUST be identical. Write the cycles list once and reuse it everywhere.

**Pixel-diff verification says masked pixels are changing but visually they look identical.** Check your diff code — the GIF is RGB when written but sharp returns RGBA (4 channels), so you may be reading alpha as color. Use `sharp().raw().toBuffer({resolveWithObject:true})` and respect `info.channels`.

**GIF won't loop seamlessly.** You used the HTML's "feel-good" rates for the GIF too. Use `encode-gif.js` without rates — it auto-syncs to `entries/duration` for a perfect loop.

**Reused cycle ranges from previous image.** Ranges are image-specific because palette sorting produces different orderings each time. Always re-read the JSON `ranges` field after quantizing.

**The remap'd color shift for a subject is huge (>60 RGB).** The cycling range overlaps the subject's primary body color. Three options: (a) narrow the cycling range to exclude the subject's color indices (best), (b) pick a different cycling feature (if the subject is orange and you were cycling lava, pick the sky instead), (c) accept the shift if motion matters more than color fidelity.

## Reference: cycling engine essentials

The engine at the heart of the template is short — here's the loop in case you ever need to inline it manually:

```js
function cyclePaletteFrame(dt) {
  palette.set(basePalette);                       // reset
  for (const { lo, hi, rate, dir } of cycles) {
    const n = hi - lo + 1;
    pos[c] = ((pos[c] + rate * speedMul * dir * dt) % n + n) % n;
    const i0 = Math.floor(pos[c]), frac = pos[c] - i0;
    for (let k = 0; k < n; k++) {
      const a = basePalette[lo + (k + i0) % n];
      const b = basePalette[lo + (k + i0 + 1) % n];
      palette[lo + k] = blendMode
        ? lerp(a, b, frac)        // BlendShift: smooth between palette steps
        : a;                      // Standard: hard step
    }
  }
}
function blit() {
  for (let i = 0; i < W*H; i++) pix32[i] = palette[indexed[i]];
  ctx.putImageData(img, 0, 0);
}
```

## Reference: masking essentials

Freezing pixels is purely a pointer-remap — the palette never changes:

```js
const isCycling = new Uint8Array(256);
for (const {lo, hi} of cycles) for (let i = lo; i <= hi; i++) isCycling[i] = 1;

for (let i = 0; i < N; i++) {
  if (!mask[i]) continue;             // not frozen — leave alone
  const oldIdx = indexed[i];
  if (!isCycling[oldIdx]) continue;   // already non-cycling — fine
  indexed[i] = nearestNonCycling(palette[oldIdx], palette, isCycling);
}
```

## Reference: subject-detection algorithm

The heart of `build-mask.js --mode subject`:

```js
// 1. Classify palette entries: which are "subject colors" by HSL filter?
const match = palette.map(([r,g,b]) => isInColorSpec(rgb2hsl(r,g,b)));

// 2. Seed: every pixel whose palette index is subject-colored
const seed = new Uint8Array(N);
for (let i = 0; i < N; i++) if (match[indexed[i]]) seed[i] = 1;

// 3. Connected components (4-connected flood fill)
const { label, sizes } = connectedComponents(seed);

// 4. Keep blobs that are: (a) big enough (min-blob-frac × biggest), AND
//    (b) have their centroid inside an allowed bbox (usually lower-center
//    of image for a character standing in the foreground)
const keep = new Set(blobsPassingFilter);

// 5. Morphological close (fill interior gaps), then dilate (grab outline)
mask = dilate(close(blobsOnlyPixels, closeR), dilateR);
```

This technique works because: (1) after palette sort, similar colors cluster into contiguous index ranges, so a single HSL filter captures most of a subject's color family; (2) connected-components reliably separates the subject-blob from scattered same-color pixels in the background; (3) morphology cleans up the silhouette edges to match the dark outline the AI image model put around the subject.

## Reference: UI-box detection algorithm

The heart of `build-mask.js --mode ui-auto`:

```js
// 1. Classify UI palette entries: near-black (lum<35, sat<0.3) OR near-white (lum>225, sat<0.15)
const isUI = palette.map(c => isUIColor(c));

// 2. UI pixels outside the exclusion mask (subject) → avoids counting Pikachu's outline as UI
const uiX = new Uint8Array(N);
for (let i = 0; i < N; i++) uiX[i] = isUI[indexed[i]] && !subjectMask[i];

// 3. Row density: how many UI-pixels per row
const rowUI = new Array(H).fill(0);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (uiX[y*W+x]) rowUI[y]++;

// 4. Contiguous ranges of rows above threshold (merge 3-row gaps)
const bands = findDenseRowBands(rowUI, DENSE_THRESH);

// 5. For each band, find dense column runs → stamp bboxes
for (const band of bands) {
  const runs = findDenseColumnRuns(band, uiX);
  runs.filter(r => r.width >= 30).forEach(r => boxes.push({...r, ...band}));
}
```

The row-density step is what makes this robust — a genuine UI box has a big horizontal slab of black+white pixels (80–200 per row), whereas scattered black pixels from a character outline contribute only ~10 per row.

## Reference: seamless GIF loop math

For a perfect loop, **each cycle must complete an integer number of rotations in the loop duration**. The `encode-gif.js` script auto-sets:

```
rate = (hi - lo + 1) / loopDuration
```

So a 71-entry range over a 4-second loop has `rate = 17.75 entries/sec`, completing exactly one rotation in 4s. A 31-entry range gets `rate = 7.75`, also exactly one rotation. Both return to position 0 simultaneously at frame 80 (= frame 0). Seamless.

The HTML uses different "vibey" rates for ambient feel; the GIF uses synced rates for the loop. Both are correct for their context.

## Files

- `scripts/quantize.js` — image fetch + source-ratio detection + sharp resize + median-cut + palette sort + range detection + deflate. Outputs JSON.
- `scripts/build-mask.js` — constructs a binary mask directly from the indexed image. Three modes: `subject` (palette-classification + connected components + morphology), `boxes` (stamp explicit rectangles), `ui-auto` (row-density scan for UI rectangles). Outputs PNG. Supports `--merge` to union with an existing mask.
- `scripts/mask-and-remap.js` — applies a mask PNG to the indexed image by remapping masked pixels out of the cycling ranges. Updates the JSON in place. Accepts `--mask-png` (recommended) or `--mask-image-id` (legacy).
- `scripts/render-html.js` — fills the template with quantized data and chosen cycle ranges. Outputs HTML.
- `scripts/encode-gif.js` — renders frames stepping through the palette rotation, encodes to a perfect-loop GIF via ffmpeg 2-pass.
- `assets/cycler-template.html` — the runtime: cycling engine, controls, swatch strip, with placeholders the renderer fills in.
