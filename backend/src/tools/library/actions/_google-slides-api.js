import BaseAction from '../BaseAction.js';
import { google } from 'googleapis';
import AuthManager from '../../../services/auth/AuthManager.js';

class GoogleSlidesAction extends BaseAction {
  static schema = {
    title: 'Google Slides API',
    category: 'action',
    type: 'google-slides-api',
    icon: 'google-slides',
    description: 'Perform actions on Google Slides presentations and slides',
    authRequired: 'oauth',
    authProvider: 'google',
    parameters: {
      action: {
        type: 'string',
        inputType: 'select',
        options: [
          'Create Presentation',
          'Read Presentation',
          'Update Presentation',
          'Delete Presentation',
          'Create Slide',
          'Read Slide',
          'Update Slide',
          'Delete Slide',
        ],
        description: 'The action to perform',
      },
      presentationId: {
        type: 'string',
        inputType: 'text',
        description: "The ID of the Google Slides presentation (not required for 'Create Presentation')",
        conditional: {
          field: 'action',
          value: ['Read Presentation', 'Update Presentation', 'Delete Presentation', 'Create Slide', 'Read Slide', 'Update Slide', 'Delete Slide'],
        },
      },
      slideId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the slide (required for slide-specific actions)',
        conditional: {
          field: 'action',
          value: ['Read Slide', 'Update Slide', 'Delete Slide'],
        },
      },
      title: {
        type: 'string',
        inputType: 'text',
        description: 'The title for creating or updating a presentation',
        conditional: {
          field: 'action',
          value: ['Create Presentation', 'Update Presentation'],
        },
      },
      slideContent: {
        type: 'string',
        inputType: 'textarea',
        description: 'JSON-formatted content for creating or updating a slide',
        conditional: {
          field: 'action',
          value: ['Create Slide', 'Update Slide'],
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the action was successful',
      },
      presentationId: {
        type: 'string',
        description: 'The ID of the affected presentation',
      },
      slideId: {
        type: 'string',
        description: 'The ID of the affected slide (if applicable)',
      },
      presentation: {
        type: 'object',
        description: 'The full presentation data (for Read Presentation action)',
      },
      slide: {
        type: 'object',
        description: 'The slide data (for Read Slide action)',
      },
      error: {
        type: 'string',
        description: 'Error message if the action failed',
      },
    },
  };

  constructor() {
    super('google-slides-action');
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const userId = workflowEngine.userId;
      const accessToken = await AuthManager.getValidAccessToken(userId, 'google');

      if (!accessToken) {
        throw new Error('No valid access token found. User needs to authenticate with Google.');
      }

      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });
      const slides = google.slides({ version: 'v1', auth });

      let result;
      switch (params.action) {
        case 'Create Presentation':
          result = await this.createPresentation(slides, params.title);
          break;
        case 'Read Presentation':
          result = await this.readPresentation(slides, params.presentationId);
          break;
        case 'Update Presentation':
          result = await this.updatePresentation(slides, params.presentationId, params.title);
          break;
        case 'Delete Presentation':
          result = await this.deletePresentation(slides, params.presentationId);
          break;
        case 'Create Slide':
          result = await this.createSlide(slides, params.presentationId, params.slideContent);
          break;
        case 'Read Slide':
          result = await this.readSlide(slides, params.presentationId, params.slideId);
          break;
        case 'Update Slide':
          result = await this.updateSlide(slides, params.presentationId, params.slideId, params.slideContent);
          break;
        case 'Delete Slide':
          result = await this.deleteSlide(slides, params.presentationId, params.slideId);
          break;
        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }

      return this.formatOutput({
        success: true,
        ...result,
        error: null,
      });
    } catch (error) {
      console.error('Error in Google Slides action:', error);
      return this.formatOutput({
        success: false,
        error: error.message,
      });
    }
  }

  // Presentation CRUD operations
  async createPresentation(slides, title) {
    const res = await slides.presentations.create({
      requestBody: { title: title || 'New Presentation' },
    });
    return { presentationId: res.data.presentationId };
  }

  async readPresentation(slides, presentationId) {
    const res = await slides.presentations.get({ presentationId });

    // Extract text from a page element
    const extractText = (element) => {
      if (element.shape && element.shape.text) {
        return element.shape.text.textElements
          .filter((textElement) => textElement.textRun && textElement.textRun.content)
          .map((textElement) => textElement.textRun.content)
          .join(' ');
      }
      return '';
    };

    // Extract only essential information
    const slimmedPresentation = {
      presentationId: res.data.presentationId,
      title: res.data.title,
      slides: res.data.slides
        ? res.data.slides.map((slide) => ({
            objectId: slide.objectId,
            title:
              slide.pageElements?.find((el) => el.shape && el.shape.shapeType === 'TEXT_BOX')?.shape?.text?.textElements[0]?.textRun?.content || '',
            pageElements: slide.pageElements?.length || 0,
            text: slide.pageElements
              ? slide.pageElements
                  .map(extractText)
                  .filter((text) => text.trim() !== '')
                  .join('\n')
              : '',
          }))
        : [],
      presentationUrl: `https://docs.google.com/presentation/d/${res.data.presentationId}/edit`,
    };

    return { presentation: slimmedPresentation };
  }

  async updatePresentation(slides, presentationId, title) {
    await slides.presentations.batchUpdate({
      presentationId,
      requestBody: {
        requests: [
          {
            updatePresentationProperties: {
              fields: 'title',
              presentationProperties: { title },
            },
          },
        ],
      },
    });
    return { presentationId };
  }

  async deletePresentation(slides, presentationId) {
    const drive = google.drive({ version: 'v3', auth: slides.context._options.auth });
    await drive.files.delete({ fileId: presentationId });
    return { presentationId };
  }

  // Slide CRUD operations
  async createSlide(slides, presentationId, slideContent) {
    const updateRequests = this.parseSlideContent(null, slideContent);

    if (updateRequests.length > 0) {
      const validRequests = [];
      for (const request of updateRequests) {
        if (request.createImage) {
          try {
            // Attempt to validate the image URL
            await this.validateImageUrl(request.createImage.url);
            validRequests.push(request);
          } catch (error) {
            console.warn(`Skipping invalid image: ${error.message}`);
            // Optionally, you could add a text box here explaining the image couldn't be loaded
          }
        } else {
          validRequests.push(request);
        }
      }

      if (validRequests.length > 0) {
        try {
          await slides.presentations.batchUpdate({
            presentationId,
            requestBody: { requests: validRequests },
          });
        } catch (error) {
          if (error.message.includes('The provided image is too large')) {
            console.warn('Some images were too large and were skipped.');
            // Retry without images
            const nonImageRequests = validRequests.filter((req) => !req.createImage);
            await slides.presentations.batchUpdate({
              presentationId,
              requestBody: { requests: nonImageRequests },
            });
          } else {
            throw error; // Re-throw if it's a different error
          }
        }
      }
    }

    return { presentationId };
  }

  async readSlide(slides, presentationId, slideId) {
    const res = await slides.presentations.get({ presentationId });
    const slide = res.data.slides.find((s) => s.objectId === slideId);
    if (!slide) {
      throw new Error(`Slide with ID ${slideId} not found`);
    }
    return { presentationId, slideId, slide };
  }

  async updateSlide(slides, presentationId, slideId, slideContent) {
    const updateRequests = this.parseSlideContent(slideId, slideContent);

    if (updateRequests.length > 0) {
      await slides.presentations.batchUpdate({
        presentationId,
        requestBody: { requests: updateRequests },
      });
    }
    return { presentationId, slideId };
  }

  async deleteSlide(slides, presentationId, slideId) {
    await slides.presentations.batchUpdate({
      presentationId,
      requestBody: {
        requests: [{ deleteObject: { objectId: slideId } }],
      },
    });
    return { presentationId, slideId };
  }

  // Helper methods
  parseSlideContent(slideId, slideContent) {
    const requests = [];
    let content;

    try {
      content = typeof slideContent === 'string' ? JSON.parse(slideContent) : slideContent;
    } catch (error) {
      console.error('Error parsing slideContent:', error);
      return requests;
    }

    if (content && content.slides && Array.isArray(content.slides)) {
      content.slides.forEach((slide, index) => {
        const slideId = `slide_${index}`;
        // Create a new slide
        requests.push({
          createSlide: {
            objectId: slideId,
            insertionIndex: index,
            slideLayoutReference: { predefinedLayout: 'BLANK' },
          },
        });

        // Add title text box
        if (slide.title) {
          requests.push(...this.createTextboxElement(slideId, slide.title, 50, 30, 600, 50, true));
        }

        // Add body text box
        if (slide.points && Array.isArray(slide.points)) {
          const pointsText = slide.points.map((point) => `• ${point}`).join('\n');
          requests.push(...this.createTextboxElement(slideId, pointsText, 50, 90, 300, 300, false));
        }

        // Add image if present
        if (slide.image) {
          requests.push(this.createImageElement(slideId, slide.image, 400, 70, 300, 300));
        }
      });
    }

    return requests;
  }

  createTextboxElement(slideId, text, left, top, width, height, isTitle = false) {
    const objectId = `${slideId}_${isTitle ? 'title' : 'body'}`;
    return [
      {
        createShape: {
          objectId,
          shapeType: 'TEXT_BOX',
          elementProperties: {
            pageObjectId: slideId,
            size: { width: { magnitude: width, unit: 'PT' }, height: { magnitude: height, unit: 'PT' } },
            transform: { scaleX: 1, scaleY: 1, translateX: left, translateY: top, unit: 'PT' },
          },
        },
      },
      {
        insertText: {
          objectId,
          insertionIndex: 0,
          text,
        },
      },
      {
        updateTextStyle: {
          objectId,
          style: {
            fontSize: { magnitude: isTitle ? 24 : 14, unit: 'PT' },
            bold: isTitle,
          },
          textRange: { type: 'ALL' },
          fields: 'fontSize,bold',
        },
      },
    ];
  }

  createImageElement(slideId, imageUrl, left, top, width, height) {
    return {
      createImage: {
        url: imageUrl,
        elementProperties: {
          pageObjectId: slideId,
          size: { width: { magnitude: width, unit: 'PT' }, height: { magnitude: height, unit: 'PT' } },
          transform: { scaleX: 1, scaleY: 1, translateX: left, translateY: top, unit: 'PT' },
        },
      },
    };
  }

  async validateImageUrl(url) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        throw new Error('URL does not point to a valid image');
      }
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
        // 10MB limit
        throw new Error('Image is too large (over 10MB)');
      }
    } catch (error) {
      throw new Error(`Invalid image: ${error.message}`);
    }
  }
}

export default new GoogleSlidesAction();
