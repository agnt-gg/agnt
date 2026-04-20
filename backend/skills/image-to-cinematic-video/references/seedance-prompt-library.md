# Seedance Prompt Library

A collection of proven shot prompts organized by category. Use these as starting points and modify for your specific subject. The structure that works best:

> `[camera move] [subject] [action] [environment] [lighting] [film/style]`

You can stack optional modifiers: `[lens type]` (e.g., 35mm, anamorphic), `[texture]` (film grain, bloom), `[atmosphere]` (fog, dust motes, lens flare), `[speed]` (slow motion, time-lapse).

## Camera Move Vocabulary

Seedance understands standard cinematography language. Use the specific terms rather than vague ones:

| Term | What it does |
|---|---|
| **dolly in / dolly out** | Camera physically moves toward / away from subject |
| **tracking shot** | Camera moves alongside subject (follows motion) |
| **pan left / pan right** | Camera rotates horizontally from fixed point |
| **tilt up / tilt down** | Camera rotates vertically from fixed point |
| **crane shot / boom shot** | Camera rises or descends vertically |
| **orbit / arc shot** | Camera circles around the subject |
| **push in** | Slow, subtle dolly-in (emotional effect) |
| **pull back reveal** | Start tight, reveal wider context |
| **whip pan** | Fast rotation, motion blur, high energy |
| **handheld / shaky cam** | Realistic, documentary feel |
| **locked off** | Completely static camera, subject moves within frame |
| **Dutch angle** | Tilted frame for unease/tension |

## Lighting Vocabulary

| Term | Look |
|---|---|
| **golden hour** | Warm, low-angle sun — universal "cinematic" signifier |
| **blue hour** | Cool, post-sunset tones — moody |
| **overcast / soft diffused** | No harsh shadows, flattering |
| **harsh noon sun** | Strong shadows, high contrast |
| **rim lighting / backlight** | Edge glow around subject |
| **chiaroscuro** | Deep shadows, focused highlights |
| **volumetric lighting** | Visible light beams through fog/dust |
| **neon / practical lights** | Urban, nighttime, color-rich |
| **moonlit / silver light** | Cool monochrome night |
| **firelight / candlelight** | Warm flickering, intimate |

## Lens & Style Modifiers

| Term | Effect |
|---|---|
| **35mm film** | Classic cinematic look, mild grain |
| **anamorphic lens flare** | Horizontal blue flare streaks |
| **shallow depth of field** | Blurred background, subject in focus |
| **deep focus** | Everything sharp from foreground to background |
| **wide angle / fisheye** | Exaggerated perspective, dramatic |
| **telephoto / compressed** | Flattened space, stalker-paparazzi feel |
| **macro / extreme closeup** | Tiny details made huge |
| **vintage / super 8** | Nostalgic, slightly degraded texture |
| **cinemascope / letterbox** | 2.39:1 widescreen feel |
| **black and white / desaturated** | Timeless, artistic |

## Scene Templates by Mood

### Warm / Joyful

```
Slow dolly-in on {subject}, {subject} {action} with gentle joy, wildflowers swaying in the breeze, golden hour lighting, shallow depth of field, 35mm film, warm color grade
```

```
Tracking shot following {subject} through a sunlit {environment}, lens flare as the sun peeks through trees, soft bokeh background, summer afternoon, cinematic
```

### Epic / Cinematic

```
Low angle push-in on {subject}, {subject} {action} heroically, wind sweeping debris past camera, volumetric backlighting, anamorphic lens flare, IMAX-style cinematography
```

```
Sweeping crane shot rising above {subject} as {subject} {action}, revealing vast {environment} in the distance, magic hour sky, epic orchestral feel
```

### Tense / Mysterious

```
Handheld camera slowly approaches {subject} from behind, {subject} suddenly {action}, low light with practical lamps, deep shadows, film noir color palette
```

```
Dutch angle, slow push-in on {subject} as {subject} {action}, flickering fluorescent light, long shadows, cold blue and sickly green color grade, thriller atmosphere
```

### Serene / Contemplative

```
Locked-off wide shot, {subject} stands quietly in {environment}, gentle breeze, distant soft ambient sound, overcast diffused light, washed-out pastel palette, meditative pace
```

```
Extreme slow motion close-up on {subject} as {subject} {action}, dust motes floating in shafts of light, shallow focus, emotional, poetic cinematography
```

### Energetic / Kinetic

```
Whip pan to {subject} mid-{action}, motion blur trails, high frame rate slow motion, vibrant saturated colors, aerial debris, action film style
```

```
Tracking shot chasing alongside {subject} as {subject} sprints through {environment}, low angle, dramatic shadows, high contrast, adrenaline-pumping energy
```

### Dreamy / Surreal

```
Floating orbit around {subject} as {subject} {action} in slow motion, drifting particles in the air, soft glowing bokeh, ethereal rim light, dreamlike color palette, shallow focus
```

```
Time ramps from normal to extreme slow motion as {subject} {action}, pastel sky, lens flare halos, nostalgic film grain, magical realism
```

## Multi-Scene Continuity Tips

When generating N scenes that need to feel like one piece:

1. **Use the same `firstFrameUrl` for every scene.** Seedance uses it as a visual anchor — the subject, environment, and lighting will stay consistent.
2. **Vary only what needs to vary** in each prompt. Keep the subject description identical across scenes and change only the action + camera move. Example:

   - Scene 1: "Slow dolly-in on a golden retriever sitting in a sunny meadow, **dog turns head toward camera**, golden hour..."
   - Scene 2: "Slow dolly-in on a golden retriever sitting in a sunny meadow, **dog stands and trots forward**, golden hour..."
   - Scene 3: "Slow dolly-in on a golden retriever sitting in a sunny meadow, **dog leaps upward chasing a butterfly**, golden hour..."

3. **Escalate energy across scenes.** Classic three-act pattern: establishing beat → development → payoff. Scene 1 is usually the quietest, Scene N is the peak.
4. **Match lighting descriptors exactly.** "Golden hour" in all three, not "sunset" in one and "golden light" in another.
5. **Lock your lens/style modifiers.** If Scene 1 is "35mm film, shallow depth of field", make all scenes 35mm film with shallow depth of field.

## Anti-Patterns (things that waste credits)

- **Generic subjects** — "a dog" is much weaker than "a golden retriever with a thick coat sitting on its haunches". Seedance fills in details either way; give it the ones you want.
- **Conflicting modifiers** — "harsh noon sun" + "golden hour" won't work. Pick one lighting condition.
- **Too many actions** — "dog runs, jumps, barks, rolls over, wags tail" in one 5s clip will look frantic and incoherent. One action per clip.
- **Abstract emotion words without visual referents** — "sad dog" is weaker than "dog lying with head on paws, ears flat, looking toward the empty doorway". Show, don't tell.
- **Color grade in isolation** — saying just "cinematic" does little. Saying "golden hour + 35mm film + shallow depth of field" gives Seedance specific targets.

## Audio generation

Seedance 2.0 supports `generateAudio: 'Yes'` for ambient sound + effects. Use it when:

- The scene has an obvious audio cue (ocean, rain, crowd, engine)
- You don't plan to dub in music/voiceover afterward

Skip it when you're going to overlay ElevenLabs voiceover or a music bed — the generated ambient audio will clash.
