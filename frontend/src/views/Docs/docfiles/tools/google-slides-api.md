# Google Slides API 🎯

## Id

`google-slides-api`

## Description

Manages Google Slides presentations with full CRUD operations. Supports creating presentations, managing slides, adding content, images, and formatting. Uses OAuth authentication for secure Google Slides integration.

## Tags

google-slides, presentation, api, slides, content, oauth

## Input Parameters

### Required

- **action** (string): Action to perform (`Create Presentation`, `Read Presentation`, `Update Presentation`, `Delete Presentation`, `Create Slide`, `Read Slide`, `Update Slide`, `Delete Slide`)
- **presentationId** (string): Google Slides presentation ID

### Optional

- **title** (string): Presentation title
- **slideId** (string): Specific slide ID for operations
- **slideContent** (string): JSON content for slide creation/updates
- **newFolderName** (string): Name for new folders

## Output Format

- **success** (boolean): Whether the Google Slides operation was successful
- **result** (object): Operation result including presentation data, slide information, or update confirmations
- **error** (string|null): Error message if the operation failed
