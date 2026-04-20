# Seedance 2.0 Video Plugin for AGNT

Generate cinematic AI video clips using **ByteDance Seedance 2.0** via OpenRouter.

## Features

- 🎬 Text-to-video generation (5, 10, 15, or 20 seconds)
- 🖼️ Image-to-video with first/last-frame conditioning
- 🔊 Native audio-video joint generation (ambient sound & effects)
- 📱 Multiple aspect ratios (9:16, 16:9, 1:1, 4:3, 3:4)
- 🎯 Three resolutions (480p, 720p, 1080p)
- ⚡ Fast tier option for cheaper/faster renders

## Authentication

Requires an **OpenRouter** API key. Connect in `Settings → Connections → OpenRouter`.

Get one at: https://openrouter.ai/settings/keys

## Pricing (April 2026)

| Resolution | Cost per second |
| ---------- | --------------- |
| 480p       | $0.067          |
| 720p       | $0.151          |
| 1080p      | $0.340          |

A 5-second 1080p clip costs **~$1.70**. A 30-second branded film (6× 5s clips at 1080p) costs **~$10.20**.

Fast tier is roughly 40% cheaper with slightly lower fidelity.

## Prompt Formula

Best results follow this structure:

```
[CAMERA] [SUBJECT] [ACTION] [ENVIRONMENT] [LIGHTING] [STYLE]
```

**Example:**
> Slow dolly-in on a chrome robot hand assembling a glowing cube, volumetric fog, cinematic teal-orange lighting, anamorphic lens flare, 35mm film grain

### Camera vocabulary
`dolly-in`, `crane-up`, `whip-pan`, `static wide`, `orbit`, `handheld push`, `tracking shot`

### Lighting vocabulary
`golden hour`, `practical neon`, `chiaroscuro`, `soft key`, `rim light`, `volumetric fog`

### Film-look vocabulary
`anamorphic bokeh`, `35mm grain`, `shallow DOF`, `motion blur`, `blade-runner aesthetic`

## Output

Returns the **absolute path** to a downloaded MP4 file. This pipes directly into the `remotion-compose` tool for branded composition with logos, typography, and captions.

```json
{
  "success": true,
  "filePath": "/path/to/plugin-data/seedance/123/clip_abc123.mp4",
  "sizeBytes": 2847392,
  "duration": 5,
  "resolution": "1080p",
  "aspectRatio": "9:16",
  "cost": 1.70,
  "model": "bytedance/seedance-2.0"
}
```

## Pairs With

- 🎙️ **elevenlabs-plugin** — for voiceover tracks
- 🎬 **remotion-plugin** — for final branded composition with graphics
