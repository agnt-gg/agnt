# Unsplash API 📸

## Id

`unsplash-api`

## Description

Accesses Unsplash's vast photo library with comprehensive search and download capabilities. Supports photo searches, random photos, collections, user profiles, and direct downloads with proper attribution.

## Tags

unsplash, photos, api, images, search, download, photography

## Input Parameters

### Required

- **action** (string): Action to perform (`SEARCH_PHOTOS`, `GET_RANDOM_PHOTO`, `GET_PHOTO`, `LIST_PHOTOS`, `GET_COLLECTIONS`, `GET_COLLECTION_PHOTOS`, `GET_USER_PROFILE`, `GET_USER_PHOTOS`, `DOWNLOAD_PHOTO`)

### Optional

- **query** (string): Search query for photo searches
- **username** (string): Username for user-specific operations
- **photoId** (string): Photo ID for specific photo operations
- **collectionId** (string): Collection ID for collection operations
- **page** (number): Page number for pagination
- **perPage** (number): Results per page (1-30)
- **orientation** (string): Photo orientation (`landscape`, `portrait`, `squarish`)
- **color** (string): Color filter for photos
- **orderBy** (string): Sort order (`latest`, `oldest`, `popular`, `relevant`)

## Output Format

- **success** (boolean): Whether the Unsplash operation was successful
- **result** (object): Operation result including photo data, URLs, metadata, or download links
- **error** (string|null): Error message if the operation failed
