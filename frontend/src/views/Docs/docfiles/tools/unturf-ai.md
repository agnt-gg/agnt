# Unturf AI 🤖

## Id

`unturf-ai`

## Description

Accesses Unturf AI services for LLM text generation and text-to-speech conversion. Supports multiple AI models and voices with comprehensive API integration for both text and audio generation.

## Tags

unturf, ai, llm, tts, text-to-speech, generation, api

## Input Parameters

### Required

- **service** (string): Service type (`LLM` or `Text-to-Speech`)
- **prompt** (string): Prompt for LLM service (required when service=LLM)
- **text** (string): Text for TTS service (required when service=Text-to-Speech)
- **voice** (string): Voice for TTS service (required when service=Text-to-Speech)

### Optional

- **model** (string): AI model for LLM service
- **temperature** (number): Temperature for LLM (default varies)
- **maxTokens** (number): Maximum tokens for LLM
- **speed** (number): Speech speed for TTS (0.25-4.0)

## Output Format

- **success** (boolean): Whether the Unturf AI operation was successful
- **result** (string): Generated text or base64-encoded audio
- **error** (string|null): Error message if the operation failed

## More Information

Visit [Unturf Software](https://www.unturf.com/software/) for more information about available models, endpoints, and API documentation.

### Available Endpoints:

- **Hermes**: https://hermes.ai.unturf.com/v1 - General purpose conversational AI
- **Qwen 3 Coder**: https://qwen.ai.unturf.com/v1 - Specialized coding model
- **TTS**: https://speech.ai.unturf.com/v1 - Text-to-speech generation

### Available Models:

- `adamo1139/Hermes-3-Llama-3.1-8B-FP8-Dynamic` - Fast general purpose model
- `NousResearch/Hermes-3-Llama-3.1-8B` - Alternative Hermes model
- `hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Q4_K_M` - Specialized coding model
