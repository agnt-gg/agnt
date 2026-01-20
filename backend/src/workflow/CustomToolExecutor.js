import GenerateWithAiLlm from '../tools/library/actions/generate-with-ai-llm.js';
import ExecuteJavaScript from '../tools/library/utilities/execute-javascript.js';
import ExecutePython from '../tools/library/utilities/execute-python.js';

class CustomToolExecutor {
  constructor(workflowEngine) {
    this.workflowEngine = workflowEngine;
  }

  async execute(node, inputData) {
    const base = node.base || 'AI';
    console.log(`Executing tool with base type: ${base}`, node);

    switch (base) {
      case 'AI':
        return await this.executeAITool(node, inputData);
      case 'CODE_JS':
        return await this.executeJavaScriptTool(node, inputData);
      case 'CODE_PYTHON':
        return await this.executePythonTool(node, inputData);
      default:
        throw new Error(`Unknown tool base type: ${base}`);
    }
  }

  async executeAITool(node, inputData) {
    const { parameters } = node;

    // Resolve all parameter values
    const resolvedParams = {};
    let imageData = null;

    for (const [key, value] of Object.entries(parameters)) {
      //   console.log(`Key: ${key}`);
      //   console.log(`Value:`, value);
      //   console.log(`Type:`, value.type);

      if (typeof value === 'object' && (value.type === 'file' || value.filename)) {
        if (value.type.startsWith('image/')) {
          // For image files, process the data
          imageData = await this.processImageData(value);
          console.log('Image type:', imageData.type);
          console.log('Image data:', imageData.data.substring(0, 100) + '...');
          resolvedParams[key] = `[Image: ${value.filename}]`; // Placeholder in the prompt
        } else {
          // For other file types, use the text content directly
          resolvedParams[key] = value.text;
        }
      } else if (typeof value === 'object' && value.type === 'textarea') {
        resolvedParams[key] = await this.workflowEngine.parameterResolver.resolveTemplate(value.value);
      } else if (typeof value === 'object' && value.type === 'text') {
        resolvedParams[key] = value.value;
      } else {
        resolvedParams[key] = await this.workflowEngine.parameterResolver.resolveTemplate(value);
      }
    }

    console.log('Resolved params:', resolvedParams); // For debugging

    // Check if this is actually a code tool that was misrouted
    if (node.code) {
      console.log('Warning: AI tool execution called on node with code. This may be a misrouted code tool.');
      // Try to execute as code tool instead
      try {
        return await this.executeJavaScriptTool(node, inputData);
      } catch (jsError) {
        console.log('JavaScript execution failed, trying Python...');
        try {
          return await this.executePythonTool(node, inputData);
        } catch (pyError) {
          console.error('Both JavaScript and Python execution failed.');
          throw new Error('Tool appears to be a code tool but failed to execute as both JavaScript and Python.');
        }
      }
    }

    let prompt = resolvedParams['instructions'] || '';

    // Add all custom fields to the prompt
    prompt += '\n\nParameters:';
    for (const [key, value] of Object.entries(resolvedParams)) {
      if (key !== 'instructions' && key !== 'provider' && key !== 'model') {
        prompt += `\n${key}: ${value}`;
      }
    }

    console.log('Final prompt:', prompt); // For debugging

    // If an image is present, use a provider model that supports image analysis
    if (imageData) {
      resolvedParams['provider'] = 'anthropic';
      resolvedParams['model'] = 'claude-3-5-sonnet-20240620'; // or another appropriate model that supports image analysis
    }

    // Only validate provider for actual AI tools (not code tools that were misrouted)
    if (!node.code && !resolvedParams['provider']) {
      throw new Error('Provider is required for AI LLM generation');
    }

    try {
      const result = await GenerateWithAiLlm.execute(
        {
          prompt: prompt,
          provider: resolvedParams['provider'],
          model: resolvedParams['model'],
          maxTokens: resolvedParams['maxTokens'],
          temperature: resolvedParams['temperature'],
          image: imageData,
        },
        inputData,
        this.workflowEngine
      );

      return result;
    } catch (error) {
      console.error('Error executing AI tool:', error);
      return { error: error.message };
    }
  }

  async executeJavaScriptTool(node, inputData) {
    try {
      const { parameters, code } = node;

      // Resolve all parameter values
      const resolvedParams = {};
      for (const [key, value] of Object.entries(parameters)) {
        if (typeof value === 'object' && value !== null) {
          // Extract the actual value from parameter objects
          if (value.type === 'textarea' || value.type === 'text' || value.type === 'select' || value.type === 'number') {
            resolvedParams[key] = await this.workflowEngine.parameterResolver.resolveTemplate(value.value || '');
          } else if (value.value !== undefined) {
            resolvedParams[key] = await this.workflowEngine.parameterResolver.resolveTemplate(value.value);
          } else {
            // If it's an object without a value property, try to resolve it as-is
            resolvedParams[key] = await this.workflowEngine.parameterResolver.resolveTemplate(value);
          }
        } else {
          resolvedParams[key] = await this.workflowEngine.parameterResolver.resolveTemplate(value);
        }
      }

      // Build code context with resolved parameters
      const codeWithContext = this.buildCodeContext(code, resolvedParams, inputData);

      const result = await ExecuteJavaScript.execute({ code: codeWithContext }, inputData, this.workflowEngine);

      return result;
    } catch (error) {
      console.error('Error executing JavaScript tool:', error);
      return { error: error.message };
    }
  }

  async executePythonTool(node, inputData) {
    try {
      const { parameters, code } = node;

      // Resolve all parameter values
      const resolvedParams = {};
      for (const [key, value] of Object.entries(parameters)) {
        if (typeof value === 'object' && value !== null) {
          // Extract the actual value from parameter objects
          if (value.type === 'textarea' || value.type === 'text' || value.type === 'select' || value.type === 'number') {
            resolvedParams[key] = await this.workflowEngine.parameterResolver.resolveTemplate(value.value || '');
          } else if (value.value !== undefined) {
            resolvedParams[key] = await this.workflowEngine.parameterResolver.resolveTemplate(value.value);
          } else {
            // If it's an object without a value property, try to resolve it as-is
            resolvedParams[key] = await this.workflowEngine.parameterResolver.resolveTemplate(value);
          }
        } else {
          resolvedParams[key] = await this.workflowEngine.parameterResolver.resolveTemplate(value);
        }
      }

      // Build code context with resolved parameters (pass 'python' as language)
      const codeWithContext = this.buildCodeContext(code, resolvedParams, inputData, 'python');

      const result = await ExecutePython.execute({ code: codeWithContext }, inputData, this.workflowEngine);

      return result;
    } catch (error) {
      console.error('Error executing Python tool:', error);
      return { error: error.message };
    }
  }

  buildCodeContext(code, resolvedParams, inputData, language = 'javascript') {
    // Make parameters available through the params object
    // This avoids variable name conflicts with user code
    let contextCode = '';

    if (language === 'python') {
      // Python syntax
      contextCode += '# Resolved parameters from workflow\n';
      contextCode += `params = ${JSON.stringify(resolvedParams)}\n`;
      contextCode += '\n# User code\n';
    } else {
      // JavaScript syntax
      contextCode += '// Resolved parameters from workflow\n';
      contextCode += `const params = ${JSON.stringify(resolvedParams)};\n`;
      contextCode += '\n// User code\n';
    }

    contextCode += code;

    return contextCode;
  }
  async processImageData(fileData) {
    if (fileData && fileData.type && fileData.type.startsWith('image/') && fileData.text) {
      return {
        type: fileData.type,
        data: fileData.text.split(',')[1], // Remove the "data:image/jpeg;base64," part
      };
    }
    return null;
  }
}

export default CustomToolExecutor;
