import { Client, GatewayIntentBits, Partials } from 'discord.js';
import EventEmitter from 'events';

/**
 * Discord Receiver Plugin Tool (Trigger)
 *
 * This is a trigger tool that listens for incoming Discord messages.
 * It maintains a persistent connection to Discord and emits events when messages arrive.
 */
class DiscordReceiver extends EventEmitter {
  constructor() {
    super();
    this.name = 'receive-discord-message';
    // All live clients across all workflows using this trigger type. Needed so
    // plugin-level teardown (uninstall/shutdown) can destroy everything, while
    // each workflow's own stop destroys only its own client.
    this.clients = new Set();
    // Most recent client - kept only for the legacy banUser/unbanUser helpers.
    this.client = null;
  }

  /**
   * Setup the trigger - called when workflow starts
   * Creates Discord client and subscribes to channel
   */
  async setup(engine, node) {
    console.log('[DiscordPlugin] Setting up Discord receiver trigger');

    if (!node.parameters || !node.parameters.channelId) {
      throw new Error('Discord trigger node is missing required channelId parameter');
    }

    try {
      const accessToken = node.parameters.__auth?.token;
      if (!accessToken) {
        throw new Error('Not connected to Discord. Connect in Settings → Connections.');
      }

      // Create an ISOLATED Discord client for THIS workflow's trigger node.
      // The previous shared this.client design meant tearing down any ONE
      // discord workflow destroyed the MOST RECENTLY ARMED workflow's client
      // (cross-kill): stopping workflow A silently deafened workflow B while
      // it stayed "listening" in the DB. One client per workflow ends that
      // entire bug class - stop/start/reload of one workflow can no longer
      // affect any other workflow's live gateway connection.
      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,     // required to fire on inbound DMs (bot->user DMs work without it, but this makes user->bot DMs work too)
          GatewayIntentBits.MessageContent,     // required to actually READ message.content in DMs (privileged intent — must also be enabled in the Discord Developer Portal)
        ],
        // CRITICAL: without Partials.Channel, discord.js v14 silently drops ALL DM
        // messageCreate events (DM channels are never cached). Guild messages work
        // without it, which makes this bug easy to miss.
        partials: [Partials.Channel],
      });

      await client.login(accessToken);
      console.log(`[DiscordPlugin] Discord bot connected for user ${engine.userId} (workflow ${engine.workflowId}, isolated client)`);

      // Track for plugin-level teardown; expose latest for legacy ban helpers.
      this.clients.add(client);
      this.client = client;

      // Per-workflow cleanup handle: engine.stopWorkflowListeners() destroys
      // ONLY this workflow's client. Never store the shared receiver instance
      // here - its teardown() destroys every workflow's client.
      engine.receivers[`discord:${node.id}`] = {
        teardown: async () => {
          this.clients.delete(client);
          if (this.client === client) this.client = null;
          try {
            client.destroy();
          } catch {
            /* client already destroyed */
          }
        },
      };

      // Listen for messages
      client.on('messageCreate', (message) => {
        // Ignore bot messages
        if (message.author.bot) return;

        // Only process messages from the subscribed channel.
        // DM-friendly matching: a DM also matches if the configured value is the
        // AUTHOR's user id (far easier to find than a DM channel id), or the
        // literal wildcard 'dm' / 'any-dm' to accept DMs from anyone.
        const configured = String(node.parameters.channelId).trim();
        const isDM = !message.guild;
        const matches =
          message.channel.id === configured ||
          (isDM && (
            message.author.id === configured ||
            configured.toLowerCase() === 'dm' ||
            configured.toLowerCase() === 'any-dm'
          ));

        if (!matches) {
          console.log(`[DiscordPlugin] Ignoring message: channel=${message.channel.id} author=${message.author.id} isDM=${isDM} (subscribed to ${configured})`);
          return;
        }

        {
          const messageData = {
            content: message.content,
            author: message.author.username,
            username: message.member?.displayName || message.author.username,
            avatarUrl: typeof message.author.displayAvatarURL === 'function' ? message.author.displayAvatarURL({ size: 256 }) : null,
            authorId: message.author.id,
            channelId: message.channel.id,
            guildId: message.guild?.id,
            timestamp: message.createdTimestamp,
            attachments: Array.from(message.attachments.values()).map((a) => ({
              id: a.id,
              name: a.name,
              url: a.url,
              size: a.size,
            })),
          };

          // Trigger the workflow
          engine.processWorkflowTrigger(messageData);
        }
      });

      console.log(`[DiscordPlugin] Subscribed to channel ${node.parameters.channelId}`);
    } catch (error) {
      console.error('[DiscordPlugin] Error setting up Discord receiver:', error);
      throw error;
    }
  }

  /**
   * Validate incoming trigger data
   */
  validate(triggerData) {
    return 'content' in triggerData && 'author' in triggerData;
  }

  /**
   * Process the trigger data into outputs
   */
  async process(inputData, engine) {
    return {
      content: inputData.content,
      author: inputData.author,
      username: inputData.username,
      avatarUrl: inputData.avatarUrl,
      authorId: inputData.authorId,
      channelId: inputData.channelId,
      guildId: inputData.guildId,
      timestamp: inputData.timestamp,
      attachments: inputData.attachments || [],
      response: inputData,
    };
  }

  async banUser(guildId, userId, reason = 'Banned via workflow') {
    console.log('[DiscordPlugin] Attempting to ban user:', userId, 'from guild:', guildId);
    if (!this.client) {
      throw new Error('Discord client is not initialized');
    }
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      await member.ban({ reason });
      console.log('[DiscordPlugin] User banned successfully:', userId);
      return true;
    } catch (error) {
      console.error('[DiscordPlugin] Error banning user:', error);
      throw error;
    }
  }

  async unbanUser(guildId, userId, reason = 'Unbanned via workflow') {
    console.log('[DiscordPlugin] Attempting to unban user:', userId, 'from guild:', guildId);
    if (!this.client) {
      throw new Error('Discord client is not initialized');
    }
    try {
      const guild = await this.client.guilds.fetch(guildId);
      await guild.members.unban(userId, reason);
      console.log('[DiscordPlugin] User unbanned successfully:', userId);
      return true;
    } catch (error) {
      console.error('[DiscordPlugin] Error unbanning user:', error);
      throw error;
    }
  }

  /**
   * Teardown - called when workflow stops
   */  async teardown() {
    // Plugin-level teardown (uninstall / full plugin shutdown): destroy ALL
    // workflow clients. Individual workflow stops use their per-workflow
    // handle stored in engine.receivers and never reach this method.
    console.log(`[DiscordPlugin] Tearing down Discord receiver (${this.clients.size} client(s))`);
    for (const client of this.clients) {
      try {
        client.destroy();
      } catch {
        /* already destroyed */
      }
    }
    this.clients.clear();
    this.client = null;
  }
}

export default new DiscordReceiver();
