---
name: ai-image-color-cycling
description: Generate an AI image, quantize it to a 256-color indexed palette, and produce BOTH a self-contained HTML artifact AND a perfect-loop animated GIF that bring the image to life via classic 1990s palette cycling — the trick where rotating palette entries makes water flow, fire flicker, and stars twinkle without ever redrawing pixels. Optionally apply a silhouette mask to FREEZE a subject (character, object) so only the background animates around them. Use this skill whenever the user asks to "color cycle an image", "make a generated image animate", "old-school palette animation", "Mark Ferrari style", "8-bit/16-bit animated scene", "make this picture come alive", "pixelize and animate", "indexed-color animation", "animated gif from a generated image", or anything that combines AI image generation with retro pixel-art motion. Also use when the user references the canvascycle library, palette rotation, color rotation, or wants flowing water / glowing rivers / waving fire / drifting clouds in a generated image, or wants to keep a character STILL while the rest of the image animates.
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
- **Freeze a character/object** while the rest of the image animates ("don't animate the dragon", "keep the character still", "mask out the subject")

Don't use it for: video generation, frame-by-frame character animation, or anything that needs to actually move pixels around. This is *only* for palette rotation effects on a static indexed image.

## How the trick works (so you can explain it)

A 256-color indexed image stores one byte per pixel — that byte is an index into a 256-entry color lookup table (the **palette**). If you change palette entry 17 from cyan to bright cyan, *every pixel referencing slot 17 instantly flips* — no redraw, no pixel walk. By rotating a *contiguous range* of palette entries (e.g. slots 16–63 shift down by one each frame), pixels that reference that range appear to flow.

The art is in **arranging the palette so similar colors sit next to each other** — then rotation looks like motion instead of strobing. This skill sorts the palette by hue/luminance after quantization, then auto-detects ranges of bright cyans, magentas, blues, etc. that make good cycling candidates.

**Masking trick:** If a subject (character) shares colors with a cycling range, those pixels animate too — usually undesirable. The fix is to generate a black/white silhouette of the subject, then for every subject-pixel whose palette index is in a cycling range, reassign it to the nearest palette entry that *isn't* cycling. The palette is unchanged; only specific pixel→palette pointers move. The visual color is essentially the same (we pick the closest RGB match), but those pixels no longer rotate.

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
[8] OPTIONAL: generate silhouette mask  →  remap subject pixels out of cycling ranges
        ↓
[9] deflate-compress indexed buffer → base64
        ↓
[10] inject into cycler-template.html → write final .html
        ↓
[11] render N frames + ffmpeg 2-pass → write seamless .gif   ← MANDATORY
```

Steps 3–9 are wrapped in `scripts/quantize.js` (auto-detects source aspect ratio). Steps 8 wrap in `mask-and-remap.js`. Step 10 in `render-html.js`. Step 11 in `encode-gif.js`. You drive the pipeline by calling those four scripts in sequence.

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

If you DO need to override (rare), pick W/H that match the source ratio. Common Gemini outputs:

| Gemini output | Ratio | Suggested target |
|---|---|---|
| 1408 × 768 | 1.833 (11:6) | 264 × 144 |
| 1024 × 768 | 1.333 (4:3) | 224 × 168 |
| 1280 × 720 | 1.778 (16:9) | 256 × 144 |
| 1024 × 1024 | 1.000 | 192 × 192 |

The script prints a warning if your requested ratio differs > 5% from the source.

The script emits:
```
✓ Source dims: 1408×768 (ratio 1.8333)
✓ Auto-picked target: 264×144 (ratio 1.8333, 38016 px)
✓ Quantized to 256 colors in 35 ms
✓ Auto-detected ranges:
    orange   137..184   (48 entries)
    yellow   181..210   (30 entries)
    magenta  116..255   (140 entries)
    light    200..210   (11 entries)
✓ Indexed: 38016 → 22440 compressed (59.0%) → 29920 b64
```

### Step 4: Pick the cycling ranges

The script suggests ranges, but **you choose which ones to actually cycle**. Read the suggested ranges, look at the user's prompt, and pick the 1–3 ranges that match what *should* be moving.

⚠️ **Critical**: ranges are completely image-specific because of palette sorting. **Don't reuse ranges from a previous run.** ALWAYS read the latest `data.json` ranges before picking.

| User wanted to animate | Pick range |
| --- | --- |
| Glowing river / bioluminescence / lava-cool / aurora | cyan |
| Lava / fire / sunset / neon pink | orange + yellow (or magenta + light) |
| Sky / aurora / ocean | blue |
| Stars / lightning / sparkle | light (+ alternating dark/bright) |

For HTML, pick rates that *feel* right (3.0–6.0 fast, 1.5–2.5 medium, 0.5–1.0 slow). For GIF, the rate is **auto-computed from loop duration** so you don't need to pass one.

For a really alive scene, **pair two ranges going in opposite directions** — e.g. the bright glow flowing forward, the mid-tones flowing back. That sells the parallax.

### Step 5 (OPTIONAL): Generate a mask and freeze the subject

If the user wants the character/subject to stay still while the background animates:

**5a.** Generate a binary silhouette mask of the subject:

```
Generate prompt: "Pure binary mask. PURE WHITE solid silhouette shape of [SUBJECT]
on PURE BLACK background. Absolutely NO grays. NO anti-aliasing. NO soft edges.
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
  --cycles '[{"lo":137,"hi":210},{"lo":116,"hi":145}]'
```

The script:
- Fetches the mask, downscales with `kernel: nearest` (preserves hard edges), thresholds to binary
- For every white-mask pixel whose palette index is in a cycling range, reassigns it to the nearest non-cycling palette entry
- Updates `data.indexedB64` in place

It reports how many pixels were remapped and the average RGB shift (typically < 15, basically imperceptible — but if the subject's body color is dead-center in the cycling range, the shift can hit 50+ which is visible. In that case, tighten the cycling range to leave the subject's actual body color un-cycled).

### Step 6: Render the HTML

```bash
node scripts/render-html.js \
  --data /tmp/cycle-data.json \
  --template assets/cycler-template.html \
  --cycles '[{"lo":137,"hi":210,"rate":5.5,"dir":1},{"lo":116,"hi":145,"rate":1.8,"dir":-1}]' \
  --title "Charizard's Lava River" \
  --out /tmp/cycling.html
```

The template includes the cycling engine, BlendShift toggle, speed slider, direction toggle, and a live palette swatch strip with cycling indices outlined in green.

### Step 7: Render the GIF (MANDATORY — always do this)

```bash
node scripts/encode-gif.js \
  --data /tmp/cycle-data.json \
  --cycles '[{"lo":137,"hi":210,"dir":1},{"lo":116,"hi":145,"dir":-1}]' \
  --duration 4 --fps 20 --scale 4 \
  --out /path/to/output.gif
```

**Note**: cycle entries don't need `rate` for the GIF — the script auto-computes `rate = entries / duration` so each cycle completes EXACTLY one rotation in the loop period. This guarantees a mathematically perfect seamless loop.

Defaults that work great:
- `--duration 4` (4 seconds, long enough to read the motion, short enough to share)
- `--fps 20` (50ms per frame, smooth)
- `--scale 4` (4× nearest-neighbor upscale; on a 264×144 source → 1056×576 output)

The script renders frames as PNGs to a temp dir, then uses ffmpeg 2-pass (palettegen → paletteuse with Bayer dither) for best quality.

### Step 8: Show the user

In your chat response:
1. Show the original generated image with `<img src="{{IMAGE_REF:...}}">`
2. Describe which ranges you chose to cycle and why
3. **Mention both files** — the HTML path and the GIF path
4. Inline the entire HTML in a single ` ```html ` code block so it renders live
5. Give the user the GIF path so they can grab it directly

If the inlined HTML approaches the chat-message limit (~40 KB), drop the resolution slightly via `--target-pixels 24000` on quantize. Don't try to RLE-compress by hand — the deflate stream is already near-optimal.

## Common pitfalls (every one of these has bitten me)

**Image looks squashed or cropped.** You used a `--width`/`--height` whose ratio doesn't match the source. Run `quantize.js` without those flags and let it auto-pick. Gemini's `aspectRatio` parameter is a *soft hint* — it returned 1408×768 (ratio 1.833) when I asked for 4:3.

**The image came out smooth/painterly instead of pixel-art.** Add stronger "16-bit, flat shading, no anti-aliasing" instructions to the prompt and regenerate. Sharp's lanczos resize will smear soft edges, killing the indexed-color illusion.

**Cycling looks like strobing instead of flowing.** Your range covers colors that aren't actually adjacent in hue. Either pick a tighter range, or trust the auto-detected ranges — they're sorted to be smooth.

**The wrong region is animating.** The image's dominant color and the auto-detected range don't line up with what the user wanted. Either re-prompt the image (push the cycling-feature color harder), or manually pick a range by reading the script's "Top-10 most-used palette entries" output.

**The character is animating with the background.** Use Step 5 (masking) to freeze them. The character's body shares color indices with the cycling range, so without masking they'll cycle too.

**Mask doesn't match the pose.** Generating a mask separately is unreliable — the AI may put the subject in a slightly different pose. Try one of: (a) emphasize the EXACT pose in the mask prompt, (b) accept slight misalignment (works fine because we threshold), or (c) use a foreground-segmentation tool instead. For most cases the prompted mask is good enough.

**Reused cycle ranges from previous image.** Ranges are completely image-specific because the palette sort produces different orderings each time. Always re-read the JSON `ranges` field after quantizing.

**GIF won't loop seamlessly.** You used the HTML's "feel-good" rates (5.5, 1.8) for the GIF too. Those have an LCM of 22,010 seconds (6 hours). Use `encode-gif.js` which auto-syncs rates so each cycle completes one full rotation per `--duration` — guaranteeing a perfect loop.

**HTML doesn't display in the iframe sandbox.** The template uses `DecompressionStream('deflate-raw')` — supported in all modern browsers but won't work in very old ones.

**Charizard's body color shifted a LOT after masking.** When the cycling range covers most of the subject's color (e.g. lava cycling on an orange dragon), the nearest non-cycling palette entry can be visibly different. Three fixes: (a) tighten the cycling range to a narrower band that doesn't include the subject's actual body color, (b) pre-quantize with the mask in mind (advanced), (c) accept the shift if the user prioritizes the cycling motion over color fidelity.

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

That's the whole magic. Everything else — controls, swatch strip, decoding the base64 — is housekeeping.

## Reference: masking essentials

```js
const isCycling = new Uint8Array(256);
for (const {lo, hi} of cycles) for (let i = lo; i <= hi; i++) isCycling[i] = 1;

for (let i = 0; i < N; i++) {
  if (!mask[i]) continue;             // background — leave alone
  const oldIdx = indexed[i];
  if (!isCycling[oldIdx]) continue;   // already non-cycling — fine
  // find nearest non-cycling palette entry to palette[oldIdx]
  indexed[i] = nearestNonCycling(palette[oldIdx], palette, isCycling);
}
```

The palette is never modified — only specific pixel→palette pointers move. Frozen pixels stay visually identical, but no longer participate in rotation.

## Reference: seamless GIF loop math

For a perfect loop, **each cycle must complete an integer number of rotations in the loop duration**. The `encode-gif.js` script auto-sets:

```
rate = (hi - lo + 1) / loopDuration
```

So a 71-entry range over a 4-second loop has `rate = 17.75 entries/sec`, completing exactly one rotation in 4s. A 31-entry range gets `rate = 7.75`, also exactly one rotation. Both return to position 0 simultaneously at frame 80 (= frame 0). Seamless.

The HTML uses different "vibey" rates for ambient feel; the GIF uses synced rates for the loop. Both are correct for their context.

## Files

- `scripts/quantize.js` — image fetch + source-ratio detection + sharp resize + median-cut + palette sort + range detection + deflate. Outputs JSON.
- `scripts/mask-and-remap.js` — fetches a binary mask, threshold-binarizes it, and remaps subject pixels out of cycling ranges. Updates the JSON in place.
- `scripts/render-html.js` — fills the template with quantized data and chosen cycle ranges. Outputs HTML.
- `scripts/encode-gif.js` — renders frames stepping through the palette rotation, encodes to a perfect-loop GIF via ffmpeg 2-pass.
- `assets/cycler-template.html` — the runtime: cycling engine, controls, swatch strip, with placeholders the renderer fills in.
