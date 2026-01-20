import BaseAction from '../BaseAction.js';

class CodePreview extends BaseAction {
  static schema = {
    title: 'Code Preview',
    category: 'utility',
    type: 'code-preview',
    icon: 'code',
    description:
      'Displays syntax-highlighted code with language detection. Supports drag & drop of code files and auto-detects programming language from file extensions.',
    parameters: {
      codeSource: {
        type: 'code',
        inputType: 'textarea',
        description: 'Code content to display. Supports drag & drop of code files (.js, .py, .java, .html, .css, etc.)',
      },
      language: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        options: ['javascript', 'typescript', 'python', 'java', 'csharp', 'cpp', 'html', 'css', 'json', 'markdown', 'sql', 'bash', 'plaintext'],
        default: 'javascript',
        description: 'Programming language for syntax highlighting',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the code was successfully processed',
      },
      codeContent: {
        type: 'string',
        description: 'The code content',
      },
      language: {
        type: 'string',
        description: 'The detected or specified programming language',
      },
      metadata: {
        type: 'object',
        description: 'Code metadata including line count, complexity, and detected features (functions, classes, comments)',
      },
      error: {
        type: 'string',
        description: 'Error message if code processing failed',
      },
    },
  };

  constructor() {
    super('code-preview');
  }

  async execute(params, inputData, workflowEngine) {
    console.log('💻 CodePreview execute called with params:', JSON.stringify(params).substring(0, 200) + '...');
    try {
      // Validate input
      if (!params.codeSource) {
        console.error('❌ CodePreview: No code source provided');
        return {
          success: false,
          error: 'No code source provided',
          codeContent: null,
          language: null,
          metadata: null,
        };
      }

      const codeSource = params.codeSource.trim();
      const language = params.language || 'plaintext';

      console.log('🔍 CodePreview: Processing code source:', {
        type: typeof codeSource,
        length: codeSource.length,
        language,
      });

      // Initialize result object
      const result = {
        success: true,
        codeContent: codeSource,
        language: language,
        metadata: {
          lineCount: 0,
          characterCount: 0,
          hasComments: false,
          hasFunctions: false,
          hasClasses: false,
          estimatedComplexity: 'low',
        },
        error: null,
      };

      // Extract metadata from code
      result.metadata = this.extractCodeMetadata(codeSource, language);

      return result;
    } catch (error) {
      console.error('❌ CodePreview error:', error);
      return {
        success: false,
        error: error.message,
        codeContent: null,
        language: null,
        metadata: null,
      };
    }
  }

  extractCodeMetadata(code, language) {
    const metadata = {
      lineCount: 0,
      characterCount: code.length,
      hasComments: false,
      hasFunctions: false,
      hasClasses: false,
      estimatedComplexity: 'low',
      language: language,
    };

    try {
      // Count lines
      const lines = code.split('\n');
      metadata.lineCount = lines.length;

      // Detect comments based on language
      const commentPatterns = {
        javascript: [/\/\//, /\/\*[\s\S]*?\*\//],
        typescript: [/\/\//, /\/\*[\s\S]*?\*\//],
        python: [/#/, /"""[\s\S]*?"""/],
        java: [/\/\//, /\/\*[\s\S]*?\*\//],
        csharp: [/\/\//, /\/\*[\s\S]*?\*\//],
        cpp: [/\/\//, /\/\*[\s\S]*?\*\//],
        css: [/\/\*[\s\S]*?\*\//],
        html: [/<!--[\s\S]*?-->/],
        sql: [/--/, /\/\*[\s\S]*?\*\//],
        bash: [/#/],
      };

      const patterns = commentPatterns[language] || [];
      metadata.hasComments = patterns.some((pattern) => pattern.test(code));

      // Detect functions
      const functionPatterns = {
        javascript: /function\s+\w+|const\s+\w+\s*=\s*\(|=>\s*{/,
        typescript: /function\s+\w+|const\s+\w+\s*=\s*\(|=>\s*{/,
        python: /def\s+\w+\s*\(/,
        java: /(public|private|protected)?\s*(static)?\s*\w+\s+\w+\s*\(/,
        csharp: /(public|private|protected)?\s*(static)?\s*\w+\s+\w+\s*\(/,
        cpp: /\w+\s+\w+\s*\([^)]*\)\s*{/,
      };

      const funcPattern = functionPatterns[language];
      if (funcPattern) {
        metadata.hasFunctions = funcPattern.test(code);
      }

      // Detect classes
      const classPatterns = {
        javascript: /class\s+\w+/,
        typescript: /class\s+\w+/,
        python: /class\s+\w+/,
        java: /(public|private|protected)?\s*class\s+\w+/,
        csharp: /(public|private|protected)?\s*class\s+\w+/,
        cpp: /class\s+\w+/,
      };

      const classPattern = classPatterns[language];
      if (classPattern) {
        metadata.hasClasses = classPattern.test(code);
      }

      // Estimate complexity based on line count and features
      if (metadata.lineCount > 200 || metadata.hasClasses) {
        metadata.estimatedComplexity = 'high';
      } else if (metadata.lineCount > 50 || metadata.hasFunctions) {
        metadata.estimatedComplexity = 'medium';
      } else {
        metadata.estimatedComplexity = 'low';
      }

      console.log('📊 Code Metadata extracted:', metadata);
    } catch (error) {
      console.warn('⚠️ Error extracting code metadata:', error);
    }

    return metadata;
  }
}

export default new CodePreview();
