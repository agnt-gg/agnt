import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


/**
 * YouTube API Plugin Tool
 *
 * Manage videos, comments, playlists, and transcriptions.
 */
class YouTubeAPI {
  constructor() {
    this.name = 'youtube-api';
    this.baseUrl = 'https://www.googleapis.com/youtube/v3';
    this.captionCache = new Map();
    this.cacheExpiration = 24 * 60 * 60 * 1000;
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[YouTubePlugin] Executing with params:', JSON.stringify(params, null, 2));

    try {
      // Import AuthManager dynamically
      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const userId = workflowEngine.userId;
      const accessToken = await AuthManager.getValidAccessToken(userId, 'google');

      if (!accessToken) {
        throw new Error('No valid access token. User needs to authenticate with Google.');
      }

      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const youtube = google.youtube({ version: 'v3', auth });

      let result;
      switch (params.action) {
        case 'ADD_VIDEO_TO_PLAYLIST':
          result = await this.addVideoToPlaylist(youtube, params);
          break;
        case 'COMMENT_ON_VIDEO':
          result = await this.commentOnVideo(youtube, params);
          break;
        case 'CREATE_PLAYLIST':
          result = await this.createPlaylist(youtube, params);
          break;
        case 'DISLIKE_VIDEO':
          result = await this.dislikeVideo(youtube, params);
          break;
        case 'GET_MY_SUBSCRIPTIONS':
          result = await this.getMySubscriptions(youtube, params);
          break;
        case 'GET_PLAYLIST_ITEMS':
          result = await this.getPlaylistItems(youtube, params);
          break;
        case 'GET_TRANSCRIPTION':
          result = await this.getTranscription(youtube, params, userId);
          break;
        case 'GET_VIDEO_DETAILS':
          result = await this.getVideoDetails(youtube, params);
          break;
        case 'LIKE_VIDEO':
          result = await this.likeVideo(youtube, params);
          break;
        case 'LIST_CHANNEL_VIDEOS':
          result = await this.listChannelVideos(youtube, params);
          break;
        case 'REPLY_TO_COMMENT':
          result = await this.replyToComment(youtube, params);
          break;
        case 'SEARCH_VIDEOS':
          result = await this.searchVideos(youtube, params);
          break;
        case 'SUBSCRIBE_TO_CHANNEL':
          result = await this.subscribeToChannel(youtube, params);
          break;
        case 'UNSUBSCRIBE_FROM_CHANNEL':
          result = await this.unsubscribeFromChannel(youtube, params);
          break;
        case 'UPDATE_VIDEO_METADATA':
          result = await this.updateVideoMetadata(youtube, params);
          break;
        case 'UPLOAD_VIDEO':
          result = await this.uploadVideo(youtube, params);
          break;
        default:
          throw new Error(`Unsupported YouTube action: '${params.action}'`);
      }

      return {
        success: true,
        result: result,
        error: null,
      };
    } catch (error) {
      console.error('[YouTubePlugin] Error:', error);
      return {
        success: false,
        result: null,
        error: error.message,
      };
    }
  }

  extractVideoId(input) {
    if (!input) return null;
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

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
    const actualVideoId = this.extractVideoId(videoId) || videoId;
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
      throw new Error(
        "'playlistId' and 'videoId' parameters are required for ADD_VIDEO_TO_PLAYLIST operation."
      );
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

  async uploadVideo(youtube, { title, description, tags, videoPath }) {
    if (!videoPath) {
      throw new Error("'videoPath' parameter is required for UPLOAD_VIDEO operation.");
    }
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

  getCachedResult(videoId) {
    const cached = this.captionCache.get(videoId);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > this.cacheExpiration) {
      this.captionCache.delete(videoId);
      return null;
    }

    const resultCopy = JSON.parse(JSON.stringify(cached.result));
    resultCopy.totalCost = 0;
    resultCopy.finalResult.cost = 0;

    if (resultCopy.attempts && Array.isArray(resultCopy.attempts)) {
      const successfulAttempts = resultCopy.attempts.filter((attempt) => attempt.success === true);
      if (successfulAttempts.length > 0) {
        const lastSuccessfulAttempt = successfulAttempts[successfulAttempts.length - 1];
        lastSuccessfulAttempt.details += ' (retrieved from cache)';
        lastSuccessfulAttempt.cost = 0;
        lastSuccessfulAttempt.content = 'Result retrieved from cache';
      }
    }

    resultCopy.method = resultCopy.method + ' (cached)';
    if (resultCopy.finalResult.pricing) {
      resultCopy.finalResult.pricing.calculation =
        '0.00 minutes × $0.000/minute = $0.0000 (cached result)';
    }

    return resultCopy;
  }

  cacheResult(videoId, result) {
    const cacheEntry = {
      result: result,
      timestamp: Date.now(),
    };
    this.captionCache.set(videoId, cacheEntry);
    console.log(`[YouTubePlugin] Cached result for video: ${videoId}`);
  }

  parseSRTContent(srtContent) {
    if (!srtContent) return '';
    const lines = srtContent.split('\n');
    const textLines = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^\d+$/.test(trimmed)) continue;
      if (/^\d{2}:\d{2}:\d{2}/.test(trimmed)) continue;
      textLines.push(trimmed);
    }
    return textLines.join(' ');
  }

  async getTranscription(youtube, { videoId, fallbackMethod = 'all' }, userId = null) {
    if (!videoId) {
      throw new Error("'videoId' parameter is required for GET_TRANSCRIPTION operation.");
    }

    const actualVideoId = this.extractVideoId(videoId) || videoId;
    const url = `https://www.youtube.com/watch?v=${actualVideoId}`;

    const cachedResult = this.getCachedResult(actualVideoId);
    if (cachedResult) {
      console.log(`[YouTubePlugin] Returning cached result for video: ${actualVideoId}`);
      return cachedResult;
    }

    console.log(`[YouTubePlugin] Starting 3-tier fallback system for video: ${videoId}`);
    console.log(`[YouTubePlugin] URL: ${url}`);
    console.log(`[YouTubePlugin] Fallback method: ${fallbackMethod}`);

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
        console.log('[YouTubePlugin] TIER 1: Attempting YouTube API...');

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

        const cleanContent = this.parseSRTContent(caption.data);

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
        console.log(
          `[YouTubePlugin] TIER 1 SUCCESS: Retrieved ${cleanContent.length} characters via YouTube API`
        );
        this.cacheResult(actualVideoId, results);
        return results;
      } catch (error) {
        const errorMsg =
          error.response?.status === 403
            ? 'Access denied to captions - insufficient permissions or restricted access'
            : error.message;

        results.attempts.push({
          tier: 1,
          method: 'YouTube API',
          success: false,
          error: errorMsg,
          details: 'YouTube API caption access failed',
        });

        console.log(`[YouTubePlugin] TIER 1 FAILED: ${errorMsg}`);
      }
    }

    // TIER 2: yt-dlp Caption Extraction
    if (fallbackMethod === 'all' || fallbackMethod === 'ytdlp') {
      try {
        console.log('[YouTubePlugin] TIER 2: Attempting yt-dlp caption extraction...');

        // Import YouTubeCaptionExtractor dynamically
        const YouTubeCaptionExtractorModule = await import(
          '../../../src/utils/youtube-caption-extractor.js'
        );
        const YouTubeCaptionExtractor = YouTubeCaptionExtractorModule.default;

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
        console.log(
          `[YouTubePlugin] TIER 2 SUCCESS: Retrieved ${captionResult.length} characters via ${captionResult.method}`
        );
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

        console.log(`[YouTubePlugin] TIER 2 FAILED: ${error.message}`);
      }
    }

    // TIER 3: OpenAI Whisper Transcription
    if (fallbackMethod === 'all' || fallbackMethod === 'whisper') {
      try {
        console.log('[YouTubePlugin] TIER 3: Attempting OpenAI Whisper transcription...');

        // Import utilities dynamically
        const YouTubeCaptionExtractorModule = await import(
          '../../../src/utils/youtube-caption-extractor.js'
        );
        const YouTubeCaptionExtractor = YouTubeCaptionExtractorModule.default;

        const WhisperTranscriberModule = await import(`file://${path.join(APP_PATH, 'backend/src/utils/whisper-transcriber.js').replace(/\\/g, '/')}`);
        const WhisperTranscriber = WhisperTranscriberModule.default;

        const extractor = new YouTubeCaptionExtractor();
        const audioResult = await extractor.downloadAudio(url);

        if (!audioResult.success) {
          throw new Error('Failed to download audio for Whisper transcription');
        }

        const transcriber = new WhisperTranscriber(userId);
        const transcriptionResult = await transcriber.transcribeAudio(audioResult.filePath, userId);

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
          `[YouTubePlugin] TIER 3 SUCCESS: Transcribed ${
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

        console.log(`[YouTubePlugin] TIER 3 FAILED: ${error.message}`);
      }
    }

    const allErrors = results.attempts
      .map((attempt) => `${attempt.method}: ${attempt.error}`)
      .join('; ');
    console.log(`[YouTubePlugin] ALL TIERS FAILED: ${allErrors}`);

    throw new Error(`All transcription methods failed. Errors: ${allErrors}`);
  }
}

export default new YouTubeAPI();
