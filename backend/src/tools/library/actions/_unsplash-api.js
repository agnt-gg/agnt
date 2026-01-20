import BaseAction from '../BaseAction.js';
import AuthManager from '../../../services/auth/AuthManager.js';
import axios from 'axios';

class UnsplashAPI extends BaseAction {
  constructor() {
    super('unsplash-api');
    this.baseUrl = 'https://api.unsplash.com';
  }

  async execute(params, inputData, workflowEngine) {
    try {
      this.validateParams(params);

      const accessKey = await AuthManager.getValidAccessToken(workflowEngine.userId, 'unsplash');

      if (!accessKey) {
        throw new Error('No valid Unsplash access key found. Please connect to Unsplash in Settings or provide an API key.');
      }

      let result;
      switch (params.action) {
        case 'SEARCH_PHOTOS':
          result = await this.searchPhotos(accessKey, params);
          break;
        case 'GET_RANDOM_PHOTO':
          result = await this.getRandomPhoto(accessKey, params);
          break;
        case 'GET_PHOTO':
          result = await this.getPhoto(accessKey, params);
          break;
        case 'LIST_PHOTOS':
          result = await this.listPhotos(accessKey, params);
          break;
        case 'GET_COLLECTIONS':
          result = await this.getCollections(accessKey, params);
          break;
        case 'GET_COLLECTION_PHOTOS':
          result = await this.getCollectionPhotos(accessKey, params);
          break;
        case 'GET_USER_PROFILE':
          result = await this.getUserProfile(accessKey, params);
          break;
        case 'GET_USER_PHOTOS':
          result = await this.getUserPhotos(accessKey, params);
          break;
        case 'DOWNLOAD_PHOTO':
          result = await this.downloadPhoto(accessKey, params);
          break;
        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }

      return this.formatOutput({
        success: true,
        result: result,
        error: null,
      });
    } catch (error) {
      console.error('Error executing Unsplash API:', error);
      return this.formatOutput({
        success: false,
        result: null,
        error: error.message,
      });
    }
  }

  async searchPhotos(accessKey, params) {
    const { query, page = 1, perPage = 10, orderBy = 'relevant', orientation, color } = params;

    const searchParams = new URLSearchParams({
      query,
      page: page.toString(),
      per_page: perPage.toString(),
      order_by: orderBy,
    });

    if (orientation) searchParams.append('orientation', orientation);
    if (color) searchParams.append('color', color);

    const response = await this.makeRequest(`/search/photos?${searchParams.toString()}`, accessKey);

    return {
      total: response.total,
      totalPages: response.total_pages,
      results: response.results.map((photo) => this.formatPhotoData(photo)),
    };
  }

  async getRandomPhoto(accessKey, params) {
    const { query, orientation, featured, username, count = 1 } = params;

    const searchParams = new URLSearchParams();
    if (query) searchParams.append('query', query);
    if (orientation) searchParams.append('orientation', orientation);
    if (featured) searchParams.append('featured', 'true');
    if (username) searchParams.append('username', username);
    if (count > 1) searchParams.append('count', count.toString());

    const queryString = searchParams.toString();
    const endpoint = `/photos/random${queryString ? `?${queryString}` : ''}`;

    const response = await this.makeRequest(endpoint, accessKey);

    // Handle both single photo and array of photos
    if (Array.isArray(response)) {
      return response.map((photo) => this.formatPhotoData(photo));
    } else {
      return this.formatPhotoData(response);
    }
  }

  async getPhoto(accessKey, params) {
    const { photoId } = params;

    const response = await this.makeRequest(`/photos/${photoId}`, accessKey);
    return this.formatPhotoData(response);
  }

  async listPhotos(accessKey, params) {
    const { page = 1, perPage = 10, orderBy = 'latest' } = params;

    const searchParams = new URLSearchParams({
      page: page.toString(),
      per_page: perPage.toString(),
      order_by: orderBy,
    });

    const response = await this.makeRequest(`/photos?${searchParams.toString()}`, accessKey);

    return response.map((photo) => this.formatPhotoData(photo));
  }

  async getCollections(accessKey, params) {
    const { page = 1, perPage = 10 } = params;

    const searchParams = new URLSearchParams({
      page: page.toString(),
      per_page: perPage.toString(),
    });

    const response = await this.makeRequest(`/collections?${searchParams.toString()}`, accessKey);

    return response.map((collection) => ({
      id: collection.id,
      title: collection.title,
      description: collection.description,
      totalPhotos: collection.total_photos,
      coverPhoto: collection.cover_photo ? this.formatPhotoData(collection.cover_photo) : null,
      user: {
        id: collection.user.id,
        username: collection.user.username,
        name: collection.user.name,
        profileImage: collection.user.profile_image?.medium,
      },
      links: collection.links,
    }));
  }

  async getCollectionPhotos(accessKey, params) {
    const { collectionId, page = 1, perPage = 10, orientation } = params;

    const searchParams = new URLSearchParams({
      page: page.toString(),
      per_page: perPage.toString(),
    });

    if (orientation) searchParams.append('orientation', orientation);

    const response = await this.makeRequest(`/collections/${collectionId}/photos?${searchParams.toString()}`, accessKey);

    return response.map((photo) => this.formatPhotoData(photo));
  }

  async getUserProfile(accessKey, params) {
    const { username } = params;

    const response = await this.makeRequest(`/users/${username}`, accessKey);

    return {
      id: response.id,
      username: response.username,
      name: response.name,
      firstName: response.first_name,
      lastName: response.last_name,
      bio: response.bio,
      location: response.location,
      totalPhotos: response.total_photos,
      totalCollections: response.total_collections,
      totalLikes: response.total_likes,
      profileImage: response.profile_image,
      social: response.social,
      links: response.links,
    };
  }

  async getUserPhotos(accessKey, params) {
    const { username, page = 1, perPage = 10, orderBy = 'latest', orientation } = params;

    const searchParams = new URLSearchParams({
      page: page.toString(),
      per_page: perPage.toString(),
      order_by: orderBy,
    });

    if (orientation) searchParams.append('orientation', orientation);

    const response = await this.makeRequest(`/users/${username}/photos?${searchParams.toString()}`, accessKey);

    return response.map((photo) => this.formatPhotoData(photo));
  }

  async downloadPhoto(accessKey, params) {
    const { photoId } = params;

    // First get the download URL
    const response = await this.makeRequest(`/photos/${photoId}/download`, accessKey);

    return {
      downloadUrl: response.url,
      photoId: photoId,
      message: 'Download URL retrieved successfully. Use this URL to download the photo and track the download as required by Unsplash API.',
    };
  }

  formatPhotoData(photo) {
    return {
      id: photo.id,
      description: photo.description || photo.alt_description,
      urls: {
        raw: photo.urls.raw,
        full: photo.urls.full,
        regular: photo.urls.regular,
        small: photo.urls.small,
        thumb: photo.urls.thumb,
        // Add custom size parameters helper
        custom: (width, height, quality = 80, format = 'jpg') => {
          return `${photo.urls.raw}&w=${width}&h=${height}&q=${quality}&fm=${format}&fit=crop`;
        },
      },
      width: photo.width,
      height: photo.height,
      color: photo.color,
      likes: photo.likes,
      downloads: photo.downloads,
      user: {
        id: photo.user.id,
        username: photo.user.username,
        name: photo.user.name,
        profileImage: photo.user.profile_image?.medium,
        portfolioUrl: photo.user.portfolio_url,
        social: photo.user.social,
      },
      exif: photo.exif,
      location: photo.location,
      tags: photo.tags,
      createdAt: photo.created_at,
      updatedAt: photo.updated_at,
      links: photo.links,
      // Attribution helper
      attribution: {
        photographer: photo.user.name,
        photographerUrl: `https://unsplash.com/@${photo.user.username}`,
        unsplashUrl: photo.links.html,
        attributionText: `Photo by ${photo.user.name} on Unsplash`,
        attributionHtml: `<a href="${photo.links.html}">Photo by ${photo.user.name}</a> on <a href="https://unsplash.com/">Unsplash</a>`,
      },
    };
  }

  async makeRequest(endpoint, accessKey) {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
          Accept: 'application/json',
        },
      });

      return response.data;
    } catch (error) {
      console.error('Unsplash API error:', error.response?.data || error.message);

      if (error.response?.status === 401) {
        throw new Error('Invalid Unsplash access key. Please check your API credentials.');
      } else if (error.response?.status === 403) {
        throw new Error('Rate limit exceeded or insufficient permissions. Please try again later.');
      } else if (error.response?.status === 404) {
        throw new Error('Resource not found. Please check the provided parameters.');
      } else {
        throw new Error(`Unsplash API error: ${error.response?.data?.errors?.[0] || error.message}`);
      }
    }
  }

  validateParams(params) {
    if (!params.action) {
      throw new Error('Action is required');
    }

    switch (params.action) {
      case 'SEARCH_PHOTOS':
        if (!params.query) {
          throw new Error('Query is required for searching photos');
        }
        break;
      case 'GET_PHOTO':
        if (!params.photoId) {
          throw new Error('Photo ID is required');
        }
        break;
      case 'GET_COLLECTION_PHOTOS':
        if (!params.collectionId) {
          throw new Error('Collection ID is required');
        }
        break;
      case 'GET_USER_PROFILE':
      case 'GET_USER_PHOTOS':
        if (!params.username) {
          throw new Error('Username is required');
        }
        break;
      case 'DOWNLOAD_PHOTO':
        if (!params.photoId) {
          throw new Error('Photo ID is required for download');
        }
        break;
    }

    // Validate pagination parameters
    if (params.page && (params.page < 1 || params.page > 1000)) {
      throw new Error('Page must be between 1 and 1000');
    }

    if (params.perPage && (params.perPage < 1 || params.perPage > 30)) {
      throw new Error('Per page must be between 1 and 30');
    }

    // Validate orientation
    if (params.orientation && !['landscape', 'portrait', 'squarish'].includes(params.orientation)) {
      throw new Error("Orientation must be 'landscape', 'portrait', or 'squarish'");
    }

    // Validate color
    if (
      params.color &&
      !['black_and_white', 'black', 'white', 'yellow', 'orange', 'red', 'purple', 'magenta', 'green', 'teal', 'blue'].includes(params.color)
    ) {
      throw new Error('Invalid color filter');
    }

    // Validate order by
    if (params.orderBy && !['latest', 'oldest', 'popular', 'relevant'].includes(params.orderBy)) {
      throw new Error("Order by must be 'latest', 'oldest', 'popular', or 'relevant'");
    }
  }
}

export default new UnsplashAPI();
