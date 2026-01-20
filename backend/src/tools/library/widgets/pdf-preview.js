import BaseAction from '../BaseAction.js';

class PdfPreview extends BaseAction {
  static schema = {
    title: 'PDF Preview',
    category: 'utility',
    type: 'pdf-preview',
    icon: 'file',
    description: 'Displays PDF documents with download capability. Supports URLs, blob URLs, and base64-encoded PDFs up to 20MB.',
    parameters: {
      pdfSource: {
        type: 'string',
        inputType: 'textarea',
        description: 'PDF source. Can be URL, blob URL, or base64 data (data:application/pdf;base64,...). Supports drag & drop of .pdf files.',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the PDF was successfully processed',
      },
      pdfUrl: {
        type: 'string',
        description: 'The PDF URL ready for rendering',
      },
      metadata: {
        type: 'object',
        description: 'PDF metadata including source type, file size, and page count (when available)',
      },
      error: {
        type: 'string',
        description: 'Error message if PDF processing failed',
      },
    },
  };

  constructor() {
    super('pdf-preview');
  }

  async execute(params, inputData, workflowEngine) {
    console.log('📄 PdfPreview execute called with params:', JSON.stringify(params).substring(0, 200) + '...');
    try {
      // Validate input
      if (!params.pdfSource) {
        console.error('❌ PdfPreview: No PDF source provided');
        return {
          success: false,
          error: 'No PDF source provided',
          pdfUrl: null,
          metadata: null,
        };
      }

      const pdfSource = params.pdfSource.trim();

      console.log('🔍 PdfPreview: Processing PDF source:', {
        type: typeof pdfSource,
        length: pdfSource.length,
        starts: pdfSource.substring(0, 50),
      });

      // Initialize result object
      const result = {
        success: true,
        pdfUrl: null,
        metadata: {
          sourceType: null,
          fileSize: null,
          pageCount: null,
        },
        error: null,
      };

      // Determine source type
      const isUrl = pdfSource.startsWith('http://') || pdfSource.startsWith('https://');
      const isBlobUrl = pdfSource.startsWith('blob:');
      const isBase64 = pdfSource.startsWith('data:application/pdf;base64,');

      if (isUrl) {
        result.metadata.sourceType = 'url';
        result.pdfUrl = pdfSource;

        // Try to fetch metadata
        try {
          const metadata = await this.fetchPdfMetadata(pdfSource);
          result.metadata = { ...result.metadata, ...metadata };
        } catch (error) {
          console.warn('⚠️ Could not fetch PDF metadata:', error.message);
        }
      } else if (isBlobUrl) {
        result.metadata.sourceType = 'blob';
        result.pdfUrl = pdfSource;
      } else if (isBase64) {
        result.metadata.sourceType = 'base64';
        result.pdfUrl = pdfSource;

        // Calculate file size from base64
        const base64Data = pdfSource.split(',')[1];
        result.metadata.fileSize = Math.round((base64Data.length * 3) / 4);
      } else {
        result.error = 'Invalid PDF source format. Expected URL, blob URL, or base64 data.';
        result.success = false;
      }

      return result;
    } catch (error) {
      console.error('❌ PdfPreview error:', error);
      return {
        success: false,
        error: error.message,
        pdfUrl: null,
        metadata: null,
      };
    }
  }

  async fetchPdfMetadata(url) {
    try {
      const response = await fetch(url, { method: 'HEAD' });

      if (!response.ok) {
        throw new Error(`Failed to fetch PDF metadata: ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      const contentType = response.headers.get('content-type');

      return {
        fileSize: contentLength ? parseInt(contentLength) : null,
        contentType: contentType,
      };
    } catch (error) {
      console.warn('Could not fetch PDF metadata:', error);
      return {};
    }
  }
}

export default new PdfPreview();
