---
name: image-to-cinematic-video
description: >-
  Turn a prompt or an existing image into a polished multi-scene cinematic short video
  using Seedance for clip generation, uguu.se for file hosting, and FFmpeg for last-frame
  extraction and crossfade stitching. Supports two modes — PARALLEL (multiple scenes from
  the same reference image, concurrent, ~3 min total) and CHAIN (each scene starts on the
  last frame of the previous scene, sequential, ~3 min per scene, produces one continuous
  long take). Use this skill whenever the user wants to "make a video from an image",
  "animate this picture", "generate video scenes", "create a cinematic short", "stitch AI
  videos together", "make a long continuous video", "chain AI clips", or any workflow
  that goes from one reference image to a multi-clip stitched video. Also trigger when
  the user mentions Seedance, image-to-video, video stitching, crossfades between clips,
  frame chaining, last-frame continuity, or wants to turn a generated image into motion.
  Covers the full pipeline end-to-end — generate image with the chat-level
  `generate_image` tool (Gemini Nano Banana Pro by default) → pull the real bytes from
  `/api/images/:id` → upload to uguu → Seedance (with the relative-filename quirk
  handled) → copy output into the project folder → extract last frame → upload → chain
  into next scene → FFmpeg xfade stitch → upload final → write manifest.
---

# Image → Cinematic Video Pipeline

A battle-tested, end-to-end workflow for turning one prompt (or one
starting image) into a polished multi-scene stitched video. This skill
only documents techniques that **actually worked** in production.

## ⚠ NON-NEGOTIABLE RULES

1. **Use `generate_image` as the primary source-image generator.**
   The image-ref system has been fixed — every `{{IMAGE_REF:<id>}}`
   returned by `generate_image` is now backed by real bytes available at
   `GET http://localhost:3333/api/images/<id>` (Bearer-auth with
   `process.env.AGNT_AUTH_TOKEN`). Use `fetchImageRefBytes(ref, outPath)`
   from `save_generated_image.js` to pull those bytes onto disk in one
   line. Default model: **Gemini Nano Banana Pro**
   (`provider: 'gemini'`, `model: 'nano-banana-pro-preview'`).
   `saveGeneratedImage()` still exists as a direct-REST-API fallback
   when you want to bypass the chat tool entirely.

2. **Every run gets its own project folder.** Call `createProjectDir(slug)`
   at the top. It returns an absolute path under
   `C:\Users\Studio\AppData\Roaming\AGNT\projects\<timestamp>_<slug>\`
   with `scenes/` and `frames/` subdirs pre-created. Every artifact
   (source image, each scene mp4, each last-frame jpg, final mp4,
   manifest.json) goes into that folder. One folder per run. No
   scattering files across the AGNT root.

3. **Upload only to uguu.se.** Catbox, Litterbox, 0x0.st, tmpfiles.org,
   transfer.sh, and file.io were all tested in this environment and
   failed (truncated files, 403s on GET, timeouts). `uploadUguu()` is
   the only host that reliably serves both small JPGs and large MP4s
   AND is reachable by the Seedance worker. Files live ~3 hours on
   uguu — fine for a run that takes ~15 min.

4. **Seedance `filename` MUST be relative.** The plugin prepends
   `C:\Users\Studio\AppData\Roaming\AGNT\plugin-data\seedance\<userId>\`
   to whatever you pass. If you pass an absolute path, the resulting
   file lives at a double-prefixed path and ffmpeg will ENOENT. Always
   pass a plain filename like `scifi_scene1.mp4`, then immediately copy
   the output into your project folder with `copySeedanceOutput()`.

5. **CHAIN mode: extract and upload the last frame BETWEEN every scene.**
   If you ever call scene N+1 with the original reference image as
   `firstFrameUrl`, you've broken the chain. Use
   `extractAndUploadLastFrame(sceneMp4, projectDir, label)` after
   every scene (except optionally the last), and pass its `frameUrl`
   as the next scene's `firstFrameUrl`.

6. **Write a `manifest.json` at the end.** Record mode, every prompt,
   every local path, every uguu URL, durations, costs, wall time.
   Keeps the run reproducible.

## The files that do the work

```
scripts/
├── save_generated_image.js          ← fetchImageRefBytes()  ← PRIMARY
│                                      saveGeneratedImage()  ← fallback
│                                      createProjectDir(),
│                                      writeProjectManifest()
├── upload_uguu.js                   ← uploadUguu()  — the only upload host
├── copy_seedance_output.js          ← copySeedanceOutput()  — handle the
│                                      relative-filename quirk
├── extract_and_upload_last_frame.js ← extractAndUploadLastFrame(),
│                                      extractLastFrame()
└── stitch_xfade.js                  ← stitchXfade()  — the exact ffmpeg
                                       command that worked
references/
└── seedance-prompt-library.md       ← 20+ proven shot prompts
```

## Mode choice

| User's goal | Mode |
|---|---|
| Continuous walk-and-talk, long pan, evolving action | **CHAIN** |
| Trailer-style single-breath mini-film | **CHAIN** |
| Narrative >10s with continuity | **CHAIN** |
| 3-shot montage / highlight reel / social post | PARALLEL |
| Different camera angles of the same subject | PARALLEL |
| Fastest turnaround | PARALLEL |

## The proven CHAIN pipeline (what actually worked)

All tool calls below are AGNT tool calls made in the conversation — not
inside `execute_javascript_code` (which can't invoke AGNT tools). The
code blocks are what goes INSIDE `execute_javascript_code`.

### Step 1 — generate the source image (chat-level tool, Gemini Nano Banana Pro)

```
generate_image(
  prompt:       "A lone astronaut in a scuffed white spacesuit at the
                 threshold of a massive derelict alien spaceship
                 half-buried in orange desert dunes. Anamorphic lens
                 flare, golden-hour rim light, cyan glyphs on the hull,
                 35mm film grain, Denis Villeneuve.",
  provider:     "gemini",
  model:        "nano-banana-pro-preview",
  aspectRatio:  "16:9"
)
```

Capture the returned ref id, e.g.
`{{IMAGE_REF:img-toolu_01ABC...-0}}` → `img-toolu_01ABC...-0`.

### Step 2 — pull the bytes onto disk + upload to uguu

```js
const path = require('path');
const {
  fetchImageRefBytes, createProjectDir,
} = require('C:/Users/Studio/.agnt/skills/image-to-cinematic-video/scripts/save_generated_image.js');
const { uploadUguu } = require('C:/Users/Studio/.agnt/skills/image-to-cinematic-video/scripts/upload_uguu.js');

const projectDir = createProjectDir('scifi_chain');
const srcImg = path.join(projectDir, 'source.jpg');

// One call: Bearer-auth GET /api/images/:id and write bytes to disk.
await fetchImageRefBytes('img-toolu_01ABC...-0', srcImg);

const imageUrl = await uploadUguu(srcImg);
require('fs').writeFileSync(path.join(projectDir, 'image_url.txt'), imageUrl);
console.log('PROJECT_DIR=' + projectDir);
console.log('IMAGE_URL=' + imageUrl);
```

### Step 3 — Scene 1 (Seedance, AGNT tool call)

Pass a **relative** filename. Pass the uguu URL as `firstFrameUrl`.

```
seedance_api(
  prompt:        "Slow cinematic dolly-in on the astronaut as she raises
                  a gloved hand to the hull — ancient cyan glyphs flare
                  under her touch. Anamorphic lens flare, 35mm grain.",
  firstFrameUrl: "<imageUrl from step 2>",
  filename:      "scifi_scene1.mp4",              ← RELATIVE
  duration:      5,
  aspectRatio:   "16:9",
  resolution:    "720p"
)
```

### Step 4 — copy scene 1 into project + extract/upload its last frame

```js
const { copySeedanceOutput } = require('C:/Users/Studio/.agnt/skills/image-to-cinematic-video/scripts/copy_seedance_output.js');
const { extractAndUploadLastFrame } = require('C:/Users/Studio/.agnt/skills/image-to-cinematic-video/scripts/extract_and_upload_last_frame.js');

const scene1 = copySeedanceOutput('scifi_scene1.mp4',
                                  path.join(projectDir, 'scenes/scene1.mp4'));
const { frameUrl: frame1Url } =
  await extractAndUploadLastFrame(scene1, projectDir, 'scene1');
console.log('FRAME1_URL=' + frame1Url);
```

### Step 5 — Scene 2 (Seedance, using frame1Url)

```
seedance_api(
  prompt:        "Continuous: the glyphs erupt into a cascade of runes,
                  a seam cracks open, warm white light pours out. Camera
                  pushes toward the widening doorway. 35mm grain.",
  firstFrameUrl: "<frame1Url>",
  filename:      "scifi_scene2.mp4",              ← RELATIVE
  duration:      5,
  aspectRatio:   "16:9",
  resolution:    "720p"
)
```

### Step 6 — copy + last-frame for scene 2

```js
const scene2 = copySeedanceOutput('scifi_scene2.mp4',
                                  path.join(projectDir, 'scenes/scene2.mp4'));
const { frameUrl: frame2Url } =
  await extractAndUploadLastFrame(scene2, projectDir, 'scene2');
```

### Step 7 — Scene 3 (Seedance, using frame2Url)

```
seedance_api(
  prompt:        "Continuous: camera pushes through the doorway into a
                  cathedral-scale interior of crystalline pillars pulsing
                  with light. Astronaut silhouette walks forward.
                  Volumetric god-rays, 35mm grain.",
  firstFrameUrl: "<frame2Url>",
  filename:      "scifi_scene3.mp4",              ← RELATIVE
  duration:      5,
  aspectRatio:   "16:9",
  resolution:    "720p"
)
```

### Step 8 — copy scene 3 + extract scene 3's last frame (thumbnail only — no upload needed)

```js
const { extractLastFrame } = require('C:/Users/Studio/.agnt/skills/image-to-cinematic-video/scripts/extract_and_upload_last_frame.js');
const scene3 = copySeedanceOutput('scifi_scene3.mp4',
                                  path.join(projectDir, 'scenes/scene3.mp4'));
extractLastFrame(scene3, path.join(projectDir, 'frames/scene3_last.jpg'));
```

### Step 9 — stitch + upload final + manifest

```js
const { stitchXfade } = require('C:/Users/Studio/.agnt/skills/image-to-cinematic-video/scripts/stitch_xfade.js');
const { writeProjectManifest } = require('C:/Users/Studio/.agnt/skills/image-to-cinematic-video/scripts/save_generated_image.js');

const finalPath = path.join(projectDir, 'final.mp4');
const { durationSec, sizeBytes } = await stitchXfade({
  clips: [scene1, scene2, scene3],
  outputPath: finalPath,
  fadeDuration: 0.15,                // chain mode — short fade
  transition: 'fade',
  crf: 18,
});

const finalUrl = await uploadUguu(finalPath);

writeProjectManifest(projectDir, {
  generatedAt: new Date().toISOString(),
  mode: 'chain',
  sourceImage: { provider: 'gemini', model: 'nano-banana-pro-preview' },
  scenes: [
    { n: 1, path: scene1, lastFrameUrl: frame1Url },
    { n: 2, path: scene2, lastFrameUrl: frame2Url },
    { n: 3, path: scene3, lastFrameUrl: null },
  ],
  stitch: { fadeDuration: 0.15, transition: 'fade', crf: 18 },
  final: { path: finalPath, url: finalUrl, durationSec, sizeBytes },
  totals: { cost: 2.268, resolution: '720p', aspectRatio: '16:9' },
});

console.log('FINAL_URL=' + finalUrl);
```

### Step 10 — reply to the user

```html
<video src="<finalUrl>" controls autoplay loop muted playsinline
       style="width:100%;max-width:720px;border-radius:12px;
              box-shadow:0 8px 32px rgba(0,0,0,0.4);background:#000;"></video>
```

Plus a crisp summary (mode, duration, resolution, cost, wall time) and
the absolute path to the project folder.

## PARALLEL mode (lighter variant)

Same as above except:

- All N seedance calls go into ONE tool-call block with
  `_executeAsync: true` so they run concurrently.
- Every scene uses the SAME `firstFrameUrl` (the source image URL).
- No last-frame extraction between scenes.
- Use `fadeDuration: 0.5` in `stitchXfade` (longer decorative fades
  make sense when seams visibly reset).

## Seedance parameters (both modes)

| Param          | Value                                            |
|----------------|--------------------------------------------------|
| `aspectRatio`  | `16:9` (landscape) or `9:16` (Reels/Shorts)      |
| `duration`     | `5` seconds (sweet spot for cost and fidelity)   |
| `resolution`   | `720p` ($0.151/s = $0.756 per 5s clip)           |
| `firstFrameUrl`| uguu URL — shared (parallel) or chained (chain)  |
| `filename`     | **RELATIVE** only, e.g. `scifi_scene1.mp4`       |

Prompt formula:
`[camera move] [subject] [action] [environment] [lighting] [style]`

20+ proven prompts: `references/seedance-prompt-library.md`.

## Image generation: which path to use

| Situation | Path |
|---|---|
| Default — best quality, agentic flow | **`generate_image` chat tool → `fetchImageRefBytes()`** |
| You want a specific provider available in the chat tool | `generate_image` (set `provider`/`model`) → `fetchImageRefBytes()` |
| You're running headless inside `execute_javascript_code` only and don't want to round-trip through the chat tool | `saveGeneratedImage()` (Pollinations / Gemini REST / OpenAI REST) |
| You already have an image URL (user upload, etc.) | Skip generation, just `uploadUguu()` it |

`fetchImageRefBytes(ref, outputPath)` does an authenticated
`GET /api/images/:ref` against the local AGNT server, validates the
response is binary image data (rejects HTML SPA fallbacks), and writes
the bytes to disk. Returns `{ path, sizeBytes, contentType }`.

## Verified result from the canyon-runes production run

| | Value |
|---|---|
| Source image | Gemini Nano Banana Pro via `generate_image` (776 KB JPG, 16:9) |
| Scenes | 5 (chained) |
| Scene duration | 5s each |
| Total after stitch | 24.6s |
| Resolution | 720p, 16:9 |
| Total Seedance cost | $3.78 |
| Final mp4 | 13.6 MB (libx264 CRF 18, 0.15s xfade) |
| Hosted at | `https://d.uguu.se/GAjyPqKB.mp4` |

Project folder layout after a successful run:

```
<PROJECTS_ROOT>/<stamp>_<slug>/
├── source.jpg                 ← bytes from /api/images/:id
├── image_url.txt              ← uguu URL of source.jpg
├── scenes/
│   ├── scene1.mp4
│   ├── scene2.mp4
│   └── scene3.mp4
├── frames/
│   ├── scene1_last.jpg        ← → became scene 2's firstFrameUrl
│   ├── scene2_last.jpg        ← → became scene 3's firstFrameUrl
│   └── scene3_last.jpg        ← thumbnail / poster
├── final.mp4                  ← stitched output
├── final_url.txt              ← uguu URL of final.mp4
└── manifest.json              ← complete run record
```

## Common failure modes (observed)

- **ENOENT on seedance output** → you passed an absolute filename.
  Use a relative one, then `copySeedanceOutput()`.
- **"Invalid base64 image url" from Seedance** → the upload host you
  used isn't serving the file. Use `uploadUguu()`.
- **Stitched video is three disconnected cuts instead of one take** →
  you forgot to swap `firstFrameUrl` between scenes. Use
  `extractAndUploadLastFrame()` after every scene except the last.
- **Frame extraction gives a tiny/empty jpg** → the video has no
  keyframe at exactly `-0`. The `-sseof -0.1` offset in
  `extract_and_upload_last_frame.js` already handles this.
- **`fetchImageRefBytes()` returns HTML instead of an image** → the
  `Authorization: Bearer ${AGNT_AUTH_TOKEN}` header was dropped, so
  the server fell back to serving the SPA. The helper detects this
  (content-type sniff + magic-byte check) and throws — re-check the
  header and the ref id.
