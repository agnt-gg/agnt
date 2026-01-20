import BaseAction from '../BaseAction.js';
import { Client } from 'twitter-api-sdk';
import AuthManager from '../../../services/auth/AuthManager.js';

class TwitterAPI extends BaseAction {
  static schema = {
    title: 'X (Twitter) API',
    category: 'action',
    type: 'twitter-api',
    icon: 'twitter',
    description:
      'This action node interacts with Twitter to post tweets, delete tweets, retrieve user tweets, search tweets, and fetch user profiles.',
    authRequired: 'oauth',
    authProvider: 'twitter',
    parameters: {
      action: {
        type: 'string',
        inputType: 'select',
        options: [
          'POST',
          'DELETE',
          'REPLY',
          'LIKE',
          'GET_TWEETS',
          'GET_TIMELINE',
          'SEARCH',
          'GET_PROFILE',
          'MONITOR_REPLIES',
          'CHECK_MENTIONS',
          'FOLLOW',
          'UNFOLLOW',
          'BULK_UNFOLLOW',
        ],
        description: 'The action to perform on Twitter',
      },
      text: {
        type: 'string',
        inputType: 'textarea',
        description: 'The content of the tweet or reply',
        conditional: {
          field: 'action',
          value: ['POST', 'REPLY'],
        },
      },
      tweetId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the tweet to delete, reply to, like, or monitor replies for',
        conditional: {
          field: 'action',
          value: ['DELETE', 'REPLY', 'LIKE', 'MONITOR_REPLIES'],
        },
      },
      userId: {
        type: 'string',
        inputType: 'text',
        description: 'The user ID or username to fetch tweets, timeline, or profile',
        conditional: {
          field: 'action',
          value: ['GET_TWEETS', 'GET_TIMELINE', 'GET_PROFILE'],
        },
      },
      targetUserId: {
        type: 'string',
        inputType: 'text',
        description: 'The target user ID or username to follow or unfollow',
        conditional: {
          field: 'action',
          value: ['FOLLOW', 'UNFOLLOW'],
        },
      },
      userIds: {
        type: 'array',
        inputType: 'textarea',
        description: 'Array of user IDs or usernames to unfollow (max 100)',
        conditional: {
          field: 'action',
          value: 'BULK_UNFOLLOW',
        },
      },
      maxResults: {
        type: 'number',
        inputType: 'number',
        description: 'The maximum number of results to return',
        default: 10,
        conditional: {
          field: 'action',
          value: ['GET_TWEETS', 'GET_TIMELINE', 'SEARCH'],
        },
      },
      query: {
        type: 'string',
        inputType: 'text',
        description: 'The search query for finding tweets',
        conditional: {
          field: 'action',
          value: 'SEARCH',
        },
      },
      sortOrder: {
        type: 'string',
        inputType: 'select',
        options: ['RECENCY', 'POPULARITY'],
        default: 'RECENCY',
        description: 'How to sort the search results',
        conditional: {
          field: 'action',
          value: 'SEARCH',
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the action was successful',
      },
      tweetId: {
        type: 'string',
        description: 'The ID of the posted tweet (for POST action)',
      },
      deletedTweetId: {
        type: 'string',
        description: 'The ID of the deleted tweet (for DELETE action)',
      },
      replyTweetId: {
        type: 'string',
        description: 'The ID of the reply tweet (for REPLY action)',
      },
      likedTweetId: {
        type: 'string',
        description: 'The ID of the liked tweet (for LIKE action)',
      },
      tweets: {
        type: 'array',
        description: 'Array of tweets from the user (for GET_TWEETS action)',
      },
      timeline: {
        type: 'array',
        description: "Array of tweets from the user's timeline (for GET_TIMELINE action)",
      },
      searchResults: {
        type: 'array',
        description: 'Array of tweets matching the search query (for SEARCH action). Each tweet includes author_username and author_name.',
      },
      userProfile: {
        type: 'object',
        description: 'User profile information (for GET_PROFILE action)',
      },
      replies: {
        type: 'array',
        description: 'Array of replies to the specified tweet (for MONITOR_REPLIES action). Each reply includes author_username and author_name.',
      },
      following: {
        type: 'array',
        description: 'Array of users that the specified user is following (for GET_FOLLOWING action)',
      },
      followers: {
        type: 'array',
        description: 'Array of users that are following the specified user (for GET_FOLLOWERS action)',
      },
      analysis: {
        type: 'object',
        description: 'Analysis of mutual relationships including mutuals, non-mutual following, and non-mutual followers (for GET_MUTUALS action)',
      },
      followedUserId: {
        type: 'string',
        description: 'The ID of the followed user (for FOLLOW action)',
      },
      followedUsername: {
        type: 'string',
        description: 'The username of the followed user (for FOLLOW action)',
      },
      unfollowedUserId: {
        type: 'string',
        description: 'The ID of the unfollowed user (for UNFOLLOW action)',
      },
      unfollowedUsername: {
        type: 'string',
        description: 'The username of the unfollowed user (for UNFOLLOW action)',
      },
      result: {
        type: 'object',
        description: 'Detailed result of the follow/unfollow operation (for FOLLOW/UNFOLLOW actions)',
      },
      summary: {
        type: 'object',
        description: 'Summary of bulk unfollow operation including attempted, successful, and failed counts (for BULK_UNFOLLOW action)',
      },
      mentions: {
        type: 'array',
        description:
          'Array of tweets mentioning the user (for CHECK_MENTIONS action). Each mention includes author_username, author_name, and author_profile_image_url.',
      },
      error: {
        type: 'string',
        description: 'Error message if the action failed',
      },
    },
  };

  constructor() {
    super('twitter-api');
  }

  async execute(params, inputData, workflowEngine) {
    this.validateParams(params);

    try {
      const userId = workflowEngine.userId;
      console.log('Attempting to perform Twitter action for user:', userId);
      console.log('Action:', params.action);

      const accessToken = await AuthManager.getValidAccessToken(userId, 'twitter');
      if (!accessToken) {
        throw new Error('No valid access token. User needs to authenticate.');
      }

      const client = new Client(accessToken);

      let response;
      switch (params.action.toUpperCase()) {
        case 'POST':
          console.log('Posting tweet:', params.text);

          // Create tweet
          const tweetData = { text: params.text };

          response = await client.tweets.createTweet(tweetData);
          console.log('Tweet posted successfully:', response.data.id);
          return {
            success: true,
            tweetId: response.data.id,
          };

        case 'DELETE':
          console.log('Deleting tweet:', params.tweetId);
          response = await client.tweets.deleteTweetById(params.tweetId);
          console.log('Tweet deleted successfully:', params.tweetId);
          return { success: true, deletedTweetId: params.tweetId };

        case 'REPLY':
          console.log(`Replying to tweet ${params.tweetId}:`, params.text);

          // Create reply
          const replyData = {
            text: params.text,
            reply: { in_reply_to_tweet_id: params.tweetId },
          };

          response = await client.tweets.createTweet(replyData);
          console.log('Reply posted successfully:', response.data.id);
          return {
            success: true,
            replyTweetId: response.data.id,
          };

        case 'LIKE':
          console.log('Liking tweet:', params.tweetId);
          try {
            // Get the current user's ID
            const userResponse = await client.users.findMyUser();
            if (!userResponse.data) {
              throw new Error('Unable to retrieve current user information');
            }
            const currentUserId = userResponse.data.id;

            // Reverting to direct API call to like the tweet
            const url = `https://api.twitter.com/2/users/${currentUserId}/likes`;

            const options = {
              method: 'POST',
              headers: {
                // Use the accessToken obtained earlier for the client
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ tweet_id: params.tweetId }),
            };

            // Ensure node-fetch or a compatible fetch is available in the environment
            // If running in Node.js < 18, you might need to import node-fetch
            const likeResponse = await fetch(url, options);

            const responseData = await likeResponse.json(); // Attempt to parse JSON regardless of status

            if (!likeResponse.ok) {
              // Log the detailed error from Twitter API
              console.error(`Twitter API error (${likeResponse.status}): ${JSON.stringify(responseData)}`);
              throw new Error(
                `Twitter API error: ${responseData.title || likeResponse.statusText}. Details: ${responseData.detail || JSON.stringify(responseData)}`
              );
            }

            // Check the actual response content for success confirmation
            if (!responseData.data || !responseData.data.liked) {
              console.warn(
                `Tweet like API call succeeded (${likeResponse.status}) but response did not confirm liked status: ${JSON.stringify(responseData)}`
              );
              // Consider if this should be an error or just a warning
            }

            console.log('Tweet liked successfully via fetch:', params.tweetId);
            return {
              success: true,
              likedTweetId: params.tweetId,
              result: responseData, // Return the parsed JSON response
            };
          } catch (error) {
            // Catch errors from findMyUser, fetch, or JSON parsing
            console.error('Error liking tweet via fetch:', error);
            // Make sure we're throwing a helpful error message
            throw new Error(`Failed to like tweet: ${error.message}`);
          }

        case 'GET_TIMELINE':
          console.log('Fetching user timeline for:', params.userId);
          try {
            const userResponse = await client.users.findUserByUsername(params.userId);
            if (!userResponse.data) {
              throw new Error(`User not found: ${params.userId}`);
            }
            const userId = userResponse.data.id;

            response = await client.tweets.usersIdTimeline(userId, {
              max_results: params.maxResults || 10,
              'tweet.fields': 'created_at,text',
            });
            console.log('Timeline fetched successfully');
            return { success: true, timeline: response.data };
          } catch (error) {
            console.error('Error fetching timeline:', error);
            throw new Error(`Failed to fetch timeline: ${error.message}`);
          }

        case 'GET_PROFILE':
          console.log('Fetching user info for:', params.userId);
          try {
            response = await client.users.findUserByUsername(params.userId, {
              'user.fields': ['description', 'name', 'profile_image_url', 'public_metrics'],
            });
            if (!response.data) {
              throw new Error(`User not found: ${params.userId}`);
            }
            console.log('User profile fetched successfully');
            return { success: true, userProfile: response.data };
          } catch (error) {
            console.error('Error fetching user profile:', error);
            throw new Error(`Failed to fetch user profile: ${error.message}`);
          }

        case 'GET_TWEETS':
          console.log('Fetching tweets for user:', params.userId);
          try {
            const userResponse = await client.users.findUserByUsername(params.userId);
            if (!userResponse.data) {
              throw new Error(`User not found: ${params.userId}`);
            }
            const userId = userResponse.data.id;

            response = await client.tweets.usersIdTweets(userId, {
              max_results: params.maxResults || 10,
              'tweet.fields': 'created_at,text',
            });
            console.log('Tweets fetched successfully');
            return { success: true, tweets: response.data };
          } catch (error) {
            console.error('Error fetching tweets:', error);
            throw new Error(`Failed to fetch tweets: ${error.message}`);
          }

        case 'SEARCH':
          console.log('Searching tweets for:', params.query);
          try {
            const maxResults = Math.max(10, Math.min(100, params.maxResults || 10));
            let searchQuery = params.query;

            // Handle sort order - options are "RECENCY" (default) or "POPULARITY"
            if (params.sortOrder && params.sortOrder.toLowerCase() === 'POPULARITY') {
              console.log('Sorting by popularity');
              // Modify the query to prioritize tweets with higher engagement
              // This is a workaround since Twitter API v2 doesn't have a direct popularity sort
              searchQuery = `${searchQuery} min_faves:10 -is:reply`;
            } else {
              console.log('Sorting by recency (default)');
            }

            response = await client.tweets.tweetsRecentSearch({
              query: searchQuery,
              max_results: maxResults,
              'tweet.fields': 'created_at,text,author_id,public_metrics',
              expansions: 'referenced_tweets.id,referenced_tweets.id.author_id,author_id',
              'user.fields': 'username,name',
            });
            console.log('Search completed successfully');

            // Process the data to include full text of referenced tweets
            let tweets = response.data || [];
            const includes = response.includes || {};
            const users = includes.users || [];

            // If we're sorting by popularity and have results with public_metrics, sort them by engagement
            if (params.sortOrder && params.sortOrder.toLowerCase() === 'POPULARITY' && tweets.length > 0 && tweets[0].public_metrics) {
              console.log('Client-side sorting by engagement metrics');
              tweets.sort((a, b) => {
                const aEngagement = a.public_metrics.like_count + a.public_metrics.retweet_count * 2;
                const bEngagement = b.public_metrics.like_count + b.public_metrics.retweet_count * 2;
                return bEngagement - aEngagement; // descending order
              });
            }

            if (includes.tweets && tweets.some((t) => t.text.startsWith('RT @'))) {
              tweets = tweets.map((tweet) => {
                // For retweets, get the full text of the original tweet
                if (tweet.text.startsWith('RT @')) {
                  const referencedTweet = includes.tweets.find((rt) =>
                    tweet.referenced_tweets?.some((ref) => ref.id === rt.id && ref.type === 'retweeted')
                  );
                  if (referencedTweet) {
                    tweet.full_text = referencedTweet.text;
                  }
                }

                // Add author username
                if (tweet.author_id) {
                  const author = users.find((user) => user.id === tweet.author_id);
                  if (author) {
                    tweet.author_username = author.username;
                    tweet.author_name = author.name;
                  }
                }

                return tweet;
              });
            } else {
              // If no retweets, still add author information
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
            }

            return { success: true, searchResults: tweets, includes: includes };
          } catch (error) {
            console.error('Error searching tweets:', error);
            throw new Error(`Failed to search tweets: ${error.message || JSON.stringify(error)}`);
          }

        case 'MONITOR_REPLIES':
          console.log('Monitoring replies to tweet:', params.tweetId);
          try {
            // Use the conversation_id search query parameter to find all replies in the thread
            response = await client.tweets.tweetsRecentSearch({
              query: `conversation_id:${params.tweetId}`,
              max_results: params.maxResults || 20,
              'tweet.fields': 'created_at,text,author_id,in_reply_to_user_id,referenced_tweets',
              expansions: 'referenced_tweets.id,referenced_tweets.id.author_id,author_id',
              'user.fields': 'username,name',
            });

            console.log('Replies fetched successfully');

            // Filter to only include actual replies to the specified tweet
            let replies = (response.data || []).filter((tweet) =>
              tweet.referenced_tweets?.some((ref) => ref.id === params.tweetId && ref.type === 'replied_to')
            );

            const includes = response.includes || {};
            const users = includes.users || [];

            // Add author username to each reply
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

            return {
              success: true,
              replies: replies,
              includes: includes,
            };
          } catch (error) {
            console.error('Error monitoring replies:', error);
            throw new Error(`Failed to monitor replies: ${error.message || JSON.stringify(error)}`);
          }

        case 'UNFOLLOW':
          console.log('Unfollowing user:', params.targetUserId);
          try {
            // Get current user ID first
            const currentUserResponse = await client.users.findMyUser();
            if (!currentUserResponse.data) {
              throw new Error('Unable to retrieve current user information');
            }
            const currentUserId = currentUserResponse.data.id;

            // Get target user ID from username
            const targetUserResponse = await client.users.findUserByUsername(params.targetUserId);
            if (!targetUserResponse.data) {
              throw new Error(`Target user not found: ${params.targetUserId}`);
            }
            const targetUserId = targetUserResponse.data.id;

            // Use correct Twitter API v2 endpoint: DELETE /2/users/:source_user_id/following/:target_user_id
            const url = `https://api.twitter.com/2/users/${currentUserId}/following/${targetUserId}`;

            const options = {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            };

            const unfollowResponse = await fetch(url, options);
            const responseData = await unfollowResponse.json();

            if (!unfollowResponse.ok) {
              console.error(`Twitter API error (${unfollowResponse.status}): ${JSON.stringify(responseData)}`);
              throw new Error(
                `Twitter API error: ${responseData.title || unfollowResponse.statusText}. Details: ${
                  responseData.detail || JSON.stringify(responseData)
                }`
              );
            }

            console.log('User unfollowed successfully:', params.targetUserId);
            return {
              success: true,
              unfollowedUserId: targetUserId,
              unfollowedUsername: params.targetUserId,
              result: responseData,
            };
          } catch (error) {
            console.error('Error unfollowing user:', error);
            throw new Error(`Failed to unfollow user: ${error.message}`);
          }

        case 'FOLLOW':
          console.log('Following user:', params.targetUserId);
          try {
            // Get current user ID first
            const currentUserResponse = await client.users.findMyUser();
            if (!currentUserResponse.data) {
              throw new Error('Unable to retrieve current user information');
            }
            const currentUserId = currentUserResponse.data.id;

            // Get target user ID from username
            const targetUserResponse = await client.users.findUserByUsername(params.targetUserId);
            if (!targetUserResponse.data) {
              throw new Error(`Target user not found: ${params.targetUserId}`);
            }
            const targetUserId = targetUserResponse.data.id;

            // Use correct Twitter API v2 endpoint: POST /2/users/:id/following
            const url = `https://api.twitter.com/2/users/${currentUserId}/following`;

            const options = {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ target_user_id: targetUserId }),
            };

            const followResponse = await fetch(url, options);
            const responseData = await followResponse.json();

            if (!followResponse.ok) {
              console.error(`Twitter API error (${followResponse.status}): ${JSON.stringify(responseData)}`);
              throw new Error(
                `Twitter API error: ${responseData.title || followResponse.statusText}. Details: ${
                  responseData.detail || JSON.stringify(responseData)
                }`
              );
            }

            console.log('User followed successfully:', params.targetUserId);
            return {
              success: true,
              followedUserId: targetUserId,
              followedUsername: params.targetUserId,
              result: responseData,
            };
          } catch (error) {
            console.error('Error following user:', error);
            throw new Error(`Failed to follow user: ${error.message}`);
          }

        case 'BULK_UNFOLLOW':
          console.log('Bulk unfollowing users:', params.userIds);
          try {
            const currentUserResponse = await client.users.findMyUser();
            if (!currentUserResponse.data) {
              throw new Error('Unable to retrieve current user information');
            }
            const currentUserId = currentUserResponse.data.id;

            const results = [];
            const errors = [];

            // Process in batches to avoid rate limits
            const batchSize = 10; // Twitter rate limits
            for (let i = 0; i < params.userIds.length; i += batchSize) {
              const batch = params.userIds.slice(i, i + batchSize);

              for (const targetUserId of batch) {
                try {
                  // Get target user ID from username
                  const targetUserResponse = await client.users.findUserByUsername(targetUserId);
                  if (!targetUserResponse.data) {
                    errors.push({ userId: targetUserId, error: 'User not found' });
                    continue;
                  }
                  const targetUserApiId = targetUserResponse.data.id;

                  const url = `https://api.twitter.com/2/users/${currentUserId}/following/${targetUserApiId}`;

                  const options = {
                    method: 'DELETE',
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                      'Content-Type': 'application/json',
                    },
                  };

                  const unfollowResponse = await fetch(url, options);

                  if (unfollowResponse.ok) {
                    results.push({ userId: targetUserId, success: true });
                    console.log('Unfollowed:', targetUserId);
                  } else {
                    const errorData = await unfollowResponse.json();
                    errors.push({ userId: targetUserId, error: errorData.title || 'Unknown error' });
                  }

                  // Add delay to avoid rate limiting
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                } catch (error) {
                  errors.push({ userId: targetUserId, error: error.message });
                }
              }

              // Add longer delay between batches
              if (i + batchSize < params.userIds.length) {
                await new Promise((resolve) => setTimeout(resolve, 5000));
              }
            }

            return {
              success: true,
              results: results,
              errors: errors,
              summary: {
                attempted: params.userIds.length,
                successful: results.length,
                failed: errors.length,
              },
            };
          } catch (error) {
            console.error('Error in bulk unfollow:', error);
            throw new Error(`Failed to perform bulk unfollow: ${error.message}`);
          }

        case 'CHECK_MENTIONS':
          console.log('Checking mentions for user');
          try {
            // Get the current user's ID
            const userResponse = await client.users.findMyUser();
            if (!userResponse.data) {
              throw new Error('Unable to retrieve current user information');
            }
            const currentUserId = userResponse.data.id;

            // Fetch mentions using the usersIdMentions method
            response = await client.tweets.usersIdMentions(currentUserId, {
              max_results: params.maxResults || 10,
              'tweet.fields': 'created_at,text,author_id,public_metrics',
              expansions: 'author_id',
              'user.fields': 'username,name,profile_image_url',
            });

            console.log('Mentions fetched successfully');

            // Process the data to include author information
            let mentions = response.data || [];
            const includes = response.includes || {};
            const users = includes.users || [];

            // Add author information to each mention
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

            return {
              success: true,
              mentions: mentions,
              includes: includes,
            };
          } catch (error) {
            console.error('Error checking mentions:', error);
            throw new Error(`Failed to check mentions: ${error.message || JSON.stringify(error)}`);
          }

        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }
    } catch (error) {
      console.error('Error with Twitter action:', error);
      console.error('Full error object:', JSON.stringify(error, null, 2));
      return {
        success: false,
        error:
          error.error?.title ||
          error.statusText ||
          error.message ||
          (typeof error === 'object' ? JSON.stringify(error) : 'An unknown error occurred'),
        details: error.response ? error.response.data : error,
      };
    }
  }

  validateParams(params) {
    if (!params.action) {
      throw new Error('Action is required');
    }
    switch (params.action.toUpperCase()) {
      case 'POST':
        if (!params.text) {
          throw new Error('Tweet text is required');
        }
        if (params.text && params.text.length > 280) {
          throw new Error('Tweet text must be 280 characters or less');
        }
        break;
      case 'DELETE':
        if (!params.tweetId) {
          throw new Error('Tweet ID is required for deletion');
        }
        break;
      case 'REPLY':
        if (!params.tweetId) {
          throw new Error('Tweet ID is required for replying');
        }
        if (!params.text) {
          throw new Error('Reply text is required');
        }
        if (params.text && params.text.length > 280) {
          throw new Error('Reply text must be 280 characters or less');
        }
        break;
      case 'LIKE':
        if (!params.tweetId) {
          throw new Error('Tweet ID is required for liking');
        }
        break;
      case 'GET_TIMELINE':
      case 'GET_PROFILE':
      case 'GET_TWEETS':
        if (!params.userId || typeof params.userId !== 'string') {
          throw new Error('Username is required for this action');
        }
        break;
      case 'SEARCH':
        if (!params.query) {
          throw new Error('Search query is required');
        }
        if (params.maxResults !== undefined) {
          const numMaxResults = Number(params.maxResults);
          if (isNaN(numMaxResults) || numMaxResults < 10 || numMaxResults > 100) {
            throw new Error('maxResults must be a number or numeric string between 10 and 100 for recent search');
          }
        }
        if (params.sortOrder && !['recency', 'popularity'].includes(params.sortOrder.toLowerCase())) {
          throw new Error("sortOrder must be either 'recency' or 'popularity'");
        }
        break;
      case 'MONITOR_REPLIES':
        if (!params.tweetId) {
          throw new Error('Tweet ID is required for monitoring replies');
        }
        break;
      case 'FOLLOW':
        if (!params.targetUserId || typeof params.targetUserId !== 'string') {
          throw new Error('Target username is required for following');
        }
        break;
      case 'UNFOLLOW':
        if (!params.targetUserId || typeof params.targetUserId !== 'string') {
          throw new Error('Target username is required for unfollowing');
        }
        break;
      case 'BULK_UNFOLLOW':
        // Handle string input formats and convert to array
        if (typeof params.userIds === 'string') {
          let userIdsString = params.userIds.trim();

          // Handle array-like string format: "[aelluswamy, spenccheng]"
          if (userIdsString.startsWith('[') && userIdsString.endsWith(']')) {
            try {
              params.userIds = JSON.parse(userIdsString);
            } catch (error) {
              // If JSON parsing fails, try manual parsing
              userIdsString = userIdsString.slice(1, -1); // Remove brackets
              params.userIds = userIdsString
                .split(',')
                .map((id) => id.trim())
                .filter((id) => id.length > 0);
            }
          }
          // Handle comma-separated string format: "aelluswamy, spenccheng"
          else if (userIdsString.includes(',')) {
            params.userIds = userIdsString
              .split(',')
              .map((id) => id.trim())
              .filter((id) => id.length > 0);
          }
          // Handle single username as string
          else if (userIdsString.length > 0) {
            params.userIds = [userIdsString];
          } else {
            params.userIds = [];
          }
        }

        // Validate the final array
        if (!params.userIds || !Array.isArray(params.userIds) || params.userIds.length === 0) {
          throw new Error('userIds must be a non-empty array of usernames');
        }
        if (params.userIds.length > 100) {
          throw new Error('Bulk unfollow limited to 100 users at a time');
        }
        break;
      case 'CHECK_MENTIONS':
        // Validate maxResults if provided
        if (params.maxResults !== undefined) {
          const numMaxResults = Number(params.maxResults);
          if (isNaN(numMaxResults) || numMaxResults < 5 || numMaxResults > 100) {
            throw new Error('maxResults must be a number or numeric string between 5 and 100 for mentions');
          }
        }
        break;
      default:
        throw new Error(
          "Invalid action. Must be 'POST', 'DELETE', 'REPLY', 'LIKE', 'GET_TIMELINE', 'SEARCH', 'GET_PROFILE', 'GET_TWEETS', 'MONITOR_REPLIES', 'FOLLOW', 'UNFOLLOW', 'BULK_UNFOLLOW', or 'CHECK_MENTIONS'"
        );
    }
  }
}

export default new TwitterAPI();
