import { EventEmitter } from 'events';
import { listInbound, releaseInboxReader } from '../../services/agntMail.js';
import { serviceFailure, hostedInstanceSlug } from '../../services/agntServices.js';
import TriggerCursorModel from '../../models/TriggerCursorModel.js';

// Where the inbox read position is stored (TriggerCursorModel).
const CURSOR_SOURCE = 'mail:inbound';
// After boot, workflows take a moment to return to listening. Mail is only
// declared unwatched once nobody has listened for this long.
const LISTENER_GRACE_MS = 5 * 60 * 1000;

/**
 * Inbound email trigger, served by mail.agnt.gg.
 *
 * The account has one hosted inbox; every workflow with a "Built-in Email"
 * receive-email trigger listens on it. This receiver polls the inbox since a
 * cursor and offers each new message to every listening engine. The cursor
 * advances only past messages that at least one engine accepted, so a message
 * arriving while a workflow is still starting is seen again on the next poll.
 *
 * Hosted mail is part of AGNT Pro. A free account's poll gets a plan refusal,
 * which is logged once per poll; nothing is queued locally for it.
 *
 * THE CURSOR IS DURABLE. It used to start at Date.now() on every boot, so mail
 * that arrived while the app was closed - or while a hosted instance slept,
 * which is exactly when the fleet wakes it to collect mail - was skipped for
 * good. It is now stored, and resumes where it left off. The one thing that
 * moves it without delivering is nobody listening at all (past a boot grace),
 * so a workflow created weeks later does not replay weeks of old mail.
 */
/** The bare, lower-cased address in `Name <addr>` or `addr` form. */
function addressOf(value) {
  const text = String(value ?? '');
  const bracketed = text.match(/<([^>]+)>/);
  return (bracketed ? bracketed[1] : text).trim().toLowerCase();
}

class EmailReceiver extends EventEmitter {
  constructor(processManager) {
    super();
    this.processManager = processManager;
    this.pollInterval = null;
    this.activeTriggers = new Set();
    this.since = null; // loaded from TriggerCursorModel on the first poll
    this.persistedSince = null;
    this.bootedAt = Date.now();
    this.readerReleased = false;
    this.polling = false;
    this.lastDenial = 0;
    this.pollingEnabled = process.env.AGNT_DISABLE_EXTERNAL_POLLING !== 'true';

    if (this.pollingEnabled) {
      this.startPolling();
      console.log('Local EmailReceiver instantiated and polling started.');
    } else {
      console.log('Local EmailReceiver instantiated with external polling disabled.');
    }
  }

  startPolling() {
    if (!this.pollingEnabled || this.pollInterval) return;
    console.log('Local EmailReceiver: Starting polling...');
    this.pollInterval = setInterval(() => this.pollForTriggers(), 10000);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('Local EmailReceiver: Polling stopped.');
    }
  }

  /** Engines currently listening on the built-in inbox. */
  _listeningWorkflows() {
    const out = [];
    for (const [workflowId, engine] of this.processManager.activeWorkflows) {
      if (!(engine.isListening || engine.isRunning)) continue;
      const nodes = engine.workflow?.nodes || engine.nodes || [];
      const usesBuiltIn = nodes.some((n) => n.type === 'receive-email' && (n.parameters?.emailConfig || 'Built-in Email') === 'Built-in Email');
      if (usesBuiltIn) out.push(workflowId);
    }
    return out;
  }

  /** Resume from the stored position; a first-ever start begins at now. */
  async _loadSince() {
    if (this.since !== null) return;
    try {
      const stored = await TriggerCursorModel.get(CURSOR_SOURCE);
      this.since = stored ?? Date.now();
      this.persistedSince = stored;
      // Record a first-ever start now, not on the first delivery: otherwise a
      // restart before any mail arrived would begin again at a later "now"
      // and skip whatever came in between.
      if (stored === null) await this._saveSince();
    } catch (error) {
      // An unreadable store must not stop mail: fall back to the old behaviour.
      console.error('Local EmailReceiver: could not load the inbox cursor, starting from now:', error.message);
      this.since = Date.now();
    }
  }

  async _saveSince() {
    if (this.since === this.persistedSince) return;
    try {
      await TriggerCursorModel.save(CURSOR_SOURCE, this.since);
      this.persistedSince = this.since;
    } catch (error) {
      console.error('Local EmailReceiver: could not save the inbox cursor:', error.message);
    }
  }

  /**
   * Nobody is listening. Once the boot grace has passed, mail arriving now is
   * unwatched: move the cursor to the present so a workflow created later does
   * not replay it. At most once a minute, so this is not a write per poll.
   */
  async _skipUnwatchedMail() {
    const now = Date.now();
    if (now - this.bootedAt < LISTENER_GRACE_MS) return;
    await this._releaseReader();
    if (now - this.since < 60000) return;
    this.since = now;
    await this._saveSince();
  }

  /**
   * A hosted instance that once read the inbox is counted as its reader, and
   * the fleet wakes it for new mail. With nothing listening it would be woken
   * and never read - so it says once that it no longer reads. Desktops are
   * never counted and never need to.
   */
  async _releaseReader() {
    if (this.readerReleased || !hostedInstanceSlug()) return;
    try {
      await releaseInboxReader();
      this.readerReleased = true;
    } catch (error) {
      console.error('Local EmailReceiver: could not release the inbox reader:', serviceFailure(error).error || error.message);
    }
  }

  async pollForTriggers() {
    if (this.polling) return;
    this.polling = true;
    try {
      await this._loadSince();
      const workflowIds = this._listeningWorkflows();
      if (workflowIds.length === 0) {
        await this._skipUnwatchedMail(); // nobody listening: do not spend a request
        return;
      }
      this.readerReleased = false; // listening again: the next read re-registers
      let inbox, messages;
      try {
        ({ inbox, messages } = await listInbound({ since: this.since }));
      } catch (error) {
        const failure = serviceFailure(error);
        if (Date.now() - this.lastDenial > 60000) {
          console.error(`Local EmailReceiver: ${failure.message || failure.error}`);
          this.lastDenial = Date.now();
        }
        return;
      }
      if (!messages.length) return;
      console.log(`Local EmailReceiver: ${messages.length} new message(s) on ${inbox.address}`);

      // Send Email sends FROM this inbox, and every trigger listens ON it. Mail
      // the inbox sent itself is therefore our own output, not an inbound event:
      // a workflow that replies to the sender would otherwise mail itself and
      // re-trigger once per poll, forever. It is skipped and the cursor moves
      // past it, so it is never re-read either.
      const ownAddress = addressOf(inbox.address);

      let advanced = this.since;
      for (const message of messages) {
        if (ownAddress && addressOf(message.from) === ownAddress) {
          advanced = Math.max(advanced, message.createdAt || advanced);
          continue;
        }
        let accepted = false;
        for (const workflowId of workflowIds) {
          if (await this._triggerWorkflowByEmail(workflowId, message)) accepted = true;
        }
        if (!accepted) break; // engines not ready: leave the cursor here
        advanced = Math.max(advanced, message.createdAt || advanced);
      }
      this.since = advanced;
      await this._saveSince();
    } catch (error) {
      console.error('Local EmailReceiver: Error polling for inbound mail:', error);
    } finally {
      this.polling = false;
    }
  }

  async _triggerWorkflowByEmail(workflowId, message) {
    if (this.activeTriggers.has(workflowId)) return false;
    const activeEngine = this.processManager.activeWorkflows.get(workflowId);
    if (!activeEngine || !(activeEngine.isListening || activeEngine.isRunning)) return false;

    // Sender and subject are enough to trace a delivery; the body stays out of the log.
    console.log(`Local EmailReceiver: triggering ${workflowId} with mail from=${message.from ?? '<unknown>'} subject=${JSON.stringify(message.subject ?? '')}`);
    const triggerData = {
      type: 'email',
      id: message.id,
      from: message.from,
      to: message.to,
      subject: message.subject,
      body: message.text ?? '',
      html: undefined, // the service returns plain text; html is not carried
      attachments: message.attachments || [],
      messageId: message.messageId,
      replyTo: message.replyTo,
      receivedAt: message.createdAt,
    };

    this.activeTriggers.add(workflowId);
    try {
      await activeEngine.processWorkflowTrigger(triggerData);
      return true;
    } catch (error) {
      console.error(`Local EmailReceiver: Error triggering workflow ${workflowId}:`, error);
      return false;
    } finally {
      this.activeTriggers.delete(workflowId);
    }
  }

  shutdown() {
    this.stopPolling();
    console.log('Local EmailReceiver: Shut down.');
  }
}

export default EmailReceiver;
