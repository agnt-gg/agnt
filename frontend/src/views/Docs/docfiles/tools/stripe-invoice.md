# Stripe Invoice 💳

## Id

`stripe-invoice`

## Description

Creates and sends professional invoices using Stripe's payment platform. Supports customer management, due dates, and automated invoice generation with comprehensive billing features.

## Tags

stripe, invoice, billing, payment, customer, due-date

## Input Parameters

### Required

- **customerEmail** (string): Customer email address
- **amount** (number): Invoice amount in cents
- **currency** (string): Currency code (usd, eur, etc.)
- **description** (string): Invoice description
- **dueDate** (string): Due date in ISO format

## Output Format

- **success** (boolean): Whether the invoice was created successfully
- **invoiceId** (string): Stripe invoice ID
- **invoiceUrl** (string): Hosted invoice URL for customer access
- **amount** (number): Final invoice amount
- **error** (string|null): Error message if invoice creation failed
