---
name: ai-image-color-cycling
description: Generate an AI image, quantize it to a 256-color indexed palette, and produce a self-contained HTML artifact that brings the image to life via classic 1990s palette cycling — the trick where rotating palette entries makes water flow, fire flicker, and stars twinkle without ever redrawing pixels. Optionally apply a silhouette mask to FREEZE a subject (character, object) so only the background animates around them. Use this skill whenever the user asks to "color cycle an image", "make a generated image animate", "old-school palette animation", "Mark Ferrari style", "8-bit/16-bit animated scene", "make this picture come alive", "pixelize and animate", "indexed-color animation", or anything that combines AI image generation with retro pixel-art motion. Also use when the user references the canvascycle library, palette rotation, color rotation, or wants flowing water / glowing rivers / waving fire / drifting clouds in a generated image, or wants to keep a character STILL while the rest of the image animates.
---

# AI Image → Palette Cycling Pipeline

This skill turns a freshly generated AI image into a living scene using **palette cycling** — a 1990s technique made famous by Mark J. Ferrari (LucasArts, _Loom_). The image is downscaled to pixel-art resolution, quantized to a 256-color indexed palette, and emitted as a self-contained HTML file. At runtime, only specific palette ranges rotate each frame — pixels never get redrawn. The result feels magical because parts of the image animate while everything else stays bolted in place.

**With masking** (optional but powerful): generate a binary silhouette of the subject, and the skill remaps every subject-pixel that uses a cycling color to the nearest _non-cycling_ palette entry. The subject becomes visually frozen while the cycling continues around them. This is exactly how Ferrari's originals worked — characters and structures stayed static while only the elemental backgrounds flowed.

## When to use this

Trigger this skill whenever the user wants to:

- Generate an AI image and animate parts of it (water, fire, lava, sky, glow, neon)
- Make any image color-cycle "Ferrari-style" / "canvascycle-style"
- Produce an 8-bit or 16-bit retro animated scene from a prompt
- Pixelize and animate a generated image
- **Freeze a character/object** while the rest of the image animates ("don't animate the dragon", "keep the character still", "mask out the subject")

Don't use it for: video generation, gif creation, frame-by-frame animation, or anything that needs to actually move pixels around. This is _only_ for palette rotation effects on a static indexed image.

## How the trick works (so you can explain it)

A 256-color indexed image stores one byte per pixel — that byte is an index into a 256-entry color lookup table (the **palette**). If you change palette entry 17 from cyan to bright cyan, _every pixel referencing slot 17 instantly flips_ — no redraw, no pixel walk. By rotating a _contiguous range_ of palette entries (e.g. slots 16–63 shift down by one each frame), pixels that reference that range appear to flow.

The art is in **arranging the palette so similar colors sit next to each other** — then rotation looks like motion instead of strobing. This skill sorts the palette by hue/luminance after quantization, then auto-detects ranges of bright cyans, magentas, blues, etc. that make good cycling candidates.

**Masking trick:** If a subject (character) shares colors with a cycling range, those pixels animate too — usually undesirable. The fix is to generate a black/white silhouette of the subject, then for every subject-pixel whose palette index is in a cycling range, reassign it to the nearest palette entry that _isn't_ cycling. The palette is unchanged; only specific pixel→palette pointers move. The visual color is essentially the same (we pick the closest RGB match), but those pixels no longer rotate.

## Pipeline overview

```
[1] generate_image (Gemini nano-banana-pro-preview)
        ↓ image ID
[2] fetch /api/images/:id  →  raw JPEG/PNG bytes
        ↓ buffer
[3] sharp .resize(W, H, lanczos3) .raw()  →  RGBA pixels
        ↓
[4] median-cut quantize → 256-entry palette
        ↓
[5] sort palette by hue/luminance → re-map indexed buffer
        ↓
[6] auto-detect cycling ranges (cyan, magenta, blue, light, etc.)
        ↓
[7] OPTIONAL: generate silhouette mask  →  remap subject pixels out of cycling ranges
        ↓
[8] deflate-compress indexed buffer → base64
        ↓
[9] inject into assets/cycler-template.html → write final .html
```

Steps 3–7 are wrapped in `scripts/quantize.js` and `scripts/mask-and-remap.js`. You drive the whole pipeline by calling them once each with a few flags.

## The exact workflow

### Step 1: Craft a cycling-friendly prompt

The image must have **clear color regions that the cycling effect can target**. Bad: a soft watercolor portrait. Good: a scene with a glowing river, waving fire, neon signs, lava flow, aurora, starfield, waterfall, or any well-separated chromatic feature.

Always append these phrases to the user's prompt to maximize the effect:

```
Limited color palette, 16-bit JRPG aesthetic (Secret of Mana, Chrono Trigger).
Crisp pixels, no anti-aliasing, flat shading, clear color separation between regions.
Strong horizontal banding in [the cycling feature] for color cycling.
```

Generate at `aspectRatio: "4:3"` (matches retro display proportions and pixelizes cleanly).

### Step 2: Get the image ID

`generate_image` returns `{{IMAGE_REF:img-XXXX-0}}`. **Extract the bare ID** (`img-XXXX-0`) — that's what you'll pass to the script.

### Step 3: Run the quantizer

```bash
node scripts/quantize.js --image-id <IMAGE_ID> --width 200 --height 150 --out /tmp/cycle-data.json
```

Flags:

- `--image-id` (required): the image ref ID
- `--width`, `--height`: pixel-art resolution. **200×150 is the sweet spot** — small enough to keep base64 < 30 KB, large enough to look like a real scene. Don't go above 256×192 unless the user explicitly wants a bigger payload.
- `--out`: where to write the JSON bundle (palette + base64 indexed + detected ranges)

The script prints a summary like:

```
✓ Quantized to 256 colors in 53 ms
✓ Indexed buffer: 30000 bytes → 18850 compressed (62.8%) → 25136 b64
✓ Auto-detected ranges: cyan=14..63, magenta=70..89, blue=110..145
```

### Step 4: Pick the cycling ranges

The script suggests ranges, but **you choose which ones to actually cycle**. Read the suggested ranges, look at the user's prompt, and pick the 1–3 ranges that match what _should_ be moving.

⚠️ **Critical**: ranges are completely image-specific because of palette sorting. Don't reuse ranges from a previous run. ALWAYS read the latest `data.json` ranges before picking.

| User wanted to animate                               | Pick range                           |
| ---------------------------------------------------- | ------------------------------------ |
| Glowing river / bioluminescence / lava-cool / aurora | cyan                                 |
| Lava / fire / sunset / neon pink                     | orange + yellow (or magenta + light) |
| Sky / aurora / ocean                                 | blue                                 |
| Stars / lightning / sparkle                          | light (+ alternating dark/bright)    |

Each cycle has a `rate` (entries per second) and a `dir` (1 forward, -1 reverse). Good defaults:

- Fast flow (waterfall, fire, lava): `rate: 5.5`
- Medium flow (river current): `rate: 3.0`
- Slow drift (sky, aurora): `rate: 0.8`

For a really alive scene, **pair two ranges going in opposite directions** — e.g. the bright glow flowing forward, the mid-tones flowing back. That sells the parallax.

### Step 5 (OPTIONAL): Generate a mask and freeze the subject

If the user wants the character/subject to stay still while the background animates:

**5a.** Generate a binary silhouette mask of the subject:

```
Generate prompt: "Pure binary mask. PURE WHITE solid silhouette shape of [SUBJECT] on
PURE BLACK background. Absolutely NO grays. NO anti-aliasing. NO soft edges.
Just two colors: white where [SUBJECT] is, black everywhere else.
[SUBJECT] in same pose as: [describe the pose from the original scene].
Hard crisp pixel-perfect edges. Pure binary 1-bit mask only."
```

The model usually still produces some grays at edges — `mask-and-remap.js` thresholds at 128 by default which is fine.

**5b.** Run the masker:

```bash
node scripts/mask-and-remap.js \
  --data /tmp/cycle-data.json \
  --mask-image-id <MASK_IMAGE_ID> \
  --cycles '[{"lo":135,"hi":205},{"lo":115,"hi":145}]'
```

The script:

- Fetches the mask, downscales with `kernel: nearest` (preserves hard edges), thresholds to binary
- For every white-mask pixel whose palette index is in a cycling range, reassigns it to the nearest non-cycling palette entry
- Updates `data.indexedB64` in place

It reports how many pixels were remapped and the average RGB shift (typically < 15, basically imperceptible).

### Step 6: Render the HTML

```bash
node scripts/render-html.js \
  --data /tmp/cycle-data.json \
  --template assets/cycler-template.html \
  --cycles '[{"lo":14,"hi":63,"rate":6,"dir":1},{"lo":64,"hi":107,"rate":2.2,"dir":-1}]' \
  --title "Bioluminescent River" \
  --out /tmp/cycling.html
```

The template includes:

- The full cycling engine (~80 lines of JS)
- **BlendShift mode** (smooth sub-step interpolation) toggleable from the UI
- Speed slider (0×–4×)
- Direction toggle
- A live 256-swatch palette strip below the canvas with cycling indices outlined in green so the user can _see_ which colors are rotating

### Step 7: Show the user

In your chat response:

1. Show the original generated image with `<img src="{{IMAGE_REF:...}}">`
2. Describe which ranges you chose to cycle and why (and if you masked, what was masked)
3. Inline the entire HTML in a single ` ```html ` code block so it renders live

If the inlined HTML approaches the chat-message limit (~40 KB), drop the resolution to 160×120 and re-run. Don't try to RLE-compress by hand — the deflate stream is already near-optimal.

## Common pitfalls

**The image came out smooth/painterly instead of pixel-art.** Add stronger "16-bit, flat shading, no anti-aliasing" instructions to the prompt and regenerate. Sharp's lanczos resize will smear soft edges, killing the indexed-color illusion.

**Cycling looks like strobing instead of flowing.** Your range covers colors that aren't actually adjacent in hue. Either pick a tighter range, or trust the auto-detected ranges — they're sorted to be smooth.

**The wrong region is animating.** The image's dominant color and the auto-detected range don't line up with what the user wanted. Either re-prompt the image (push the cycling-feature color harder), or manually pick a range by reading the script's "Top-10 most-used palette entries" output and locking onto those indices.

**The character is animating with the background.** Use Step 5 (masking) to freeze them. The character's body shares color indices with the cycling range, so without masking they'll cycle too.

**Mask doesn't match the pose.** Generating a mask separately is unreliable — the AI may put the subject in a slightly different pose. Try one of: (a) emphasize the EXACT pose in the mask prompt, (b) accept slight misalignment (works fine because we threshold), or (c) use a foreground-segmentation tool instead. For most cases the prompted mask is good enough.

**Reused cycle ranges from previous image.** Ranges are completely image-specific because the palette sort produces different orderings each time. Always re-read the JSON `ranges` field after quantizing.

**Base64 too long for chat.** Drop resolution to 160×120 (saves ~40%) or 128×96 (~60%). Below 128 wide it stops looking like a real image.

**HTML doesn't display in the iframe sandbox.** The template uses `DecompressionStream('deflate-raw')` — this is supported in all modern browsers but won't work in very old ones. If the user reports a blank canvas, check the browser console.

## Reference: cycling engine essentials

The engine at the heart of the template is short — here's the loop in case you ever need to inline it manually:

```js
function cyclePaletteFrame(dt) {
  palette.set(basePalette); // reset
  for (const { lo, hi, rate, dir } of cycles) {
    const n = hi - lo + 1;
    pos[c] = (((pos[c] + rate * speedMul * dir * dt) % n) + n) % n;
    const i0 = Math.floor(pos[c]),
      frac = pos[c] - i0;
    for (let k = 0; k < n; k++) {
      const a = basePalette[lo + ((k + i0) % n)];
      const b = basePalette[lo + ((k + i0 + 1) % n)];
      palette[lo + k] = blendMode
        ? lerp(a, b, frac) // BlendShift: smooth between palette steps
        : a; // Standard: hard step
    }
  }
}
function blit() {
  for (let i = 0; i < W * H; i++) pix32[i] = palette[indexed[i]];
  ctx.putImageData(img, 0, 0);
}
```

That's the whole magic. Everything else — controls, swatch strip, decoding the base64 — is housekeeping.

## Reference: masking essentials

```js
// For each subject pixel whose palette index is in a cycling range,
// find the nearest palette entry OUTSIDE all cycling ranges.
const isCycling = new Uint8Array(256);
for (const { lo, hi } of cycles) for (let i = lo; i <= hi; i++) isCycling[i] = 1;

for (let i = 0; i < N; i++) {
  if (!mask[i]) continue; // background — leave alone
  const oldIdx = indexed[i];
  if (!isCycling[oldIdx]) continue; // already non-cycling — fine
  // find nearest non-cycling palette entry to palette[oldIdx]
  indexed[i] = nearestNonCycling(palette[oldIdx], palette, isCycling);
}
```

The palette is never modified — only specific pixel→palette pointers move. Frozen pixels stay visually identical, but no longer participate in rotation.

## Files

- `scripts/quantize.js` — image fetch + sharp resize + median-cut + palette sort + range detection + deflate. Outputs JSON.
- `scripts/mask-and-remap.js` — fetches a binary mask, threshold-binarizes it, and remaps subject pixels out of cycling ranges. Updates the JSON in place.
- `scripts/render-html.js` — fills the template with quantized data and chosen cycle ranges. Outputs HTML.
- `assets/cycler-template.html` — the runtime: cycling engine, controls, swatch strip, with placeholders the renderer fills in.
