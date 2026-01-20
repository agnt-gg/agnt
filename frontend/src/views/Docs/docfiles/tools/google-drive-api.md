# Google Drive API ☁️

## Id

`google-drive-api`

## Description

Manages Google Drive files and folders with full CRUD operations. Supports file uploads/downloads, folder creation, sharing, and metadata retrieval. Uses OAuth authentication for secure Google Drive integration.

## Tags

google-drive, storage, files, cloud, api, oauth, sharing

## Input Parameters

### Required

- **action** (string): Action to perform (`LIST_FILES`, `UPLOAD_FILE`, `DOWNLOAD_FILE`, `CREATE_FOLDER`, `DELETE_FILE`, `MOVE_FILE`, `GET_FILE_INFO`, `SHARE_FILE`)
- **fileName** (string): File or folder name for operations

### Optional

- **folderId** (string): Parent folder ID for operations
- **fileContent** (string): File content for uploads
- **destinationFolderId** (string): Destination folder for move operations
- **shareEmail** (string): Email address for sharing
- **shareRole** (string): Sharing role (`reader`, `writer`, `owner`)

## Output Format

- **success** (boolean): Whether the Google Drive operation was successful
- **result** (object): Operation result including file IDs, download URLs, or share links
- **error** (string|null): Error message if the operation failed
