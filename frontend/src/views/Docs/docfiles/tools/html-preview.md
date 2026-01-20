# HTML Preview

## Overview

The **HTML Preview** node renders HTML content in a sandboxed preview window with configurable security levels. It supports raw HTML strings, URLs, base64-encoded HTML, and drag & drop .html files. The node automatically extracts metadata about scripts, styles, and external resources.

## Category

**Widget**

## Parameters

### htmlSource

- **Type**: String (textarea)
- **Required**: Yes
- **Description**: HTML content to preview
- **Supported Formats**:
  - Raw HTML string
  - URL to fetch HTML from
  - Base64-encoded HTML (data:text/html;base64,...)
  - Blob URL
  - Drag & drop .html files

### sandboxMode

- **Type**: String (select)
- **Required**: No
- **Default**: Strict
- **Options**:
  - **Strict**: Blocks all scripts and inline event handlers (safest)
  - **Allow Scripts**: Allows scripts but blocks inline event handlers
  - **Full Access**: No restrictions (use with caution)
- **Description**: Security sandbox level for the HTML preview

## Outputs

### success

- **Type**: Boolean
- **Description**: Whether the HTML was successfully processed

### htmlContent

- **Type**: String
- **Description**: The processed HTML content ready for rendering

### metadata

- **Type**: Object
- **Description**: Extracted HTML metadata including:
  - Character count
  - Script detection (inline and external)
  - Style detection (inline and external)
  - External resources count
  - Source type (raw, url, base64, blob)

### error

- **Type**: String
- **Description**: Error message if HTML processing failed

## Use Cases

1. **Email Template Preview**: Preview HTML email templates before sending
2. **Web Page Testing**: Test HTML snippets or full pages
3. **Documentation Display**: Render HTML documentation
4. **Report Generation**: Display HTML reports from data
5. **Widget Development**: Preview custom HTML widgets
6. **Content Validation**: Verify HTML structure and rendering

## Example Configurations

**Preview Raw HTML**

```
htmlSource: <div><h1>Hello World</h1><p>This is a test.</p></div>
sandboxMode: Strict
```

**Preview HTML from URL**

```
htmlSource: https://example.com/page.html
sandboxMode: Allow Scripts
```

**Preview Base64 HTML**

```
htmlSource: data:text/html;base64,PGh0bWw+PGJvZHk+SGVsbG88L2JvZHk+PC9odG1sPg==
sandboxMode: Strict
```

## Security Considerations

### Strict Mode (Recommended)

- Blocks all JavaScript execution
- Blocks inline event handlers (onclick, onload, etc.)
- Prevents form submissions
- Safest option for untrusted content

### Allow Scripts Mode

- Allows JavaScript execution
- Still blocks inline event handlers
- Use for trusted content that needs interactivity

### Full Access Mode

- No security restrictions
- **Only use with fully trusted content**
- Potential security risk with untrusted HTML

## Tips

- Always use **Strict** mode for untrusted or user-generated HTML
- The node extracts metadata about scripts and styles automatically
- Supports drag & drop for easy HTML file upload
- Can fetch HTML from remote URLs
- Handles base64-encoded HTML seamlessly
- Metadata includes character count and resource detection

## Common Patterns

**Email Template Workflow**

```
1. Generate HTML email template with AI LLM
2. Pass to HTML Preview with Strict mode
3. Review rendering before sending
4. Send via Send Email node
```

**Web Scraping Preview**

```
1. Scrape HTML with Web Scrape node
2. Pass to HTML Preview for visual inspection
3. Extract specific elements or data
```

**Dynamic Report Generation**

```
1. Fetch data from API
2. Generate HTML report with Execute JavaScript
3. Preview with HTML Preview
4. Export or email the report
```

## Related Nodes

- **Web Scrape**: For fetching HTML from websites
- **Execute JavaScript**: For generating dynamic HTML
- **Send Email**: For sending HTML emails
- **Media Preview**: For displaying images and videos
- **Code Preview**: For viewing HTML source code

## Tags

html, preview, render, display, widget, sandbox, security, web, email, template
