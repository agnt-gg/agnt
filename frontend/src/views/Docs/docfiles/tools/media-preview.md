# Media Preview

## Overview

The **Media Preview** node is an advanced media display tool that renders images and videos from various sources including URLs, base64 data, and streaming platforms. It automatically detects media types, extracts metadata, and provides enhanced validation and optimization.

## Category

**Widget**

## Parameters

### mediaSource

- **Type**: String (textarea)
- **Required**: Yes
- **Description**: Media URL, base64 data (with or without data URI prefix), or blob URL
- **Supported Formats**:
  - **Images**: jpg, png, gif, webp, bmp, svg
  - **Videos**: mp4, webm, mov, avi, mkv, wmv
  - **Streaming**: YouTube, Vimeo, and other streaming URLs
- **Features**: Automatically detects format from magic bytes for raw base64 data

## Outputs

### success

- **Type**: Boolean
- **Description**: Whether the media was successfully processed

### mediaType

- **Type**: String
- **Description**: The detected media type ('image', 'video', or 'unknown')

### originalUrl

- **Type**: String
- **Description**: The original media URL before processing

### base64Data

- **Type**: String
- **Description**: Full data URI with prefix (data:image/jpeg;base64,abc123...) - ready for HTML display

### metadata

- **Type**: Object
- **Description**: Extracted media metadata including dimensions, format, file size, and processing info

### fileSize

- **Type**: Number
- **Description**: File size in bytes (calculated for base64 data, fetched for URLs)

### dimensions

- **Type**: Object
- **Description**: Image dimensions as {width, height} (when available)

### format

- **Type**: String
- **Description**: Detected media format/MIME type

### error

- **Type**: String
- **Description**: Error message if media processing failed

## Use Cases

1. **Image Display**: Show images from API responses or file uploads
2. **Video Playback**: Display videos from various sources
3. **Media Validation**: Verify media files before processing
4. **Thumbnail Generation**: Preview media content in workflows
5. **Streaming Integration**: Embed YouTube or Vimeo videos
6. **Base64 Conversion**: Display base64-encoded media

## Example Configurations

**Display Image from URL**

```
mediaSource: https://example.com/image.jpg
```

**Display Base64 Image**

```
mediaSource: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...
```

**Display YouTube Video**

```
mediaSource: https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

**Display Local Video**

```
mediaSource: {{fileUpload.base64Data}}
```

## Tips

- The node automatically detects media type from the source
- Base64 data can be provided with or without the data URI prefix
- Supports drag & drop for easy media upload
- Extracts metadata like dimensions and file size automatically
- Works with streaming platform URLs (YouTube, Vimeo, etc.)
- Handles both local and remote media sources

## Common Patterns

**Image Processing Pipeline**

```
1. Upload image via file input
2. Pass to Media Preview for validation
3. Use metadata.dimensions to verify size
4. Process or display the image
```

**Video Thumbnail Extraction**

```
1. Provide video URL to Media Preview
2. Extract metadata.format and metadata.fileSize
3. Use for video processing decisions
```

**Multi-Source Media Display**

```
1. Accept media from various sources (URL, base64, upload)
2. Media Preview normalizes and displays all formats
3. Use outputs for further processing
```

## Related Nodes

- **HTML Preview**: For displaying HTML content
- **PDF Preview**: For displaying PDF documents
- **Code Preview**: For displaying code with syntax highlighting
- **File System Operation**: For reading local media files
- **Custom API Request**: For fetching media from APIs

## Tags

media, image, video, preview, display, widget, base64, streaming, youtube, vimeo
