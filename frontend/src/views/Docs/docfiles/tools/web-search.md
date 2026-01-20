# Web Search 🔍

## Id

`web-search`

## Description

Performs web searches using Google Custom Search API to retrieve relevant results based on a query.

## Tags

search, web, research, information-retrieval

## Input Parameters

### Required

- **searchQuery** (string): The search query to look up

### Optional

- **numResults** (number, default=5): Number of results to return
- **sort** (string, default="relevance"): Sort order for results

## Output Format

- **success** (boolean): Whether the search was successful
- **results** (array): Array of search results with title, link, and snippet
- **error** (string|null): Error message if the search failed
