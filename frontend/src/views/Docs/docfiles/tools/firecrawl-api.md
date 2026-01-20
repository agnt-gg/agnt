# Firecrawl API 🔥

## Id

`firecrawl-api`

## Description

Extracts structured data from web pages using Firecrawl's scraping API. Supports multiple output formats including markdown, HTML, and plain text. Ideal for content extraction and web data collection.

## Tags

scraping, web, content, extraction, api, firecrawl

## Input Parameters

### Required

- **url** (string): The URL to scrape
- **format** (string): Output format (`markdown`, `html`, `text`)

## Output Format

- **success** (boolean): Whether the scraping was successful
- **result** (object): Scraped content data
- **error** (string|null): Error message if scraping failed
