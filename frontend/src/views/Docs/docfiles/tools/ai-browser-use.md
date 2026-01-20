# AI Browser Use 🤖

## Id

`ai-browser-use`

## Description

Uses AI-powered browser automation to perform web browsing tasks. Supports multiple AI providers (OpenAI, Gemini, DeepSeek) and can generate GIF recordings of browser sessions. Features browser reuse for efficiency and comprehensive error handling.

## Tags

ai, browser, automation, web, scraping, gpt, gemini, deepseek

## Input Parameters

### Required

- **instructions** (string): Detailed instructions for the AI agent to perform
- **provider** (string): AI provider to use (`openai`, `gemini`, `deepseek`)

### Optional

- **reuseBrowser** (boolean, default=false): Whether to reuse browser sessions for efficiency

## Output Format

- **success** (boolean): Whether the browser automation was successful
- **result** (string): The output from the AI agent's task execution
- **gifPath** (string|null): Path to generated GIF recording of the browser session
- **error** (string|null): Error message if the operation failed
