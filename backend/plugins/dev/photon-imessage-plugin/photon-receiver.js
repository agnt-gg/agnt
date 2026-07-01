// photon-receiver.js
// AGNT trigger tool: listen for incoming iMessages through Photon Spectrum.
//
// Photon's native transport is a long-lived gRPC stream (app.messages) held by
// the spectrum-ts SDK in a Node sidecar. Inside AGNT's plugin runtime we use a
// resilient long-poll against the Spectrum messages endpoint, which gives the
// same delivery semantics (dedupe + auto-reconnect/backoff) without bundling an
// unverified gRPC client. Swap pollLoop() for a streaming consumer once the
// real Spectrum stream endpoint is confirmed — the dispatch/guardrail layer is
// identical either way.
import crypto from 'crypto';
import EventEmitter from 'events';
import {
  DEFAULT_API_BASE_URL,
  getPhotonCredentials,
  normalizeApiBaseUrl,
  normalizeInboundMessage,
  normalizePhone,
  parseList,
  requestSpectrum,
  toBoolean,
  toIntegerOrDefault
} from './photon-common.js';

let instance = null;

function sleep(ms, state) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => {
    state.sleepTimer = setTimeout(() => {
      state.sleepTimer = null;
      resolve();
    }, ms);
  });
}

function hashKey(projectId) {
  return crypto.createHash('sha256').update(String(projectId)).digest('hex').slice(0, 16);
}

function compileMentionPatterns(value) {
  const lines = parseList(value);
  const patterns = [];
  for (const line of lines) {
    try {
      patterns.push(new RegExp(line, 'i'));
    } catch (_) {
      // Treat invalid regex as a literal wake word.
      patterns.push(new RegExp(`\\b${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
    }
  }
  return patterns;
}

class PhotonReceiver extends EventEmitter {
  constructor() {
    super();
    this.name = 'receive-imessage';
    this.pollers = new Map(); // key -> poller state
    this.subscriptions = new Map(); // id -> subscription
  }

  async setup(engine, node) {
    console.log('[PhotonPlugin] Setting up iMessage receiver trigger');

    const params = node?.parameters || {};
    const creds = getPhotonCredentials(params);
    const apiBaseUrl = normalizeApiBaseUrl(params.apiBaseUrl || DEFAULT_API_BASE_URL);
    const projectKey = hashKey(creds.projectId);
    const pollerKey = `${apiBaseUrl}:${projectKey}`;
    const subscriptionId = `${engine?.workflowId || engine?.id || engine?.userId || 'wf'}:${
      node?.id || node?.nodeId || Date.now()
    }:${Math.random().toString(36).slice(2)}`;

    const allowAll = toBoolean(params.allowAllUsers);
    const allowList = parseList(params.allowedUsers).map(normalizePhone).filter(Boolean);
    const requireMention = toBoolean(params.requireMention);
    const mentionPatterns = requireMention
      ? compileMentionPatterns(
          params.mentionPatterns || '\\bAGNT\\b\n\\bAnnie\\b\n@AGNT\n@Annie'
        )
      : [];

    const subscription = {
      id: subscriptionId,
      engine,
      node,
      allowAll,
      allowList,
      requireMention,
      mentionPatterns,
      ignoreGroups: toBoolean(params.ignoreGroups),
      includeRaw: toBoolean(params.includeRaw),
      pairingMode: params.pairingMode === undefined ? true : toBoolean(params.pairingMode),
      callback: (data) => engine.processWorkflowTrigger(data)
    };

    if (!this.pollers.has(pollerKey)) {
      await this.createPoller(pollerKey, {
        ...creds,
        apiBaseUrl,
        projectKey,
        pollIntervalMs: toIntegerOrDefault(params.pollIntervalMs, 3000, 1000, 60000),
        limit: toIntegerOrDefault(params.limit, 50, 1, 200),
        dropPendingOnStart: params.dropPendingOnStart === undefined ? true : toBoolean(params.dropPendingOnStart)
      });
    }

    this.subscriptions.set(subscriptionId, subscription);
    this.pollers.get(pollerKey).subscriptions.add(subscriptionId);

    if (engine) {
      engine.receivers = engine.receivers || {};
      engine.receivers.photonImessage = this;
    }

    console.log(
      `[PhotonPlugin] Subscribed to iMessages for project ${projectKey} ` +
        `(allowAll=${allowAll}, allowList=${allowList.length}, requireMention=${requireMention})`
    );
  }

  async createPoller(key, config) {
    const state = {
      key,
      ...config,
      running: true,
      seen: new Set(),
      seenOrder: [],
      cursor: null,
      consecutiveErrors: 0,
      sleepTimer: null,
      subscriptions: new Set(),
      // Pairing codes pending approval: phoneKey -> { code, createdAt }
      pendingPairing: new Map()
    };

    this.pollers.set(key, state);

    if (state.dropPendingOnStart) {
      // Establish a cursor so we only deliver messages that arrive AFTER start.
      try {
        const data = await requestSpectrum('app.messages', {
          projectId: state.projectId,
          projectSecret: state.projectSecret,
          apiBaseUrl: state.apiBaseUrl,
          query: { limit: 1, order: 'desc' },
          timeoutMs: 15000
        });
        const latest = (data.messages || data.results || data.items || [])[0];
        state.cursor = latest?.cursor || latest?.id || latest?.timestamp || null;
        console.log(`[PhotonPlugin] Established start cursor for project ${state.projectKey}`);
      } catch (error) {
        // Non-fatal — if status/messages aren't reachable yet (e.g. creds not
        // live), we still start the loop and back off until they are.
        console.warn(
          `[PhotonPlugin] Could not establish start cursor for ${state.projectKey}: ${error.message}`
        );
      }
    }

    this.pollLoop(state).catch((error) => {
      console.error(`[PhotonPlugin] Poll loop crashed for ${state.projectKey}:`, error);
    });

    return state;
  }

  markSeen(state, id) {
    if (state.seen.has(id)) return false;
    state.seen.add(id);
    state.seenOrder.push(id);
    if (state.seenOrder.length > 5000) {
      const old = state.seenOrder.shift();
      state.seen.delete(old);
    }
    return true;
  }

  async pollLoop(state) {
    console.log(`[PhotonPlugin] Started polling Photon Spectrum for project ${state.projectKey}`);

    while (state.running) {
      try {
        const query = { limit: state.limit, order: 'asc' };
        if (state.cursor) query.after = state.cursor;

        const data = await requestSpectrum('app.messages', {
          projectId: state.projectId,
          projectSecret: state.projectSecret,
          apiBaseUrl: state.apiBaseUrl,
          query,
          timeoutMs: 30000
        });

        state.consecutiveErrors = 0;
        const rawMessages = data.messages || data.results || data.items || [];
        for (const rawMessage of rawMessages) {
          const normalized = normalizeInboundMessage(rawMessage);
          const id = normalized.messageId || rawMessage.cursor || rawMessage.id;
          if (id) {
            state.cursor = rawMessage.cursor || id || state.cursor;
            if (!this.markSeen(state, id)) continue;
          }
          await this.dispatch(state, normalized, rawMessage);
        }
      } catch (error) {
        state.consecutiveErrors += 1;
        console.error(
          `[PhotonPlugin] Error polling Photon for ${state.projectKey}:`,
          error?.message || error
        );
      }

      if (state.running) {
        const backoff = Math.min(state.pollIntervalMs * Math.max(1, state.consecutiveErrors), 60000);
        await sleep(backoff, state);
      }
    }

    console.log(`[PhotonPlugin] Stopped polling Photon Spectrum for project ${state.projectKey}`);
  }

  /**
   * Generate a 6-digit pairing code and ask the sender to approve it.
   * Returns true if a pairing prompt was sent (i.e. the message should NOT be
   * dispatched to the workflow yet).
   */
  async maybePair(state, subscription, normalized) {
    const phoneKey = normalizePhone(normalized.sender);
    if (!phoneKey) return false;

    const existing = state.pendingPairing.get(phoneKey);
    const code = existing?.code || String(Math.floor(100000 + Math.random() * 900000));
    if (!existing) {
      state.pendingPairing.set(phoneKey, { code, createdAt: Date.now() });
    }

    this.emit('pairing', { phone: phoneKey, code, spaceId: normalized.spaceId });

    // Best-effort: tell the sender how to get approved. Failure here is
    // non-fatal — the workflow author can also watch the 'pairing' event.
    try {
      await requestSpectrum('space.send', {
        projectId: state.projectId,
        projectSecret: state.projectSecret,
        apiBaseUrl: state.apiBaseUrl,
        payload: {
          spaceId: normalized.spaceId,
          recipient: phoneKey,
          text:
            `This number isn't connected to AGNT yet. To approve it, add ${phoneKey} to the ` +
            `trigger's allowed users (pairing code ${code}), then text again.`
        },
        timeoutMs: 15000
      });
    } catch (error) {
      console.warn(`[PhotonPlugin] Failed to send pairing prompt to ${phoneKey}: ${error.message}`);
    }

    console.log(`[PhotonPlugin] Pairing requested for ${phoneKey} (code ${code})`);
    return true;
  }

  isAuthorized(subscription, normalized) {
    if (subscription.allowAll) return true;
    if (!subscription.allowList.length) return false;
    const phoneKey = normalizePhone(normalized.sender);
    return subscription.allowList.includes(phoneKey);
  }

  passesMention(subscription, normalized) {
    if (!subscription.requireMention) return true;
    // Mention-gating only applies to group chats; DMs are always direct.
    if (!normalized.isGroup) return true;
    const text = String(normalized.text || '');
    return subscription.mentionPatterns.some((re) => re.test(text));
  }

  async dispatch(state, normalized, rawMessage) {
    const subscriptionIds = [...state.subscriptions];
    for (const subscriptionId of subscriptionIds) {
      const subscription = this.subscriptions.get(subscriptionId);
      if (!subscription) continue;

      if (subscription.ignoreGroups && normalized.isGroup) continue;

      if (!this.isAuthorized(subscription, normalized)) {
        // Unknown sender. Offer pairing (once) unless pairing is disabled.
        if (subscription.pairingMode) {
          await this.maybePair(state, subscription, normalized).catch(() => {});
        }
        continue;
      }

      if (!this.passesMention(subscription, normalized)) continue;

      const eventData = {
        ...normalized,
        raw: subscription.includeRaw ? rawMessage : null,
        response: subscription.includeRaw ? rawMessage : { ...normalized, raw: null }
      };

      try {
        this.emit('message', eventData);
        await Promise.resolve(subscription.callback(eventData));
      } catch (error) {
        console.error('[PhotonPlugin] Error dispatching iMessage to workflow:', error);
      }
    }
  }

  validate(triggerData) {
    return !!triggerData && (triggerData.messageId !== undefined || triggerData.text !== undefined);
  }

  async process(inputData) {
    return {
      platform: inputData.platform || 'imessage',
      provider: inputData.provider || 'photon',
      messageId: inputData.messageId,
      spaceId: inputData.spaceId,
      sender: inputData.sender,
      senderName: inputData.senderName,
      text: inputData.text,
      isGroup: inputData.isGroup,
      participants: inputData.participants || [],
      attachments: inputData.attachments || [],
      timestamp: inputData.timestamp,
      serviceLine: inputData.serviceLine,
      raw: inputData.raw || null,
      response: inputData.response || inputData
    };
  }

  async teardown() {
    console.log('[PhotonPlugin] Tearing down iMessage receiver');
    for (const state of this.pollers.values()) {
      state.running = false;
      if (state.sleepTimer) {
        clearTimeout(state.sleepTimer);
        state.sleepTimer = null;
      }
      state.subscriptions.clear();
    }
    this.pollers.clear();
    this.subscriptions.clear();
    this.removeAllListeners('message');
    this.removeAllListeners('pairing');
  }
}

function getPhotonReceiver() {
  if (!instance) instance = new PhotonReceiver();
  return instance;
}

export default getPhotonReceiver();
