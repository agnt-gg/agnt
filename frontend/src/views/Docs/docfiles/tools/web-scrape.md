# Web Scrape 🕷️

## Id

`web-scrape`

## Description

Performs comprehensive web scraping using headless browser automation. Extracts clean text content, all links, and code snippets from web pages. Features intelligent content filtering and robust error handling for reliable data extraction.

## Tags

web-scraping, browser, automation, content, links, code, extraction

## Input Parameters

### Required

- **url** (string): URL to scrape (automatically adds https:// if missing)

## Output Format

- **success** (boolean): Whether the scraping was successful
- **textContent** (string): Clean extracted text content
- **links** (array): All extracted links from the page
- **codeContent** (string): All code snippets found on the page
- **error** (string|null): Error message if scraping failed
