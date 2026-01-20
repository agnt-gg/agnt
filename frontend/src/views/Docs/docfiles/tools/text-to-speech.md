# Text to Speech 🔊

## Id

`text-to-speech`

## Description

Converts text to natural-sounding speech using OpenAI's TTS API. Supports multiple voices and languages with configurable speed and chunking for long texts. Features retry mechanisms and comprehensive error handling.

## Tags

tts, speech, audio, openai, voice, synthesis

## Input Parameters

### Required

- **text** (string): Text content to convert to speech (max 4096 characters)
- **voice** (string): Voice to use (alloy, echo, fable, onyx, nova, shimmer)

### Optional

- **speed** (number, default=1.0): Speech speed (0.25-4.0)

## Output Format

- **success** (boolean): Whether the text-to-speech conversion was successful
- **result** (object): Audio content as base64-encoded MP3
- **contentType** (string): Audio format (audio/mpeg)
- **error** (string|null): Error message if conversion failed
