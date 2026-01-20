import BaseAction from '../BaseAction.js';

class MediaPreview extends BaseAction {
  static schema = {
    title: 'Media Preview',
    category: 'utility',
    type: 'media-preview',
    icon: 'image',
    description:
      'Advanced media preview tool that displays images or videos from URLs, base64 data, or streaming platforms. Automatically detects media types, extracts metadata (dimensions, file size), and processes base64 data with enhanced validation and optimization.',
    parameters: {
      mediaSource: {
        type: 'string',
        inputType: 'textarea',
        description:
          'Media URL, base64 data (with or without data URI prefix), or blob URL. Supports images (jpg, png, gif, webp, bmp, svg), videos (mp4, webm, mov, avi, mkv, wmv), and streaming URLs (YouTube, Vimeo, etc.). Automatically detects format from magic bytes for raw base64.',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the media was successfully processed',
      },
      mediaType: {
        type: 'string',
        description: "The detected media type ('image', 'video', or 'unknown')",
      },
      originalUrl: {
        type: 'string',
        description: 'The original media URL before processing',
      },
      base64Data: {
        type: 'string',
        description: 'Full data URI with prefix (data:image/jpeg;base64,abc123...) - ready for HTML display',
      },
      metadata: {
        type: 'object',
        description: 'Extracted media metadata including dimensions, format, file size, and processing info',
      },
      fileSize: {
        type: 'number',
        description: 'File size in bytes (calculated for base64 data, fetched for URLs)',
      },
      dimensions: {
        type: 'object',
        description: 'Image dimensions as {width, height} (when available)',
      },
      format: {
        type: 'string',
        description: 'Detected media format/MIME type',
      },
      error: {
        type: 'string',
        description: 'Error message if media processing failed',
      },
    },
  };

  constructor() {
    super('media-preview');
  }

  async execute(params, inputData, workflowEngine) {
    console.log('🎬 MediaPreview execute called with params:', JSON.stringify(params).substring(0, 200) + '...');
    try {
      // Validate input
      if (!params.mediaSource) {
        console.error('❌ MediaPreview: No media source provided');
        return {
          success: false,
          error: 'No media source provided',
          mediaType: null,
          originalUrl: null,
          metadata: null,
          fileSize: null,
          dimensions: null,
          format: null,
        };
      }

      // Basic validation for URL or base64 format
      const mediaSource = params.mediaSource.trim();
      console.log('🔍 MediaPreview: Processing media source type and length:', {
        type: typeof mediaSource,
        length: mediaSource.length,
        starts: mediaSource.substring(0, 50),
      });

      // Check for IndexedDB references that weren't resolved
      if (mediaSource.startsWith('idb://')) {
        console.error('❌ MediaPreview: IndexedDB reference found - this should have been resolved by frontend:', mediaSource);
        return {
          success: false,
          error: 'IndexedDB reference found but not resolved. This indicates a frontend resolution failure.',
          mediaType: null,
          originalUrl: mediaSource,
          metadata: null,
          fileSize: null,
          dimensions: null,
          format: null,
        };
      }

      // Check if it's a valid URL, base64 data, or blob URL
      const isUrl = mediaSource.startsWith('http://') || mediaSource.startsWith('https://');
      const isBlobUrl = mediaSource.startsWith('blob:');
      const isImageBase64 = mediaSource.startsWith('data:image/');
      const isVideoBase64 = mediaSource.startsWith('data:video/');
      const isBase64Data = isImageBase64 || isVideoBase64;

      // Check for raw base64 without data URI prefix
      const isRawBase64 = !isUrl && !isBlobUrl && !isBase64Data && this.isBase64String(mediaSource);

      console.log('🔍 MediaPreview: Media source analysis:', {
        isUrl,
        isBlobUrl,
        isImageBase64,
        isVideoBase64,
        isBase64Data,
        isRawBase64,
      });

      if (!isUrl && !isBlobUrl && !isBase64Data && !isRawBase64) {
        const detailedError = `Invalid media source format. Expected: URL, blob URL, or base64 data. Got: ${mediaSource.substring(0, 100)}...`;
        console.error('❌ MediaPreview:', detailedError);
        return {
          success: false,
          error: detailedError,
          mediaType: null,
          originalUrl: mediaSource,
          metadata: null,
          fileSize: null,
          dimensions: null,
          format: null,
        };
      }

      // Initialize result object
      const result = {
        success: true,
        mediaType: 'unknown',
        originalUrl: mediaSource,
        metadata: {},
        fileSize: null,
        dimensions: null,
        format: null,
        base64Data: null, // Full data URI with prefix
        error: null,
      };

      // Process based on media source type
      if (isBase64Data || isRawBase64) {
        // Handle base64 data
        const base64Info = this.processBase64Data(mediaSource);
        result.mediaType = base64Info.mediaType;
        result.fileSize = base64Info.fileSize;
        result.format = base64Info.mimeType;
        result.dimensions = base64Info.dimensions;
        result.base64Data = base64Info.processedUrl; // Full data URI with prefix
        result.metadata = {
          encoding: 'base64',
          hasDataUri: isBase64Data,
          originalSize: mediaSource.length,
          processedSize: base64Info.processedUrl.length,
          ...base64Info.metadata,
        };
      } else if (isBlobUrl || isUrl) {
        // Handle URLs and blob URLs - fetch and convert to base64
        try {
          const fetchInfo = await this.fetchAndConvertToBase64(mediaSource);
          result.mediaType = fetchInfo.mediaType;
          result.fileSize = fetchInfo.fileSize;
          result.format = fetchInfo.mimeType;
          result.dimensions = fetchInfo.dimensions;
          result.base64Data = fetchInfo.dataUri; // Full data URI with prefix
          result.metadata = {
            type: isBlobUrl ? 'blob' : 'url',
            originalUrl: mediaSource,
            fetchedSize: fetchInfo.fileSize,
            convertedToBase64: true,
            ...fetchInfo.metadata,
          };

          // For URLs, also include URL processing info
          if (isUrl) {
            const urlInfo = this.processUrl(mediaSource);
            result.metadata = {
              ...result.metadata,
              isEmbedded: urlInfo.isEmbedded,
              platform: urlInfo.platform,
              ...urlInfo.metadata,
            };
          }
        } catch (error) {
          // Fallback to URL processing if fetch fails
          if (isUrl) {
            const urlInfo = this.processUrl(mediaSource);
            result.mediaType = urlInfo.mediaType;
            result.format = urlInfo.format;
            result.metadata = {
              type: 'url',
              isEmbedded: urlInfo.isEmbedded,
              platform: urlInfo.platform,
              fetchError: error.message,
              ...urlInfo.metadata,
            };
          } else {
            result.error = `Failed to fetch blob: ${error.message}`;
            result.success = false;
          }
        }
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        mediaType: null,
        originalUrl: params.mediaSource || null,
        metadata: null,
        fileSize: null,
        dimensions: null,
        format: null,
      };
    }
  }

  processBase64Data(mediaSource) {
    let base64Data = mediaSource;
    let mimeType = null;
    let hasDataUri = false;

    // Check if it has data URI prefix
    if (mediaSource.startsWith('data:')) {
      hasDataUri = true;
      const matches = mediaSource.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        base64Data = matches[2];
      }
    } else {
      // Try to detect MIME type from magic bytes
      mimeType = this.detectMimeTypeFromBase64(base64Data);
    }

    // Calculate file size (base64 is ~33% larger than binary)
    const fileSize = Math.round((base64Data.length * 3) / 4);

    // Determine media type
    let mediaType = 'unknown';
    if (mimeType) {
      if (mimeType.startsWith('image/')) {
        mediaType = 'image';
      } else if (mimeType.startsWith('video/')) {
        mediaType = 'video';
      }
    }

    // Create proper data URI if needed
    let processedUrl = mediaSource;
    if (!hasDataUri && mimeType) {
      processedUrl = `data:${mimeType};base64,${base64Data}`;
    }

    // Try to extract dimensions for images (basic implementation)
    let dimensions = null;
    if (mediaType === 'image' && mimeType) {
      dimensions = this.extractImageDimensions(base64Data, mimeType);
    }

    return {
      processedUrl,
      mediaType,
      mimeType,
      fileSize,
      dimensions,
      rawBase64: base64Data, // Raw base64 string without data URI prefix
      metadata: {
        originalHasDataUri: hasDataUri,
        detectedMimeType: mimeType,
        base64Length: base64Data.length,
      },
    };
  }

  processUrl(mediaSource) {
    const url = mediaSource.toLowerCase();
    let mediaType = 'unknown';
    let format = null;
    let isEmbedded = false;
    let platform = null;

    // Video extensions
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.m4v', '.mkv', '.wmv'];
    const hasVideoExtension = videoExtensions.some((ext) => url.includes(ext));

    // Image extensions
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico'];
    const hasImageExtension = imageExtensions.some((ext) => url.includes(ext));

    // Video streaming platforms
    const videoStreamingDomains = ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'twitch.tv'];
    const isVideoStreaming = videoStreamingDomains.some((domain) => url.includes(domain));

    if (hasVideoExtension || isVideoStreaming) {
      mediaType = 'video';
    } else if (hasImageExtension) {
      mediaType = 'image';
    } else {
      // Default to image for unknown URL types (backwards compatibility)
      mediaType = 'image';
    }

    // Extract format from extension
    if (hasVideoExtension) {
      const extension = videoExtensions.find((ext) => url.includes(ext));
      format = `video/${extension.substring(1)}`;
    } else if (hasImageExtension) {
      const extension = imageExtensions.find((ext) => url.includes(ext));
      format = `image/${extension.substring(1)}`;
      if (format === 'image/jpg') format = 'image/jpeg';
    }

    // Handle YouTube URLs - convert to embed format
    let processedUrl = mediaSource;
    if (mediaType === 'video' && (mediaSource.includes('youtube.com') || mediaSource.includes('youtu.be'))) {
      processedUrl = this.convertToYouTubeEmbed(mediaSource);
      isEmbedded = true;
      platform = 'youtube';
      format = 'video/youtube';
    }

    return {
      processedUrl,
      mediaType,
      format,
      isEmbedded,
      platform,
      metadata: {
        hasVideoExtension,
        hasImageExtension,
        isVideoStreaming,
      },
    };
  }

  isBase64String(str) {
    // Basic check for base64 string (could be more robust)
    if (typeof str !== 'string' || str.length < 4) return false;

    // Check if string contains only valid base64 characters
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    return base64Regex.test(str) && str.length % 4 === 0;
  }

  detectMimeTypeFromBase64(base64Data) {
    try {
      // Get first few bytes to check magic numbers - increase to 32 bytes for better detection
      const binaryString = atob(base64Data.substring(0, 44)); // 44 base64 chars = ~32 bytes
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      console.log(
        'MIME detection - First 16 bytes:',
        Array.from(bytes.slice(0, 16))
          .map((b) => '0x' + b.toString(16).padStart(2, '0'))
          .join(' ')
      );

      // Check common image formats
      // JPEG: FF D8 (any JPEG variant - JFIF, EXIF, etc.)
      if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        console.log('MIME detection - Detected JPEG format');
        return 'image/jpeg';
      }

      // PNG: 89 50 4E 47 0D 0A 1A 0A
      if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        console.log('MIME detection - Detected PNG format');
        return 'image/png';
      }

      // GIF: 47 49 46 (GIF87a or GIF89a)
      if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
        console.log('MIME detection - Detected GIF format');
        return 'image/gif';
      }

      // WebP: RIFF....WEBP
      if (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      ) {
        console.log('MIME detection - Detected WebP format');
        return 'image/webp';
      }

      // BMP: 42 4D
      if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
        console.log('MIME detection - Detected BMP format');
        return 'image/bmp';
      }

      // Check common video formats
      // MP4: Check for ftyp box at offset 4
      if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
        console.log('MIME detection - Detected MP4 format');
        return 'video/mp4';
      }

      // WebM: Check for EBML signature
      if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
        console.log('MIME detection - Detected WebM format');
        return 'video/webm';
      }

      console.log('MIME detection - No format detected from magic bytes');
    } catch (error) {
      console.warn('Error detecting MIME type from base64:', error);
    }

    return null;
  }

  extractImageDimensions(base64Data, mimeType) {
    try {
      // Basic dimension extraction for common formats
      if (mimeType === 'image/png') {
        return this.extractPngDimensions(base64Data);
      } else if (mimeType === 'image/jpeg') {
        return this.extractJpegDimensions(base64Data);
      } else if (mimeType === 'image/gif') {
        return this.extractGifDimensions(base64Data);
      }
    } catch (error) {
      console.warn('Error extracting image dimensions:', error);
    }
    return null;
  }

  extractPngDimensions(base64Data) {
    try {
      const binaryString = atob(base64Data.substring(0, 100));
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // PNG dimensions are at bytes 16-23 (after PNG signature and IHDR)
      if (bytes.length >= 24) {
        const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
        const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
        return { width, height };
      }
    } catch (error) {
      console.warn('Error extracting PNG dimensions:', error);
    }
    return null;
  }

  extractJpegDimensions(base64Data) {
    // JPEG dimension extraction is more complex, would need SOF marker parsing
    // For now, return null (could be implemented later)
    return null;
  }

  extractGifDimensions(base64Data) {
    try {
      const binaryString = atob(base64Data.substring(0, 50));
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // GIF dimensions are at bytes 6-9 (little-endian)
      if (bytes.length >= 10) {
        const width = bytes[6] | (bytes[7] << 8);
        const height = bytes[8] | (bytes[9] << 8);
        return { width, height };
      }
    } catch (error) {
      console.warn('Error extracting GIF dimensions:', error);
    }
    return null;
  }

  async fetchAndConvertToBase64(url) {
    try {
      console.log(`Fetching media from: ${url}`);

      // Use fetch to get the media
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
      }

      // Get the content type
      const contentType = response.headers.get('content-type') || 'application/octet-stream';

      // Get the binary data
      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Convert to base64
      let binaryString = '';
      for (let i = 0; i < uint8Array.length; i++) {
        binaryString += String.fromCharCode(uint8Array[i]);
      }
      const base64Data = btoa(binaryString);

      // Create data URI
      const dataUri = `data:${contentType};base64,${base64Data}`;

      // Calculate file size
      const fileSize = uint8Array.length;

      // Determine media type
      let mediaType = 'unknown';
      if (contentType.startsWith('image/')) {
        mediaType = 'image';
      } else if (contentType.startsWith('video/')) {
        mediaType = 'video';
      }

      // Try to extract dimensions for images
      let dimensions = null;
      if (mediaType === 'image') {
        dimensions = this.extractImageDimensions(base64Data, contentType);
      }

      return {
        dataUri,
        rawBase64: base64Data,
        mimeType: contentType,
        mediaType,
        fileSize,
        dimensions,
        metadata: {
          originalSize: arrayBuffer.byteLength,
          base64Length: base64Data.length,
          contentType,
        },
      };
    } catch (error) {
      console.error('Error fetching and converting to base64:', error);
      throw error;
    }
  }

  convertToYouTubeEmbed(url) {
    try {
      let videoId = null;

      if (url.includes('youtu.be/')) {
        // Short URL format: https://youtu.be/VIDEO_ID
        videoId = url.split('youtu.be/')[1].split(/[?&]/)[0];
      } else if (url.includes('youtube.com/watch')) {
        // Long URL format: https://www.youtube.com/watch?v=VIDEO_ID
        const urlParams = new URL(url).searchParams;
        videoId = urlParams.get('v');
      }

      if (videoId) {
        return `https://www.youtube.com/embed/${videoId}`;
      }
    } catch (error) {
      console.error('Error converting YouTube URL:', error);
    }

    return url; // Return original URL if conversion fails
  }
}

export default new MediaPreview();
