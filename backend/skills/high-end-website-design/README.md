# High End Website Design — Skill

Production pipeline for ULTRA high-end single-file HTML landing pages with AI-generated cinematic hero imagery and seamlessly looping AI video backgrounds.

## What it does

End-to-end automation:

1. 🎨 **Hero image** — Gemini Nano Banana Pro generates a magazine-quality 16:9 still
2. 🌐 **Upload** — image hosted on uguu so Seedance can consume it
3. 🎬 **Native loop video** — Seedance 2.0 generates a seamless looping clip with first/last frame identical (no boomerang reverse-time weirdness)
4. 📄 **HTML slide** — single-file, viewport-fit, premium typography, reduced-motion safe
5. 🗂️ **Deck index** — auto-generated navigator listing all slides as autoplay thumbnails

## When to use

Trigger on requests like:
- "Make me a high-end landing page"
- "Build a premium product slide with video"
- "Create a luxury brand hero"
- "Design a cinematic agency portfolio"
- "Build me a presentation slide that's ultra unique"

## How to use

Just say what you want. The skill will:
1. Propose 2-3 aesthetic directions (or use one you specify)
2. Run the full pipeline in parallel for any number of slides
3. Save everything to a portable folder you can open offline

## File structure produced

```
<your-project>/
├── index.html           ← deck navigator
├── slides/              ← one HTML per slide
├── images/              ← Nano Banana stills
├── videos/              ← Seedance loops
└── assets.json          ← uguu URL map
```

## Cost

~$1.70 per 5-second video clip via OpenRouter (Seedance 2.0). Image generation is free with your AGNT subscription.

## Reference docs

- `SKILL.md` — full instructions
- `references/PIPELINE.md` — exact code for every step
- `references/DESIGN_AESTHETICS.md` — 12 named aesthetic recipes
- `references/PROMPT_RECIPES.md` — battle-tested image + video prompts
- `assets/slide-template.html` — production-ready HTML scaffold
