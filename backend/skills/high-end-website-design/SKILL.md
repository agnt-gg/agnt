name high-end-website-design
description End-to-end pipeline for producing ULTRA high-end, novel, single-file HTML landing pages and presentation slides featuring AI-generated hero imagery and seamlessly looping AI video backgrounds. Combines Gemini Nano Banana Pro for cinematic stills, ByteDance Seedance 2.0 for native looping video clips (firstFrameUrl == lastFrameUrl), and frontend-slides design philosophy for the final HTML. Use this skill whenever the user asks for: a "high end" / "luxury" / "premium" / "novel" / "ultra unique" landing page or slide, hero sections with animated video backgrounds, presentation decks with AI-generated cinematic motion, agency-grade portfolio pages, fashion / fragrance / product launch sites, cyberpunk / brutalist / editorial / vaporwave / Swiss-design web pages, or anything that pairs a generated image with a looping video and premium typography. Also trigger when the user mentions Seedance, Nano Banana, video loops on a webpage, hero video backgrounds, or wants a "modern" / "ultra-engaging" / "highly dynamic" web design.
version 1.0.0

# High End Website Design

End-to-end pipeline: AI image → seamless AI video loop → ultra-premium single-file HTML page.

## Creative Standard

This is editorial-grade web design. Every output should look like it was crafted by a world-class design agency — bold, distinctive, and visually striking. Generic AI aesthetics are unacceptable.

The pipeline produces ONE polished slide / landing page per invocation by default. If the user asks for multiple, run them in parallel.

Hero rules:
- Typography is the soul. Use distinctive, paid-quality fonts (Bespoke Serif, Cormorant Garamond, Syne, Gambarino, Fraunces, Khand, Supreme, PP Neue Montreal). Never Inter, Roboto, Arial, or system defaults.
- Generous whitespace. Base-2 spacing scale only (4, 8, 16, 24, 32, 48, 64, 96px) — no arbitrary values.
- 100vh / 100dvh viewport fitting. Content overflows? Split the design.
- One dominant color, one accent. Floods of color = AI slop. Restraint = luxury.
- Hero video must autoplay, muted, loop, playsinline, with a poster fallback.
- Always include `@media (prefers-reduced-motion: reduce){ *{animation:none!important} }`.
- All paths in HTML are RELATIVE (`../videos/foo.mp4`) so the project is portable.

## The Five-Phase Pipeline

```
PHASE 1: Brainstorm aesthetic + brief (conversational)
PHASE 2: Generate hero image  (generate_image tool — Gemini Nano Banana Pro)
PHASE 3: Save image locally + upload to uguu (execute_javascript_code)
PHASE 4: Generate NATIVE LOOPING video (seedance_api — firstFrameUrl == lastFrameUrl)
PHASE 5: Copy MP4 to project, write HTML slide, save deck index (file_operations + js)
```

For multiple slides, all phases (image gen, uguu uploads, seedance calls) MUST be run in parallel — same tool block.

---

## PHASE 1 — Brief & Aesthetic

Ask the user (or infer from context) the minimum needed:
1. **Subject / topic** — what's the page for?
2. **Aesthetic** — pick from `references/DESIGN_AESTHETICS.md` or invent one. Each has a defined font stack, color palette, motion language.
3. **Project name** — used as folder slug.

If the user is vague, propose 3 distinct aesthetic options as a quick menu — don't bog them down with form-style questions. Show, don't ask.

---

## PHASE 2 — Hero Image Generation

Use the chat-level `generate_image` tool (NOT generate_with_ai_llm node). Defaults that matter:

| param | value | why |
|---|---|---|
| `provider` | `gemini` | Best aesthetic quality |
| `model` | `nano-banana-pro-preview` | Highest fidelity available |
| `aspectRatio` | `16:9` for hero / `9:16` for vertical / `1:1` for square | Match the design |
| `prompt` | See `references/PROMPT_RECIPES.md` | Photographic/cinematic, never "AI art" |

**Prompt formula:** `[shot] [subject] [environment] [lighting] [camera/lens] [mood] [grade] [style refs] no text`

The "no text" suffix is critical — Nano Banana will hallucinate logos and watermarks otherwise.

For multiple slides → fire all `generate_image` calls in the SAME tool block (parallel).

---

## PHASE 3 — Save & Upload

After generation, the image lives at `C:\Users\<USER>\AppData\Roaming\AGNT\Data\images\<imageId>.jpg`. Copy it into the project structure and upload to uguu so Seedance can consume it.

```javascript
// Standard project structure
const projDir = 'C:\\Users\\Studio\\<project-slug>';
fs.mkdirSync(path.join(projDir, 'images'), { recursive: true });
fs.mkdirSync(path.join(projDir, 'videos'), { recursive: true });
fs.mkdirSync(path.join(projDir, 'slides'), { recursive: true });

// Copy image into project
fs.copyFileSync(srcPath, path.join(projDir, 'images', `${slug}.jpg`));

// Upload to uguu (Seedance needs a public URL)
async function uploadToUguu(filePath, mime) {
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf], { type: mime });
  const fd = new FormData();
  fd.append('files[]', blob, path.basename(filePath));
  const r = await fetch('https://uguu.se/upload', { method: 'POST', body: fd });
  return (await r.json()).files[0].url;
}
```

**Uguu rate limits**: when uploading 3+ files, sleep 3000ms between each. Parallel uploads will fail.

---

## PHASE 4 — Native Looping Video (the most important step)

The boomerang ffmpeg trick (forward + reverse) works for ambient motion but feels weird for directional motion (rotation, drift, characters moving). The vastly superior method is to let Seedance generate a NATIVE LOOP by setting `firstFrameUrl == lastFrameUrl` and explicitly telling it the first and last frame must be identical.

```javascript
seedance_api({
  prompt: "SEAMLESS LOOPING VIDEO — first frame and last frame must be IDENTICAL so it loops perfectly with no cut. Cyclical motion only: [describe the action as a complete cycle that returns to start]. Returns to original composition by the end.",
  firstFrameUrl: <UGUU_URL>,
  lastFrameUrl:  <UGUU_URL>,   // SAME url as firstFrameUrl
  filename: "<slug>.mp4",
  aspectRatio: "16:9",
  duration: 5,
  resolution: "1080p"
})
```

**Cost:** ~$1.70 per 5s clip via OpenRouter. If user runs out: tell them to top up at https://openrouter.ai/settings/credits — don't try to fall back to a different video tool, just pause and ask.

**IP-safe prompts:** Per memory rules — if the source image contains branded IP (Pokémon, etc.), the image already carries it. The Seedance prompt should ONLY describe pure shot/camera/lighting/motion. Never name the IP, franchise, or character. (e.g., "winged fire-creature statue" not "Charizard").

**Cyclical motion vocabulary** (for the prompt):
- "completes one full 360° rotation back to starting angle"
- "swells and recedes"
- "breathes in and out once"
- "pulses outward and back"
- "drifts forward then settles back to starting positions"
- "ripples radiate outward then settle back"
- "opens then closes back to starting pose"

For multiple slides → fire all `seedance_api` calls in the SAME tool block (parallel). Each takes 60-90s, parallelism saves real time.

---

## PHASE 5 — Build the HTML

Seedance writes the MP4 to its plugin-data directory. Copy it into the project's `/videos/` folder. Path on Windows:

```
C:\Users\<USER>\AppData\Roaming\AGNT\plugin-data\seedance\<userhash>\<filename>.mp4
```

The exact path is in the seedance_api response under `filePath`. Use that.

Then write the HTML using `assets/slide-template.html` as the scaffold. The template includes:
- Viewport-fit `100vh/100dvh` with `overflow:hidden`
- Hero `<video autoplay muted loop playsinline poster="../images/X.jpg">`
- Reduced-motion guard
- Staggered `fadeUp` animation system
- Responsive `clamp()` typography
- AGNT-quality CSS variables

Customize per the chosen aesthetic — see `references/DESIGN_AESTHETICS.md` for 12 ready-to-use recipes (each with font imports, palette, layout pattern, signature motion).

Write the HTML file last — never inline videos as base64 (would blow up the file). Always reference relatively: `../videos/<slug>.mp4` and `../images/<slug>.jpg`.

Finally, write/update an `index.html` deck navigator at the project root that lists all slides as autoplaying card previews — see template in `references/PIPELINE.md`.

---

## Final Project Structure

```
<project-slug>/
├── index.html           ← Deck navigator (auto-playing thumbnails → click to open)
├── slides/
│   ├── 01-<slug>.html
│   ├── 02-<slug>.html
│   └── ...
├── images/              ← Source JPGs from Nano Banana
├── videos/              ← Looped MP4s from Seedance
└── assets.json          ← Public uguu URL map (optional, useful for re-use)
```

This structure is fully portable — zip the folder and it works anywhere offline. No CDN needed.

---

## Reference Files

Read these on demand based on what the user is asking for:

- **`references/PIPELINE.md`** — Deep technical walkthrough of every step end-to-end with exact code.
- **`references/DESIGN_AESTHETICS.md`** — 12 named aesthetic recipes (Liquid Machine, Neon Protocol, Botanical Signal, Data Morphology, Vapor Cathedral, Brutalist Web, Newspaper, Glassmorphic, Print Poster, ASCII Terminal, Y2K Chrome, Modernist Architecture). Each has font stack, palette, layout pattern, motion signature, and example image+video prompt.
- **`references/PROMPT_RECIPES.md`** — Battle-tested image and video prompt templates per aesthetic. Read this before writing any new prompt.
- **`assets/slide-template.html`** — Production-ready HTML scaffold with all the boilerplate (reduced-motion, viewport-fit, fadeUp, etc.). Customize the typography, palette, and layout per aesthetic.

---

## Hard-won Lessons (do not violate)

1. **Native loops > boomerang.** Always set `firstFrameUrl == lastFrameUrl` for video. Boomerang reverse-time looks weird for directional motion.
2. **Pure motion in Seedance prompts.** Branded IP already lives in the image. Naming it in the prompt = copyright refusal.
3. **Uguu rate limits hit fast.** Sleep 3s between uploads when doing 3+.
4. **Insufficient credits halts the pipeline.** Don't pivot, just tell the user to top up OpenRouter.
5. **Relative paths in HTML.** Never absolute, never base64-inline videos.
6. **Reduced-motion always.** Accessibility is non-negotiable.
7. **Save the file, don't just preview it.** Always `fs.writeFileSync` the final HTML to disk. Chat preview ≠ saved file.
8. **One dominant color + one accent.** Multi-color floods read as AI slop.
