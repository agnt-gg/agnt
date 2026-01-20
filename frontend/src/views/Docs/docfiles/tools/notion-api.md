# Notion API 📝

## Id

`notion-api`

## Description

Manages Notion workspaces with comprehensive database and page operations. Supports searching, querying databases, creating pages, and managing content. Uses OAuth authentication for secure Notion integration.

## Tags

notion, api, database, pages, workspace, oauth, content

## Input Parameters

### Required

- **operation** (string): Action to perform (`search`, `getDatabaseList`, `queryDatabase`, `getPageContent`, `createPage`)

### Optional

- **query** (string): Search query for search operations
- **databaseId** (string): Database ID for database operations
- **pageId** (string): Page ID for page operations
- **parentId** (string): Parent ID for new pages
- **parentType** (string): Parent type (`database` or `page`)
- **properties** (string): JSON properties for new pages
- **content** (string): JSON content for new pages
- **filter** (object): Filter criteria for database queries
- **sorts** (array): Sort criteria for database queries

## Output Format

- **success** (boolean): Whether the Notion operation was successful
- **result** (object): Operation result including search results, page data, or database records
- **error** (string|null): Error message if the operation failed
