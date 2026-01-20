# Image Preview 🖼️

## Id

`image-preview`

## Description

Validates and prepares image data for display in workflows. Supports both URL-based images and base64-encoded image data. Provides basic validation to ensure image sources are properly formatted for frontend rendering.

## Tags

image, preview, utility, display, validation, base64

## Input Parameters

### Required

- **imageSource** (string): The image source - can be a URL (http/https) or base64-encoded image data

## Output Format

- **success** (boolean): Indicates whether the image source is valid
- **imageUrl** (string|null): The validated image source ready for display
- **error** (string|null): Error message if the image source is invalid
