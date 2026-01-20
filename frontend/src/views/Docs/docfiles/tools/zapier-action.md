# Zapier Webhook

## Overview

The **Zapier Webhook** node sends data to 6,000+ apps via Zapier webhooks. Trigger actions like sending emails, creating tasks, posting to social media, and more by sending JSON data to your Zap's webhook URL.

## Category

**Action**

## Parameters

### zapWebhookUrl

- **Type**: String
- **Required**: Yes
- **Description**: Your Zap's webhook URL. In Zapier: 1) Create a new Zap, 2) Choose 'Webhooks by Zapier' as the trigger, 3) Select 'Catch Hook', 4) Copy the webhook URL and paste it here.

### payload

- **Type**: String (code area)
- **Required**: Yes
- **Description**: JSON data to send to Zapier. Example: `{"email": "user@example.com", "name": "John Doe", "amount": 100}`. This data will be available in your Zap for mapping to other apps.

## Outputs

### success

- **Type**: Boolean
- **Description**: Whether the webhook was triggered successfully

### zapResponse

- **Type**: Object
- **Description**: Response from Zapier webhook

### triggeredZaps

- **Type**: Array
- **Description**: List of triggered Zaps with status and timestamp

### error

- **Type**: String
- **Description**: Error message if the webhook failed

## Use Cases

1. **Send Notifications**: Trigger email, SMS, or push notifications
2. **Create Tasks**: Add tasks to Asana, Trello, or Todoist
3. **Update CRM**: Add or update contacts in Salesforce, HubSpot, etc.
4. **Post to Social Media**: Share content on Twitter, LinkedIn, Facebook
5. **Log Data**: Send data to Google Sheets, Airtable, or databases
6. **Trigger Automations**: Start complex multi-step Zaps

## Setup Instructions

### Step 1: Create Zap in Zapier

1. Go to Zapier and create a new Zap
2. Choose "Webhooks by Zapier" as the trigger
3. Select "Catch Hook" as the trigger event
4. Copy the webhook URL provided by Zapier

### Step 2: Configure Workflow Node

1. Add Zapier Webhook node to your workflow
2. Paste the webhook URL into the `zapWebhookUrl` parameter
3. Define your JSON payload with the data you want to send

### Step 3: Configure Zap Actions

1. In Zapier, add action steps for what you want to happen
2. Map the webhook data fields to your action apps
3. Test your Zap

### Step 4: Test

1. Run your workflow
2. Verify the data appears in Zapier
3. Check that your Zap actions execute correctly

## Example Configurations

**Send Email via Gmail**

```
zapWebhookUrl: https://hooks.zapier.com/hooks/catch/123456/abcdef/
payload: {
  "to": "recipient@example.com",
  "subject": "Workflow Notification",
  "body": "Your workflow has completed successfully!"
}

Zapier Action: Gmail - Send Email
Map fields: to, subject, body
```

**Create Trello Card**

```
zapWebhookUrl: https://hooks.zapier.com/hooks/catch/123456/abcdef/
payload: {
  "title": "New Task from Workflow",
  "description": "{{aiLLM.generatedText}}",
  "list": "To Do",
  "dueDate": "2024-12-31"
}

Zapier Action: Trello - Create Card
Map fields: title, description, list, dueDate
```

**Add to Google Sheets**

```
zapWebhookUrl: https://hooks.zapier.com/hooks/catch/123456/abcdef/
payload: {
  "name": "{{formData.name}}",
  "email": "{{formData.email}}",
  "timestamp": "{{currentTime}}",
  "status": "Processed"
}

Zapier Action: Google Sheets - Create Spreadsheet Row
Map fields: name, email, timestamp, status
```

**Post to Twitter**

```
zapWebhookUrl: https://hooks.zapier.com/hooks/catch/123456/abcdef/
payload: {
  "tweet": "{{aiLLM.generatedText}}",
  "hashtags": "#automation #workflow"
}

Zapier Action: Twitter - Create Tweet
Map fields: tweet, hashtags
```

## Tips

- Use descriptive field names in your payload for easier mapping in Zapier
- Test your webhook URL before deploying
- You can send any valid JSON structure
- Use workflow variables in your payload with `{{nodeName.output}}`
- Check Zapier's task history if webhooks aren't being received
- Zapier has a 30-second timeout for webhook responses

## Common Patterns

**Workflow Completion Notification**

```
1. Workflow processes data
2. Zapier Webhook sends completion status
3. Zapier sends email notification
4. Zapier logs to Google Sheets
```

**AI Content Distribution**

```
1. AI LLM generates content
2. Zapier Webhook sends content
3. Zapier posts to Twitter
4. Zapier posts to LinkedIn
5. Zapier saves to Notion
```

**Lead Processing**

```
1. Workflow qualifies lead
2. Zapier Webhook sends lead data
3. Zapier adds to CRM
4. Zapier sends welcome email
5. Zapier notifies sales team in Slack
```

**Data Sync**

```
1. Workflow transforms data
2. Zapier Webhook sends transformed data
3. Zapier updates multiple databases
4. Zapier sends confirmation
```

## Payload Examples

**Simple Data**

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "status": "active"
}
```

**Nested Data**

```json
{
  "user": {
    "name": "John Doe",
    "email": "john@example.com"
  },
  "order": {
    "id": "12345",
    "total": 99.99,
    "items": ["Product A", "Product B"]
  }
}
```

**With Workflow Variables**

```json
{
  "generatedContent": "{{aiLLM.generatedText}}",
  "processedAt": "{{currentTimestamp}}",
  "workflowId": "{{workflowId}}",
  "success": true
}
```

## Troubleshooting

**Webhook not triggering:**

- Verify the webhook URL is correct and active
- Check that your Zap is turned on
- Review Zapier's task history for errors
- Ensure payload is valid JSON

**Data not mapping:**

- Check field names match exactly (case-sensitive)
- Verify JSON structure is correct
- Test with simple payload first
- Use Zapier's "Test Trigger" feature

**Timeout errors:**

- Reduce payload size if very large
- Check network connectivity
- Verify Zapier service status

## Related Nodes

- **Zapier Trigger**: Receive data from Zapier
- **Custom API Request**: For direct API integrations
- **Send Email**: For direct email sending
- **Data Transformer**: Transform data before sending
- **Conditional Logic**: Send different payloads based on conditions

## Tags

zapier, webhook, action, integration, automation, 6000+ apps, email, tasks, crm, social media
