import StreamEngine from '../stream/StreamEngine.js';
import AuthManager from '../services/auth/AuthManager.js';
import dotenv from 'dotenv';

dotenv.config();

class AiService {
  constructor() {
    // Create a method that returns a new StreamEngine instance with userId
    this.ai = (req) => {
      return new StreamEngine(req.user.id);
    };
    this.authManager = AuthManager;
    this.localAuthProviders = new Set(['local', 'openai-codex', 'openai-codex-cli']);
  }

  // Break typical controller pattern and use arrow functions to automatically bind 'this'
  healthCheck = (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.status(200).json({ status: 'OK' });
  };
  startToolForgeStream = async (req, res) => {
    try {
      const { query, provider, model } = req.body;
      const files = req.files;
      const userId = req.user.id;

      console.log('Provider:', provider);

      // If no provider, this is a CODE tool - execute it directly instead of streaming
      if (!provider) {
        const parsedQuery = JSON.parse(query);
        const CustomToolModel = (await import('../models/CustomToolModel.js')).default;
        const WorkflowEngine = (await import('../workflow/WorkflowEngine.js')).default;
        const CustomToolExecutor = (await import('../workflow/CustomToolExecutor.js')).default;

        // Create a minimal workflow engine for parameter resolution
        const mockWorkflow = { nodes: [], edges: [] };
        const mockEngine = new WorkflowEngine(mockWorkflow, 'temp', userId);
        const executor = new CustomToolExecutor(mockEngine);

        // Get the tool type from the query
        const toolType = parsedQuery['tool-type'];
        if (!toolType) {
          return res.status(400).json({
            error: 'Missing tool type',
            message: 'CODE tools must specify a tool-type in the query',
          });
        }

        // Load the tool definition
        const allTools = await CustomToolModel.findAllByUserId(userId);
        const toolDef = allTools.find((tool) => tool.type === toolType);

        if (!toolDef) {
          return res.status(404).json({
            error: 'Tool not found',
            message: `No tool found with type: ${toolType}`,
          });
        }

        // Build the node object
        const node = {
          id: 'temp-node',
          type: toolType,
          category: 'custom',
          base: toolDef.base,
          code: toolDef.code,
          parameters: parsedQuery,
        };

        // Execute the code tool
        const result = await executor.execute(node, {});

        // Return the result as JSON
        return res.json(result);
      }

      let accessTokenOrApiKey = null;

      // Only attempt to get an access token or API key if it's not the local provider
      const providerLower = provider.toLowerCase();
      if (!this.localAuthProviders.has(providerLower)) {
        try {
          accessTokenOrApiKey = await this.authManager.getValidAccessToken(userId, providerLower);
        } catch (authError) {
          console.error('Authentication error:', authError);
          return res.status(401).json({
            error: 'Authentication required',
            message: 'Please authenticate or provide an API key for the provider before starting a Tool Forge stream.',
            provider: provider,
          });
        }
      }

      this.ai(req).startStream(
        req,
        res,
        query,
        files,
        provider,
        model,
        'false', // isChat
        null, // messages
        accessTokenOrApiKey
      );
    } catch (error) {
      console.error('Error starting Tool Forge stream:', error);
      res.status(500).json({
        error: 'Failed to start Tool Forge stream',
        message: error.message,
      });
    }
  };
  cancelToolForgeStream = async (req, res) => {
    try {
      const { streamId } = req.body;
      await this.ai(req).cancelStream(streamId);
      res.status(200).json({
        message: `Tool Forge stream with ID ${streamId} has been cancelled.`,
      });
    } catch (error) {
      console.error('Error cancelling Tool Forge stream:', error);
      // Send a 200 status even if there's an error, as the stream cancellation might have succeeded
      res.status(200).json({ message: 'Stream cancellation request processed', error: error.message });
    }
  };
  startChatStream = async (req, res) => {
    try {
      console.log(req.body);
      const { query, provider, model, isChat, messages } = req.body;
      const userId = req.user.id;

      console.log('Provider:', provider);

      // Parse the query JSON string
      const parsedQuery = JSON.parse(query);

      // Extract the user's current message from the parsed query
      const userMessage = parsedQuery['user-current-message'];
      // Parse the messages JSON string
      const parsedMessages = JSON.parse(messages);

      // Get the access token or API key for the provider
      let accessToken;
      const providerLower = provider.toLowerCase();
      if (!this.localAuthProviders.has(providerLower)) {
        try {
          accessToken = await this.authManager.getValidAccessToken(userId, providerLower);
        } catch (authError) {
          if (authError.message === 'No valid access token. User needs to authenticate.') {
            return res.status(401).json({
              error: 'Authentication required',
              message: 'Please authenticate with the provider before starting a chat.',
              provider: provider,
            });
          }
          throw authError; // Re-throw if it's a different error
        }
      }

      // Call the AI's startStream method with the correct parameters
      this.ai(req).startStream(req, res, userMessage, null, provider, model, isChat === 'true', parsedMessages, accessToken);
    } catch (error) {
      console.error('Error starting chat stream:', error);
      res.status(500).json({
        error: 'Failed to start chat stream',
        message: error.message,
      });
    }
  };
  cancelChatStream = async (req, res) => {
    try {
      const { streamId } = req.body;
      await this.ai(req).cancelStream(streamId);
      res.status(200).json({
        message: `Chat stream with ID ${streamId} has been cancelled.`,
      });
    } catch (error) {
      console.error('Error cancelling chat stream:', error);
      // Send a 200 status even if there's an error, as the stream cancellation might have succeeded
      res.status(200).json({ message: 'Stream cancellation request processed', error: error.message });
    }
  };
  generateTool = async (req, res) => {
    const { templateOverview, provider, model } = req.body; // Move this outside try/catch

    try {
      const generatedTool = await this.ai(req).generateTool(templateOverview, provider, model);
      res.json(generatedTool);
    } catch (error) {
      console.error('Error generating tool:', error);
      // Now provider is accessible in catch block
      res.status(401).json({
        error: error.message,
        provider: provider,
        type: 'auth_error',
      });
    }
  };
  generateWorkflow = async (req, res) => {
    const { overview, availableTools, customTools, currentWorkflow, provider, model } = req.body;

    try {
      console.log('GENERATING WORKFLOW', {
        overview,
        availableTools,
        customTools,
        currentWorkflow,
        provider,
        model,
      });

      const workflowElements = {
        overview,
        availableTools,
        customTools,
        currentWorkflow,
      };

      // Pass workflowElements object, provider, and model to stream engine
      const generatedWorkflow = await this.ai(req).generateWorkflow(workflowElements, provider, model);
      res.json(generatedWorkflow);
    } catch (error) {
      console.error('Error generating workflow:', error);
      // Make sure we're sending a proper JSON response
      res.status(401).json({
        error: error.message,
        provider: provider,
        type: 'auth_error',
      });
    }
  };
  generateAgent = async (req, res) => {
    const { overview, currentAgent, provider, model } = req.body;

    try {
      console.log('GENERATING AGENT', {
        overview,
        currentAgent,
        provider,
        model,
      });

      const agentElements = {
        overview,
        currentAgent: currentAgent || '{}',
      };

      // Pass agentElements object, provider, and model to stream engine
      const generatedAgent = await this.ai(req).generateAgent(agentElements, provider, model);
      res.json(generatedAgent);
    } catch (error) {
      console.error('Error generating agent:', error);
      // Make sure we're sending a proper JSON response
      res.status(401).json({
        error: error.message,
        provider: provider,
        type: 'auth_error',
      });
    }
  };
}

console.log(`AI Service Started...`);

export default new AiService();
