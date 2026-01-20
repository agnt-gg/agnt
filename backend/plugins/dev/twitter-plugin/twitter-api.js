import { Client } from 'twitter-api-sdk';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


/**
 * Twitter/X API Plugin Tool
 *
 * Post tweets, search, manage follows, and monitor mentions.
 */
class TwitterAPI {
  constructor() {
    this.name = 'twitter-api';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[TwitterPlugin] Executing with params:', JSON.stringify(params, null, 2));
    this.validateParams(params);

    try {
      // Import AuthManager dynamically
      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const userId = workflowEngine.userId;
      const accessToken = await AuthManager.getValidAccessToken(userId, 'twitter');
      if (!accessToken) {
        throw new Error('No valid access token. Please connect to Twitter in Settings.');
      }

      const client = new Client(accessToken);

      let response;
      switch (params.action.toUpperCase()) {
        case 'POST':
          response = await client.tweets.createTweet({ text: params.text });
          return { success: true, tweetId: response.data.id };

        case 'DELETE':
          response = await client.tweets.deleteTweetById(params.tweetId);
          return { success: true, deletedTweetId: params.tweetId };

        case 'REPLY':
          response = await client.tweets.createTweet({
            text: params.text,
            reply: { in_reply_to_tweet_id: params.tweetId },
          });
          return { success: true, replyTweetId: response.data.id };

        case 'LIKE':
          return await this.likeTweet(client, accessToken, params);

        case 'GET_TIMELINE':
          return await this.getTimeline(client, params);

        case 'GET_PROFILE':
          return await this.getProfile(client, params);

        case 'GET_TWEETS':
          return await this.getTweets(client, params);

        case 'SEARCH':
          return await this.searchTweets(client, params);

        case 'MONITOR_REPLIES':
          return await this.monitorReplies(client, params);

        case 'FOLLOW':
          return await this.followUser(client, accessToken, params);

        case 'UNFOLLOW':
          return await this.unfollowUser(client, accessToken, params);

        case 'BULK_UNFOLLOW':
          return await this.bulkUnfollow(client, accessToken, params);

        case 'CHECK_MENTIONS':
          return await this.checkMentions(client, params);

        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }
    } catch (error) {
      console.error('[TwitterPlugin] Error:', error);
      return {
        success: false,
        error: error.message || JSON.stringify(error),
      };
    }
  }

  async likeTweet(client, accessToken, params) {
    const userResponse = await client.users.findMyUser();
    if (!userResponse.data) {
      throw new Error('Unable to retrieve current user information');
    }

    const url = `https://api.twitter.com/2/users/${userResponse.data.id}/likes`;
    const likeResponse = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tweet_id: params.tweetId }),
    });

    if (!likeResponse.ok) {
      const errorData = await likeResponse.json();
      throw new Error(`Twitter API error: ${errorData.title || likeResponse.statusText}`);
    }

    return { success: true, likedTweetId: params.tweetId };
  }

  async getTimeline(client, params) {
    const userResponse = await client.users.findUserByUsername(params.userId);
    if (!userResponse.data) {
      throw new Error(`User not found: ${params.userId}`);
    }

    const response = await client.tweets.usersIdTimeline(userResponse.data.id, {
      max_results: params.maxResults || 10,
      'tweet.fields': 'created_at,text',
    });

    return { success: true, timeline: response.data };
  }

  async getProfile(client, params) {
    const response = await client.users.findUserByUsername(params.userId, {
      'user.fields': ['description', 'name', 'profile_image_url', 'public_metrics'],
    });

    if (!response.data) {
      throw new Error(`User not found: ${params.userId}`);
    }

    return { success: true, userProfile: response.data };
  }

  async getTweets(client, params) {
    const userResponse = await client.users.findUserByUsername(params.userId);
    if (!userResponse.data) {
      throw new Error(`User not found: ${params.userId}`);
    }

    const response = await client.tweets.usersIdTweets(userResponse.data.id, {
      max_results: params.maxResults || 10,
      'tweet.fields': 'created_at,text',
    });

    return { success: true, tweets: response.data };
  }

  async searchTweets(client, params) {
    const maxResults = Math.max(10, Math.min(100, params.maxResults || 10));

    const response = await client.tweets.tweetsRecentSearch({
      query: params.query,
      max_results: maxResults,
      'tweet.fields': 'created_at,text,author_id,public_metrics',
      expansions: 'author_id',
      'user.fields': 'username,name',
    });

    let tweets = response.data || [];
    const users = response.includes?.users || [];

    tweets = tweets.map((tweet) => {
      if (tweet.author_id) {
        const author = users.find((user) => user.id === tweet.author_id);
        if (author) {
          tweet.author_username = author.username;
          tweet.author_name = author.name;
        }
      }
      return tweet;
    });

    return { success: true, searchResults: tweets };
  }

  async monitorReplies(client, params) {
    const response = await client.tweets.tweetsRecentSearch({
      query: `conversation_id:${params.tweetId}`,
      max_results: params.maxResults || 20,
      'tweet.fields': 'created_at,text,author_id,referenced_tweets',
      expansions: 'author_id',
      'user.fields': 'username,name',
    });

    let replies = (response.data || []).filter((tweet) =>
      tweet.referenced_tweets?.some((ref) => ref.id === params.tweetId && ref.type === 'replied_to')
    );

    const users = response.includes?.users || [];
    replies = replies.map((reply) => {
      if (reply.author_id) {
        const author = users.find((user) => user.id === reply.author_id);
        if (author) {
          reply.author_username = author.username;
          reply.author_name = author.name;
        }
      }
      return reply;
    });

    return { success: true, replies };
  }

  async followUser(client, accessToken, params) {
    const currentUserResponse = await client.users.findMyUser();
    if (!currentUserResponse.data) {
      throw new Error('Unable to retrieve current user information');
    }

    const targetUserResponse = await client.users.findUserByUsername(params.targetUserId);
    if (!targetUserResponse.data) {
      throw new Error(`Target user not found: ${params.targetUserId}`);
    }

    const url = `https://api.twitter.com/2/users/${currentUserResponse.data.id}/following`;
    const followResponse = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target_user_id: targetUserResponse.data.id }),
    });

    if (!followResponse.ok) {
      const errorData = await followResponse.json();
      throw new Error(`Twitter API error: ${errorData.title || followResponse.statusText}`);
    }

    return {
      success: true,
      followedUserId: targetUserResponse.data.id,
      followedUsername: params.targetUserId,
    };
  }

  async unfollowUser(client, accessToken, params) {
    const currentUserResponse = await client.users.findMyUser();
    if (!currentUserResponse.data) {
      throw new Error('Unable to retrieve current user information');
    }

    const targetUserResponse = await client.users.findUserByUsername(params.targetUserId);
    if (!targetUserResponse.data) {
      throw new Error(`Target user not found: ${params.targetUserId}`);
    }

    const url = `https://api.twitter.com/2/users/${currentUserResponse.data.id}/following/${targetUserResponse.data.id}`;
    const unfollowResponse = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!unfollowResponse.ok) {
      const errorData = await unfollowResponse.json();
      throw new Error(`Twitter API error: ${errorData.title || unfollowResponse.statusText}`);
    }

    return {
      success: true,
      unfollowedUserId: targetUserResponse.data.id,
      unfollowedUsername: params.targetUserId,
    };
  }

  async bulkUnfollow(client, accessToken, params) {
    const currentUserResponse = await client.users.findMyUser();
    if (!currentUserResponse.data) {
      throw new Error('Unable to retrieve current user information');
    }

    const results = [];
    const errors = [];

    for (const targetUserId of params.userIds) {
      try {
        const targetUserResponse = await client.users.findUserByUsername(targetUserId);
        if (!targetUserResponse.data) {
          errors.push({ userId: targetUserId, error: 'User not found' });
          continue;
        }

        const url = `https://api.twitter.com/2/users/${currentUserResponse.data.id}/following/${targetUserResponse.data.id}`;
        const unfollowResponse = await fetch(url, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (unfollowResponse.ok) {
          results.push({ userId: targetUserId, success: true });
        } else {
          const errorData = await unfollowResponse.json();
          errors.push({ userId: targetUserId, error: errorData.title || 'Unknown error' });
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        errors.push({ userId: targetUserId, error: error.message });
      }
    }

    return {
      success: true,
      results,
      errors,
      summary: {
        attempted: params.userIds.length,
        successful: results.length,
        failed: errors.length,
      },
    };
  }

  async checkMentions(client, params) {
    const userResponse = await client.users.findMyUser();
    if (!userResponse.data) {
      throw new Error('Unable to retrieve current user information');
    }

    const response = await client.tweets.usersIdMentions(userResponse.data.id, {
      max_results: params.maxResults || 10,
      'tweet.fields': 'created_at,text,author_id,public_metrics',
      expansions: 'author_id',
      'user.fields': 'username,name,profile_image_url',
    });

    let mentions = response.data || [];
    const users = response.includes?.users || [];

    mentions = mentions.map((mention) => {
      if (mention.author_id) {
        const author = users.find((user) => user.id === mention.author_id);
        if (author) {
          mention.author_username = author.username;
          mention.author_name = author.name;
          mention.author_profile_image_url = author.profile_image_url;
        }
      }
      return mention;
    });

    return { success: true, mentions };
  }

  validateParams(params) {
    if (!params.action) {
      throw new Error('Action is required');
    }

    const action = params.action.toUpperCase();

    switch (action) {
      case 'POST':
        if (!params.text) throw new Error('Tweet text is required');
        if (params.text.length > 280) throw new Error('Tweet text must be 280 characters or less');
        break;
      case 'DELETE':
      case 'LIKE':
      case 'MONITOR_REPLIES':
        if (!params.tweetId) throw new Error('Tweet ID is required');
        break;
      case 'REPLY':
        if (!params.tweetId) throw new Error('Tweet ID is required');
        if (!params.text) throw new Error('Reply text is required');
        break;
      case 'GET_TIMELINE':
      case 'GET_PROFILE':
      case 'GET_TWEETS':
        if (!params.userId) throw new Error('Username is required');
        break;
      case 'SEARCH':
        if (!params.query) throw new Error('Search query is required');
        break;
      case 'FOLLOW':
      case 'UNFOLLOW':
        if (!params.targetUserId) throw new Error('Target username is required');
        break;
      case 'BULK_UNFOLLOW':
        if (!params.userIds || !Array.isArray(params.userIds) || params.userIds.length === 0) {
          throw new Error('userIds must be a non-empty array');
        }
        break;
    }
  }
}

export default new TwitterAPI();
