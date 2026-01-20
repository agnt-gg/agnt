# Code Preview

## Overview

The **Code Preview** node displays syntax-highlighted code with automatic language detection. It supports drag & drop of code files and auto-detects programming languages from file extensions, making it perfect for displaying code snippets in workflows.

## Category

**Widget**

## Parameters

### codeSource

- **Type**: Code (textarea)
- **Required**: Yes
- **Description**: Code content to display
- **Features**: Supports drag & drop of code files (.js, .py, .java, .html, .css, etc.)

### language

- **Type**: String (select)
- **Required**: No
- **Default**: javascript
- **Options**:
  - javascript
  - typescript
  - python
  - java
  - csharp
  - cpp
  - html
  - css
  - json
  - markdown
  - sql
  - bash
  - plaintext
- **Description**: Programming language for syntax highlighting

## Outputs

### success

- **Type**: Boolean
- **Description**: Whether the code was successfully processed

### codeContent

- **Type**: String
- **Description**: The code content

### language

- **Type**: String
- **Description**: The detected or specified programming language

### metadata

- **Type**: Object
- **Description**: Code metadata including:
  - Line count
  - Complexity metrics
  - Detected features (functions, classes, comments)
  - Character count

### error

- **Type**: String
- **Description**: Error message if code processing failed

## Use Cases

1. **Code Documentation**: Display code examples in documentation
2. **Code Review**: Preview code changes before committing
3. **Tutorial Creation**: Show code snippets in educational content
4. **API Response Display**: Format and display JSON/XML responses
5. **Log Viewing**: Display formatted log files
6. **Script Validation**: Preview generated scripts before execution

## Example Configurations

**Display JavaScript Code**

```
codeSource: function hello() { console.log("Hello World"); }
language: javascript
```

**Display Python Code**

```
codeSource: def hello(): print("Hello World")
language: python
```

**Display JSON Data**

```
codeSource: {"name": "John", "age": 30}
language: json
```

## Tips

- Language is auto-detected from file extensions when using drag & drop
- Syntax highlighting improves code readability
- Metadata includes line count and complexity metrics
- Supports all major programming languages
- Use plaintext for unsupported languages
- Great for displaying API responses or generated code

## Common Patterns

**Code Generation Workflow**

```
1. Generate code with AI LLM
2. Pass to Code Preview for syntax highlighting
3. Review the generated code
4. Execute with Execute JavaScript/Python node
```

**API Response Formatting**

```
1. Make API request with Custom API
2. Pass JSON response to Code Preview
3. Set language to 'json' for formatting
4. Display formatted response
```

**Documentation Builder**

```
1. Fetch code examples from repository
2. Display with Code Preview
3. Combine with Markdown Preview for full docs
```

## Related Nodes

- **Execute JavaScript**: For running JavaScript code
- **Execute Python**: For running Python code
- **HTML Preview**: For displaying HTML content
- **Markdown Preview**: For displaying markdown with code blocks
- **File System Operation**: For reading code files

## Tags

code, preview, syntax, highlighting, display, widget, programming, javascript, python, json
