# Seedance 2.0 Video Plugin for AGNT

Generate cinematic AI video clips using **ByteDance Seedance 2.0** via OpenRouter.

**Version 1.1.0** adds multimodal reference inputs — pass prior clips, reference audio, and style images back into Seedance 2.0 for continuity and style memory across multi-scene videos.

## Features

- 🎬 Text-to-video generation (5, 10, 15, or 20 seconds)
- 🖼️ Image-to-video with first/last-frame conditioning
- 🔊 Native audio-video joint generation (ambient sound & effects)
- 🎨 **Multimodal reference inputs** — up to 9 reference images, 3 reference videos, 3 reference audio clips
- 📱 Multiple aspect ratios (9:16, 16:9, 1:1, 4:3, 3:4)
- 🎯 Three resolutions (480p, 720p, 1080p)
- ⚡ Fast tier option for cheaper/faster renders
- 🔁 Returns provider content URLs so generated clips can chain into the next call as `referenceVideoUrls`

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

## Multimodal Reference Inputs (v1.1)

Three optional fields accept newline- or comma-separated public URLs:

| Field | Limit | Use for |
|---|---|---|
| `referenceImageUrls` | up to 9 | Color palette, character design, sparse style frames |
| `referenceVideoUrls` | up to 3 | Camera rhythm, motion patterns, prior-scene continuity |
| `referenceAudioUrls` | up to 3 | Sound design, percussion, voice timbre (cannot be used alone) |

### Prompt conventions

Address references explicitly in the prompt — Seedance ignores attached references that aren't named:

```text
Use [Video1] for camera rhythm and impact timing.
Use [Audio1] for percussion and metallic hits.
Use [Image1] for color palette and character design.
```

The `@` form also works:

```text
Use @Video1 as the motion reference, @Audio1 as the sound-design reference, and @Image1 as the brand-style frame.
```

If you submit references but don't address any of them in the prompt, the plugin returns a warning in `referenceSummary.warnings`.

### Combining references with first/last frame

Reference inputs and frame conditioning compose. The high-leverage workflow for a multi-scene trailer:

```
Scene 2 call:
  prompt:           "Use [Video1] for camera rhythm. Use [Audio1] for percussion."
  firstFrameUrl:    <Scene 1's last frame, for visual continuity>
  referenceVideoUrls: <Scene 1's unsignedUrl, for motion/style memory>
  referenceAudioUrls: <Scene 1's audio, for rhythm continuity>
```

Whether OpenRouter accepts that exact combination depends on the provider — see the **Payload modes** section below.

## Payload modes

Different providers expose reference fields under different schemas. The plugin can submit references in four shapes, controlled by `referencePayloadMode`:

| Mode | Shape | When to use |
|---|---|---|
| `auto` (default) | Tries `openrouter-normalized` first; retries with `provider-lists` only on pre-job validation errors that name unknown reference fields | Default — safest |
| `openrouter-normalized` | `reference_images` / `reference_videos` / `reference_audios` arrays of typed entries | OpenRouter's documented normalized shape |
| `provider-lists` | `image_urls` / `video_urls` / `audio_urls` flat arrays | fal.ai / Replicate native shape |
| `content-array` | A single `content` array with role-tagged multimodal entries | Providers expecting chat-style multimodal payloads |
| `raw-only` | Only core params + whatever you pass in `rawPassthroughJson` | Testing brand-new provider fields without rebuilding |

**`auto` never retries after a job ID is returned** — only on pre-job 400 validation errors that clearly indicate unknown reference fields. You will never be billed for two jobs from a single call.

### Raw passthrough escape hatch

`rawPassthroughJson` is merged into the request **after** every other field (highest priority on key conflicts). Use it to test new provider-specific fields:

```json
{
  "stylization_strength": 0.7,
  "motion_strength": 1.2
}
```

Must be a JSON object — arrays and scalars are rejected before any paid call.

### Debugging the request body

Set `includeDebugRequest: "Yes"` to receive a redacted summary of the actual request body in the output:

- Auth headers are stripped
- Signed URLs are truncated to `<origin>/<first-two-path-segments>/...`
- Use it to verify which fields the plugin actually submitted

## Output

```json
{
  "success": true,
  "filePath": "C:/Users/.../plugin-data/seedance/123/clip_abc123.mp4",
  "filename": "clip_abc123.mp4",
  "sizeBytes": 2847392,
  "duration": 5,
  "resolution": "1080p",
  "aspectRatio": "9:16",
  "jobId": "job_xyz",
  "cost": 1.70,
  "model": "bytedance/seedance-2.0",
  "contentUrl": "https://cdn.openrouter.ai/.../clip.mp4?Signature=...",
  "unsignedUrl": "https://cdn.openrouter.ai/.../clip.mp4",
  "pollUrl": "https://openrouter.ai/api/v1/videos/job_xyz",
  "referenceSummary": {
    "imageCount": 1,
    "videoCount": 1,
    "audioCount": 0,
    "totalCount": 2,
    "imageNames": ["palette.png"],
    "videoNames": ["scene1.mp4"],
    "audioNames": [],
    "warnings": []
  },
  "requestShape": "openrouter-normalized",
  "debugRequest": null,
  "error": null
}
```

`unsignedUrl` is typically the cleanest URL to feed back into the next call's `referenceVideoUrls`. `contentUrl` may carry signature query parameters that expire — use `unsignedUrl` for chaining when both are present.

## Validation errors (returned before any paid call)

| Failure | Message |
|---|---|
| Too many images | `Seedance reference input limit exceeded: image references support at most 9 URLs.` |
| Too many videos | `Seedance reference input limit exceeded: video references support at most 3 URLs.` |
| Too many audio clips | `Seedance reference input limit exceeded: audio references support at most 3 URLs.` |
| Audio without anything else | `Reference audio cannot be used alone. Add at least one image, video, first frame, or last frame reference.` |
| Non-public URL | `Reference URL must be public http(s): <value>.` |
| Bad passthrough JSON | `rawPassthroughJson must be a JSON object.` |

When OpenRouter rejects the reference payload, the error message includes the attempted payload mode and a hint to try a different one — e.g.:

```
OpenRouter/Seedance rejected the reference payload (mode=openrouter-normalized).
Try referencePayloadMode=provider-lists, content-array, or raw-only with rawPassthroughJson,
and inspect debugRequest for the exact body.
```

## Pairs With

- 🎙️ **elevenlabs-plugin** — for voiceover tracks (use returned audio as `referenceAudioUrls`)
- 🎬 **remotion-plugin** — for final branded composition with graphics

## V1 Limitations

- **Public URLs only.** Local file paths are rejected. A future release will add provider-neutral hosting so any AGNT-generated asset can be referenced directly.
- **No silent reference handling.** If a provider rejects the payload, the plugin returns the exact mode it tried and a hint to switch — it never silently drops references.
- **No timeline editing or compositing.** Use the Remotion plugin for that.
