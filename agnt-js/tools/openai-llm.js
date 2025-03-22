import OpenAI from 'openai';

/**
 * OpenAI Text Generator Tool
 * Generates text using OpenAI's API based on a provided prompt
 */
export async function execute(params, inputData) {
  try {
    // Validate parameters
    if (!params.prompt) {
      return { error: "Prompt is required" };
    }

    // Get API key from environment variable or params
    const apiKey = process.env.OPENAI_API_KEY || params.apiKey;
    if (!apiKey) {
      return { error: "OpenAI API key is required. Set OPENAI_API_KEY environment variable or provide it as a parameter." };
    }

    // Initialize OpenAI client
    const openai = new OpenAI({ apiKey });

    // Set up request parameters
    const requestParams = {
      model: params.model || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: params.systemPrompt || 'You are a helpful assistant.' },
        { role: 'user', content: params.prompt }
      ],
      temperature: parseFloat(params.temperature) || 0.7,
      max_tokens: parseInt(params.maxTokens) || 500
    };

    // Make API request
    const response = await openai.chat.completions.create(requestParams);

    // Extract and return the generated text
    return {
      success: true,
      generatedText: response.choices[0].message.content,
      model: response.model,
      usage: response.usage
    };
  } catch (error) {
    console.error('Error generating text with OpenAI:', error);
    return {
      success: false,
      error: error.message || 'Unknown error occurred'
    };
  }
}