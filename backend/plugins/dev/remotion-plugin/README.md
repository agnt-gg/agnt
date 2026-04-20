# Remotion Plugin for AGNT

Programmatic video composition using **Remotion** — the React-based video framework.

This plugin takes a shot-list of MP4 clips (typically from `seedance-api`) plus a voiceover (typically from `elevenlabs-api`) and produces a final branded MP4 with typography overlays, color grading, and transitions.

## Features

- 🎞️ Stitches multiple MP4 clips into a single composition
- ✨ Auto-generated big title + CTA cards with spring animations
- 🎨 Consistent color grade across all clips (unifies AI-generated footage)
- 🎙️ Optional voiceover audio track
- 🖼️ Optional per-shot text overlays
- 📐 Full control over dimensions, fps, brand colors
- ♻️ Re-render support via persisted `projectId`

## Authentication

**None required.** This plugin runs locally and uses only Node.js + Remotion.

> ⚠️ **Prerequisite:** The host machine needs Node.js installed (for `npm install` + `npx remotion render`).

## Input

| Parameter         | Default     | Notes                                                    |
| ----------------- | ----------- | -------------------------------------------------------- |
| `shots`           | required    | `[{filePath, durationFrames, overlayText?}, ...]`        |
| `width`           | `1080`      | 1080 vertical, 1920 horizontal                           |
| `height`          | `1920`      | 9:16 default (Reels/Shorts)                              |
| `fps`             | `30`        | Standard social-video frame rate                         |
| `brandPrimary`    | `#e53d8f`   | Title color                                              |
| `brandAccent`     | `#12e0ff`   | CTA + glow color                                         |
| `backgroundColor` | `#0b0b14`   | Letterbox fill                                           |
| `titleText`       | —           | Big animated title (appears in first shot)               |
| `ctaText`         | —           | Call-to-action pill (appears in last shot)               |
| `voiceoverPath`   | —           | MP3 path from `elevenlabs-api` output                    |
| `projectId`       | auto        | Reuse a previous project for fast re-renders             |
| `skipInstall`     | `No`        | Skip npm install (only if node_modules already present)  |

### Shot object

```json
{
  "filePath": "/path/to/plugin-data/seedance/123/clip_abc.mp4",
  "durationFrames": 150,
  "overlayText": "Introducing the future of work"
}
```

`durationFrames = seconds * fps`. At 30fps, a 5-second clip is 150 frames.

## Typical Pipeline

```
[generate-with-ai-llm]  →  shot-list JSON
         │
         ├── [seedance-api] × N  →  clip_1.mp4 ... clip_N.mp4
         │
         └── [elevenlabs-api TTS] →  voice.mp3
                                         │
                                         ▼
                             [remotion-compose]  →  final.mp4
```

## Output

```json
{
  "success": true,
  "filePath": "/path/to/plugin-data/remotion/123/remotion_abc/out/final.mp4",
  "sizeBytes": 12847392,
  "durationSeconds": 30,
  "totalFrames": 900,
  "projectDir": "/path/to/plugin-data/remotion/123/remotion_abc",
  "renderDurationMs": 45231
}
```

The `projectDir` can be passed back as `projectId` on a subsequent render to skip `npm install` and reuse the composition.

## Performance Notes

- First render: ~1–3 minutes (includes `npm install` of Remotion + React)
- Subsequent renders (same projectId): ~30–90 seconds for a 30s vertical video
- Concurrency is set to 4 by default. For large machines, edit `remotion.config.ts.tmpl`.

## Pairs With

- 🎬 **seedance-plugin** — provides the AI B-roll clips
- 🎙️ **elevenlabs-plugin** — provides the voiceover audio
