import BaseAction from '../BaseAction.js';

class ImagePreview extends BaseAction {
  static schema = {
    title: 'Image Preview',
    category: 'utility',
    type: 'image-preview',
    icon: 'image',
    description: 'Displays an image from a URL or base64 data.',
    parameters: {
      imageSource: {
        type: 'string',
        inputType: 'textarea',
        description: 'Image URL or base64 data (data:image/...)',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the image was successfully processed',
      },
      imageUrl: {
        type: 'string',
        description: 'The image URL or base64 data',
      },
      error: {
        type: 'string',
        description: 'Error message if processing failed',
      },
    },
  };

  constructor() {
    super('image-preview');
  }

  async execute(params, inputData, workflowEngine) {
    try {
      // Validate input
      if (!params.imageSource) {
        return {
          success: false,
          error: 'No image source provided',
          imageUrl: null,
        };
      }

      // Basic validation for URL or base64 format
      const imageSource = params.imageSource.trim();

      // Check if it's a valid URL or base64 data
      const isUrl = imageSource.startsWith('http://') || imageSource.startsWith('https://');
      const isBase64 = imageSource.startsWith('data:image/');

      if (!isUrl && !isBase64) {
        return {
          success: false,
          error: 'Image source must be a valid URL or base64 data',
          imageUrl: null,
        };
      }

      // Pass through the image source - frontend will handle display
      return {
        success: true,
        imageUrl: imageSource,
        error: null,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        imageUrl: null,
      };
    }
  }
}

export default new ImagePreview();
