# Twitter API 🐦

## Id

`twitter-api`

## Description

Manages Twitter accounts with comprehensive social media operations including posting tweets, managing followers, searching content, and monitoring engagement. Supports OAuth authentication for secure Twitter integration.

## Tags

twitter, api, social-media, tweets, followers, search, engagement, oauth

## Input Parameters

### Required

- **action** (string): Action to perform (`POST`, `DELETE`, `REPLY`, `LIKE`, `GET_TIMELINE`, `SEARCH`, `GET_PROFILE`, `GET_TWEETS`, `MONITOR_REPLIES`, `FOLLOW`, `UNFOLLOW`, `BULK_UNFOLLOW`, `CHECK_MENTIONS`)

### Optional

- **text** (string): Tweet content for posting
- **tweetId** (string): Tweet ID for operations
- **userId** (string): Username for profile/timeline operations
- **query** (string): Search query for search operations
- **maxResults** (number): Maximum results for search operations
- **targetUserId** (string): Target username for follow/unfollow operations
- **userIds** (array): Array of usernames for bulk operations

## Output Format

- **success** (boolean): Whether the Twitter operation was successful
- **result** (object): Operation result including tweet data, user profiles, search results, or engagement metrics
- **error** (string|null): Error message if the operation failed
