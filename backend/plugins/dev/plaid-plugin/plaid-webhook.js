import EventEmitter from 'events';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

/**
 * Plaid Webhook Plugin Tool (Trigger)
 *
 * Listens for incoming Plaid webhook events and triggers workflows when events arrive.
 *
 * Plaid sends webhooks for many event types:
 *
 * TRANSACTIONS:
 *   - SYNC_UPDATES_AVAILABLE: New transaction data ready for sync
 *   - RECURRING_TRANSACTIONS_UPDATE: Recurring streams updated
 *   - DEFAULT_UPDATE: New transactions available (legacy)
 *   - INITIAL_UPDATE: Initial transaction pull complete
 *   - HISTORICAL_UPDATE: Historical transaction pull complete
 *   - TRANSACTIONS_REMOVED: Transactions were removed
 *
 * AUTH:
 *   - AUTOMATICALLY_VERIFIED: Micro-deposit verification complete
 *   - VERIFICATION_EXPIRED: Micro-deposit verification expired
 *   - DEFAULT_UPDATE: Auth data changed
 *
 * IDENTITY:
 *   - DEFAULT_UPDATE: Identity data changed
 *
 * ITEM:
 *   - ERROR: Item is in an error state (e.g., login required)
 *   - LOGIN_REPAIRED: User has re-authenticated
 *   - PENDING_EXPIRATION: Consent is about to expire
 *   - USER_PERMISSION_REVOKED: User revoked access
 *   - USER_ACCOUNT_REVOKED: Specific account access revoked
 *   - WEBHOOK_UPDATE_ACKNOWLEDGED: Webhook URL was updated
 *   - NEW_ACCOUNTS_AVAILABLE: New accounts detected
 *
 * TRANSFER:
 *   - TRANSFER_EVENTS_UPDATE: Transfer status changed
 *
 * INVESTMENTS_TRANSACTIONS:
 *   - DEFAULT_UPDATE: New investment transactions
 *
 * LIABILITIES:
 *   - DEFAULT_UPDATE: Liability data changed
 *
 * To receive webhooks, you must:
 * 1. Configure a webhook URL when creating Link tokens (via plaid-link CREATE_LINK_TOKEN)
 * 2. Expose an endpoint that receives POST requests from Plaid
 * 3. This trigger processes those incoming webhook payloads
 */
class PlaidWebhook extends EventEmitter {
  constructor() {
    super();
    this.name = 'plaid-webhook';
    this.webhookFilter = 'ALL';
  }

  /**
   * Setup the trigger - called when workflow starts
   * Registers webhook handler with the AGNT webhook infrastructure
   */
  async setup(engine, node) {
    console.log('[PlaidPlugin] Setting up Plaid webhook trigger');

    this.webhookFilter = node.parameters?.webhookFilter || 'ALL';

    // Store in engine receivers for cleanup
    engine.receivers.plaid = this;

    // Register the webhook handler with the engine's webhook infrastructure
    // The engine should route POST requests to /webhooks/plaid to this handler
    if (engine.registerWebhookHandler) {
      engine.registerWebhookHandler('plaid', async (req) => {
        return await this.handleWebhook(req, engine);
      });
    }

    console.log(`[PlaidPlugin] Webhook trigger configured with filter: ${this.webhookFilter}`);
  }

  /**
   * Handle an incoming Plaid webhook
   */
  async handleWebhook(payload, engine) {
    const webhookType = payload.webhook_type;
    const webhookCode = payload.webhook_code;

    console.log(`[PlaidPlugin] Received webhook: ${webhookType} / ${webhookCode}`);

    // Apply filter
    if (this.webhookFilter !== 'ALL' && webhookType !== this.webhookFilter) {
      console.log(`[PlaidPlugin] Webhook filtered out (type: ${webhookType}, filter: ${this.webhookFilter})`);
      return { filtered: true };
    }

    const webhookData = {
      webhookType,
      webhookCode,
      itemId: payload.item_id,
      error: payload.error || null,
      payload,
    };

    // Trigger the workflow
    engine.processWorkflowTrigger(webhookData);

    return { processed: true };
  }

  /**
   * Validate incoming trigger data
   */
  validate(triggerData) {
    return 'webhookType' in triggerData && 'webhookCode' in triggerData;
  }

  /**
   * Process the trigger data into outputs
   */
  async process(inputData, engine) {
    return {
      webhookType: inputData.webhookType,
      webhookCode: inputData.webhookCode,
      itemId: inputData.itemId,
      error: inputData.error,
      payload: inputData.payload,
    };
  }

  /**
   * Teardown - called when workflow stops
   */
  async teardown() {
    console.log('[PlaidPlugin] Tearing down Plaid webhook trigger');
    this.removeAllListeners();
  }
}

export default new PlaidWebhook();
