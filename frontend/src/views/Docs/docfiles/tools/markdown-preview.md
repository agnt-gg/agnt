# Markdown Preview

## Overview

The **Markdown Preview** node renders markdown content with preview/source toggle functionality. It supports headers, bold, italic, links, code blocks, inline code, and lists, making it perfect for displaying formatted documentation and content in workflows.

## Category

**Widget**

## Parameters

### markdownSource

- **Type**: String (textarea)
- **Required**: Yes
- **Description**: Markdown content to render
- **Features**: Supports drag & drop of .md files
- **Supported Syntax**:
  - Headers (# H1, ## H2, etc.)
  - Bold (\*\*text\*\*)
  - Italic (\*text\*)
  - Links ([text](url))
  - Code blocks (\`\`\`code\`\`\`)
  - Inline code (\`code\`)
  - Lists (ordered and unordered)
  - Tables
  - Blockquotes

## Outputs

### success

- **Type**: Boolean
- **Description**: Whether the markdown was successfully processed

### markdownContent

- **Type**: String
- **Description**: The original markdown content

### htmlContent

- **Type**: String
- **Description**: The rendered HTML from markdown

### metadata

- **Type**: Object
- **Description**: Markdown metadata including:
  - Line count
  - Word count
  - Detected features (headers, links, images, code blocks, tables, lists)

### error

- **Type**: String
- **Description**: Error message if markdown processing failed

## Use Cases

1. **Documentation Display**: Render markdown documentation
2. **README Preview**: Display README files from repositories
3. **Blog Post Rendering**: Show markdown blog posts
4. **Note Taking**: Display formatted notes
5. **Report Generation**: Create formatted reports from markdown
6. **Content Management**: Preview markdown content before publishing

## Example Configurations

**Basic Markdown**

```
markdownSource: # Hello World

This is a **bold** statement with *italic* text.

- Item 1
- Item 2
- Item 3
```

**Markdown with Code**

```
markdownSource: ## Code Example

Here's some JavaScript:

\`\`\`javascript
function hello() {
  console.log("Hello World");
}
\`\`\`
```

**Markdown from Variable**

```
markdownSource: {{aiLLM.generatedText}}
```

## Tips

- Toggle between preview and source view
- Supports all standard markdown syntax
- Metadata includes word count and feature detection
- Drag & drop support for .md files
- Great for displaying AI-generated content
- Can be combined with other preview nodes

## Common Patterns

**Documentation Generator**

```
1. Fetch markdown from repository
2. Display with Markdown Preview
3. Extract metadata for indexing
4. Publish or export
```

**AI Content Display**

```
1. Generate markdown content with AI LLM
2. Pass to Markdown Preview
3. Review formatted output
4. Save or publish content
```

**README Viewer**

```
1. Fetch README.md from GitHub API
2. Display with Markdown Preview
3. Show formatted documentation
```

## Markdown Syntax Reference

**Headers**

```
# H1
## H2
### H3
```

**Emphasis**

```
*italic* or _italic_
**bold** or __bold__
***bold italic***
```

**Lists**

```
- Unordered item
- Another item

1. Ordered item
2. Another item
```

**Links**

```
[Link text](https://example.com)
```

**Code**

```
Inline `code`

\`\`\`javascript
// Code block
console.log("Hello");
\`\`\`
```

**Tables**

```
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
```

**Blockquotes**

```
> This is a quote
```

## Related Nodes

- **Code Preview**: For displaying code with syntax highlighting
- **HTML Preview**: For displaying HTML content
- **AI LLM Call**: For generating markdown content
- **File System Operation**: For reading markdown files
- **GitHub API**: For fetching README files

## Tags

markdown, preview, render, display, widget, documentation, readme, formatting
