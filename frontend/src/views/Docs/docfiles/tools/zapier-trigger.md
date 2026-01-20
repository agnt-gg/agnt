# Zapier Trigger

## Overview

The **Zapier Trigger** node receives events from 6,000+ apps via Zapier. When something happens in your connected apps (new email, form submission, sale, etc.), this trigger fires your workflow, enabling powerful cross-platform automation.

## Category

**Trigger**

## Parameters

### webhookUrl

- **Type**: String (readonly)
- **Value**: `{{WEBHOOK_URL}}/webhook/{{WORKFLOWID}}`
- **Description**: Copy this URL into your Zapier webhook action. In Zapier, add a 'Webhooks by Zapier' action and paste this URL.

### authType

- **Type**: String (select)
- **Required**: No
- **Default**: Bearer
- **Options**:
  - **None**: No authentication (not recommended)
  - **Basic**: Username/password authentication
  - **Bearer**: Token-based authentication (recommended)
- **Description**: Authentication method (recommended: Bearer for security)

### authToken

- **Type**: String
- **Required**: Conditional (when authType is Bearer)
- **Description**: Secret token to verify requests from Zapier. Generate a random string and add it to your Zap's headers as 'Authorization: Bearer YOUR_TOKEN'

### username

- **Type**: String
- **Required**: Conditional (when authType is Basic)
- **Description**: Username for Basic authentication

### password

- **Type**: String (password)
- **Required**: Conditional (when authType is Basic)
- **Description**: Password for Basic authentication

## Outputs

### method

- **Type**: String
- **Description**: The HTTP method (always POST for Zapier)

### headers

- **Type**: Object
- **Description**: Request headers from Zapier

### body

- **Type**: Object
- **Description**: All data sent from Zapier - access fields like `{{zapierTrigger.body.email}}`, `{{zapierTrigger.body.name}}`, etc.

### query

- **Type**: Object
- **Description**: Query parameters (if any)

### params

- **Type**: Object
- **Description**: Route parameters (if any)

## Use Cases

1. **Form Submissions**: Trigger workflows when forms are submitted (Typeform, Google Forms, etc.)
2. **Email Notifications**: React to new emails from Gmail, Outlook, etc.
3. **E-commerce Events**: Process new orders from Shopify, WooCommerce, etc.
4. **CRM Updates**: Respond to new leads or contacts in Salesforce, HubSpot, etc.
5. **Social Media**: Monitor mentions, posts, or messages
6. **Calendar Events**: Trigger on new calendar events or reminders

## Setup Instructions

### Step 1: Copy Webhook URL

1. Add Zapier Trigger node to your workflow
2. Copy the webhook URL from the node parameters

### Step 2: Create Zap in Zapier

1. Go to Zapier and create a new Zap
2. Choose your trigger app (e.g., "Gmail", "Typeform", "Shopify")
3. Configure the trigger event

### Step 3: Add Webhook Action

1. Add an action step
2. Choose "Webhooks by Zapier"
3. Select "POST" as the action
4. Paste your webhook URL

### Step 4: Configure Authentication (Recommended)

1. In your workflow, set authType to "Bearer"
2. Generate a secure random token
3. In Zapier, add a header:
   - Key: `Authorization`
   - Value: `Bearer YOUR_TOKEN_HERE`

### Step 5: Map Data

1. In Zapier, map the data you want to send
2. This data will be available in `{{zapierTrigger.body}}`

### Step 6: Test

1. Test your Zap in Zapier
2. Verify your workflow receives the data

## Example Configurations

**Gmail to Workflow**

```
Zapier Setup:
- Trigger: Gmail - New Email
- Action: Webhooks - POST
- URL: Your webhook URL
- Headers: Authorization: Bearer abc123xyz

Workflow Access:
{{zapierTrigger.body.from}}
{{zapierTrigger.body.subject}}
{{zapierTrigger.body.body}}
```

**Typeform to Workflow**

```
Zapier Setup:
- Trigger: Typeform - New Entry
- Action: Webhooks - POST
- URL: Your webhook URL

Workflow Access:
{{zapierTrigger.body.name}}
{{zapierTrigger.body.email}}
{{zapierTrigger.body.message}}
```

**Shopify Order to Workflow**

```
Zapier Setup:
- Trigger: Shopify - New Order
- Action: Webhooks - POST
- URL: Your webhook URL

Workflow Access:
{{zapierTrigger.body.order_id}}
{{zapierTrigger.body.customer_email}}
{{zapierTrigger.body.total_price}}
```

## Security Best Practices

1. **Always use Bearer authentication** for production workflows
2. **Generate strong random tokens** (at least 32 characters)
3. **Keep tokens secret** - don't share them publicly
4. **Rotate tokens periodically** for enhanced security
5. **Monitor webhook activity** for suspicious requests

## Tips

- Test your Zap before enabling it
- Use descriptive field names in Zapier for easier workflow access
- The body object structure depends on what you send from Zapier
- All data is available in `{{zapierTrigger.body.fieldName}}`
- Zapier always sends POST requests
- Check Zapier's task history if webhooks aren't firing

## Common Patterns

**Email Processing Workflow**

```
1. Zapier Trigger receives new email
2. AI LLM analyzes email content
3. Conditional logic routes based on analysis
4. Send appropriate response via Send Email
```

**Order Fulfillment Workflow**

```
1. Zapier Trigger receives new Shopify order
2. Database Operation stores order details
3. Send Email sends confirmation to customer
4. Slack API notifies fulfillment team
```

**Lead Qualification Workflow**

```
1. Zapier Trigger receives new form submission
2. AI LLM qualifies the lead
3. If qualified: Add to CRM via Custom API
4. Send Email with next steps
```

## Troubleshooting

**Webhook not receiving data:**

- Verify the webhook URL is correct
- Check that your Zap is turned on
- Review Zapier's task history for errors
- Ensure authentication tokens match

**Authentication failing:**

- Verify authType matches your setup
- Check that the token is correct
- Ensure header format is: `Authorization: Bearer TOKEN`

**Data not accessible:**

- Check the exact field names sent from Zapier
- Use `{{zapierTrigger.body}}` to see all available data
- Field names are case-sensitive

## Related Nodes

- **Zapier Webhook** (Action): Send data back to Zapier
- **Webhook Listener**: For non-Zapier webhook integrations
- **Custom API Request**: For direct API integrations
- **Conditional Logic**: Route based on received data
- **Data Transformer**: Transform incoming data

## Tags

zapier, trigger, webhook, integration, automation, 6000+ apps, forms, email, ecommerce
