import BaseAction from '../BaseAction.js';
import Stripe from 'stripe';
import AuthManager from '../../../services/auth/AuthManager.js';

class StripeInvoice extends BaseAction {
  static schema = {
    title: 'Stripe API',
    category: 'action',
    type: 'stripe-invoice',
    icon: 'stripe',
    description: 'Create and send a Stripe invoice with support for single or multiple line items',
    authRequired: 'apiKey',
    authProvider: 'stripe',
    parameters: {
      customerEmail: {
        type: 'string',
        inputType: 'text',
        required: true,
        description: 'Email address of the customer to bill',
      },
      dueDate: {
        type: 'string',
        inputType: 'text',
        required: true,
        description: 'Due date for the invoice (YYYY-MM-DD)',
      },
      currency: {
        type: 'string',
        inputType: 'select',
        options: ['USD', 'EUR', 'GBP', 'JPY'],
        default: 'USD',
        required: true,
        description: 'Currency for the invoice (used as default for line items)',
      },
      amount: {
        type: 'number',
        inputType: 'text',
        description: 'Amount in cents for single item (e.g., 1000 for $10.00). Required if not using lineItems array.',
      },
      description: {
        type: 'string',
        inputType: 'textarea',
        description: 'Description for single item invoice. Required if not using lineItems array.',
      },
      lineItems: {
        type: 'array',
        inputType: 'textarea',
        description:
          "Array of line items for the invoice. Each item must have 'description' and 'amount' (in cents). Optional fields: 'quantity' (default: 1), 'currency', 'discountable' (default: true), 'metadata'. Example: [{\"description\": \"Consulting\", \"amount\": 5000, \"quantity\": 2}]",
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the invoice was created successfully',
      },
      invoiceId: {
        type: 'string',
        description: 'The ID of the created invoice',
      },
      invoiceNumber: {
        type: 'string',
        description: 'The human-readable invoice number',
      },
      invoiceUrl: {
        type: 'string',
        description: 'URL to view the invoice in the Stripe dashboard',
      },
      invoicePdf: {
        type: 'string',
        description: 'URL to download the invoice PDF',
      },
      customerEmail: {
        type: 'string',
        description: 'Email address of the invoiced customer',
      },
      currency: {
        type: 'string',
        description: 'Currency code for the invoice',
      },
      subtotal: {
        type: 'number',
        description: 'Subtotal amount in cents (before taxes/discounts)',
      },
      total: {
        type: 'number',
        description: 'Total amount in cents for the invoice',
      },
      amountDue: {
        type: 'number',
        description: 'Amount due in cents',
      },
      amountPaid: {
        type: 'number',
        description: 'Amount already paid in cents',
      },
      status: {
        type: 'string',
        description: 'Invoice status (draft, open, paid, void, uncollectible)',
      },
      dueDate: {
        type: 'string',
        description: 'ISO datetime string of when the invoice is due',
      },
      createdAt: {
        type: 'string',
        description: 'ISO datetime string when the invoice was created',
      },
      itemCount: {
        type: 'number',
        description: 'Total number of line items on the invoice',
      },
      lineItems: {
        type: 'array',
        description:
          'Array of line item details with index, description, amount, quantity, unitAmount, currency, formattedAmount, type, and metadata',
      },
      customer: {
        type: 'object',
        description: 'Customer object containing id, email, and name',
      },
      totalTax: {
        type: 'number',
        description: 'Total tax amount in cents (if applicable)',
      },
      taxes: {
        type: 'array',
        description: 'Array of tax information (if applicable)',
      },
      payment: {
        type: 'object',
        description: 'Payment information object (if invoice is paid)',
      },
      error: {
        type: 'string',
        description: 'Error message if the invoice creation failed',
      },
      type: {
        type: 'string',
        description: 'Error type if failed',
      },
      code: {
        type: 'string',
        description: 'Error code if failed',
      },
    },
  };

  constructor() {
    super('stripe-invoice');
  }

  async execute(params, inputData, workflowEngine) {
    params.userId = workflowEngine.userId;

    // Handle stringified JSON in lineItems (common when passed from LLMs)
    if (params.lineItems && Array.isArray(params.lineItems)) {
      params.lineItems = params.lineItems.map((item) => {
        if (typeof item === 'string') {
          try {
            return JSON.parse(item);
          } catch (e) {
            console.warn('Failed to parse line item JSON:', item);
            return item;
          }
        }
        return item;
      });
    }

    // Default currency to USD if not provided
    params.currency = params.currency || 'USD';

    this.validateParams(params);

    const apiKey = await AuthManager.getValidAccessToken(params.userId, 'stripe');
    if (!apiKey) {
      throw new Error('Stripe API key not found for this user');
    }

    const stripe = new Stripe(apiKey);

    try {
      console.log('Starting Stripe invoice creation process');

      const customer = await this.getOrCreateCustomer(stripe, params.customerEmail);
      console.log('Customer:', customer.id);

      // Create a draft invoice first
      const invoice = await stripe.invoices.create({
        customer: customer.id,
        collection_method: 'send_invoice',
        due_date: Math.floor(new Date(params.dueDate).getTime() / 1000),
        auto_advance: false,
      });
      console.log('Draft invoice created:', invoice.id);

      // Determine if we are processing a list of line items or a single item
      const hasLineItems = params.lineItems && Array.isArray(params.lineItems) && params.lineItems.length > 0;

      if (hasLineItems) {
        console.log(`Processing ${params.lineItems.length} line items...`);
        for (const item of params.lineItems) {
          if (!item.amount || !item.description) {
            throw new Error('Each line item must have an amount and description');
          }

          const invoiceItemParams = {
            customer: customer.id,
            currency: item.currency || params.currency || 'usd', // Use item currency or fallback to invoice default
            description: item.description,
            invoice: invoice.id,
          };

          // Handle amount vs quantity constraint
          if (item.amount) {
            invoiceItemParams.amount = item.amount;
            // When amount is specified, we cannot specify quantity in Stripe API (it implies 1 unit of that amount)
          } else {
            // Fallback for cases where amount might be missing but quantity/unit_amount logic is desired (though schema enforces amount)
            invoiceItemParams.quantity = item.quantity || 1;
          }

          await stripe.invoiceItems.create(invoiceItemParams);
        }
      } else {
        // Fallback to single item legacy behavior
        console.log('Processing single invoice item...');
        const invoiceItemParams = {
          customer: customer.id,
          currency: params.currency || 'usd',
          description: params.description,
          invoice: invoice.id,
        };

        if (params.amount) {
          invoiceItemParams.amount = params.amount;
        }

        await stripe.invoiceItems.create(invoiceItemParams);
      }

      // Retrieve the invoice to check its items and total
      let updatedInvoice = await stripe.invoices.retrieve(invoice.id);

      if (updatedInvoice.total === 0) {
        throw new Error('Invoice total is still 0 after adding items');
      }

      // Finalize the invoice
      const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id, {
        auto_advance: false,
      });
      console.log('Invoice finalized:', finalizedInvoice.id);

      // Send the invoice
      const sentInvoice = await stripe.invoices.sendInvoice(finalizedInvoice.id);
      console.log('Invoice sent:', sentInvoice.id);

      return {
        success: true,
        invoiceId: sentInvoice.id,
        invoiceNumber: sentInvoice.number,
        invoiceUrl: sentInvoice.hosted_invoice_url,
        invoicePdf: sentInvoice.invoice_pdf,
        customerEmail: sentInvoice.customer_email,
        currency: sentInvoice.currency,
        subtotal: sentInvoice.subtotal,
        total: sentInvoice.total,
        amountDue: sentInvoice.amount_due,
        amountPaid: sentInvoice.amount_paid,
        status: sentInvoice.status,
        dueDate: sentInvoice.due_date ? new Date(sentInvoice.due_date * 1000).toISOString() : null,
        createdAt: sentInvoice.created ? new Date(sentInvoice.created * 1000).toISOString() : null,
        itemCount: sentInvoice.lines.total_count,
        lineItems: sentInvoice.lines.data.map((line) => ({
          description: line.description,
          amount: line.amount,
          quantity: line.quantity,
          unitAmount: line.price ? line.price.unit_amount : null,
          currency: line.currency,
        })),
        customer: {
          id: customer.id,
          email: customer.email,
          name: customer.name,
        },
        totalTax: sentInvoice.tax,
        taxes: sentInvoice.total_tax_amounts,
      };
    } catch (error) {
      console.error('Error creating and sending Stripe invoice:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  validateParams(params) {
    if (!params.userId) throw new Error('User ID is required');
    if (!params.customerEmail) throw new Error('Customer email is required');
    if (!params.dueDate) throw new Error('Due date is required');
    if (!params.currency) throw new Error('Currency is required');

    // Check if we have either lineItems OR (amount + description)
    const hasSingleItem = params.amount && params.description;
    const hasLineItems = params.lineItems && Array.isArray(params.lineItems) && params.lineItems.length > 0;

    if (!hasSingleItem && !hasLineItems) {
      throw new Error('Either (amount + description) OR a valid lineItems array is required');
    }

    // Validate single item specifics if that's what we are using
    if (!hasLineItems) {
      if (params.amount <= 0) throw new Error('Invalid amount');
    }
  }

  async getOrCreateCustomer(stripe, email) {
    const existingCustomers = await stripe.customers.list({ email: email, limit: 1 });
    if (existingCustomers.data.length > 0) {
      return existingCustomers.data[0];
    } else {
      return await stripe.customers.create({ email: email });
    }
  }
}

export default new StripeInvoice();
