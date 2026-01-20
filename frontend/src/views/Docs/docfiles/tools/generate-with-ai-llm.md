# Generate with AI LLM 🧠

## Id

`generate-with-ai-llm`

## Description

Generates text content using various AI language models including OpenAI GPT, Anthropic Claude, Google Gemini, and others. Supports custom prompts, temperature control, and multiple providers with comprehensive model selection.

## Tags

ai, llm, generation, gpt, claude, gemini, text, openai, anthropic

## Input Parameters

### Required

- **prompt** (string): The prompt or instructions for AI generation
- **provider** (string): AI provider (`anthropic`, `deepseek`, `gemini`, `grokai`, `groq`, `local`, `openai`, `togetherai`)

### Optional

- **model** (string): Specific model to use (varies by provider)
- **maxTokens** (number, default=4096): Maximum tokens to generate
- **temperature** (number, default=0): Temperature for randomness (0-1)
- **parseJson** (boolean, default=false): Whether to parse JSON output
- **image** (object): Image data for vision models

## Output Format

- **generatedText** (string): The AI-generated content
- **tokenCount** (number): Number of tokens used
- **error** (string|null): Error message if generation failed
