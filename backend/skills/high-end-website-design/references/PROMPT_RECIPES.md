# Prompt Recipes

Battle-tested prompts. Copy and adapt — don't write from scratch.

## Image Prompt Formula (for Nano Banana Pro)

```
[shot type] [subject] [environment] [lighting] [camera/lens] [mood] [color grade] [reference style] no text
```

The `no text` suffix is critical to prevent hallucinated logos/watermarks.

### Examples (paired with their downstream Seedance prompts)

---

### LIQUID / CHROME / FLUID
**Image:**
"Ultra high-end editorial photograph of molten chromatic liquid metal flowing in slow motion, swirling iridescent mercury with pink, cyan, and gold reflections, shot on Phase One 150MP, studio lighting, pitch black background, hyper-detailed surface tension, rippling reflections, cinematic, magazine-quality, 8k, no text"

**Seedance loop:**
"SEAMLESS LOOPING VIDEO — first frame and last frame must be IDENTICAL so it loops perfectly with no cut. Cyclical motion only: iridescent liquid chrome ripples radiate outward then settle back to exact starting state, pink-cyan-gold reflections shimmer and return, surface tension swells and recedes, slow cinematic hyper-real motion, returns to original composition by the end"

---

### CYBERPUNK / HOLOGRAPHIC ORB
**Image:**
"Floating holographic orb of pure neon cyan and magenta light suspended in a dark cyberpunk void, translucent glass particles orbiting it, volumetric god-rays, lens flares, rim light, data streams of glowing code curling around it, ultra detailed 3D render, Blade Runner 2049 aesthetic, cinematic, hyper-real, no text"

**Seedance loop:**
"SEAMLESS LOOPING VIDEO — first frame and last frame must be IDENTICAL so it loops perfectly with no cut. Cyclical motion only: holographic orb completes exactly one full 360° rotation back to starting angle, glass particles orbit one full revolution returning to start positions, light pulses outward and back, lens flares bloom and fade in sync, returns to original composition by the end"

---

### DARK BOTANICAL / LUXURY MAISON
**Image:**
"Dark moody botanical still life, ultra-detailed dewdrops on black monstera leaves and orchids, a single gold-leaf butterfly catching light, deep emerald and obsidian tones, chiaroscuro lighting like a Dutch master painting, Hasselblad macro, fine mist, dream-like, luxury magazine cover, no text"

**Seedance loop:**
"SEAMLESS LOOPING VIDEO — first frame and last frame must be IDENTICAL so it loops perfectly with no cut. Cyclical motion only: gold-leaf butterfly opens wings then closes back to starting pose, dewdrop swells and recedes, faint mist breathes in and out once, chiaroscuro light pulses subtly then returns, slow luxurious cinematic motion, returns to original composition by the end"

---

### SWISS / SCIENTIFIC / FLUID
**Image:**
"Abstract scientific visualization of a morphing fluid data sculpture, sharp white geometric wireframe bands intersecting a flowing iridescent blob on a clean paper-white background, minimal, Swiss design, editorial, Nature magazine cover, long shadows, ultra clean, precise, 3D render with a matte finish, soft studio light, no text"

**Seedance loop:**
"SEAMLESS LOOPING VIDEO — first frame and last frame must be IDENTICAL so it loops perfectly with no cut. Cyclical motion only: morphing iridescent fluid blob completes one full pulse cycle back to start, white geometric wireframe bands rotate exactly 360 degrees back to starting angle, smooth minimalist motion, soft studio light, editorial Swiss design, returns to original composition by the end"

---

### VAPORWAVE / RISOGRAPH / DREAM
**Image:**
"Surreal dreamlike cathedral made of pastel vapor and risograph grain, infinite marble columns fading into pink and cyan mist, oversized moon low on the horizon, retro-futuristic vaporwave aesthetic, soft grainy texture, James Turrell light, Wes Anderson symmetry, muted coral and lavender palette, no text"

**Seedance loop:**
"SEAMLESS LOOPING VIDEO — first frame and last frame must be IDENTICAL so it loops perfectly with no cut. Cyclical motion only: pastel pink and cyan vapor drifts forward then settles back to starting positions, oversized moon stays still, light pulses gently and returns, grainy risograph texture breathes once, surreal floating atmosphere, returns to original symmetrical composition by the end"

---

## Cyclical Motion Vocabulary (for Seedance)

The phrase "first frame and last frame must be IDENTICAL" goes in EVERY loop prompt. Then describe the action as a CYCLE:

| Bad (one-direction) | Good (cyclical) |
|---|---|
| "camera dollies in" | "camera gently pushes in then pulls back to start" |
| "smoke rises" | "smoke swells upward then settles back" |
| "robot turns its head" | "robot completes one full head rotation back to start" |
| "leaves fall" | "leaves drift down then float back to original positions" |
| "light flickers on" | "light pulses on and back off in one full cycle" |

## IP-Safe Rewrites (memory rule)

If the source image contains a recognizable franchise / character (Pokémon, etc.), the IMAGE already carries it. The Seedance prompt must contain ZERO franchise/character names. Describe purely as shot/motion.

| Avoid | Use instead |
|---|---|
| "Charizard" | "winged fire-creature statue" |
| "Pokemon booster pack" | "luxury black and gold pack" |
| "Ho-Oh" | "phoenix figure above" |
| "Mickey Mouse" | "vintage cartoon figure" |

## Things That Always Improve Image Quality

- Specify a real camera + lens: "Phase One 150MP", "Hasselblad H6D-100c", "Leica M11 50mm Summilux"
- Specify a real photographer style: "shot like Annie Leibovitz", "Helmut Newton lighting", "Wolfgang Tillmans"
- Specify the grade: "teal and orange grade", "high-key", "low-key chiaroscuro"
- Specify "no text" at end always
- Pick ONE mood, not three. "Cinematic" + "vibrant" + "moody" = mush.

## Things That Always Improve Seedance Loops

- Open the prompt with "SEAMLESS LOOPING VIDEO — first frame and last frame must be IDENTICAL"
- Describe motion as ONE COMPLETE CYCLE: "swells and recedes", "rotates 360° back to start"
- End the prompt with "returns to original composition by the end"
- Keep motion subtle (0–20% of frame). Big motion can't loop seamlessly in 5s.
- For static-feeling moods, prefer "breathes once" / "subtly pulses" over big actions.
