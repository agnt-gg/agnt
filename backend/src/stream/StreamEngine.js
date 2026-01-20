import { Anthropic } from '@anthropic-ai/sdk';
import { OpenAI } from 'openai/index.mjs';
import axios from 'axios';
import RAG from '../services/ai/RagService.js';
import fs from 'fs/promises';
import path from 'path';
import PathManager from '../utils/PathManager.js';
import AuthManager from '../services/auth/AuthManager.js';
import { createLlmClient } from '../services/ai/LlmService.js';

import { getRawTextFromPDFBuffer, getRawTextFromDocxBuffer, trimToWordLimit, generateUniqueId, computeFileHash } from './utils.js';

class StreamEngine {
  constructor(userId) {
    this.userId = userId;
    this.baseURLs = {
      deepseek: 'https://api.deepseek.com/v1',
      gemini: 'https://generativelanguage.googleapis.com/v1beta/',
      grokai: 'https://api.x.ai/v1/',
      groq: 'https://api.groq.com/openai/v1',
      local: 'http://127.0.0.1:1234/v1',
      openai: 'https://api.openai.com/v1',
      togetherai: 'https://api.together.xyz/v1',
      // Add other provider base URLs as needed
    };
    this.systemPrompt = `RESPONSE FORMAT:

IMPORTANT: If returning advanced math or chemical notation, ALWAYS INCLUDE DOUBLE DOLLAR SIGNS SPACE "$$ " at the beginning and "$$" end of any MathJax advanced math notation that can be used by MathJax JavaScript display engine. For example: "$$\sigma = \sqrt{\text{Var}(X)}$$"
IMPORTANT: For MathJax chemical formulas, ALWAYS include the mhchem extension by enclosing the formula in DOUBLE dollar sign "$$\\ce{}$$" tags. For example: "$$\\ce{H2O}$$" for water.
IMPORTANT: When using chemical formulas, always enclose the entire \\ce{} expression in display math delimiters $$ $$. For example: $$\\ce{H2O}$$
For more complex structures or equations involving both chemical formulas and mathematical notation, use the appropriate combination of delimiters and mhchem commands. For example:
$$\\ce{C6H12O6} + 6\\ce{O2} \\rightarrow 6\\ce{CO2} + 6\\ce{H2O}$$
MATHJAX SETTING TO CLARIFY:
displayMath: [
  ['\\[', '\\]'],
  ['$$\\', '$$'],
],
MATHJAX WILL FAIL IF YOU USE SINGLE DOLLAR SIGNS. ALWAYS USE DOUBLE DOLLAR SIGNS FOR ALL MATHJAX FORMULAS AND VARIABLES.
Remember to use proper spacing and line breaks for readability in more complex equations or structures.
If returning programming code, return the code within <PRE><CODE> tags.
Always return your helpful answer as well structured, valid markdown format with various elements (h1 #, h2 ##, h3 ##, lists -, etc where appropriate).
IMPORTANT: DO NOT INCLUDE THE OUTERMOST "\`\`\`markdown", <>,  OR FINAL "\`\`\`" IN YOUR RESULT. I WILL HANDLE THAT EXTERNALLY.
`;
    this.chatSystemPrompt = `SYSTEM INSTRUCTIONS:

Your primary goal is to read the entire chat, message by message, and continue the current chat, responding to the user's latest request while referencing the current chat.
Think step by step in your mind about the messages from latest to first in the "current-chat". The current chat is the exact HTML page as the user sees it. 
Do not repeat the previous messages or your internal monolog in you response. Make sure each message response back to the user is unique unless asked so by the user.
Prioritize answering the "user-current-message" (latest message from user) query by referencing messages between you (the assistant) and the user in the "current-chat" (past messages). 
Prioritize later messages in the conversation (message number 10) over earlier messages (message number 2) when responding. 

RESPONSE FORMAT:

IMPORTANT: If returning advanced math, math notation, latex, or chemical notation, ALWAYS USE MATHJAX WITH DOUBLE DOLLAR SIGNS SPACE "$$ " at the beginning and "$$" end of any MathJax advanced math notation that can be used by MathJax JavaScript display engine.
EXAMPLES: "$$ x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} $$"
"$$\sigma = \sqrt{\text{Var}(X)}$$"
IMPORTANT: For MathJax chemical formulas, ALWAYS include the mhchem extension by enclosing the formula in DOUBLE dollar sign "$$\\ce{}$$" tags. For example: "$$\\ce{H2O}$$" for water.
IMPORTANT: When using chemical formulas, always enclose the entire \\ce{} expression in display math delimiters $$ $$. For example: $$\\ce{H2O}$$
For more complex structures or equations involving both chemical formulas and mathematical notation, use the appropriate combination of delimiters and mhchem commands. For example:
$$\\ce{C6H12O6} + 6\\ce{O2} \\rightarrow 6\\ce{CO2} + 6\\ce{H2O}$$
MATHJAX SETTING TO CLARIFY:
displayMath: [
  ['\\[', '\\]'],
  ['$$\\', '$$'],
],
MATHJAX WILL FAIL IF YOU USE SINGLE DOLLAR SIGNS. ALWAYS USE DOUBLE DOLLAR SIGNS FOR ALL MATHJAX FORMULAS AND VARIABLES.
Remember to use proper spacing and line breaks for readability in more complex equations or structures.
If returning programming code, return the code within <PRE><CODE> tags.
Always return your helpful answer as well structured, valid markdown format with various elements (h1 #, h2 ##, h3 ##, lists -, etc where appropriate).
IMPORTANT: DO NOT INCLUDE THE OUTERMOST "\`\`\`markdown", <>,  OR FINAL "\`\`\`" IN YOUR RESULT. I WILL HANDLE THAT EXTERNALLY.
`;
    this.streamMap = new Map();
    this.rag = null;
    this.agnt = null;
  }
  async startStream(req, res, userQuery, files, provider, modelName, isChat, messages, accessToken) {
    // Client is now initialized with the factory based on provider
    const client = await createLlmClient(provider, this.userId);

    // Add these headers at the start of the method
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Important for Nginx
    res.setHeader('Transfer-Encoding', 'chunked');

    // Enable CORS if needed
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    // Disable response buffering
    res.flushHeaders();

    const cache = {};
    let combinedDocumentText = '';
    let systemPrompt = isChat ? this.chatSystemPrompt : this.systemPrompt;
    let imageData = null;

    try {
      // Handle files
      if (files) {
        let fileCount = 0;
        for (const file of files) {
          const fileBuffer = file.buffer;
          const fileType = file.mimetype;
          let textContent = '';
          let cacheKey;
          fileCount++;

          if (fileBuffer) {
            cacheKey = computeFileHash(fileBuffer);
            if (cache[cacheKey]) {
              textContent = cache[cacheKey];
            } else {
              if (fileType.startsWith('image/')) {
                // Process image file
                imageData = {
                  type: fileType,
                  data: fileBuffer.toString('base64'),
                };
                textContent = `[Image: ${file.originalname}]`;
              } else {
                // Process other file types as before
                switch (fileType) {
                  case 'application/pdf':
                    textContent = await getRawTextFromPDFBuffer(Buffer.from(fileBuffer));
                    break;
                  case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                    textContent = await getRawTextFromDocxBuffer(Buffer.from(fileBuffer));
                    break;
                  case 'text/plain':
                  case 'text/csv':
                  case 'text/html':
                  case 'text/javascript':
                  case 'text/markdown':
                  case 'application/octet-stream':
                    textContent = fileBuffer.toString('utf-8');
                    break;
                  default:
                    return res.status(400).send('Unsupported file type.');
                }
              }
              cache[cacheKey] = textContent;
            }
          }
          combinedDocumentText += `[FILE #${fileCount} OF ${files.length}] \n\n`;
          combinedDocumentText += textContent + '\n\n';
        }
      }

      const streamId = generateUniqueId();
      console.log(`Stream ${streamId} created...`);

      combinedDocumentText = trimToWordLimit(combinedDocumentText, 8192);

      // If an image is present, use Anthropic's Claude 3.5 Sonnet model
      if (imageData) {
        provider = 'anthropic';
        modelName = 'claude-3-5-sonnet-20240620';
      }

      switch (provider.toLowerCase()) {
        case 'anthropic':
          await this.startClaudeAIStream(res, systemPrompt, combinedDocumentText, userQuery, messages, streamId, modelName, imageData, client);
          break;
        case 'cerebras':
        case 'deepseek':
        case 'gemini':
        case 'grokai':
        case 'groq':
        case 'local':
        case 'openai':
        case 'openrouter':
        case 'togetherai':
          await this.startOpenAiLikeStream(res, systemPrompt, combinedDocumentText, userQuery, messages, streamId, modelName, client, provider);
          break;
        // Add cases for other providers as needed
        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }
    } catch (error) {
      console.error('Error processing the file(s) or generating the text stream:', error);
      res.status(500).send('An error occurred while processing the file(s) or generating the text stream.');
    }
  }
  async startClaudeAIStream(res, systemPrompt, combinedDocumentText, userQuery, messages, streamId, modelName, imageData, client) {
    let finalMessages = [];

    if (messages && messages.length > 0) {
      try {
        // Check if messages is already an array
        finalMessages = Array.isArray(messages) ? messages : JSON.parse(messages);
      } catch (error) {
        console.error('Error parsing messages JSON:', error);
        console.error('Failed to parse:', messages);
        // If parsing fails, we'll use an empty array for messages
        finalMessages = [];
      }
    }

    if (userQuery) {
      const userMessage = {
        role: 'user',
        content: imageData
          ? [
              { type: 'text', text: userQuery },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imageData.type,
                  data: imageData.data,
                },
              },
            ]
          : [{ type: 'text', text: userQuery }],
      };
      finalMessages.push(userMessage);
    }

    console.log(finalMessages);

    try {
      const stream = await client.messages.stream(
        {
          model: modelName,
          messages: finalMessages,
          system: [
            {
              type: 'text',
              text: `
              [SYSTEM INSTRUCTIONS]:
              ${systemPrompt}
              [END SYSTEM INSTRUCTIONS]
    
              [START RELEVANT DOCUMENT TEXT (OPTIONAL)]:
              ${combinedDocumentText}
              [END RELEVANT DOCUMENT TEXT]:
            `,
            },
          ],
          max_tokens: modelName === 'claude-3-7-sonnet-20250219' ? 64000 : modelName === 'claude-3-5-sonnet-20240620' ? 8192 : 4096,
          temperature: modelName === 'claude-3-7-sonnet-20250219' ? 1 : 0.5,
          thinking:
            modelName === 'claude-3-7-sonnet-20250219'
              ? {
                  type: 'enabled',
                  budget_tokens: 51200,
                }
              : undefined,
        },
        {
          headers: {
            'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15',
          },
          // If using cache
          // headers: {
          //   "anthropic-beta": "prompt-caching-2024-07-31,max-tokens-3-5-sonnet-2024-07-15"
          // }
        }
      );

      // Set response headers for streaming
      // res.setHeader("Content-Type", "text/event-stream");
      // res.setHeader("Cache-Control", "no-cache");
      // res.setHeader("Connection", "keep-alive");

      this.streamMap.set(streamId, stream);

      // Return the stream ID to the client
      res.write(`{ streamId: ${streamId} }\n\n`);

      stream.on('text', (text) => {
        if (text.length > 0) {
          res.write(text);
        }
      });

      stream.on('end', () => {
        res.end();
      });

      stream.on('error', (error) => {
        console.error('Stream error:', error);
        res.status(500).write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
        this.streamMap.delete(streamId);
        res.end();
      });
    } catch (error) {
      console.error('Error setting up stream:', error);
      res.status(500).send('Error setting up stream');
    }
  }
  async startOpenAiLikeStream(res, systemPrompt, combinedDocumentText, userQuery, messages, streamId, modelName, client, provider) {
    let finalMessages = [];

    if (messages && messages.length > 0) {
      try {
        finalMessages = Array.isArray(messages) ? messages : JSON.parse(messages);

        // Filter out messages with null content
        finalMessages = finalMessages.filter((msg) => msg.content !== null && msg.content !== undefined);
      } catch (error) {
        console.error('Error parsing messages JSON:', error);
        finalMessages = [];
      }
    }

    if (userQuery) {
      const userMessage = {
        role: 'user',
        content: userQuery,
      };
      finalMessages.push(userMessage);
    }

    console.log(finalMessages);

    try {
      // For o1-preview model, include system instructions in the first user message
      if (modelName === 'o1-mini' && provider.toLowerCase() === 'openai') {
        const systemInstructions = `
          [SYSTEM INSTRUCTIONS]:
          ${systemPrompt}
          [END SYSTEM INSTRUCTIONS]
  
          [START RELEVANT DOCUMENT TEXT (OPTIONAL)]:
          ${combinedDocumentText}
          [END RELEVANT DOCUMENT TEXT]:
        `;

        if (finalMessages.length > 0 && finalMessages[0].role === 'user') {
          finalMessages[0].content = `${systemInstructions}\n\n${finalMessages[0].content}`;
        } else {
          finalMessages.unshift({
            role: 'user',
            content: systemInstructions,
          });
        }
      } else {
        // For other models, keep the original system message
        finalMessages.unshift({
          role: 'system',
          content: `
            [SYSTEM INSTRUCTIONS]:
            ${systemPrompt}
            [END SYSTEM INSTRUCTIONS]
  
            [START RELEVANT DOCUMENT TEXT (OPTIONAL)]:
            ${combinedDocumentText}
            [END RELEVANT DOCUMENT TEXT]:
          `,
        });
      }

      const streamOptions = {
        model: modelName,
        messages: finalMessages,
      };

      // Add the appropriate token limit parameter based on the model and provider
      if ((modelName === 'o1-mini' || modelName === 'o3-mini' || modelName === 'o1') && provider.toLowerCase() === 'openai') {
        streamOptions.max_completion_tokens = 8192;
      } else if (provider.toLowerCase() !== 'groq') {
        // Don't set max_tokens for Groq
        streamOptions.max_tokens = 8192;
      }

      // Don't set temperature for Groq as it has special handling
      if (modelName !== 'deepseek-reasoner' && provider.toLowerCase() !== 'groq') {
        streamOptions.temperature = 1;
        streamOptions.top_p = 1;
      }

      // Check if streaming is supported for the provider and model
      const supportsStreaming = !(provider.toLowerCase() === 'groq' || modelName === 'o1' || modelName === 'o1-mini' || modelName === 'o3-mini');
      streamOptions.stream = supportsStreaming;

      let response;
      if (supportsStreaming) {
        const stream = await client.chat.completions.create(streamOptions);
        this.streamMap.set(streamId, stream);

        // Return the stream ID to the client
        res.write(`{ streamId: ${streamId} }\n\n`);

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            res.write(content);
          }
        }
      } else {
        // For providers that don't support streaming, use a non-streaming request
        delete streamOptions.stream; // Remove the stream option for non-streaming requests
        response = await client.chat.completions.create(streamOptions);
        const content = response.choices[0]?.message?.content || '';
        res.write(content);
      }

      this.streamMap.delete(streamId);
      console.log(`Stream ${streamId} complete.`);
      res.end();
    } catch (error) {
      console.error('Stream error:', error);
      res.status(500).write(
        `data: ${JSON.stringify({
          error: 'Stream error: ' + error.message,
        })}\n\n`
      );
      this.streamMap.delete(streamId);
      res.end();
    }
  }
  cancelStream(streamId) {
    const stream = this.streamMap.get(streamId);
    if (stream) {
      stream.controller.abort();
      this.streamMap.delete(streamId);
      console.log(`Stream ${streamId} cancelled.`);
    }
  }
  async generateTool(templateOverview, provider, model) {
    const toolGenerationPrompt = `[PRIORITIZE THESE INSTRUCTIONS AND ESPECIALLY THE TEMPLATE BELOW]:
      Generate a detailed and complete JSON template with all fields and initial instructions based on the user's template overview requirements.
      
      [TOOL TYPES]:
      1. AI Prompt Tool (Default): Uses an LLM to process text. Must include "template-instructions" field.
      2. Code Tool (JavaScript/Python): Executes code. Must include "base" ("JavaScript" or "Python") and "code" fields.

      [GENERAL INSTRUCTIONS]:
      The template should include a "name", a "description" for the tool itself, and a "fields" array.
      The "fields" array should contain objects, each with at least "name", "value", and "type".
      You have the types "text", "textarea", and "file" to choose from for the fields.
      Always return as a complete JSON string with properties double quoted.
      Think step by step about the best fields and information to include as the template.
      DO NOT USE MARKDOWN AT ALL FOR THIS PARTICULAR QUERY, JUST THE OBJECT PLEASE WITH NO EXPLAINATION OR COMMENTARY WHATSOEVER.
      DO NOT INCLUDE THE OUTERMOST "'''json" OR FINAL "'''" IN YOUR RESULT. I WILL HANDLE THAT EXTERNALLY!!

      [FOR AI PROMPT TOOLS]:
      - One of the fields must be named "template-instructions" and its "value" should contain the instructions for the AI that will use this tool template.
      
      [FOR CODE TOOLS]:
      - Set "base" property to "JavaScript" or "Python".
      - Include a "code" property with the actual code to execute.
      - The "fields" array should define the input parameters that will be passed to the code.
      - Do NOT include "template-instructions" for code tools.
      - For JavaScript: Code runs in a Node.js environment. Use 'params.paramName' to access parameters. Return result.
      - For Python: Code runs in a Python environment. Use 'params.paramName' to access parameters. Define a 'result' variable with the output.

      [CODE TIPS]:
      
      [JAVASCRIPT TIPS]:
      // Input parameters: Access with params.paramName

      // Example with params "url" and "method":
      const url = params.url || '';
      const method = params.method || 'GET';

      // Your code here
      let finalUrl = url;
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = 'https://' + finalUrl;
      }

      // YOU MUST RETURN AN OBJECT!!! - success/error wrapped automatically
      return {
          url: finalUrl,
          method: method
      };

      [AUTHENTICATING APPS IN JAVASCRIPT]:

      // Get the current user's ID for the auth
      const userId = workflowContext.userId;

      // Use AuthManager to get a valid token from the system
      const githubToken = await AuthManager.getValidAccessToken(userId, 'github');

      // Make an API call with the token
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': \`Bearer \${githubToken}\`
        }
      });

      const userData = await response.json();

      // Return the result YOU MUST RETURN AN OBJECT!!!
      return { result: userData };

      [PYTHON TIPS]:
      # Input parameters: Access with params.paramName

      # Example with params "url" and "method":
      url = params.url if hasattr(params, 'url') else ''
      method = params.method if hasattr(params, 'method') else 'GET'

      # Your code here
      if not url.startswith('http://') and not url.startswith('https://'):
          url = 'https://' + url

      # MUST use return (or print) - success/error wrapped automatically YOU MUST RETURN AN OBJECT!!!
      # IF YOU DONT RETURN AN OBJECT IT WONT RUN!!!!
      return {
          "url": url,
          "method": method
      }

      # Alternative: print also works
      # print({"url": url, "method": method})

      [TEMPLATE OVERVIEW]:
      ${templateOverview}

      [EXAMPLE TEMPLATE OBJECTS]:

      [EXAMPLE 1 - AI PROMPT TOOL]:
      "{
        "id": "template-home-renovation-advisor",
        "name": "Home Renovation Advisor",
        "description": "An AI assistant to help plan and get advice on home renovation projects.",
        "fields": [
            {
                "name": "template-name",
                "value": "Home Renovation Advisor",
                "type": "text"
            },
            {
                "name": "template-instructions",
                "value": "Provide suggestions for home renovation projects, including design ideas, material recommendations, and cost estimations based on the provided room type, design preferences, and budget.",
                "type": "textarea"
            },
            {
                "name": "room-type",
                "value": "",
                "type": "textarea"
            },
            {
                "name": "design-preferences",
                "value": "",
                "type": "textarea"
            },
            {
                "name": "budget",
                "value": "",
                "type": "textarea"
            }
        ]
      }"

      [EXAMPLE 2 - JAVASCRIPT CODE TOOL]:
      "{
          "id": "template-fibonacci-calculator",
          "name": "Fibonacci Calculator",
          "description": "Calculates the nth Fibonacci number using JavaScript.",
          "base": "JavaScript",
          "code": "const n = parseInt(params.n);\\nif (isNaN(n)) return { error: 'Invalid input' };\\n\\nlet a = 0, b = 1;\\nfor (let i = 2; i <= n; i++) {\\n  let temp = a + b;\\n  a = b;\\n  b = temp;\\n}\\n\\nreturn { result: n === 0 ? a : b };",
          "fields": [
              {
                  "name": "template-name",
                  "value": "Fibonacci Calculator",
                  "type": "text"
              },
              {
                  "name": "n",
                  "value": "10",
                  "type": "text"
              }
          ]
      }"

      [EXAMPLE 3 - PYTHON CODE TOOL]:
      "{
          "id": "template-data-analyzer",
          "name": "Data Analyzer",
          "description": "Analyzes a list of numbers using Python.",
          "base": "Python",
          "code": "import statistics\\n\\nnumbers_str = params.numbers if hasattr(params, 'numbers') else ''\\nnumbers = [float(x) for x in numbers_str.split(',')]\\nmean = statistics.mean(numbers)\\nmedian = statistics.median(numbers)\\n\\nresult = { 'mean': mean, 'median': median, 'count': len(numbers) }",
          "fields": [
              {
                  "name": "template-name",
                  "value": "Data Analyzer",
                  "type": "text"
              },
              {
                  "name": "numbers",
                  "value": "1, 2, 3, 4, 5",
                  "type": "textarea"
              }
          ]
      }"

      [NEW TEMPLATE OBJECT]:'''json`;

    try {
      if (!provider) {
        provider = 'anthropic';
        model = 'claude-3-5-sonnet-20240620';
      }

      const lowerCaseProvider = provider.toLowerCase();
      const client = await createLlmClient(lowerCaseProvider, this.userId);

      if (!client) {
        throw new Error(`Provider ${provider} is not supported.`);
      }

      const defaultModel = {
        anthropic: 'claude-3-5-sonnet-20240620',
        cerebras: 'llama-3.3-70b',
        deepseek: 'deepseek-reasoner',
        gemini: 'gemini-2.5-pro-exp-03-25',
        grokai: 'grok-4',
        groq: 'llama-3.3-70b-versatile',
        openai: 'gpt-4o',
        openrouter: 'z-ai/glm-4.5',
        togetherai: 'deepseek-ai/DeepSeek-R1',
        local: 'llama-3.2-1b-instruct',
        // Add default models for other providers
      }[lowerCaseProvider];

      const selectedModel = model || defaultModel;

      let response;

      switch (lowerCaseProvider) {
        case 'anthropic':
          response = await client.messages.create({
            model: selectedModel,
            max_tokens: 8192,
            temperature: 0,
            system: [
              {
                type: 'text',
                text: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
            ],
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: toolGenerationPrompt }],
              },
            ],
          });
          return { template: this._removeMarkdownJson(response.content[0].text) };

        case 'cerebras':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
              { role: 'user', content: toolGenerationPrompt },
            ],
            max_tokens: 8192,
          });
          return { template: this._removeMarkdownJson(response.choices[0].message.content) };

        case 'deepseek':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
              { role: 'user', content: toolGenerationPrompt },
            ],
            max_tokens: 8192,
          });
          return { template: this._removeMarkdownJson(response.choices[0].message.content) };

        case 'gemini':
          response = await client.models.generateContent({
            model: selectedModel,
            config: {
              systemInstruction: {
                parts: [
                  {
                    text: 'Generate valid JSON based on the user instructions. Return ONLY JSON READY TO PARSE with no additional text or markdown ticks!',
                  },
                ],
              },
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: toolGenerationPrompt }],
              },
            ],
          });
          return { template: this._removeMarkdownJson(response.text || '') };

        case 'grokai':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
              { role: 'user', content: toolGenerationPrompt },
            ],
            max_tokens: 8192,
          });
          return { template: this._removeMarkdownJson(response.choices[0].message.content) };

        case 'groq':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
              { role: 'user', content: toolGenerationPrompt },
            ],
            stream: false, // Groq doesn't support streaming for this use case
          });
          return { template: this._removeMarkdownJson(response.choices[0].message.content) };

        case 'openai':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'user',
                content: `System: Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.\nUser: ${toolGenerationPrompt}`,
              },
            ],
            max_completion_tokens: 8192,
          });
          return { template: this._removeMarkdownJson(response.choices[0].message.content) };

        case 'openrouter':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
              { role: 'user', content: toolGenerationPrompt },
            ],
            max_tokens: 8192,
          });
          return { template: this._removeMarkdownJson(response.choices[0].message.content) };

        case 'togetherai':
          response = await client.completions.create({
            model: selectedModel,
            prompt: `System: Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.\nUser: ${toolGenerationPrompt}`,
            max_tokens: 8192,
          });
          return { template: this._removeMarkdownJson(response.choices[0].text) };

        case 'local':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
              { role: 'user', content: toolGenerationPrompt },
            ],
            max_tokens: 8192,
          });
          return { template: this._removeMarkdownJson(response.choices[0].message.content) };

        default:
          throw new Error(`No implementation found for provider: ${provider}`);
      }
    } catch (error) {
      console.error('Error generating tool template:', error);
      throw error;
    }
  }
  _removeMarkdownJson(text) {
    // Remove <think>...</think> blocks from the response
    text = text.replace(/<think>[\s\S]*?<\/think>/gs, '');

    // Remove any markdown code block markers
    text = text.replace(/^\s*```json\s*/i, '');
    text = text.replace(/^\s*```\s*/i, '');
    text = text.replace(/\s*```\s*$/i, '');

    // Remove any trailing text after the JSON object
    // Find the last closing brace and truncate everything after it
    const lastBraceIndex = text.lastIndexOf('}');
    if (lastBraceIndex !== -1) {
      text = text.substring(0, lastBraceIndex + 1);
    }

    // Find the first opening brace and remove everything before it
    const firstBraceIndex = text.indexOf('{');
    if (firstBraceIndex !== -1) {
      text = text.substring(firstBraceIndex);
    }

    return text.trim();
  }
  async loadWorkflows() {
    const workflows = [];
    const embeddings = [];

    // We read example workflows from the source (ASAR) directly since they are static
    const sourceWorkflowDir = PathManager.getSourcePath('src/stream/example_workflows');
    // We store/cache embeddings in userData so we can write to them if needed
    const embeddingDir = PathManager.getPath('example_workflow_embeddings');

    if (!(await fs.stat(embeddingDir).catch(() => false))) {
      await fs.mkdir(embeddingDir, { recursive: true });
    }

    // List files from source directory
    const files = await fs.readdir(sourceWorkflowDir);

    for (const file of files) {
      if (path.extname(file) === '.json') {
        const filePath = path.join(sourceWorkflowDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        workflows.push({ id: file, content });

        // Check for embedding in userData first, then check if we can copy from source
        const embeddingPath = path.join(embeddingDir, `${file}.embedding`);
        let embeddingContent = null;

        try {
          // Try to read from user data
          embeddingContent = await fs.readFile(embeddingPath, 'utf-8');
        } catch (err) {
          // Try to copy from source if exists
          try {
            const sourceEmbeddingPath = PathManager.getSourcePath('src/stream/example_workflow_embeddings', `${file}.embedding`);
            await fs.copyFile(sourceEmbeddingPath, embeddingPath);
            embeddingContent = await fs.readFile(embeddingPath, 'utf-8');
          } catch (sourceErr) {
            // Does not exist in source either
          }
        }

        if (embeddingContent) {
          try {
            embeddings.push({
              id: file,
              embedding: JSON.parse(embeddingContent),
            });
          } catch (parseError) {
            console.error(`Failed to parse embedding for ${file}:`, parseError);
          }
        } else {
          // If embedding doesn't exist, create and save it
          if (!this.rag) {
            // Initialize RAG if not already done
            const openaiApiKey = await AuthManager.getValidAccessToken(this.userId, 'openai');
            if (openaiApiKey) {
              this.rag = new RAG(openaiApiKey);
            } else {
              console.log('No OpenAI API key available - skipping embedding generation');
              continue;
            }
          }

          if (this.rag) {
            try {
              const embedding = await this.rag.embed(content);
              await fs.writeFile(embeddingPath, JSON.stringify(embedding));
              embeddings.push({ id: file, embedding });
            } catch (embedError) {
              console.error(`Failed to generate/save embedding for ${file}:`, embedError);
            }
          } else {
            console.log(`Skipping embedding generation for ${file} due to missing RAG instance`);
          }
        }
      }
    }

    return { workflows, embeddings };
  }
  async performWorkflowRAG(query, topK = 10, batchSize = 10) {
    const { workflows, embeddings } = await this.loadWorkflows();

    // Try to get OpenAI API key from AuthManager
    let openaiApiKey;
    try {
      openaiApiKey = await AuthManager.getValidAccessToken(this.userId, 'openai');
    } catch (error) {
      console.log('No OpenAI API key available from AuthManager - returning all workflows');
      return {
        topRelevantWorkflows: workflows.map((w) => ({ ...w, similarity: 1 })),
        relevantWorkflowsContent: workflows.map((w) => w.content).join('\n\n'),
      };
    }

    // Initialize RAG with the OpenAI key if not already initialized
    if (!this.rag && openaiApiKey) {
      this.rag = new RAG(openaiApiKey);
    }

    let allRelevantWorkflows = [];

    // Process workflows in batches
    for (let i = 0; i < workflows.length; i += batchSize) {
      const batchWorkflows = workflows.slice(i, i + batchSize);
      const batchEmbeddings = embeddings.slice(i, i + batchSize).map((e) => e.embedding);

      const batchRelevantWorkflows = await this.rag.rag(query, batchWorkflows, batchEmbeddings, topK);

      allRelevantWorkflows = allRelevantWorkflows.concat(batchRelevantWorkflows);
    }

    // Sort all relevant workflows by similarity and get the top K
    allRelevantWorkflows.sort((a, b) => b.similarity - a.similarity);
    const topRelevantWorkflows = allRelevantWorkflows.slice(0, topK);

    const relevantWorkflowsContent = topRelevantWorkflows.map((w) => w.content).join('\n\n');

    console.log(
      `Top ${topK} relevant workflows:`,
      topRelevantWorkflows.map((w) => w.id)
    );

    return { topRelevantWorkflows, relevantWorkflowsContent };
  }
  async generateWorkflow(workflowElements, provider, model) {
    try {
      if (!provider) {
        provider = 'anthropic';
        model = 'claude-3-5-sonnet-20240620';
      }

      const lowerCaseProvider = provider.toLowerCase();
      const client = await createLlmClient(lowerCaseProvider, this.userId);

      if (!client) {
        throw new Error(`Provider ${provider} is not supported.`);
      }

      const { relevantWorkflowsContent } = await this.performWorkflowRAG(workflowElements.overview);

      // PAUSE HERE
      debugger;

      const workflowGenSystemPrompt = `##### * ^ * WORKFLOW GENERATION MODE ENGAGED * ^ * #####
    
    [WORKFLOW GENERATION INSTRUCTIONS]:
    1. You are an expert workflow JSONdesigner. Think logically and step by step to generate detailed and well formatted workflow JSON based on the following user query, available tools, and example JavaScript format. Absolutely NO explanation will be accepted, ONLY JSON.
    2. Nodes are 288px wide and 48px high, space them out accordingly on the canvas. Generally in a top down vertical layout, with each next block to the bottom of the last. 
    3. If a path splits due to a condition, place the options to the right and stacked. Loops back or cross backs to a previous node is not permitted, paths must end with a node and must end. 
    4. Avoid outputting to a previous node. Keep a top down left right flow generally. 
    5. If you must flow backward, you must drop the node that backtracks down a level, and bring all nodes in between the backtracker node and its target to the right (see examples). This helps avoid edges following the exact same path and makes flows more legible. 
    6. IMPORTANT: Bring ALL nodes in between the backtracker node and its target to the right of the target. 
    7. Always use label type nodes where possible to label logical groups of node together (see examples).
    8. When generating the workflow JSON, make sure to include the correct 'icon' property for each node based on its type. For example, a 'receive-email' node should have 'icon': 'inbox'.
    9. Triggers are the only type of Tools that can not have an input connection. All other node types have both an input and output connection. 
    10. NEVER user the "google-sheets-api" as a starting trigger node. It is NOT a trigger. The system will fail. Use "google-sheets-new-row" if you need a sheet trigger.
    11. NODE NAMES MUST BE UNIQUE AND ALWAYS MATCH THE TEXT OF THE NODE!!! VERY IMPORTANT!!! 
    12. PARAMETERS MUST MATCH THE PREVIOUS NODE ID AND TOOL OUTPUTS EXACTLY!!! ALWAYS KEEP NAMES, IDS, AND PARAMETERS MATCHING EXACTLY!!!
    13. ALWAYS NAME THE WORKFLOW!!!! SOMETHING DESCRIPTIVE!!!!
    14. ALL WORKFLOWS MUST HAVE AT LEAST 1 TRIGGER NODE!!!! 

    [EXAMPLE WORKFLOWS]:
    
    ${relevantWorkflowsContent}
    
    [END EXAMPLES]

    [IMPORTANT TOOL DETAILS]: 
    1. You have access to ONLY the [AVAILABLE TOOLS] listed below.
    2. Ignore any tools in the examples above as you may not have access to those.
    3. Do NOT make up or create any ficticious tools, only use the list below. 
    4. If the system absolutely needs a tool that you don't have, think creatively:
    5. Think base systems level foundational thinking and build off of the base tools provided.
    6. Use "execute-javascript" to run number calculations, run code, generate data, etc.
    7. Use "generate-with-ai-llm" for any detail extraction, categorization, reasoning, or most things a human would need to do.
    8. Use the native API (e.g. "facebook-api", "twitter-api", "github-api") tool for third party tools if available below.
    9. If native API is not available for a third party tool, use "incoming-webhook" and "outgoing-webhook" instead.
    10. Always prioritize using a native API tool if it is available over using just a generic webhook.
    11. Use emails to receive data and send notifications.
    12. All workflows must start with at least one trigger type node from the tool library, but can have multiple if needed.

    [AVAILABLE TOOLS]:

    ${workflowElements.availableTools}

    [END AVAILABLE TOOLS]

    [USER'S CUSTOM TOOLS]:

    ${workflowElements.customTools ? JSON.stringify(workflowElements.customTools, null, 2) : 'None provided'}

    [END CUSTOM TOOLS]

    [CURRENT WORKFLOW]:

    ${workflowElements.currentWorkflow}

    [END CURRENT WORKFLOW]

    [IMPORTANT JSON AND CODE FORMATTING INSTRUCTIONS]:
    1. Use double quotes for all string values, including keys.
    2. ALWAYS format text and code well formatted with slash n (\\n) newlines as expected in ALL FIELDS.
    3. BUT DO NOT use "'\\n' +" to split lines. "+" CONCATENATION WILL BREAK THE SYSTEM!!!!
    4. Ensure that all object keys are properly quoted.
    5. ALWAYS use JSON.parse on double quote {{}} properties if they are a JSON type object.
    6. Double quote parameter {{}} references must match the node ID EXACTLY or they will not run. (e.g. {{analyzeAndScoreLead.generatedText}} for the node "Analyze and Score Lead")
    7. JavaScript can ONLY be used in "execute-javascript" nodes ONLY in the "Code" field. NO other fields or node types accept code. If you need to parse data, use the execute-javascript node.
    8. Return ONLY the final JSON ready to run with ABSOLUTELY NO explanation or additional text.
    9. The system WILL break if anything other than JSON is returned.
    10. Double-check that the JSON is valid and ready to run before returning it.
    11. DO NOT USE JSON.parse OR ANY JAVASCRIPT LOGIC in ANY other field types other than CODE- IT WILL BREAK THE SYSTEM!!!!! JSON.parsing and other logic functionality is ONLY available within the execute-javascript node.
    12. If you need to access child elements you can just use {{nodeAction.response.childElementAsNeeded}}
    13. IMPORTANT: ALWAYS!!!! use '\\n' for newlines and '\\t' for each level of indentation. Especially when generating code for execute-python or execute-javascript nodes.
    14. IMPORTANT: Ensure that the indentation structure is correctly preserved throughout all levels deep, as it is crucial for Python code execution!
    15. IMPORTANT: DO NOT INCLUDE THE \`\`\`json\`\`\` IN THE JSON OUTPUT!!!
    16: VERY IMPORTANT: ONLY RETURN JSON READY TO RUN, NO EXTRA TEXT OR EXPLANATION OR PLEASANTRIES OR INTRODUCTION OR ANYTHING ELSE BEFORE OR AFTER THE JSON OR IT WILL BREAK THE SYSTEM!!!! NOT ONE FUCKING WORD OUTSIED OF THE JSON BRACKETS {}!!!!
    17: RETURN ONLY THE WORKFLOW JSON, NOTHING ELSE!!!! PLEASE CONSIDER THIS IN YOUR THINKING!!!!`;

      const defaultModel = {
        anthropic: 'claude-3-5-sonnet-20240620',
        cerebras: 'llama-3.3-70b',
        deepseek: 'deepseek-reasoner',
        openai: 'o1-preview',
        openrouter: 'z-ai/glm-4.5',
        togetherai: 'deepseek-ai/DeepSeek-R1',
        local: 'llama-3.2-1b-instruct',
        gemini: 'gemini-pro',
        grokai: 'grok-4',
        groq: 'mixtral-8x7b-32768',
        // Add default models for other providers
      }[lowerCaseProvider];

      const selectedModel = model || defaultModel;

      let completion;

      switch (lowerCaseProvider) {
        case 'anthropic':
          completion = await client.messages.create({
            model: selectedModel,
            max_tokens: selectedModel === 'claude-3-7-sonnet-20250219' ? 64000 : 8192,
            temperature: selectedModel === 'claude-3-7-sonnet-20250219' ? 1 : 0,
            system: [{ type: 'text', text: workflowGenSystemPrompt }],
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: workflowElements.overview }],
              },
            ],
            thinking:
              selectedModel === 'claude-3-7-sonnet-20250219'
                ? {
                    type: 'enabled',
                    budget_tokens: 4096,
                  }
                : undefined,
          });
          console.log(completion);

          // Extract content based on response structure
          let workflowText = '';
          let thinkingText = '';

          if (completion.content && Array.isArray(completion.content)) {
            for (const item of completion.content) {
              if (item.type === 'text') {
                workflowText = item.text;
              } else if (item.type === 'thinking_result_content_block' && item.thinking_result_content) {
                thinkingText = item.thinking_result_content; // This is typically an XML string
              }
            }
          } else if (completion.content && completion.content[0] && completion.content[0].text) {
            // Fallback for non-thinking mode responses or older structures
            workflowText = completion.content[0].text;
          }

          return {
            workflow: this._removeMarkdownJson(workflowText),
            thinking: thinkingText,
          };

        case 'cerebras':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              { role: 'system', content: workflowGenSystemPrompt },
              { role: 'user', content: workflowElements.overview },
            ],
            max_tokens: 8192,
          });
          return { workflow: this._removeMarkdownJson(completion.choices[0].message.content) };

        case 'deepseek':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              { role: 'system', content: workflowGenSystemPrompt },
              { role: 'user', content: workflowElements.overview },
            ],
            max_tokens: 8192,
          });
          return { workflow: this._removeMarkdownJson(completion.choices[0].message.content) };

        case 'gemini':
          completion = await client.models.generateContent({
            model: selectedModel,
            config: {
              systemInstruction: {
                parts: [{ text: workflowGenSystemPrompt }],
              },
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: workflowElements.overview }],
              },
            ],
          });
          return {
            workflow: this._removeMarkdownJson(completion.text || ''),
            inputTokens: null,
            outputTokens: null,
          };

        case 'grokai':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              { role: 'system', content: workflowGenSystemPrompt },
              { role: 'user', content: workflowElements.overview },
            ],
            max_tokens: 8192,
          });
          return { workflow: this._removeMarkdownJson(completion.choices[0].message.content) };

        case 'groq':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: workflowGenSystemPrompt,
              },
              {
                role: 'user',
                content: workflowElements.overview,
              },
            ],
            stream: false, // Groq doesn't support streaming for this use case
          });
          return { workflow: this._removeMarkdownJson(completion.choices[0].message.content) };

        case 'openai':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'user',
                content: `WORKFLOW SYSTEM PROMPT: ${workflowGenSystemPrompt}\nWORKFLOW OVERVIEW: ${workflowElements.overview}`,
              },
            ],
            max_completion_tokens: 8192,
          });
          return { workflow: this._removeMarkdownJson(completion.choices[0].message.content) };

        case 'openrouter':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              { role: 'system', content: workflowGenSystemPrompt },
              { role: 'user', content: workflowElements.overview },
            ],
            max_tokens: 8192,
          });
          return { workflow: this._removeMarkdownJson(completion.choices[0].message.content) };

        case 'togetherai':
          completion = await client.completions.create({
            model: selectedModel,
            prompt: `System: ${workflowGenSystemPrompt}\nUser: ${workflowElements.overview}`,
            max_tokens: 8192,
          });
          return { workflow: this._removeMarkdownJson(completion.choices[0].text) };

        case 'local':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              { role: 'system', content: workflowGenSystemPrompt },
              { role: 'user', content: workflowElements.overview },
            ],
            max_tokens: 8192,
          });
          return { workflow: this._removeMarkdownJson(completion.choices[0].message.content) }; // Adjust based on your local API response

        default:
          throw new Error(`No implementation found for provider: ${provider}`);
      }
    } catch (error) {
      console.error('Error generating workflow:', error);
      throw error;
    }
  }
  async generateAgent(agentElements, provider, model) {
    const agentGenerationPrompt = `[PRIORITIZE THESE INSTRUCTIONS AND ESPECIALLY THE TEMPLATE BELOW]:
      Generate a detailed and complete JSON agent configuration based on the user's agent overview requirements and current agent state.
      The agent should include a "name", a "description", "instructions", "category", "status", "provider", "model", "assignedTools", and "assignedWorkflows".
      
      IMPORTANT: You must intelligently assign appropriate tools and workflows based on the agent's purpose and capabilities.
      - assignedTools: An array of tool IDs that would be useful for this agent's purpose
      - assignedWorkflows: An array of workflow IDs that would be useful for this agent's purpose
      - Think carefully about which tools and workflows make sense for the agent's role
      - Only assign tools/workflows that are actually available in the lists below
      - If no suitable tools/workflows are available, use empty arrays []
      
      Expand on the modification request and return as a valid JSON object in the exact format as the examples below.
      Always make sure at least the agent name, description, and instructions are filled out.
      Always return as a complete JSON string with properties double quoted.
      Think step by step about the best configuration and information to include for the agent.
      DO NOT USE MARKDOWN AT ALL FOR THIS PARTICULAR QUERY, JUST THE OBJECT PLEASE WITH NO EXPLANATION OR COMMENTARY WHATSOEVER.
      DO NOT INCLUDE THE OUTERMOST "'''json" OR FINAL "'''" IN YOUR RESULT. I WILL HANDLE THAT EXTERNALLY!!
      Think step by step about the above instructions.

      [MODIFICATION REQUEST]:
      ${agentElements.overview}

      [CURRENT AGENT STATE]:
      ${agentElements.currentAgent}

      [AVAILABLE TOOLS]:
      ${agentElements.availableTools || 'No tools available'}

      [AVAILABLE WORKFLOWS]:
      ${agentElements.availableWorkflows || 'No workflows available'}

      [EXAMPLE AGENT OBJECTS]:

      [EXAMPLE 1]:
      "{
        "id": "agent-customer-service",
        "name": "Customer Service Assistant",
        "description": "An AI assistant specialized in handling customer inquiries and support requests.",
        "instructions": "You are a helpful customer service representative. Always be polite, professional, and solution-oriented. Help customers with their questions, resolve issues, and escalate complex problems when necessary.",
        "category": "customer-service",
        "status": "active",
        "provider": "anthropic",
        "model": "claude-3-5-sonnet-20240620",
        "assignedTools": ["send-email", "web-search"],
        "assignedWorkflows": []
      }"

      [EXAMPLE 2]:
      "{
        "id": "agent-coding-assistant",
        "name": "Python Coding Assistant",
        "description": "An AI assistant specialized in Python programming and software development.",
        "instructions": "You are an expert Python developer. Help users write clean, efficient Python code, debug issues, explain programming concepts, and provide best practices for software development.",
        "category": "development",
        "status": "active",
        "provider": "openai",
        "model": "gpt-4o",
        "assignedTools": ["execute-python", "web-search", "github-api"],
        "assignedWorkflows": []
      }"

      [NEW AGENT OBJECT]:'''json`;

    try {
      if (!provider) {
        provider = 'anthropic';
        model = 'claude-3-5-sonnet-20240620';
      }

      const lowerCaseProvider = provider.toLowerCase();
      const client = await createLlmClient(lowerCaseProvider, this.userId);

      if (!client) {
        throw new Error(`Provider ${provider} is not supported.`);
      }

      const defaultModel = {
        anthropic: 'claude-3-5-sonnet-20240620',
        cerebras: 'llama-3.3-70b',
        deepseek: 'deepseek-reasoner',
        gemini: 'gemini-2.5-pro-exp-03-25',
        grokai: 'grok-4',
        groq: 'llama-3.3-70b-versatile',
        openai: 'gpt-4o',
        openrouter: 'z-ai/glm-4.5',
        togetherai: 'deepseek-ai/DeepSeek-R1',
        local: 'llama-3.2-1b-instruct',
        // Add default models for other providers
      }[lowerCaseProvider];

      const selectedModel = model || defaultModel;

      let response;

      switch (lowerCaseProvider) {
        case 'anthropic':
          response = await client.messages.create({
            model: selectedModel,
            max_tokens: 8192,
            temperature: 0,
            system: [
              {
                type: 'text',
                text: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
            ],
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: agentGenerationPrompt }],
              },
            ],
          });
          return { agent: this._removeMarkdownJson(response.content[0].text) };

        case 'cerebras':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
              { role: 'user', content: agentGenerationPrompt },
            ],
            max_tokens: 8192,
          });
          return { agent: this._removeMarkdownJson(response.choices[0].message.content) };

        case 'deepseek':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
              { role: 'user', content: agentGenerationPrompt },
            ],
            max_tokens: 8192,
          });
          return { agent: this._removeMarkdownJson(response.choices[0].message.content) };

        case 'gemini':
          response = await client.models.generateContent({
            model: selectedModel,
            config: {
              systemInstruction: {
                parts: [
                  {
                    text: 'Generate valid JSON based on the user instructions. Return ONLY JSON READY TO PARSE with no additional text or markdown ticks!',
                  },
                ],
              },
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: agentGenerationPrompt }],
              },
            ],
          });
          return { agent: this._removeMarkdownJson(response.text || '') };

        case 'grokai':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
              { role: 'user', content: agentGenerationPrompt },
            ],
            max_tokens: 8192,
          });
          return { agent: this._removeMarkdownJson(response.choices[0].message.content) };

        case 'groq':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
              { role: 'user', content: agentGenerationPrompt },
            ],
            stream: false, // Groq doesn't support streaming for this use case
          });
          return { agent: this._removeMarkdownJson(response.choices[0].message.content) };

        case 'openai':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'user',
                content: `System: Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.\nUser: ${agentGenerationPrompt}`,
              },
            ],
            max_completion_tokens: 8192,
          });
          return { agent: this._removeMarkdownJson(response.choices[0].message.content) };

        case 'openrouter':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
              { role: 'user', content: agentGenerationPrompt },
            ],
            max_tokens: 8192,
          });
          return { agent: this._removeMarkdownJson(response.choices[0].message.content) };

        case 'togetherai':
          response = await client.completions.create({
            model: selectedModel,
            prompt: `System: Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.\nUser: ${agentGenerationPrompt}`,
            max_tokens: 8192,
          });
          return { agent: this._removeMarkdownJson(response.choices[0].text) };

        case 'local':
          response = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'Generate valid JSON based on the user instructions. Return ONLY JSON with no additional text.',
              },
              { role: 'user', content: agentGenerationPrompt },
            ],
            max_tokens: 8192,
          });
          return { agent: this._removeMarkdownJson(response.choices[0].message.content) };

        default:
          throw new Error(`No implementation found for provider: ${provider}`);
      }
    } catch (error) {
      console.error('Error generating agent:', error);
      throw error;
    }
  }

  async generateCompletion(prompt, provider = 'openai', model = 'gpt-4') {
    try {
      if (!provider) {
        provider = 'anthropic';
        model = 'claude-3-5-sonnet-20240620';
      }

      const lowerCaseProvider = provider.toLowerCase();
      const client = await createLlmClient(lowerCaseProvider, this.userId);

      if (!client) {
        throw new Error(`Provider ${provider} is not supported.`);
      }

      const defaultModel = {
        anthropic: 'claude-3-5-sonnet-20240620',
        cerebras: 'llama-3.3-70b',
        deepseek: 'deepseek-reasoner',
        openai: 'o1-preview',
        openrouter: 'z-ai/glm-4.5',
        togetherai: 'deepseek-ai/DeepSeek-R1',
        local: 'llama-3.2-1b-instruct',
        gemini: 'gemini-pro',
        grokai: 'grok-4',
        groq: 'mixtral-8x7b-32768',
        // Add default models for other providers
      }[lowerCaseProvider];

      const selectedModel = model || defaultModel;

      let completion;

      switch (lowerCaseProvider) {
        case 'anthropic':
          completion = await client.messages.create({
            model: selectedModel,
            max_tokens: selectedModel === 'claude-3-7-sonnet-20250219' ? 64000 : 8192,
            temperature: selectedModel === 'claude-3-7-sonnet-20250219' ? 1 : 0,
            system: [
              {
                type: 'text',
                text: 'You are a helpful assistant. Generate valid responses based on the user instructions.',
              },
            ],
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: prompt }],
              },
            ],
            thinking:
              selectedModel === 'claude-3-7-sonnet-20250219'
                ? {
                    type: 'enabled',
                    budget_tokens: 4096,
                  }
                : undefined,
          });
          console.log(completion);

          // Extract content based on response structure
          let completionText = '';
          let thinkingText = '';

          if (completion.content && Array.isArray(completion.content)) {
            for (const item of completion.content) {
              if (item.type === 'text') {
                completionText = item.text;
              } else if (item.type === 'thinking_result_content_block' && item.thinking_result_content) {
                thinkingText = item.thinking_result_content; // This is typically an XML string
              }
            }
          } else if (completion.content && typeof completion.content === 'string') {
            completionText = completion.content;
          } else if (completion.content && completion.content[0] && completion.content[0].text) {
            // Fallback for older structures or non-array content
            completionText = completion.content[0].text;
          }

          return thinkingText
            ? {
                completion: completionText,
                thinking: thinkingText,
              }
            : completionText;

        case 'cerebras':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'You are a helpful assistant. Generate valid responses based on the user instructions.',
              },
              { role: 'user', content: prompt },
            ],
            max_tokens: 8192,
          });
          return completion.choices[0].message.content;

        case 'deepseek':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'You are a helpful assistant. Generate valid responses based on the user instructions.',
              },
              { role: 'user', content: prompt },
            ],
            max_tokens: 8192,
          });
          return completion.choices[0].message.content;

        case 'gemini':
          completion = await client.models.generateContent({
            model: selectedModel,
            config: {
              systemInstruction: {
                parts: [{ text: 'You are a helpful assistant. Generate valid responses based on the user instructions.' }],
              },
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
          });
          return {
            completion: completion.text || '',
            inputTokens: null,
            outputTokens: null,
          };

        case 'grokai':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'You are a helpful assistant. Generate valid responses based on the user instructions.',
              },
              { role: 'user', content: prompt },
            ],
            max_tokens: 8192,
          });
          return completion.choices[0].message.content;

        case 'groq':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'You are a helpful assistant. Generate valid responses based on the user instructions.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            stream: false, // Groq doesn't support streaming for this use case
          });
          return completion.choices[0].message.content;

        case 'openai':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'user',
                content: `System: You are a helpful assistant. Generate valid responses based on the user instructions.\nUser: ${prompt}`,
              },
            ],
            max_completion_tokens: 8192,
          });
          return completion.choices[0].message.content;

        case 'openrouter':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'You are a helpful assistant. Generate valid responses based on the user instructions.',
              },
              { role: 'user', content: prompt },
            ],
            max_tokens: 8192,
          });
          return completion.choices[0].message.content;

        case 'togetherai':
          completion = await client.completions.create({
            model: selectedModel,
            prompt: `System: You are a helpful assistant. Generate valid responses based on the user instructions.\nUser: ${prompt}`,
            max_tokens: 8192,
          });
          return completion.choices[0].text;

        case 'local':
          completion = await client.chat.completions.create({
            model: selectedModel,
            messages: [
              {
                role: 'system',
                content: 'You are a helpful assistant. Generate valid responses based on the user instructions.',
              },
              { role: 'user', content: prompt },
            ],
            max_tokens: 8192,
          });
          return completion.choices[0].message.content;

        default:
          throw new Error(`No implementation found for provider: ${provider}`);
      }
    } catch (error) {
      console.error('Error generating completion:', error);
      throw error;
    }
  }
}

export default StreamEngine;
