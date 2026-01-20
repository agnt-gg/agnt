# Custom API 🔗

## Id

`custom-api`

## Description

Makes HTTP requests to any REST API endpoint with full support for authentication methods (Basic, Bearer, Webhook tokens), query parameters, headers, and request bodies. Supports JSON and plain text payloads with comprehensive error handling.

## Tags

api, http, rest, authentication, web, integration

## Input Parameters

### Required

- **url** (string): The API endpoint URL
- **method** (string): HTTP method (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`)

### Optional

- **query** (string): Query parameters as URL-encoded string
- **headers** (string|object): Request headers as JSON string or object
- **body** (string|object): Request body as JSON string or object
- **authType** (string): Authentication type (`basic`, `bearer`, `webhook`)
- **authToken** (string): Bearer or webhook token for authentication
- **username** (string): Username for Basic authentication
- **password** (string): Password for Basic authentication

## Output Format

- **success** (boolean): Whether the API request was successful
- **status** (number): HTTP status code
- **result** (any): Response data from the API
- **headers** (object): Response headers
- **error** (string|null): Error message if the request failed
