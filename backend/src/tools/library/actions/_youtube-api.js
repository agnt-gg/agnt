import BaseAction from '../BaseAction.js';
import { google } from 'googleapis';
import AuthManager from '../../../services/auth/AuthManager.js';
import YouTubeCaptionExtractor from '../../../utils/youtube-caption-extractor.js';
import WhisperTranscriber from '../../../utils/whisper-transcriber.js';

class YouTubeAPI extends BaseAction {
  static schema = {
    title: 'YouTube API',
    category: 'action',
    type: 'youtube-api',
    icon: 'youtube',
    description: 'Interact with the YouTube API to manage videos, comments, playlists, and more.',
    authRequired: 'oauth',
    authProvider: 'google',
    parameters: {
      action: {
        type: 'string',
        inputType: 'select',
        options: [
          'ADD_VIDEO_TO_PLAYLIST',
          'COMMENT_ON_VIDEO',
          'CREATE_PLAYLIST',
          'DISLIKE_VIDEO',
          'GET_MY_SUBSCRIPTIONS',
          'GET_PLAYLIST_ITEMS',
          'GET_TRANSCRIPTION',
          'GET_VIDEO_DETAILS',
          'LIKE_VIDEO',
          'LIST_CHANNEL_VIDEOS',
          'REPLY_TO_COMMENT',
          'SEARCH_VIDEOS',
          'SUBSCRIBE_TO_CHANNEL',
          'UNSUBSCRIBE_FROM_CHANNEL',
          'UPDATE_VIDEO_METADATA',
          'UPLOAD_VIDEO',
        ],
        description: 'The action to perform on YouTube',
      },
      query: {
        type: 'string',
        inputType: 'text',
        description: 'The search query',
        conditional: {
          field: 'action',
          value: 'SEARCH_VIDEOS',
        },
      },
      videoId: {
        type: 'string',
        inputType: 'text',
        description:
          "YouTube video ID or full URL (e.g., 'dQw4w9WgXcQ' or 'https://www.youtube.com/watch?v=dQw4w9WgXcQ') - automatically converts URLs to video IDs",
        conditional: {
          field: 'action',
          value: ['GET_VIDEO_DETAILS', 'LIKE_VIDEO', 'DISLIKE_VIDEO', 'COMMENT_ON_VIDEO', 'UPDATE_VIDEO_METADATA', 'GET_TRANSCRIPTION'],
        },
      },
      fallbackMethod: {
        type: 'string',
        inputType: 'select',
        options: ['all', 'api', 'ytdlp', 'whisper'],
        default: 'all',
        description:
          "Transcription method: 'all' (try all methods), 'api' (YouTube API only), 'ytdlp' (yt-dlp only), 'whisper' (OpenAI Whisper only). IMPORTANT: Use 'all' for best results - tries YouTube API first, then yt-dlp, then Whisper as fallbacks.",
        conditional: {
          field: 'action',
          value: 'GET_TRANSCRIPTION',
        },
      },
      channelId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the YouTube channel',
        conditional: {
          field: 'action',
          value: ['LIST_CHANNEL_VIDEOS', 'SUBSCRIBE_TO_CHANNEL', 'UNSUBSCRIBE_FROM_CHANNEL'],
        },
      },
      text: {
        type: 'string',
        inputType: 'textarea',
        description: 'The text of the comment or reply',
        conditional: {
          field: 'action',
          value: ['COMMENT_ON_VIDEO', 'REPLY_TO_COMMENT'],
        },
      },
      commentId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the comment to reply to',
        conditional: {
          field: 'action',
          value: 'REPLY_TO_COMMENT',
        },
      },
      title: {
        type: 'string',
        inputType: 'text',
        description: 'The title of the playlist or video',
        conditional: {
          field: 'action',
          value: ['CREATE_PLAYLIST', 'UPDATE_VIDEO_METADATA', 'UPLOAD_VIDEO'],
        },
      },
      description: {
        type: 'string',
        inputType: 'textarea',
        description: 'The description of the playlist or video',
        conditional: {
          field: 'action',
          value: ['CREATE_PLAYLIST', 'UPDATE_VIDEO_METADATA', 'UPLOAD_VIDEO'],
        },
      },
      tags: {
        type: 'string',
        inputType: 'text',
        description: 'Comma-separated list of tags for the video',
        conditional: {
          field: 'action',
          value: ['UPDATE_VIDEO_METADATA', 'UPLOAD_VIDEO'],
        },
      },
      playlistId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the playlist',
        conditional: {
          field: 'action',
          value: ['ADD_VIDEO_TO_PLAYLIST', 'GET_PLAYLIST_ITEMS'],
        },
      },
      videoPath: {
        type: 'string',
        inputType: 'text',
        description: 'The local path to the video file to upload',
        conditional: {
          field: 'action',
          value: 'UPLOAD_VIDEO',
        },
      },
      maxResults: {
        type: 'number',
        inputType: 'number',
        description: 'The maximum number of results to return',
        default: 10,
        conditional: {
          field: 'action',
          value: ['SEARCH_VIDEOS', 'LIST_CHANNEL_VIDEOS', 'GET_MY_SUBSCRIPTIONS', 'GET_PLAYLIST_ITEMS'],
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the action was successful',
      },
      result: {
        type: 'object',
        description: 'The result of the action',
      },
      error: {
        type: 'string',
        description: 'Error message if the action failed',
      },
    },
  };

  constructor() {
    super('youtube-api');
    this.baseUrl = 'https://www.googleapis.com/youtube/v3';
    // In-memory cache for caption results
    this.captionCache = new Map();
    // Cache expiration time (24 hours)
    this.cacheExpiration = 24 * 60 * 60 * 1000;
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const userId = workflowEngine.userId;
      const accessToken = await AuthManager.getValidAccessToken(userId, 'google');

      if (!accessToken) {
        throw new Error('No valid access token. User needs to authenticate with Google.');
      }

      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const youtube = google.youtube({ version: 'v3', auth });

      const resolvedParams = workflowEngine.parameterResolver ? workflowEngine.parameterResolver.resolveParameters(params) : params;

      let result;
      switch (resolvedParams.action) {
        case 'ADD_VIDEO_TO_PLAYLIST':
          result = await this.addVideoToPlaylist(youtube, resolvedParams);
          break;
        case 'COMMENT_ON_VIDEO':
          result = await this.commentOnVideo(youtube, resolvedParams);
          break;
        case 'CREATE_PLAYLIST':
          result = await this.createPlaylist(youtube, resolvedParams);
          break;
        case 'DISLIKE_VIDEO':
          result = await this.dislikeVideo(youtube, resolvedParams);
          break;
        case 'GET_MY_SUBSCRIPTIONS':
          result = await this.getMySubscriptions(youtube, resolvedParams);
          break;
        case 'GET_PLAYLIST_ITEMS':
          result = await this.getPlaylistItems(youtube, resolvedParams);
          break;
        case 'GET_TRANSCRIPTION':
          result = await this.getTranscription(youtube, resolvedParams, userId);
          break;
        case 'GET_VIDEO_DETAILS':
          result = await this.getVideoDetails(youtube, resolvedParams);
          break;
        case 'LIKE_VIDEO':
          result = await this.likeVideo(youtube, resolvedParams);
          break;
        case 'LIST_CHANNEL_VIDEOS':
          result = await this.listChannelVideos(youtube, resolvedParams);
          break;
        case 'REPLY_TO_COMMENT':
          result = await this.replyToComment(youtube, resolvedParams);
          break;
        case 'SEARCH_VIDEOS':
          result = await this.searchVideos(youtube, resolvedParams);
          break;
        case 'SUBSCRIBE_TO_CHANNEL':
          result = await this.subscribeToChannel(youtube, resolvedParams);
          break;
        case 'UNSUBSCRIBE_FROM_CHANNEL':
          result = await this.unsubscribeFromChannel(youtube, resolvedParams);
          break;
        case 'UPDATE_VIDEO_METADATA':
          result = await this.updateVideoMetadata(youtube, resolvedParams);
          break;
        case 'UPLOAD_VIDEO':
          result = await this.uploadVideo(youtube, resolvedParams);
          break;
        default:
          throw new Error(`Unsupported YouTube action: '${resolvedParams.action}'`);
      }

      return this.formatOutput({
        success: true,
        result: result,
        error: null,
      });
    } catch (error) {
      console.error('Error executing YouTube API action:', error);
      return this.formatOutput({
        success: false,
        result: null,
        error: error.message,
      });
    }
  }

  // Placeholder methods for each action
  async searchVideos(youtube, { query, maxResults = 10 }) {
    if (!query) {
      throw new Error("'query' parameter is required for SEARCH_VIDEOS operation.");
    }
    const res = await youtube.search.list({
      part: 'snippet',
      q: query,
      maxResults: maxResults,
    });
    return res.data;
  }
  async getVideoDetails(youtube, { videoId }) {
    if (!videoId) {
      throw new Error("'videoId' parameter is required for GET_VIDEO_DETAILS operation.");
    }

    // Auto-convert URL to videoId if needed
    const extractor = new YouTubeCaptionExtractor();
    const actualVideoId = extractor.extractVideoId(videoId) || videoId;

    const res = await youtube.videos.list({
      part: 'snippet,contentDetails,statistics',
      id: actualVideoId,
    });
    return res.data;
  }
  async listChannelVideos(youtube, { channelId, maxResults = 10 }) {
    if (!channelId) {
      throw new Error("'channelId' parameter is required for LIST_CHANNEL_VIDEOS operation.");
    }
    const res = await youtube.search.list({
      part: 'snippet',
      channelId: channelId,
      maxResults: maxResults,
      order: 'date',
    });
    return res.data;
  }
  async likeVideo(youtube, { videoId }) {
    if (!videoId) {
      throw new Error("'videoId' parameter is required for LIKE_VIDEO operation.");
    }
    const res = await youtube.videos.rate({
      id: videoId,
      rating: 'like',
    });
    return res.data;
  }
  async dislikeVideo(youtube, { videoId }) {
    if (!videoId) {
      throw new Error("'videoId' parameter is required for DISLIKE_VIDEO operation.");
    }
    const res = await youtube.videos.rate({
      id: videoId,
      rating: 'dislike',
    });
    return res.data;
  }
  async commentOnVideo(youtube, { videoId, text }) {
    if (!videoId || !text) {
      throw new Error("'videoId' and 'text' parameters are required for COMMENT_ON_VIDEO operation.");
    }
    const res = await youtube.commentThreads.insert({
      part: 'snippet',
      requestBody: {
        snippet: {
          videoId: videoId,
          topLevelComment: {
            snippet: {
              textOriginal: text,
            },
          },
        },
      },
    });
    return res.data;
  }
  async replyToComment(youtube, { commentId, text }) {
    if (!commentId || !text) {
      throw new Error("'commentId' and 'text' parameters are required for REPLY_TO_COMMENT operation.");
    }
    const res = await youtube.comments.insert({
      part: 'snippet',
      requestBody: {
        snippet: {
          parentId: commentId,
          textOriginal: text,
        },
      },
    });
    return res.data;
  }
  async subscribeToChannel(youtube, { channelId }) {
    if (!channelId) {
      throw new Error("'channelId' parameter is required for SUBSCRIBE_TO_CHANNEL operation.");
    }
    const res = await youtube.subscriptions.insert({
      part: 'snippet',
      requestBody: {
        snippet: {
          resourceId: {
            kind: 'youtube#channel',
            channelId: channelId,
          },
        },
      },
    });
    return res.data;
  }
  async unsubscribeFromChannel(youtube, { channelId }) {
    if (!channelId) {
      throw new Error("'channelId' parameter is required for UNSUBSCRIBE_FROM_CHANNEL operation.");
    }
    // To unsubscribe, we need the subscription ID. We get this by searching for the subscription.
    const subList = await youtube.subscriptions.list({
      part: 'id',
      forChannelId: channelId,
      mine: true,
    });

    if (subList.data.items.length === 0) {
      throw new Error(`Not subscribed to channel ${channelId}`);
    }

    const subscriptionId = subList.data.items[0].id;

    const res = await youtube.subscriptions.delete({
      id: subscriptionId,
    });
    return res.data;
  }
  async getMySubscriptions(youtube, { maxResults = 10 }) {
    const res = await youtube.subscriptions.list({
      part: 'snippet',
      mine: true,
      maxResults: maxResults,
    });
    return res.data;
  }
  async createPlaylist(youtube, { title, description }) {
    if (!title) {
      throw new Error("'title' parameter is required for CREATE_PLAYLIST operation.");
    }
    const res = await youtube.playlists.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: title,
          description: description,
        },
        status: {
          privacyStatus: 'private',
        },
      },
    });
    return res.data;
  }
  async addVideoToPlaylist(youtube, { playlistId, videoId }) {
    if (!playlistId || !videoId) {
      throw new Error("'playlistId' and 'videoId' parameters are required for ADD_VIDEO_TO_PLAYLIST operation.");
    }
    const res = await youtube.playlistItems.insert({
      part: 'snippet',
      requestBody: {
        snippet: {
          playlistId: playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId: videoId,
          },
        },
      },
    });
    return res.data;
  }
  async getPlaylistItems(youtube, { playlistId, maxResults = 10 }) {
    if (!playlistId) {
      throw new Error("'playlistId' parameter is required for GET_PLAYLIST_ITEMS operation.");
    }
    const res = await youtube.playlistItems.list({
      part: 'snippet',
      playlistId: playlistId,
      maxResults: maxResults,
    });
    return res.data;
  }
  async updateVideoMetadata(youtube, { videoId, title, description, tags }) {
    if (!videoId) {
      throw new Error("'videoId' parameter is required for UPDATE_VIDEO_METADATA operation.");
    }
    const snippet = {};
    if (title) snippet.title = title;
    if (description) snippet.description = description;
    if (tags) snippet.tags = tags;

    const res = await youtube.videos.update({
      part: 'snippet',
      requestBody: {
        id: videoId,
        snippet: snippet,
      },
    });
    return res.data;
  }

  /**
   * Get cached result for a video if it exists and hasn't expired
   */
  getCachedResult(videoId) {
    const cached = this.captionCache.get(videoId);
    if (!cached) {
      return null;
    }

    const now = Date.now();
    if (now - cached.timestamp > this.cacheExpiration) {
      // Cache expired, remove it
      this.captionCache.delete(videoId);
      return null;
    }

    // Create a deep copy of the cached result to avoid modifying the cached version
    const resultCopy = JSON.parse(JSON.stringify(cached.result));

    // Update costs and add cache information
    resultCopy.totalCost = 0;
    resultCopy.finalResult.cost = 0;

    // Find the last successful attempt and modify it to indicate cache usage
    if (resultCopy.attempts && Array.isArray(resultCopy.attempts)) {
      // Find the last successful attempt
      const successfulAttempts = resultCopy.attempts.filter((attempt) => attempt.success === true);
      if (successfulAttempts.length > 0) {
        const lastSuccessfulAttempt = successfulAttempts[successfulAttempts.length - 1];
        // Modify the last successful attempt to indicate it was from cache
        lastSuccessfulAttempt.details += ' (retrieved from cache)';
        lastSuccessfulAttempt.cost = 0;
        // Update the content to indicate it was from cache
        lastSuccessfulAttempt.content = 'Result retrieved from cache';
      }
    }

    // Update method to indicate cache usage
    resultCopy.method = resultCopy.method + ' (cached)';

    // Update pricing information in finalResult if it exists
    if (resultCopy.finalResult.pricing) {
      resultCopy.finalResult.pricing.calculation = '0.00 minutes × $0.000/minute = $0.0000 (cached result)';
    }

    return resultCopy;
  }

  /**
   * Cache a transcription result
   */
  cacheResult(videoId, result) {
    const cacheEntry = {
      result: result,
      timestamp: Date.now(),
    };
    this.captionCache.set(videoId, cacheEntry);
    console.log(`[YouTube Transcription] Cached result for video: ${videoId}`);
  }
  async uploadVideo(youtube, { title, description, tags, videoPath }) {
    if (!videoPath) {
      throw new Error("'videoPath' parameter is required for UPLOAD_VIDEO operation.");
    }
    const fs = require('fs');
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found at path: ${videoPath}`);
    }

    const res = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: title,
          description: description,
          tags: tags,
        },
        status: {
          privacyStatus: 'private',
        },
      },
      media: {
        body: fs.createReadStream(videoPath),
      },
    });
    return res.data;
  }

  async getTranscription(youtube, { videoId, fallbackMethod = 'all' }, userId = null) {
    if (!videoId) {
      throw new Error("'videoId' parameter is required for GET_TRANSCRIPTION operation.");
    }

    // Auto-convert URL to videoId if needed, or construct URL from videoId
    const extractor = new YouTubeCaptionExtractor();
    const actualVideoId = extractor.extractVideoId(videoId) || videoId;
    const url = `https://www.youtube.com/watch?v=${actualVideoId}`;

    // Check cache first
    const cachedResult = this.getCachedResult(actualVideoId);
    if (cachedResult) {
      console.log(`[YouTube Transcription] Returning cached result for video: ${actualVideoId}`);
      return cachedResult;
    }

    console.log(`[YouTube Transcription] Starting 3-tier fallback system for video: ${videoId}`);
    console.log(`[YouTube Transcription] URL: ${url}`);
    console.log(`[YouTube Transcription] Fallback method: ${fallbackMethod}`);

    const results = {
      videoId: videoId,
      url: url,
      attempts: [],
      finalResult: null,
      totalCost: 0,
      method: null,
    };

    // TIER 1: YouTube API (Official)
    if (fallbackMethod === 'all' || fallbackMethod === 'api') {
      try {
        console.log('[YouTube Transcription] TIER 1: Attempting YouTube API...');

        const res = await youtube.captions.list({
          part: 'snippet',
          videoId: actualVideoId,
        });

        if (res.data.items.length === 0) {
          throw new Error('No captions found via YouTube API');
        }

        const captionId = res.data.items[0].id;
        const caption = await youtube.captions.download({
          id: captionId,
          tfmt: 'srt',
        });

        // Parse SRT content to clean text
        const extractor = new YouTubeCaptionExtractor();
        const cleanContent = extractor.parseSRTContent(caption.data);

        results.attempts.push({
          tier: 1,
          method: 'YouTube API',
          success: true,
          content: cleanContent,
          cost: 0,
          details: 'Successfully retrieved captions via official YouTube API',
        });

        results.finalResult = {
          success: true,
          content: cleanContent,
          method: 'YouTube API (Official)',
          cost: 0,
          length: cleanContent.length,
          source: 'youtube_api',
        };

        results.method = 'YouTube API';
        console.log(`[YouTube Transcription] TIER 1 SUCCESS: Retrieved ${cleanContent.length} characters via YouTube API`);
        this.cacheResult(actualVideoId, results);
        return results;
      } catch (error) {
        const errorMsg = error.response?.status === 403 ? 'Access denied to captions - insufficient permissions or restricted access' : error.message;

        results.attempts.push({
          tier: 1,
          method: 'YouTube API',
          success: false,
          error: errorMsg,
          details: 'YouTube API caption access failed',
        });

        console.log(`[YouTube Transcription] TIER 1 FAILED: ${errorMsg}`);
      }
    }

    // TIER 2: yt-dlp Caption Extraction
    if (fallbackMethod === 'all' || fallbackMethod === 'ytdlp') {
      try {
        console.log('[YouTube Transcription] TIER 2: Attempting yt-dlp caption extraction...');

        const extractor = new YouTubeCaptionExtractor();
        const captionResult = await extractor.extractCaptions(url);

        results.attempts.push({
          tier: 2,
          method: 'yt-dlp',
          success: true,
          content: captionResult.content,
          cost: 0,
          details: `Successfully extracted captions using ${captionResult.method}`,
        });

        results.finalResult = {
          success: true,
          content: captionResult.content,
          method: captionResult.method,
          cost: 0,
          length: captionResult.length,
          source: 'ytdlp',
        };

        results.method = 'yt-dlp';
        console.log(`[YouTube Transcription] TIER 2 SUCCESS: Retrieved ${captionResult.length} characters via ${captionResult.method}`);
        this.cacheResult(actualVideoId, results);
        return results;
      } catch (error) {
        results.attempts.push({
          tier: 2,
          method: 'yt-dlp',
          success: false,
          error: error.message,
          details: 'yt-dlp caption extraction failed',
        });

        console.log(`[YouTube Transcription] TIER 2 FAILED: ${error.message}`);
      }
    }

    // TIER 3: OpenAI Whisper Transcription
    if (fallbackMethod === 'all' || fallbackMethod === 'whisper') {
      try {
        console.log('[YouTube Transcription] TIER 3: Attempting OpenAI Whisper transcription...');

        // Download audio first
        const extractor = new YouTubeCaptionExtractor();
        const audioResult = await extractor.downloadAudio(url);

        if (!audioResult.success) {
          throw new Error('Failed to download audio for Whisper transcription');
        }

        // Transcribe with Whisper
        const transcriber = new WhisperTranscriber(userId);
        const transcriptionResult = await transcriber.transcribeAudio(audioResult.filePath, userId);

        // Clean up audio file
        transcriber.cleanupAudioFile(audioResult.filePath);

        results.attempts.push({
          tier: 3,
          method: 'OpenAI Whisper',
          success: true,
          content: transcriptionResult.content,
          cost: transcriptionResult.estimatedCost,
          details: `Transcribed ${transcriptionResult.chunksProcessed} chunk(s), ${transcriptionResult.successfulChunks} successful`,
          durationMinutes: transcriptionResult.durationMinutes,
          pricing: transcriptionResult.pricing,
        });

        results.finalResult = {
          success: true,
          content: transcriptionResult.content,
          method: transcriptionResult.method,
          cost: transcriptionResult.estimatedCost,
          length: transcriptionResult.content.length,
          source: 'whisper',
          durationMinutes: transcriptionResult.durationMinutes,
          chunksProcessed: transcriptionResult.chunksProcessed,
          pricing: transcriptionResult.pricing,
        };

        results.totalCost = transcriptionResult.estimatedCost;
        results.method = 'OpenAI Whisper';
        console.log(
          `[YouTube Transcription] TIER 3 SUCCESS: Transcribed ${
            transcriptionResult.content.length
          } characters via Whisper (Cost: $${transcriptionResult.estimatedCost.toFixed(4)})`
        );
        this.cacheResult(actualVideoId, results);
        return results;
      } catch (error) {
        results.attempts.push({
          tier: 3,
          method: 'OpenAI Whisper',
          success: false,
          error: error.message,
          details: 'OpenAI Whisper transcription failed',
        });

        console.log(`[YouTube Transcription] TIER 3 FAILED: ${error.message}`);
      }
    }

    // All tiers failed
    const allErrors = results.attempts.map((attempt) => `${attempt.method}: ${attempt.error}`).join('; ');
    console.log(`[YouTube Transcription] ALL TIERS FAILED: ${allErrors}`);

    throw new Error(`All transcription methods failed. Errors: ${allErrors}`);
  }
}

export default new YouTubeAPI();
