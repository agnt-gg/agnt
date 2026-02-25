import { Configuration, PlaidApi, PlaidEnvironments, TransferType, TransferNetwork, ACHClass } from 'plaid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

/**
 * Plaid API Plugin Tool
 *
 * The main banking operations tool for interacting with connected bank accounts:
 * - Accounts & Balances: View accounts and real-time balances
 * - Transactions: Sync, search, and analyze transaction history
 * - Auth: Get account and routing numbers for ACH payments
 * - Identity: Verify account ownership
 * - Investments: View holdings and investment transactions
 * - Liabilities: View credit card, loan, and mortgage data
 * - Transfers: Initiate and manage ACH/RTP money transfers
 */
class PlaidAPI {
  constructor() {
    this.name = 'plaid-api';
  }

  /**
   * Create an authenticated Plaid API client using stored credentials
   */
  async getClient(userId) {
    const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
    const AuthManagerModule = await import(`file://${authManagerPath.replace(/\\/g, '/')}`);
    const AuthManager = AuthManagerModule.default;

    const credentials = await AuthManager.getValidAccessToken(userId, 'plaid');
    if (!credentials) {
      throw new Error('Plaid credentials not found. Please add your Plaid API keys in Settings > Connected Apps.');
    }

    let clientId, secret, environment;
    if (typeof credentials === 'string') {
      try {
        const parsed = JSON.parse(credentials);
        clientId = parsed.clientId || parsed.client_id;
        secret = parsed.secret;
        environment = parsed.environment || 'sandbox';
      } catch {
        throw new Error(
          'Plaid credentials must be stored as JSON: {"clientId": "your_client_id", "secret": "your_secret", "environment": "sandbox"}',
        );
      }
    } else if (typeof credentials === 'object') {
      clientId = credentials.clientId || credentials.client_id;
      secret = credentials.secret;
      environment = credentials.environment || 'sandbox';
    }

    if (!clientId || !secret) {
      throw new Error('Invalid Plaid credentials. Expected JSON with clientId and secret.');
    }

    const config = new Configuration({
      basePath: PlaidEnvironments[environment] || PlaidEnvironments.sandbox,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret,
          'Plaid-Version': '2020-09-14',
        },
      },
    });

    return { client: new PlaidApi(config), environment };
  }

  /**
   * Parse comma-separated account IDs into array, or return undefined
   */
  parseAccountIds(accountIdsStr) {
    if (!accountIdsStr) return undefined;
    return accountIdsStr
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[PlaidPlugin] Executing Plaid API with action:', params.action);

    try {
      params.userId = workflowEngine.userId;
      const { client, environment } = await this.getClient(params.userId);

      if (!params.accessToken && params.action !== 'LIST_TRANSFERS') {
        throw new Error('accessToken is required. Connect a bank account first using the Plaid Link tool.');
      }

      let result;
      switch (params.action) {
        // ─── ACCOUNTS & BALANCES ───
        case 'GET_ACCOUNTS':
          result = await this.getAccounts(client, params);
          break;
        case 'GET_BALANCE':
          result = await this.getBalance(client, params);
          break;

        // ─── TRANSACTIONS ───
        case 'SYNC_TRANSACTIONS':
          result = await this.syncTransactions(client, params);
          break;
        case 'GET_TRANSACTIONS':
          result = await this.getTransactions(client, params);
          break;
        case 'GET_RECURRING_TRANSACTIONS':
          result = await this.getRecurringTransactions(client, params);
          break;
        case 'REFRESH_TRANSACTIONS':
          result = await this.refreshTransactions(client, params);
          break;

        // ─── AUTH (ROUTING NUMBERS) ───
        case 'GET_AUTH':
          result = await this.getAuth(client, params);
          break;

        // ─── IDENTITY ───
        case 'GET_IDENTITY':
          result = await this.getIdentity(client, params);
          break;
        case 'MATCH_IDENTITY':
          result = await this.matchIdentity(client, params);
          break;

        // ─── INVESTMENTS ───
        case 'GET_INVESTMENT_HOLDINGS':
          result = await this.getInvestmentHoldings(client, params);
          break;
        case 'GET_INVESTMENT_TRANSACTIONS':
          result = await this.getInvestmentTransactions(client, params);
          break;

        // ─── LIABILITIES ───
        case 'GET_LIABILITIES':
          result = await this.getLiabilities(client, params);
          break;

        // ─── TRANSFERS ───
        case 'CREATE_TRANSFER':
          result = await this.createTransfer(client, params);
          break;
        case 'GET_TRANSFER':
          result = await this.getTransfer(client, params);
          break;
        case 'LIST_TRANSFERS':
          result = await this.listTransfers(client, params);
          break;

        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }

      return {
        success: true,
        result,
        environment,
        error: null,
      };
    } catch (error) {
      console.error('[PlaidPlugin] Error in Plaid API:', error);
      const plaidError = error?.response?.data;
      return {
        success: false,
        result: null,
        error: plaidError
          ? `[${plaidError.error_type}] ${plaidError.error_code}: ${plaidError.error_message}`
          : error.message,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ACCOUNTS & BALANCES
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET_ACCOUNTS
   * Retrieves all accounts associated with the Item.
   * Returns account names, types, masks, and cached balance info.
   * Note: Balances returned here may be stale. Use GET_BALANCE for real-time.
   */
  async getAccounts(client, params) {
    const request = {
      access_token: params.accessToken,
    };

    const accountIds = this.parseAccountIds(params.accountIds);
    if (accountIds) {
      request.options = { account_ids: accountIds };
    }

    const response = await client.accountsGet(request);

    return {
      accounts: response.data.accounts.map((acct) => ({
        accountId: acct.account_id,
        name: acct.name,
        officialName: acct.official_name,
        type: acct.type,
        subtype: acct.subtype,
        mask: acct.mask,
        balances: {
          available: acct.balances.available,
          current: acct.balances.current,
          limit: acct.balances.limit,
          currency: acct.balances.iso_currency_code || acct.balances.unofficial_currency_code,
        },
      })),
      itemId: response.data.item.item_id,
      institutionId: response.data.item.institution_id,
      totalAccounts: response.data.accounts.length,
      requestId: response.data.request_id,
    };
  }

  /**
   * GET_BALANCE
   * Retrieves real-time balance information for accounts.
   * This makes a live request to the financial institution.
   * Use this instead of GET_ACCOUNTS when you need current balances.
   */
  async getBalance(client, params) {
    const request = {
      access_token: params.accessToken,
    };

    const accountIds = this.parseAccountIds(params.accountIds);
    if (accountIds) {
      request.options = { account_ids: accountIds };
    }

    const response = await client.accountsBalanceGet(request);

    return {
      accounts: response.data.accounts.map((acct) => ({
        accountId: acct.account_id,
        name: acct.name,
        officialName: acct.official_name,
        type: acct.type,
        subtype: acct.subtype,
        mask: acct.mask,
        balances: {
          available: acct.balances.available,
          current: acct.balances.current,
          limit: acct.balances.limit,
          currency: acct.balances.iso_currency_code || acct.balances.unofficial_currency_code,
        },
      })),
      totalAccounts: response.data.accounts.length,
      requestId: response.data.request_id,
      _note: 'Balances are fetched in real-time from the financial institution.',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // TRANSACTIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * SYNC_TRANSACTIONS (Recommended)
   * Incrementally syncs transactions using a cursor-based approach.
   * First call (no cursor): returns all available transactions.
   * Subsequent calls (with cursor): returns only new/modified/removed since last sync.
   * Store the returned nextCursor for future calls.
   */
  async syncTransactions(client, params) {
    let cursor = params.cursor || null;
    let added = [];
    let modified = [];
    let removed = [];
    let hasMore = true;
    const maxPages = 10; // Safety limit to prevent infinite loops
    let page = 0;

    while (hasMore && page < maxPages) {
      const request = {
        access_token: params.accessToken,
        cursor: cursor || undefined,
        count: Math.min(params.count || 100, 500),
      };

      const response = await client.transactionsSync(request);
      const data = response.data;

      added = added.concat(data.added);
      modified = modified.concat(data.modified);
      removed = removed.concat(data.removed);

      hasMore = data.has_more;
      cursor = data.next_cursor;
      page++;
    }

    return {
      added: added.map(this.formatTransaction),
      modified: modified.map(this.formatTransaction),
      removed: removed.map((r) => ({
        accountId: r.account_id,
        transactionId: r.transaction_id,
      })),
      nextCursor: cursor,
      hasMore,
      totalAdded: added.length,
      totalModified: modified.length,
      totalRemoved: removed.length,
      pagesProcessed: page,
      _note: 'Store nextCursor and pass it in subsequent SYNC_TRANSACTIONS calls to get incremental updates.',
    };
  }

  /**
   * GET_TRANSACTIONS
   * Retrieves transactions within a date range. Supports pagination via count/offset.
   * Consider using SYNC_TRANSACTIONS instead for ongoing monitoring.
   */
  async getTransactions(client, params) {
    if (!params.startDate || !params.endDate) {
      throw new Error('startDate and endDate are required for GET_TRANSACTIONS (format: YYYY-MM-DD)');
    }

    const request = {
      access_token: params.accessToken,
      start_date: params.startDate,
      end_date: params.endDate,
      options: {
        count: Math.min(params.count || 100, 500),
        offset: params.offset || 0,
      },
    };

    const accountIds = this.parseAccountIds(params.accountIds);
    if (accountIds) {
      request.options.account_ids = accountIds;
    }

    const response = await client.transactionsGet(request);

    return {
      transactions: response.data.transactions.map(this.formatTransaction),
      totalTransactions: response.data.total_transactions,
      returnedCount: response.data.transactions.length,
      accounts: response.data.accounts.map((a) => ({
        accountId: a.account_id,
        name: a.name,
        type: a.type,
        subtype: a.subtype,
      })),
      requestId: response.data.request_id,
      _pagination: {
        count: request.options.count,
        offset: request.options.offset,
        hasMore: request.options.offset + response.data.transactions.length < response.data.total_transactions,
        nextOffset: request.options.offset + response.data.transactions.length,
      },
    };
  }

  /**
   * GET_RECURRING_TRANSACTIONS
   * Identifies recurring transaction patterns (subscriptions, bills, paychecks, etc.)
   * Returns separate inflow streams (income) and outflow streams (expenses).
   */
  async getRecurringTransactions(client, params) {
    const accountIds = this.parseAccountIds(params.accountIds);

    const request = {
      access_token: params.accessToken,
      account_ids: accountIds || [],
    };

    // If no account IDs provided, first fetch all accounts
    if (!accountIds || accountIds.length === 0) {
      const accountsResp = await client.accountsGet({ access_token: params.accessToken });
      request.account_ids = accountsResp.data.accounts.map((a) => a.account_id);
    }

    const response = await client.transactionsRecurringGet(request);

    return {
      inflowStreams: response.data.inflow_streams.map(this.formatRecurringStream),
      outflowStreams: response.data.outflow_streams.map(this.formatRecurringStream),
      updatedAt: response.data.updated_datetime,
      totalInflows: response.data.inflow_streams.length,
      totalOutflows: response.data.outflow_streams.length,
      requestId: response.data.request_id,
    };
  }

  /**
   * REFRESH_TRANSACTIONS
   * Forces Plaid to refresh transaction data from the financial institution.
   * Useful when you need the latest data immediately rather than waiting for background updates.
   * After calling this, use SYNC_TRANSACTIONS or wait for the SYNC_UPDATES_AVAILABLE webhook.
   */
  async refreshTransactions(client, params) {
    const response = await client.transactionsRefresh({
      access_token: params.accessToken,
    });

    return {
      refreshed: true,
      requestId: response.data.request_id,
      _note: 'Transaction refresh initiated. New data will be available shortly. Use SYNC_TRANSACTIONS to retrieve updates.',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // AUTH (ACCOUNT & ROUTING NUMBERS)
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET_AUTH
   * Retrieves account and routing numbers for ACH, EFT, BACS, or IBAN payments.
   * This is essential for initiating bank transfers or setting up direct deposit.
   */
  async getAuth(client, params) {
    const request = {
      access_token: params.accessToken,
    };

    const accountIds = this.parseAccountIds(params.accountIds);
    if (accountIds) {
      request.options = { account_ids: accountIds };
    }

    const response = await client.authGet(request);

    return {
      accounts: response.data.accounts.map((acct) => ({
        accountId: acct.account_id,
        name: acct.name,
        officialName: acct.official_name,
        type: acct.type,
        subtype: acct.subtype,
        mask: acct.mask,
      })),
      numbers: {
        ach: (response.data.numbers.ach || []).map((n) => ({
          accountId: n.account_id,
          account: n.account,
          routing: n.routing,
          wireRouting: n.wire_routing,
        })),
        eft: (response.data.numbers.eft || []).map((n) => ({
          accountId: n.account_id,
          account: n.account,
          institution: n.institution,
          branch: n.branch,
        })),
        international: (response.data.numbers.international || []).map((n) => ({
          accountId: n.account_id,
          iban: n.iban,
          bic: n.bic,
        })),
        bacs: (response.data.numbers.bacs || []).map((n) => ({
          accountId: n.account_id,
          account: n.account,
          sortCode: n.sort_code,
        })),
      },
      requestId: response.data.request_id,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET_IDENTITY
   * Retrieves identity information (names, emails, addresses, phone numbers)
   * associated with the bank account owner. Useful for KYC and verification.
   */
  async getIdentity(client, params) {
    const request = {
      access_token: params.accessToken,
    };

    const accountIds = this.parseAccountIds(params.accountIds);
    if (accountIds) {
      request.options = { account_ids: accountIds };
    }

    const response = await client.identityGet(request);

    return {
      accounts: response.data.accounts.map((acct) => ({
        accountId: acct.account_id,
        name: acct.name,
        type: acct.type,
        owners: (acct.owners || []).map((owner) => ({
          names: owner.names,
          emails: (owner.emails || []).map((e) => ({
            data: e.data,
            primary: e.primary,
            type: e.type,
          })),
          phoneNumbers: (owner.phone_numbers || []).map((p) => ({
            data: p.data,
            primary: p.primary,
            type: p.type,
          })),
          addresses: (owner.addresses || []).map((a) => ({
            primary: a.primary,
            data: a.data,
          })),
        })),
      })),
      requestId: response.data.request_id,
    };
  }

  /**
   * MATCH_IDENTITY
   * Compares provided user information against bank records and returns
   * confidence scores (0-100) for name, email, phone, and address matching.
   */
  async matchIdentity(client, params) {
    const user = {};
    if (params.legalName) user.legal_name = params.legalName;
    if (params.email) user.email_address = params.email;
    if (params.phone) user.phone_number = params.phone;

    if (Object.keys(user).length === 0) {
      throw new Error('At least one of legalName, email, or phone is required for MATCH_IDENTITY');
    }

    const request = {
      access_token: params.accessToken,
      user,
    };

    const response = await client.identityMatch(request);

    return {
      accounts: response.data.accounts.map((acct) => ({
        accountId: acct.account_id,
        name: acct.name,
        legalNameMatch: acct.legal_name,
        emailMatch: acct.email_address,
        phoneMatch: acct.phone_number,
        addressMatch: acct.address,
      })),
      requestId: response.data.request_id,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // INVESTMENTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET_INVESTMENT_HOLDINGS
   * Retrieves current investment holdings including stocks, bonds, ETFs, mutual funds, etc.
   * Returns security details, quantities, prices, and values.
   */
  async getInvestmentHoldings(client, params) {
    const request = {
      access_token: params.accessToken,
    };

    const accountIds = this.parseAccountIds(params.accountIds);
    if (accountIds) {
      request.options = { account_ids: accountIds };
    }

    const response = await client.investmentsHoldingsGet(request);

    // Build a security lookup map
    const securityMap = {};
    (response.data.securities || []).forEach((sec) => {
      securityMap[sec.security_id] = {
        securityId: sec.security_id,
        name: sec.name,
        ticker: sec.ticker_symbol,
        type: sec.type,
        closePrice: sec.close_price,
        closePriceAsOf: sec.close_price_as_of,
        currency: sec.iso_currency_code,
        isin: sec.isin,
        cusip: sec.cusip,
      };
    });

    return {
      holdings: (response.data.holdings || []).map((h) => ({
        accountId: h.account_id,
        securityId: h.security_id,
        security: securityMap[h.security_id] || null,
        quantity: h.quantity,
        institutionPrice: h.institution_price,
        institutionPriceAsOf: h.institution_price_as_of,
        institutionValue: h.institution_value,
        costBasis: h.cost_basis,
        currency: h.iso_currency_code,
      })),
      accounts: response.data.accounts.map((a) => ({
        accountId: a.account_id,
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        balances: a.balances,
      })),
      totalHoldings: (response.data.holdings || []).length,
      totalSecurities: (response.data.securities || []).length,
      requestId: response.data.request_id,
    };
  }

  /**
   * GET_INVESTMENT_TRANSACTIONS
   * Retrieves investment transactions (buys, sells, dividends, etc.) within a date range.
   */
  async getInvestmentTransactions(client, params) {
    if (!params.startDate || !params.endDate) {
      throw new Error('startDate and endDate are required for GET_INVESTMENT_TRANSACTIONS (format: YYYY-MM-DD)');
    }

    const request = {
      access_token: params.accessToken,
      start_date: params.startDate,
      end_date: params.endDate,
    };

    const accountIds = this.parseAccountIds(params.accountIds);
    if (accountIds) {
      request.options = { account_ids: accountIds };
    }

    const response = await client.investmentsTransactionsGet(request);

    return {
      investmentTransactions: (response.data.investment_transactions || []).map((t) => ({
        investmentTransactionId: t.investment_transaction_id,
        accountId: t.account_id,
        securityId: t.security_id,
        date: t.date,
        name: t.name,
        type: t.type,
        subtype: t.subtype,
        quantity: t.quantity,
        amount: t.amount,
        price: t.price,
        fees: t.fees,
        currency: t.iso_currency_code,
      })),
      totalTransactions: response.data.total_investment_transactions,
      requestId: response.data.request_id,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // LIABILITIES
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET_LIABILITIES
   * Retrieves liability data for credit cards, student loans, and mortgages.
   */
  async getLiabilities(client, params) {
    const request = {
      access_token: params.accessToken,
    };

    const accountIds = this.parseAccountIds(params.accountIds);
    if (accountIds) {
      request.options = { account_ids: accountIds };
    }

    const response = await client.liabilitiesGet(request);

    return {
      accounts: response.data.accounts.map((a) => ({
        accountId: a.account_id,
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        balances: {
          available: a.balances.available,
          current: a.balances.current,
          limit: a.balances.limit,
          currency: a.balances.iso_currency_code,
        },
      })),
      liabilities: {
        credit: (response.data.liabilities.credit || []).map((c) => ({
          accountId: c.account_id,
          isOverdue: c.is_overdue,
          lastPaymentAmount: c.last_payment_amount,
          lastPaymentDate: c.last_payment_date,
          lastStatementBalance: c.last_statement_balance,
          lastStatementIssueDate: c.last_statement_issue_date,
          minimumPaymentAmount: c.minimum_payment_amount,
          nextPaymentDueDate: c.next_payment_due_date,
          aprs: c.aprs,
        })),
        mortgage: (response.data.liabilities.mortgage || []).map((m) => ({
          accountId: m.account_id,
          type: m.loan_type_description,
          interestRate: m.interest_rate,
          term: m.loan_term,
          originationDate: m.origination_date,
          originationPrincipal: m.origination_principal_amount,
          lastPaymentAmount: m.last_payment_amount,
          lastPaymentDate: m.last_payment_date,
          nextPaymentDueDate: m.next_payment_due_date,
          nextMonthlyPayment: m.next_monthly_payment,
          currentLateFee: m.current_late_fee,
          pastDueAmount: m.past_due_amount,
          maturityDate: m.maturity_date,
          propertyAddress: m.property_address,
        })),
        student: (response.data.liabilities.student || []).map((s) => ({
          accountId: s.account_id,
          name: s.loan_name,
          status: s.loan_status,
          type: s.loan_type,
          interestRate: s.interest_rate_percentage,
          originationDate: s.origination_date,
          originationPrincipal: s.origination_principal_amount,
          outstandingInterest: s.outstanding_interest_amount,
          expectedPayoffDate: s.expected_payoff_date,
          lastPaymentAmount: s.last_payment_amount,
          lastPaymentDate: s.last_payment_date,
          minimumPaymentAmount: s.minimum_payment_amount,
          nextPaymentDueDate: s.next_payment_due_date,
          servicerAddress: s.servicer_address,
        })),
      },
      requestId: response.data.request_id,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // TRANSFERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * CREATE_TRANSFER
   * Initiates an ACH or RTP money transfer.
   * - 'debit' = pull money FROM user's bank account (user pays you)
   * - 'credit' = push money TO user's bank account (you pay user)
   */
  async createTransfer(client, params) {
    if (!params.transferAccountId) {
      throw new Error('transferAccountId is required for CREATE_TRANSFER');
    }
    if (!params.transferAmount) {
      throw new Error('transferAmount is required for CREATE_TRANSFER (e.g., "100.00")');
    }
    if (!params.transferType) {
      throw new Error('transferType is required for CREATE_TRANSFER ("debit" or "credit")');
    }

    // First, authorize the transfer
    const authorizationRequest = {
      access_token: params.accessToken,
      account_id: params.transferAccountId,
      type: params.transferType === 'debit' ? TransferType.Debit : TransferType.Credit,
      network: this.parseTransferNetwork(params.transferNetwork),
      amount: params.transferAmount,
      ach_class: ACHClass.Ppd,
      user: {
        legal_name: params.transferDescription || 'AGNT Transfer',
      },
    };

    const authResponse = await client.transferAuthorizationCreate(authorizationRequest);
    const authorization = authResponse.data.authorization;

    if (authorization.decision !== 'approved') {
      return {
        authorized: false,
        decision: authorization.decision,
        decisionRationale: authorization.decision_rationale,
        _note: 'Transfer was not approved. Check decisionRationale for details.',
      };
    }

    // Create the actual transfer
    const transferRequest = {
      access_token: params.accessToken,
      account_id: params.transferAccountId,
      authorization_id: authorization.id,
      type: params.transferType === 'debit' ? TransferType.Debit : TransferType.Credit,
      network: this.parseTransferNetwork(params.transferNetwork),
      amount: params.transferAmount,
      description: (params.transferDescription || 'AGNT Transfer').substring(0, 15),
      ach_class: ACHClass.Ppd,
    };

    const transferResponse = await client.transferCreate(transferRequest);
    const transfer = transferResponse.data.transfer;

    return {
      authorized: true,
      transfer: {
        id: transfer.id,
        authorizationId: authorization.id,
        type: transfer.type,
        accountId: transfer.account_id,
        amount: transfer.amount,
        status: transfer.status,
        network: transfer.network,
        description: transfer.description,
        created: transfer.created,
        currency: transfer.iso_currency_code,
      },
      requestId: transferResponse.data.request_id,
    };
  }

  /**
   * GET_TRANSFER
   * Retrieves the current status and details of a specific transfer.
   */
  async getTransfer(client, params) {
    if (!params.transferId) {
      throw new Error('transferId is required for GET_TRANSFER');
    }

    const response = await client.transferGet({
      transfer_id: params.transferId,
    });

    const transfer = response.data.transfer;
    return {
      transfer: {
        id: transfer.id,
        type: transfer.type,
        accountId: transfer.account_id,
        amount: transfer.amount,
        status: transfer.status,
        network: transfer.network,
        description: transfer.description,
        created: transfer.created,
        currency: transfer.iso_currency_code,
        failureReason: transfer.failure_reason,
      },
      requestId: response.data.request_id,
    };
  }

  /**
   * LIST_TRANSFERS
   * Lists all transfers, optionally filtered by various criteria.
   */
  async listTransfers(client, params) {
    const request = {};

    if (params.startDate) request.start_date = params.startDate;
    if (params.endDate) request.end_date = params.endDate;
    if (params.count) request.count = params.count;
    if (params.offset) request.offset = params.offset;

    const response = await client.transferList(request);

    return {
      transfers: (response.data.transfers || []).map((t) => ({
        id: t.id,
        type: t.type,
        accountId: t.account_id,
        amount: t.amount,
        status: t.status,
        network: t.network,
        description: t.description,
        created: t.created,
        currency: t.iso_currency_code,
        failureReason: t.failure_reason,
      })),
      totalTransfers: (response.data.transfers || []).length,
      requestId: response.data.request_id,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  parseTransferNetwork(networkStr) {
    const networkMap = {
      ach: TransferNetwork.Ach,
      'same-day-ach': TransferNetwork.SameDayAch,
      rtp: TransferNetwork.Rtp,
    };
    return networkMap[(networkStr || 'ach').toLowerCase()] || TransferNetwork.Ach;
  }

  /**
   * Format a raw Plaid transaction into a clean, consistent shape
   */
  formatTransaction(t) {
    return {
      transactionId: t.transaction_id,
      accountId: t.account_id,
      amount: t.amount,
      currency: t.iso_currency_code || t.unofficial_currency_code,
      date: t.date,
      datetime: t.datetime,
      authorizedDate: t.authorized_date,
      name: t.name,
      merchantName: t.merchant_name,
      merchantEntityId: t.merchant_entity_id,
      logoUrl: t.logo_url,
      website: t.website,
      category: t.personal_finance_category
        ? {
            primary: t.personal_finance_category.primary,
            detailed: t.personal_finance_category.detailed,
            confidence: t.personal_finance_category.confidence_level,
            iconUrl: t.personal_finance_category_icon_url,
          }
        : null,
      counterparties: (t.counterparties || []).map((cp) => ({
        name: cp.name,
        type: cp.type,
        logoUrl: cp.logo_url,
        website: cp.website,
        confidence: cp.confidence_level,
      })),
      location: t.location
        ? {
            address: t.location.address,
            city: t.location.city,
            region: t.location.region,
            postalCode: t.location.postal_code,
            country: t.location.country,
            lat: t.location.lat,
            lon: t.location.lon,
            storeNumber: t.location.store_number,
          }
        : null,
      paymentChannel: t.payment_channel,
      pending: t.pending,
      pendingTransactionId: t.pending_transaction_id,
      checkNumber: t.check_number,
      transactionCode: t.transaction_code,
    };
  }

  /**
   * Format a recurring transaction stream
   */
  formatRecurringStream(stream) {
    return {
      streamId: stream.stream_id,
      accountId: stream.account_id,
      description: stream.description,
      merchantName: stream.merchant_name,
      category: stream.personal_finance_category
        ? {
            primary: stream.personal_finance_category.primary,
            detailed: stream.personal_finance_category.detailed,
          }
        : null,
      frequency: stream.frequency,
      firstDate: stream.first_date,
      lastDate: stream.last_date,
      predictedNextDate: stream.predicted_next_date,
      averageAmount: stream.average_amount,
      lastAmount: stream.last_amount,
      isActive: stream.is_active,
      status: stream.status,
      transactionCount: (stream.transaction_ids || []).length,
    };
  }
}

export default new PlaidAPI();
