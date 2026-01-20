# File System Operation 📁

## Id

`file-system-operation`

## Description

Provides comprehensive file system operations including reading, writing, appending, listing directories, and executing files. Supports multiple file types and formats with automatic encoding detection for text files and base64 encoding for binary files.

## Tags

file, system, utility, read, write, execute, directory, filesystem

## Input Parameters

### Required

- **rootDirectory** (string): Base directory path for file operations
- **operation** (string): The file operation to perform (`readFile`, `writeFile`, `appendFile`, `listFiles`, `executeFile`)
- **path** (string): Relative file path from rootDirectory

### Optional

- **content** (string) [writeFile/appendFile operations only]: Content to write or append to the file

## Output Format

- **success** (boolean): Indicates whether the file operation was successful
- **result** (any): The result of the file operation (file content, directory listing, or execution output)
- **error** (string|null): Error message if the file operation failed
