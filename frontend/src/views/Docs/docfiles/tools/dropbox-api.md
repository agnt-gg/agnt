# Dropbox API 📦

## Id

`dropbox-api`

## Description

Manages files and folders in Dropbox with full CRUD operations. Supports file uploads/downloads, folder management, shared links, and metadata retrieval. Uses OAuth authentication for secure Dropbox integration.

## Tags

dropbox, storage, files, cloud, api, oauth

## Input Parameters

### Required

- **action** (string): Action to perform (`LIST_FOLDER`, `UPLOAD_FILE`, `DOWNLOAD_FILE`, `DELETE_FILE`, `MOVE_FILE`, `CREATE_FOLDER`, `GET_FILE_METADATA`, `CREATE_SHARED_LINK`)
- **path** (string): File or folder path in Dropbox

### Optional

- **content** (string): Base64-encoded file content for uploads
- **newPath** (string): Destination path for move operations
- **fileName** (string): Name for uploaded files

## Output Format

- **success** (boolean): Whether the Dropbox operation was successful
- **result** (object): Operation result including file metadata, download URLs, or shared links
- **error** (string|null): Error message if the operation failed
