# Webhook Receiver 🌐

## Id

`webhook-receiver`

## Description

Listens for incoming HTTP webhooks to trigger workflows. Supports multiple authentication methods including Basic Auth, Bearer tokens, and custom webhook tokens. Polls a remote server for webhook events and processes them based on configured authentication and method requirements.

## Tags

webhook, trigger, http, api, authentication, polling

## Input Parameters

### Required

- **workflowId** (string): Unique identifier for the workflow to trigger
- **method** (string): HTTP method to accept (GET, POST, PUT, DELETE, etc.)
- **authType** (string): Authentication type (none, basic, bearer, webhook)

### Optional

- **authToken** (string) [bearer/webhook auth only]: Bearer token or webhook token for authentication
- **username** (string) [basic auth only]: Username for Basic authentication
- **password** (string) [basic auth only]: Password for Basic authentication

## Output Format

- **webhookUrl** (string): The unique webhook URL endpoint for receiving triggers
- **status** (string): Registration status (success/error)
- **message** (string): Detailed status message
