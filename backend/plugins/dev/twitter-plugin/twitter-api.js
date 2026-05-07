import { Client } from 'twitter-api-sdk';

/**
 * Twitter/X API Plugin Tool
 *
 * Post tweets, quote tweets, search, manage follows, and monitor mentions.
 */
class TwitterAPI {
  constructor() {
    this.name = 'twitter-api';
    this.tweetFields = 'created_at,text,author_id,conversation_id,public_metrics,referenced_tweets,entities,attachments,lang,possibly_sensitive,reply_settings';
    this.userFields = 'created_at,description,location,name,profile_image_url,protected,public_metrics,url,username,verified,verified_type';
    this.mediaFields = 'type,url,preview_image_url,alt_text,public_metrics';
    this.tweetExpansions = 'author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[TwitterPlugin] Executing with params:', JSON.stringify(this.redactParams(params), null, 2));
    this.normalizeParams(params);
    this.validateParams(params);

    try {
      const accessToken = params.__auth?.token;
      if (!accessToken) {
        throw new Error('Not connected to Twitter/X. Connect in Settings → Connections.');
      }

      const client = new Client(accessToken);

      let response;
      switch (params.action.toUpperCase()) {
        case 'POST':
          response = await client.tweets.createTweet({ text: params.text });
          return { success: true, tweetId: response.data.id, url: this.tweetUrl(response.data.id) };

        case 'DELETE':
          response = await client.tweets.deleteTweetById(params.tweetId);
          return { success: true, deletedTweetId: params.tweetId, response };

        case 'REPLY':
          response = await client.tweets.createTweet({
            text: params.text,
            reply: { in_reply_to_tweet_id: params.tweetId },
          });
          return { success: true, replyTweetId: response.data.id, repliedToTweetId: params.tweetId, url: this.tweetUrl(response.data.id) };

        case 'QUOTE_TWEET':
          response = await client.tweets.createTweet({
            text: params.text,
            quote_tweet_id: params.tweetId,
          });
          return { success: true, quoteTweetId: response.data.id, quotedTweetId: params.tweetId, url: this.tweetUrl(response.data.id) };

        case 'LIKE':
          return await this.likeTweet(client, accessToken, params);

        case 'UNLIKE':
          return await this.unlikeTweet(client, accessToken, params);

        case 'RETWEET':
          return await this.retweet(client, accessToken, params);

        case 'UNRETWEET':
          return await this.unretweet(client, accessToken, params);

        case 'GET_ME':
          return await this.getMe(client);

        case 'GET_TWEET':
          return await this.getTweet(client, params);

        case 'GET_CONVERSATION':
          return await this.getConversation(client, params);

        case 'GET_TIMELINE':
          return await this.getTimeline(client, params);

        case 'GET_PROFILE':
          return await this.getProfile(client, params);

        case 'GET_TWEETS':
          return await this.getTweets(client, params);

        case 'SEARCH':
        case 'ADVANCED_SEARCH':
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

  redactParams(params) {
    const copy = { ...params };
    if (copy.__auth) copy.__auth = { ...copy.__auth, token: copy.__auth.token ? '[REDACTED]' : undefined };
    return copy;
  }

  normalizeParams(params) {
    if (!params || typeof params !== 'object') return;
    if (params.tweetId) params.tweetId = this.normalizeTweetId(params.tweetId);
    if (params.userId) params.userId = this.normalizeUsername(params.userId);
    if (params.targetUserId) params.targetUserId = this.normalizeUsername(params.targetUserId);
    if (Array.isArray(params.userIds)) params.userIds = params.userIds.map((id) => this.normalizeUsername(id));
  }

  normalizeTweetId(value) {
    const text = String(value || '').trim();
    const match = text.match(/(?:twitter\.com|x\.com)\/[^/]+\/status(?:es)?\/(\d+)/i) || text.match(/^(\d+)$/);
    if (!match) return text;
    return match[1];
  }

  normalizeUsername(value) {
    const text = String(value || '').trim();
    const urlMatch = text.match(/(?:twitter\.com|x\.com)\/([^/?#]+)/i);
    const username = (urlMatch ? urlMatch[1] : text).replace(/^@/, '').trim();
    return username;
  }

  tweetUrl(tweetId, username = 'i') {
    return `https://x.com/${username}/status/${tweetId}`;
  }

  requestedMax(params, fallback = 10, apiMinimum = 5) {
    const requested = Math.max(1, Math.min(100, Number(params.maxResults || fallback)));
    const apiMax = Math.max(apiMinimum, requested);
    return { requested, apiMax };
  }

  async apiFetch(accessToken, url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const detail = data?.detail || data?.title || data?.errors?.[0]?.message || response.statusText;
      throw new Error(`Twitter API error ${response.status}: ${detail}`);
    }

    return data;
  }

  async resolveUser(client, identifier) {
    const normalized = this.normalizeUsername(identifier);
    const isNumericId = /^\d+$/.test(normalized);
    const response = isNumericId
      ? await client.users.findUserById(normalized, { 'user.fields': this.userFields })
      : await client.users.findUserByUsername(normalized, { 'user.fields': this.userFields });

    if (!response.data) {
      throw new Error(`User not found: ${identifier}`);
    }
    return response.data;
  }

  enrichTweets(response) {
    const users = response.includes?.users || [];
    const tweetsById = new Map((response.includes?.tweets || []).map((tweet) => [tweet.id, tweet]));
    const mediaByKey = new Map((response.includes?.media || []).map((media) => [media.media_key, media]));

    return (response.data || []).map((tweet) => this.enrichTweet(tweet, users, tweetsById, mediaByKey));
  }

  enrichTweet(tweet, users = [], tweetsById = new Map(), mediaByKey = new Map()) {
    const author = users.find((user) => user.id === tweet.author_id);
    if (author) {
      tweet.author = author;
      tweet.author_username = author.username;
      tweet.author_name = author.name;
      tweet.url = this.tweetUrl(tweet.id, author.username);
    } else {
      tweet.url = this.tweetUrl(tweet.id);
    }

    if (tweet.referenced_tweets) {
      tweet.referenced_tweets = tweet.referenced_tweets.map((ref) => ({
        ...ref,
        tweet: tweetsById.get(ref.id) || undefined,
      }));
    }

    if (tweet.attachments?.media_keys) {
      tweet.media = tweet.attachments.media_keys.map((key) => mediaByKey.get(key)).filter(Boolean);
    }

    return tweet;
  }

  async getMe(client) {
    const response = await client.users.findMyUser({ 'user.fields': this.userFields });
    if (!response.data) {
      throw new Error('Unable to retrieve current user information');
    }
    return { success: true, userProfile: response.data };
  }

  async likeTweet(client, accessToken, params) {
    const userResponse = await client.users.findMyUser();
    if (!userResponse.data) {
      throw new Error('Unable to retrieve current user information');
    }

    const url = `https://api.twitter.com/2/users/${userResponse.data.id}/likes`;
    const data = await this.apiFetch(accessToken, url, {
      method: 'POST',
      body: JSON.stringify({ tweet_id: params.tweetId }),
    });

    return { success: true, likedTweetId: params.tweetId, response: data };
  }

  async unlikeTweet(client, accessToken, params) {
    const userResponse = await client.users.findMyUser();
    if (!userResponse.data) {
      throw new Error('Unable to retrieve current user information');
    }

    const url = `https://api.twitter.com/2/users/${userResponse.data.id}/likes/${params.tweetId}`;
    const data = await this.apiFetch(accessToken, url, { method: 'DELETE' });

    return { success: true, unlikedTweetId: params.tweetId, response: data };
  }

  async retweet(client, accessToken, params) {
    const userResponse = await client.users.findMyUser();
    if (!userResponse.data) {
      throw new Error('Unable to retrieve current user information');
    }

    const url = `https://api.twitter.com/2/users/${userResponse.data.id}/retweets`;
    const data = await this.apiFetch(accessToken, url, {
      method: 'POST',
      body: JSON.stringify({ tweet_id: params.tweetId }),
    });

    return { success: true, retweetedTweetId: params.tweetId, response: data };
  }

  async unretweet(client, accessToken, params) {
    const userResponse = await client.users.findMyUser();
    if (!userResponse.data) {
      throw new Error('Unable to retrieve current user information');
    }

    const url = `https://api.twitter.com/2/users/${userResponse.data.id}/retweets/${params.tweetId}`;
    const data = await this.apiFetch(accessToken, url, { method: 'DELETE' });

    return { success: true, unretweetedTweetId: params.tweetId, response: data };
  }

  async getTweet(client, params) {
    const response = await client.tweets.findTweetById(params.tweetId, {
      'tweet.fields': this.tweetFields,
      expansions: this.tweetExpansions,
      'user.fields': this.userFields,
      'media.fields': this.mediaFields,
    });

    if (!response.data) {
      throw new Error(`Tweet not found: ${params.tweetId}`);
    }

    const tweet = this.enrichTweet(
      response.data,
      response.includes?.users || [],
      new Map((response.includes?.tweets || []).map((t) => [t.id, t])),
      new Map((response.includes?.media || []).map((m) => [m.media_key, m]))
    );

    return { success: true, tweet, includes: response.includes || {} };
  }

  async getConversation(client, params) {
    let conversationId = params.conversationId || params.tweetId;
    let rootTweet;

    if (params.tweetId) {
      const root = await this.getTweet(client, params);
      rootTweet = root.tweet;
      conversationId = rootTweet.conversation_id || params.tweetId;
    }

    const { requested, apiMax } = this.requestedMax(params, 50, 10);
    const response = await client.tweets.tweetsRecentSearch({
      query: `conversation_id:${conversationId}`,
      max_results: apiMax,
      'tweet.fields': this.tweetFields,
      expansions: this.tweetExpansions,
      'user.fields': this.userFields,
      'media.fields': this.mediaFields,
    });

    const tweets = this.enrichTweets(response).slice(0, requested);
    return { success: true, conversationId, rootTweet, tweets, includes: response.includes || {} };
  }

  async getTimeline(client, params) {
    const user = await this.resolveUser(client, params.userId);
    const { requested, apiMax } = this.requestedMax(params, 10, 5);

    const response = await client.tweets.usersIdTimeline(user.id, {
      max_results: apiMax,
      'tweet.fields': this.tweetFields,
      expansions: this.tweetExpansions,
      'user.fields': this.userFields,
      'media.fields': this.mediaFields,
    });

    return { success: true, user, timeline: this.enrichTweets(response).slice(0, requested), includes: response.includes || {} };
  }

  async getProfile(client, params) {
    const user = await this.resolveUser(client, params.userId);
    return { success: true, userProfile: user };
  }

  async getTweets(client, params) {
    const user = await this.resolveUser(client, params.userId);
    const { requested, apiMax } = this.requestedMax(params, 10, 5);

    const response = await client.tweets.usersIdTweets(user.id, {
      max_results: apiMax,
      'tweet.fields': this.tweetFields,
      expansions: this.tweetExpansions,
      'user.fields': this.userFields,
      'media.fields': this.mediaFields,
    });

    return { success: true, user, tweets: this.enrichTweets(response).slice(0, requested), includes: response.includes || {} };
  }

  buildSearchQuery(params) {
    let query = params.query;
    if (params.fromUser) query += ` from:${this.normalizeUsername(params.fromUser)}`;
    if (params.toUser) query += ` to:${this.normalizeUsername(params.toUser)}`;
    if (params.mentionsUser) query += ` @${this.normalizeUsername(params.mentionsUser)}`;
    if (params.excludeRetweets) query += ' -is:retweet';
    if (params.excludeReplies) query += ' -is:reply';
    if (params.onlyVerified) query += ' is:verified';
    if (params.minLikes) query += ` min_faves:${Number(params.minLikes)}`;
    if (params.minRetweets) query += ` min_retweets:${Number(params.minRetweets)}`;
    return query.trim();
  }

  async searchTweets(client, params) {
    const { requested, apiMax } = this.requestedMax(params, 10, 10);
    const options = {
      query: this.buildSearchQuery(params),
      max_results: apiMax,
      'tweet.fields': this.tweetFields,
      expansions: this.tweetExpansions,
      'user.fields': this.userFields,
      'media.fields': this.mediaFields,
    };

    if (params.sortOrder) options.sort_order = String(params.sortOrder).toLowerCase();
    if (params.startTime) options.start_time = params.startTime;
    if (params.endTime) options.end_time = params.endTime;
    if (params.sinceId) options.since_id = params.sinceId;
    if (params.untilId) options.until_id = params.untilId;

    const response = await client.tweets.tweetsRecentSearch(options);
    const tweets = this.enrichTweets(response).slice(0, requested);

    return { success: true, query: options.query, searchResults: tweets, includes: response.includes || {} };
  }

  async monitorReplies(client, params) {
    const { requested, apiMax } = this.requestedMax(params, 20, 10);
    const response = await client.tweets.tweetsRecentSearch({
      query: `conversation_id:${params.tweetId}`,
      max_results: apiMax,
      'tweet.fields': this.tweetFields,
      expansions: this.tweetExpansions,
      'user.fields': this.userFields,
      'media.fields': this.mediaFields,
    });

    const replies = this.enrichTweets(response)
      .filter((tweet) => tweet.referenced_tweets?.some((ref) => ref.id === params.tweetId && ref.type === 'replied_to'))
      .slice(0, requested);

    return { success: true, replies };
  }

  async followUser(client, accessToken, params) {
    const currentUserResponse = await client.users.findMyUser();
    if (!currentUserResponse.data) {
      throw new Error('Unable to retrieve current user information');
    }

    const targetUser = await this.resolveUser(client, params.targetUserId);
    const url = `https://api.twitter.com/2/users/${currentUserResponse.data.id}/following`;
    const data = await this.apiFetch(accessToken, url, {
      method: 'POST',
      body: JSON.stringify({ target_user_id: targetUser.id }),
    });

    return {
      success: true,
      followedUserId: targetUser.id,
      followedUsername: targetUser.username,
      response: data,
    };
  }

  async unfollowUser(client, accessToken, params) {
    const currentUserResponse = await client.users.findMyUser();
    if (!currentUserResponse.data) {
      throw new Error('Unable to retrieve current user information');
    }

    const targetUser = await this.resolveUser(client, params.targetUserId);
    const url = `https://api.twitter.com/2/users/${currentUserResponse.data.id}/following/${targetUser.id}`;
    const data = await this.apiFetch(accessToken, url, { method: 'DELETE' });

    return {
      success: true,
      unfollowedUserId: targetUser.id,
      unfollowedUsername: targetUser.username,
      response: data,
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
        const targetUser = await this.resolveUser(client, targetUserId);
        const url = `https://api.twitter.com/2/users/${currentUserResponse.data.id}/following/${targetUser.id}`;
        const data = await this.apiFetch(accessToken, url, { method: 'DELETE' });
        results.push({ userId: targetUser.id, username: targetUser.username, success: true, response: data });
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

    const { requested, apiMax } = this.requestedMax(params, 10, 5);
    const response = await client.tweets.usersIdMentions(userResponse.data.id, {
      max_results: apiMax,
      'tweet.fields': this.tweetFields,
      expansions: this.tweetExpansions,
      'user.fields': this.userFields,
      'media.fields': this.mediaFields,
    });

    return { success: true, mentions: this.enrichTweets(response).slice(0, requested), includes: response.includes || {} };
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
      case 'UNLIKE':
      case 'RETWEET':
      case 'UNRETWEET':
      case 'GET_TWEET':
      case 'MONITOR_REPLIES':
        if (!params.tweetId) throw new Error('Tweet ID is required');
        break;
      case 'QUOTE_TWEET':
        if (!params.tweetId) throw new Error('Tweet ID to quote is required');
        if (!params.text) throw new Error('Quote tweet text is required');
        if (params.text.length > 280) throw new Error('Quote tweet text must be 280 characters or less');
        break;
      case 'REPLY':
        if (!params.tweetId) throw new Error('Tweet ID is required');
        if (!params.text) throw new Error('Reply text is required');
        if (params.text.length > 280) throw new Error('Reply text must be 280 characters or less');
        break;
      case 'GET_TIMELINE':
      case 'GET_PROFILE':
      case 'GET_TWEETS':
        if (!params.userId) throw new Error('Username or user ID is required');
        break;
      case 'GET_CONVERSATION':
        if (!params.tweetId && !params.conversationId) throw new Error('Tweet ID or conversation ID is required');
        break;
      case 'SEARCH':
      case 'ADVANCED_SEARCH':
        if (!params.query) throw new Error('Search query is required');
        break;
      case 'FOLLOW':
      case 'UNFOLLOW':
        if (!params.targetUserId) throw new Error('Target username or user ID is required');
        break;
      case 'BULK_UNFOLLOW':
        if (!params.userIds || !Array.isArray(params.userIds) || params.userIds.length === 0) {
          throw new Error('userIds must be a non-empty array');
        }
        if (params.userIds.length > 100) throw new Error('Bulk unfollow supports at most 100 users per run');
        break;
    }
  }
}

export default new TwitterAPI();
