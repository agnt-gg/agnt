import BaseAction from '../BaseAction.js';

class AudioPreview extends BaseAction {
  static schema = {
    title: 'Audio Preview',
    category: 'utility',
    type: 'audio-preview',
    icon: 'speaker',
    description: 'Audio player with waveform visualization. Supports MP3, WAV, OGG, WebM, AAC, and M4A formats up to 10MB.',
    parameters: {
      audioSource: {
        type: 'string',
        inputType: 'textarea',
        description: 'Audio source. Can be URL, blob URL, or base64 data (data:audio/...). Supports drag & drop of audio files.',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the audio was successfully processed',
      },
      audioUrl: {
        type: 'string',
        description: 'The audio URL ready for playback',
      },
      metadata: {
        type: 'object',
        description: 'Audio metadata including source type, file size, duration, format, bitrate, and sample rate (when available)',
      },
      error: {
        type: 'string',
        description: 'Error message if audio processing failed',
      },
    },
  };

  constructor() {
    super('audio-preview');
  }

  async execute(params, inputData, workflowEngine) {
    console.log('🎵 AudioPreview execute called');
    console.log('🎵 Full params object:', JSON.stringify(params, null, 2));
    console.log('🎵 audioSource type:', typeof params.audioSource);
    console.log('🎵 audioSource value:', params.audioSource);

    try {
      // Validate input
      if (!params.audioSource) {
        console.error('❌ AudioPreview: No audio source provided');
        return {
          success: false,
          error: 'No audio source provided',
          audioUrl: null,
          metadata: null,
        };
      }

      let audioSource = params.audioSource;

      // Handle JSON string input (when object is stringified during parameter resolution)
      if (typeof audioSource === 'string' && audioSource.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(audioSource);
          console.log('✅ AudioPreview: Parsed JSON string to object:', Object.keys(parsed));
          audioSource = parsed;
        } catch (e) {
          console.log('⚠️ AudioPreview: String starts with { but is not valid JSON, treating as regular string');
        }
      }

      // Handle object input (e.g., from text-to-speech node)
      if (typeof audioSource === 'object' && audioSource !== null) {
        console.log('🔍 AudioPreview: Received object input:', Object.keys(audioSource));

        // Check for audioContent property (from TTS)
        if (audioSource.audioContent && audioSource.contentType) {
          const base64Audio = audioSource.audioContent;
          const contentType = audioSource.contentType;
          audioSource = `data:${contentType};base64,${base64Audio}`;
          console.log('✅ AudioPreview: Converted audioContent to data URL');
        }
        // Check for audioUrl property
        else if (audioSource.audioUrl) {
          audioSource = audioSource.audioUrl;
          console.log('✅ AudioPreview: Extracted audioUrl from object');
        }
        // Check for text property (from file uploads)
        else if (audioSource.text) {
          audioSource = audioSource.text;
          console.log('✅ AudioPreview: Extracted text property from object');
        }
        // Check for data property (base64 without prefix)
        else if (audioSource.data && audioSource.type) {
          audioSource = `data:${audioSource.type};base64,${audioSource.data}`;
          console.log('✅ AudioPreview: Converted data property to data URL');
        } else {
          console.error('❌ AudioPreview: Object format not recognized:', audioSource);
          return {
            success: false,
            error: 'Invalid audio source object format. Expected audioContent, audioUrl, text, or data property.',
            audioUrl: null,
            metadata: null,
          };
        }
      }

      // Ensure audioSource is a string
      if (typeof audioSource !== 'string') {
        console.error('❌ AudioPreview: audioSource is not a string after processing');
        return {
          success: false,
          error: 'Audio source must be a string or valid object',
          audioUrl: null,
          metadata: null,
        };
      }

      audioSource = audioSource.trim();

      console.log('🔍 AudioPreview: Processing audio source:', {
        type: typeof audioSource,
        length: audioSource.length,
        starts: audioSource.substring(0, 50),
      });

      // Initialize result object
      const result = {
        success: true,
        audioUrl: null,
        metadata: {
          sourceType: null,
          fileSize: null,
          duration: null,
          format: null,
          bitrate: null,
          sampleRate: null,
        },
        error: null,
      };

      // Determine source type
      const isUrl = audioSource.startsWith('http://') || audioSource.startsWith('https://');
      const isBlobUrl = audioSource.startsWith('blob:');
      const isBase64 = audioSource.startsWith('data:audio/');

      if (isUrl) {
        result.metadata.sourceType = 'url';

        // Option 1: Try to fetch and convert to base64 for full AudioContext support
        // This allows visualization to work with the actual audio data
        try {
          console.log('🎵 Fetching remote audio to enable visualization...');
          const response = await fetch(audioSource);

          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const base64Audio = Buffer.from(arrayBuffer).toString('base64');
            const contentType = response.headers.get('content-type') || 'audio/mpeg';

            // Return as base64 data URL for full AudioContext support
            result.audioUrl = `data:${contentType};base64,${base64Audio}`;
            result.metadata.format = contentType;
            result.metadata.fileSize = arrayBuffer.byteLength;

            console.log('✅ Audio converted to base64 for visualization support');
          } else {
            // Fallback: Just use the URL directly
            console.log('⚠️ Could not fetch audio, using direct URL (no visualization)');
            result.audioUrl = audioSource;
          }
        } catch (error) {
          console.warn('⚠️ Could not fetch audio for conversion:', error.message);
          // Fallback: Just use the URL directly
          result.audioUrl = audioSource;
        }

        // Try to fetch metadata
        try {
          const metadata = await this.fetchAudioMetadata(audioSource);
          result.metadata = { ...result.metadata, ...metadata };
        } catch (error) {
          console.warn('⚠️ Could not fetch audio metadata:', error.message);
        }
      } else if (isBlobUrl) {
        result.metadata.sourceType = 'blob';
        result.audioUrl = audioSource;
      } else if (isBase64) {
        result.metadata.sourceType = 'base64';
        result.audioUrl = audioSource;

        // Extract format from data URI
        const formatMatch = audioSource.match(/^data:audio\/([^;]+);base64,/);
        if (formatMatch) {
          result.metadata.format = `audio/${formatMatch[1]}`;
        }

        // Calculate file size from base64
        const base64Data = audioSource.split(',')[1];
        result.metadata.fileSize = Math.round((base64Data.length * 3) / 4);
      } else {
        result.error = 'Invalid audio source format. Expected URL, blob URL, or base64 data.';
        result.success = false;
      }

      return result;
    } catch (error) {
      console.error('❌ AudioPreview error:', error);
      return {
        success: false,
        error: error.message,
        audioUrl: null,
        metadata: null,
      };
    }
  }

  async fetchAudioMetadata(url) {
    try {
      const response = await fetch(url, { method: 'HEAD' });

      if (!response.ok) {
        throw new Error(`Failed to fetch audio metadata: ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      const contentType = response.headers.get('content-type');

      // Extract format from content type
      let format = contentType;
      if (contentType && contentType.startsWith('audio/')) {
        format = contentType.split(';')[0];
      }

      return {
        fileSize: contentLength ? parseInt(contentLength) : null,
        format: format,
        contentType: contentType,
      };
    } catch (error) {
      console.warn('Could not fetch audio metadata:', error);
      return {};
    }
  }
}

export default new AudioPreview();
