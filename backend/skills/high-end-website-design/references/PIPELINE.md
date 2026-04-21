# Pipeline — Deep Technical Walkthrough

End-to-end recipe with exact code. Read this when actually executing the pipeline.

## Step-by-step for ONE slide

### 1. Decide the slug
```
const slug = 'liquid-machine';        // kebab-case, used everywhere
const projDir = 'C:\\Users\\Studio\\<project-name>';
```

### 2. Generate hero image
Use the chat-level `generate_image` tool (parallel-safe):
```
generate_image({
  provider: 'gemini',
  model: 'nano-banana-pro-preview',
  aspectRatio: '16:9',
  prompt: '<see PROMPT_RECIPES.md>'
})
```
Returns `firstImagePath` like `C:\\Users\\<USER>\\AppData\\Roaming\\AGNT\\Data\\images\\img-gen-<uuid>.jpg`

### 3. Set up project + copy image + upload to uguu
```javascript
const fs = require('fs');
const path = require('path');

const projDir = 'C:\\Users\\Studio\\<project-name>';
fs.mkdirSync(path.join(projDir, 'images'), { recursive: true });
fs.mkdirSync(path.join(projDir, 'videos'), { recursive: true });
fs.mkdirSync(path.join(projDir, 'slides'), { recursive: true });

// Copy each generated image into /images/
const imgSrc = '<firstImagePath from generate_image>';
fs.copyFileSync(imgSrc, path.join(projDir, 'images', slug + '.jpg'));

// Upload to uguu (Seedance needs a publicly fetchable URL)
async function uploadToUguu(filePath, mime) {
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf], { type: mime });
  const fd = new FormData();
  fd.append('files[]', blob, path.basename(filePath));
  const r = await fetch('https://uguu.se/upload', { method: 'POST', body: fd });
  return (await r.json()).files[0].url;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// For 3+ slugs, sleep 3000ms between each upload to avoid rate limit
const heroUrl = await uploadToUguu(path.join(projDir, 'images', slug + '.jpg'), 'image/jpeg');
```

### 4. Generate native loop video
```
seedance_api({
  prompt: 'SEAMLESS LOOPING VIDEO — first frame and last frame must be IDENTICAL so it loops perfectly with no cut. Cyclical motion only: <describe action as full cycle returning to start>. Returns to original composition by the end.',
  firstFrameUrl: heroUrl,
  lastFrameUrl: heroUrl,    // SAME url
  filename: slug + '.mp4',
  aspectRatio: '16:9',
  duration: 5,
  resolution: '1080p'
})
```

Returns `filePath` like `C:\\Users\\<USER>\\AppData\\Roaming\\AGNT\\plugin-data\\seedance\\<hash>\\<slug>.mp4`

### 5. Copy video to project + write HTML
```javascript
const seedancePath = '<filePath from seedance_api response>';
fs.copyFileSync(seedancePath, path.join(projDir, 'videos', slug + '.mp4'));

// Render HTML from template (see assets/slide-template.html)
const html = renderTemplate({ slug, title, subtitle, ...aestheticVars });
fs.writeFileSync(path.join(projDir, 'slides', '01-' + slug + '.html'), html);
```

### 6. Write deck index
The deck navigator at `<projDir>/index.html` lets the user browse all slides at once with autoplaying thumbnails.

```html
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Deck</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui;background:#0a0a0a;color:#f5f1ea;padding:64px 32px}
.wrap{max-width:1100px;margin:0 auto}
h1{font-size:80px;letter-spacing:-.03em;margin-bottom:48px;font-weight:300}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:24px}
a.card{display:block;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;transition:transform .3s}
a.card:hover{transform:translateY(-4px);border-color:#ff3d68}
a.card video{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#000}
.meta{padding:20px}
.meta .num{font-size:11px;letter-spacing:.2em;color:#ff3d68;text-transform:uppercase;margin-bottom:6px}
.meta .name{font-size:22px;font-weight:600}
</style></head>
<body><div class="wrap"><h1>Deck</h1><div class="grid">
<!-- For each slide: -->
<a class="card" href="slides/01-<slug>.html">
  <video autoplay muted loop playsinline src="videos/<slug>.mp4"></video>
  <div class="meta"><div class="num">01 · <aesthetic></div><div class="name"><title></div></div>
</a>
</div></div></body></html>
```

---

## For MULTIPLE slides — fire in parallel

CRITICAL pattern: every external call (image gen, seedance) goes in the SAME tool block. This is the single biggest speedup.

```
// In ONE message, call:
generate_image(slide1)
generate_image(slide2)
generate_image(slide3)
generate_image(slide4)
generate_image(slide5)

// Then in ONE message, call:
seedance_api(slide1)
seedance_api(slide2)
...
```

Sequential = 5x slower. Don't do it.

---

## Performance budget per slide

| Step | Time | Cost |
|---|---|---|
| Image gen (Nano Banana Pro) | ~15s | included |
| Uguu upload | ~2s | free |
| Seedance loop | ~75s | $1.70 |
| HTML write | <1s | free |
| **Total per slide** | **~95s** | **~$1.70** |

5 slides in parallel ≈ 95s wall time, $8.50 total cost.

---

## Common failures + fixes

| Error | Fix |
|---|---|
| `Insufficient credits` from seedance | Stop. Tell user to top up at https://openrouter.ai/settings/credits |
| Uguu upload returns empty / fails | Sleep 3000ms and retry. Don't parallelize 3+ uploads |
| Seedance refuses prompt (IP) | Rewrite prompt with no franchise/character names, only motion |
| Video has visible cut at loop point | Confirm `firstFrameUrl == lastFrameUrl` AND prompt says "first and last frame IDENTICAL" |
| Generated image has random text/logos | Add "no text" to end of image prompt |
| HTML file not found in browser | Check relative path — must be `../videos/foo.mp4` from inside `/slides/` |
| Video doesn't autoplay | Must have all four: `autoplay muted loop playsinline` |
