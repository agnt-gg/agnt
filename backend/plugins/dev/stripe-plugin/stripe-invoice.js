import Stripe from 'stripe';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


/**
 * Stripe Invoice Plugin Tool
 *
 * Create and send invoices with line items.
 */
class StripeInvoice {
  constructor() {
    this.name = 'stripe-invoice';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[StripePlugin] Executing with params:', JSON.stringify(params, null, 2));

    try {
      // Import AuthManager dynamically
      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      params.userId = workflowEngine.userId;

      // Handle stringified JSON in lineItems
      if (params.lineItems && Array.isArray(params.lineItems)) {
        params.lineItems = params.lineItems.map((item) => {
          if (typeof item === 'string') {
            try {
              return JSON.parse(item);
            } catch (e) {
              return item;
            }
          }
          return item;
        });
      }

      params.currency = params.currency || 'USD';
      this.validateParams(params);

      const apiKey = await AuthManager.getValidAccessToken(params.userId, 'stripe');
      if (!apiKey) {
        throw new Error('Stripe API key not found. Please connect to Stripe in Settings.');
      }

      const stripe = new Stripe(apiKey);

      // Get or create customer
      const customer = await this.getOrCreateCustomer(stripe, params.customerEmail);

      // Create a draft invoice
      const invoice = await stripe.invoices.create({
        customer: customer.id,
        collection_method: 'send_invoice',
        due_date: Math.floor(new Date(params.dueDate).getTime() / 1000),
        auto_advance: false,
      });

      // Add line items
      const hasLineItems = params.lineItems && Array.isArray(params.lineItems) && params.lineItems.length > 0;

      if (hasLineItems) {
        for (const item of params.lineItems) {
          if (!item.amount || !item.description) {
            throw new Error('Each line item must have an amount and description');
          }

          await stripe.invoiceItems.create({
            customer: customer.id,
            currency: item.currency || params.currency || 'usd',
            description: item.description,
            amount: item.amount,
            invoice: invoice.id,
          });
        }
      } else {
        await stripe.invoiceItems.create({
          customer: customer.id,
          currency: params.currency || 'usd',
          description: params.description,
          amount: params.amount,
          invoice: invoice.id,
        });
      }

      // Retrieve the invoice to check total
      let updatedInvoice = await stripe.invoices.retrieve(invoice.id);
      if (updatedInvoice.total === 0) {
        throw new Error('Invoice total is still 0 after adding items');
      }

      // Finalize and send the invoice
      const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id, {
        auto_advance: false,
      });

      const sentInvoice = await stripe.invoices.sendInvoice(finalizedInvoice.id);

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
          currency: line.currency,
        })),
        customer: {
          id: customer.id,
          email: customer.email,
          name: customer.name,
        },
      };
    } catch (error) {
      console.error('[StripePlugin] Error:', error);
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

    const hasSingleItem = params.amount && params.description;
    const hasLineItems = params.lineItems && Array.isArray(params.lineItems) && params.lineItems.length > 0;

    if (!hasSingleItem && !hasLineItems) {
      throw new Error('Either (amount + description) OR a valid lineItems array is required');
    }

    if (!hasLineItems && params.amount <= 0) {
      throw new Error('Invalid amount');
    }
  }

  async getOrCreateCustomer(stripe, email) {
    const existingCustomers = await stripe.customers.list({ email: email, limit: 1 });
    if (existingCustomers.data.length > 0) {
      return existingCustomers.data[0];
    }
    return await stripe.customers.create({ email: email });
  }
}

export default new StripeInvoice();
