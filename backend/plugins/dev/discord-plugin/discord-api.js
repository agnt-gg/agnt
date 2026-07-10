import { Client, GatewayIntentBits, Partials, AttachmentBuilder } from 'discord.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { optimizeForDiscord } from './discord-safe-attachment.js';
import { askOrchestrator, conversationIdForChannel } from './annie-orchestrator-bridge.js';

/**
 * Discord API Plugin Tool
 *
 * This is a plugin-based tool that loads discord.js from its own isolated node_modules.
 * The plugin system automatically runs `npm install` on server startup.
 */

// Discord's hard content cap for a single message (non-Nitro bots).
const DISCORD_MAX_CONTENT = 2000;

/**
 * Look up a Discord user. Two modes:
 *
 *   byQuery  — walk a guild's member list looking for matches against username,
 *              global_name (the new post-2023 display name), or per-guild nickname.
 *              Requires the Server Members Intent to be enabled in the Developer
 *              Portal so guild.members.fetch() actually returns anyone. Returns
 *              an array of matches.
 *
 *   byId     — fetch a known user by ID and return their current public metadata.
 *              Useful for validating an ID before storing it in a workflow.
 *
 * Discord killed discriminators in mid-2023. All users are now on unique global
 * usernames (e.g. 'nathan_' not 'Nathan#0523'). There is intentionally NO public
 * API for "search all users by name" — Discord blocks it for anti-harassment.
 * Guild member search is the only supported path, which is why guildId is required
 * for byQuery mode.
 */
async function resolveUser(client, params) {
  const mode = (params.resolveMode || 'byQuery').toLowerCase();

  if (mode === 'byid') {
    const userId = String(params.userId || '').trim();
    if (!userId) throw new Error("RESOLVE_USER mode='byId' requires userId.");
    const user = await client.users.fetch(userId).catch((err) => {
      throw new Error(`Could not fetch user ${userId}: ${err.message}`);
    });
    return {
      mode: 'byId',
      matches: [{
        id: user.id,
        username: user.username,
        displayName: user.globalName || user.username,
        discriminator: user.discriminator === '0' ? null : user.discriminator, // legacy accounts still have one
        bot: user.bot,
        avatarUrl: user.displayAvatarURL({ size: 256 }),
      }],
    };
  }

  // byQuery mode
  const query = String(params.userQuery || '').trim().toLowerCase();
  const guildId = String(params.guildId || '').trim();
  const exactMatch = params.exactMatch === true || params.exactMatch === 'true';

  if (!query) throw new Error("RESOLVE_USER mode='byQuery' requires userQuery (the username/display name to search for).");
  if (!guildId) throw new Error("RESOLVE_USER mode='byQuery' requires guildId (Discord blocks global user search; searches happen per-guild). Right-click the server icon -> Copy Server ID.");

  const guild = await client.guilds.fetch(guildId).catch((err) => {
    throw new Error(`Could not fetch guild ${guildId}: ${err.message}. Make sure the bot is in this server.`);
  });

  // fetch({ query, limit }) uses Discord's guild-search endpoint — it's fast and
  // doesn't require the Server Members Intent for the fetch itself (only cache-based
  // list access does). This works even on large guilds.
  let members;
  try {
    members = await guild.members.fetch({ query, limit: 25 });
  } catch (err) {
    throw new Error(`Guild member search failed: ${err.message}. If this is a small guild, try enabling the Server Members Intent in the Developer Portal.`);
  }

  const matches = [];
  for (const member of members.values()) {
    const u = member.user;
    const uname = (u.username || '').toLowerCase();
    const gname = (u.globalName || '').toLowerCase();
    const nick = (member.nickname || '').toLowerCase();

    const isMatch = exactMatch
      ? (uname === query || gname === query || nick === query)
      : (uname.includes(query) || gname.includes(query) || nick.includes(query));

    if (!isMatch) continue;

    matches.push({
      id: u.id,
      username: u.username,
      displayName: u.globalName || u.username,
      guildNickname: member.nickname || null,
      discriminator: u.discriminator === '0' ? null : u.discriminator,
      bot: u.bot,
      avatarUrl: u.displayAvatarURL({ size: 256 }),
      guildId,
    });
  }

  return {
    mode: 'byQuery',
    query: params.userQuery,
    guildId,
    exactMatch,
    matchCount: matches.length,
    matches,
  };
}

/**
 * TEST_DM: 5-stage diagnostic that verifies the whole bot->user DM path is working.
 * Returns a structured report per stage so a caller can see EXACTLY which stage
 * failed and get an actionable error message.
 *
 * Stages:
 *   1. botLogin        — client is ready and has a user
 *   2. userFetch       — the userId resolves to a real user
 *   3. dmChannelOpen   — createDM() succeeds (user has DMs enabled from the shared guild)
 *   4. messageSend     — actual send goes through (skipped if dryRun=true)
 *   5. overall         — verdict + hint if anything failed
 *
 * This is the tool to call when "my DM setup isn't working" to see WHY.
 */
async function testDM(client, params) {
  const userId = String(params.userId || '').trim();
  const dryRun = params.dryRun === true || params.dryRun === 'true';
  const customMessage = String(params.message || '').trim() || 'AGNT ↔ Discord DM connection verified ✅';

  const report = {
    userId,
    dryRun,
    stages: {
      botLogin: { status: 'pending', detail: null },
      userFetch: { status: 'pending', detail: null },
      dmChannelOpen: { status: 'pending', detail: null },
      messageSend: { status: 'pending', detail: null },
    },
    overall: 'unknown',
    hint: null,
  };

  // Stage 1: bot login.
  //
  // discord.js Client.login() resolves as soon as the WebSocket identify
  // handshake is sent — the 'clientReady' event fires ~200-500ms later. If we
  // check client.readyAt / client.isReady() immediately after login we race the
  // event loop and false-fail on cold-start calls. Wait for ready explicitly.
  if (!client.isReady()) {
    try {
      await new Promise((resolve, reject) => {
        const t0 = Date.now();
        const timeout = setTimeout(() => {
          reject(new Error('Timed out waiting for Discord clientReady event (8s)'));
        }, 8000);
        client.once('clientReady', () => {
          clearTimeout(timeout);
          resolve(Date.now() - t0);
        });
        // Support older discord.js versions that emit 'ready' instead
        client.once('ready', () => {
          clearTimeout(timeout);
          resolve(Date.now() - t0);
        });
      });
    } catch (err) {
      report.stages.botLogin = {
        status: 'fail',
        detail: `Bot client did not become ready: ${err.message}`,
      };
      report.overall = 'fail';
      report.hint = 'The Discord gateway did not send the ready event. Common causes: (a) bot token is invalid or revoked, (b) required Gateway Intents are disabled in the Discord Developer Portal, (c) network cannot reach Discord.';
      return report;
    }
  }

  if (client.user) {
    report.stages.botLogin = {
      status: 'ok',
      detail: `Logged in as ${client.user.tag} (id ${client.user.id})`,
    };
  } else {
    report.stages.botLogin = {
      status: 'fail',
      detail: 'Bot client is ready but client.user is null — this should not happen.',
    };
    report.overall = 'fail';
    report.hint = 'Unexpected discord.js state: client.isReady() true but client.user falsy. This may indicate a discord.js version mismatch.';
    return report;
  }

  // Stage 2: user fetch
  if (!userId) {
    report.stages.userFetch = { status: 'fail', detail: 'userId is required for TEST_DM.' };
    report.overall = 'fail';
    report.hint = 'Right-click your Discord name (with Developer Mode on) -> Copy User ID, then pass it as userId.';
    return report;
  }
  let user;
  try {
    user = await client.users.fetch(userId);
    report.stages.userFetch = { status: 'ok', detail: `Resolved to ${user.tag} (globalName: ${user.globalName || 'none'}, bot: ${user.bot})` };
  } catch (err) {
    report.stages.userFetch = { status: 'fail', detail: `Could not fetch user ${userId}: ${err.message}` };
    report.overall = 'fail';
    report.hint = `Discord could not find a user with ID '${userId}'. Verify the ID is correct (right-click yourself in Discord with Developer Mode on -> Copy User ID) and that the bot has access to see this user (usually means sharing at least one guild).`;
    return report;
  }

  // Stage 3: open DM channel
  let dm;
  try {
    dm = await user.createDM();
    report.stages.dmChannelOpen = { status: 'ok', detail: `DM channel opened (id ${dm.id})` };
  } catch (err) {
    report.stages.dmChannelOpen = { status: 'fail', detail: `Could not open DM channel: ${err.message}` };
    report.overall = 'fail';
    report.hint = 'The bot could not open a DM channel with this user. This usually means the bot does not share any guild with the user, OR the user has DMs disabled server-wide, OR the user has blocked the bot.';
    return report;
  }

  // Stage 4: send (or skip)
  if (dryRun) {
    report.stages.messageSend = { status: 'skipped', detail: 'Skipped because dryRun=true. All prerequisites passed — real send would succeed.' };
    report.overall = 'ready';
    report.hint = 'All stages passed except the send (which was skipped). Set dryRun=false to actually send a test message.';
    return report;
  }
  try {
    const sent = await dm.send({ content: customMessage });
    report.stages.messageSend = { status: 'ok', detail: `Sent message ${sent.id} at ${new Date(sent.createdTimestamp).toISOString()}` };
    report.overall = 'ok';
    report.hint = 'Everything works. You can now use UPLOAD_FILE and SEND_MESSAGE with recipientType="user" freely.';
    return report;
  } catch (err) {
    report.stages.messageSend = { status: 'fail', detail: `Send failed: ${err.message}` };
    report.overall = 'fail';
    report.hint = `The DM channel opened but the actual send was rejected. Common causes: (a) user has DMs disabled on the shared guild, (b) user has blocked the bot, (c) bot is missing the Send Messages permission somewhere. Error: ${err.message}`;
    return report;
  }
}

/**
 * Resolve a sendable destination (channel object with .send()) from params.
 *
 * Two modes:
 *  - recipientType 'channel' (default): treat channelId as a guild channel ID.
 *    Works for text channels, threads, announcements, etc.
 *  - recipientType 'user': treat userId (or channelId as a fallback) as a
 *    Discord user ID. Fetches the user, opens/reuses their DM channel, and
 *    returns that. Required for DMs — you cannot channels.fetch() a DM channel
 *    by its channel ID unless the bot has already opened it in this process.
 *
 * NOTE: Bot->user DMs require the bot and user to share at least one guild.
 * Discord enforces this to prevent unsolicited DM spam; it's a platform rule,
 * not a code issue.
 */
async function resolveDestination(client, params) {
  const recipientType = (params.recipientType || 'channel').toLowerCase();

  if (recipientType === 'user') {
    // Accept userId as the primary field, but fall back to channelId so
    // callers that already had 'channelId' wired can just flip recipientType
    // without also renaming the field.
    const userId = (params.userId && String(params.userId).trim()) || (params.channelId && String(params.channelId).trim());
    if (!userId) {
      throw new Error("recipientType='user' requires userId (or channelId) to be a Discord user ID.");
    }
    const user = await client.users.fetch(userId).catch((err) => {
      throw new Error(`Could not fetch user ${userId}: ${err.message}. Make sure the ID is correct and the bot shares at least one guild with this user.`);
    });
    // createDM() is idempotent — returns the existing DM channel if one is
    // already cached, or opens a new one. Safe to call every time.
    const dm = await user.createDM();
    return dm;
  }

  // Default: guild channel by ID.
  const channelId = params.channelId && String(params.channelId).trim();
  if (!channelId) throw new Error('channelId is required when recipientType is "channel" (the default).');
  return client.channels.fetch(channelId);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lpLen = (s) => Array.from(s).length; // length in Unicode code points

/**
 * Take up to `room` code points from the front of `str`, preferring to cut on a
 * paragraph break, then newline, then sentence end, then whitespace. Falls back to a
 * hard code-point cut if no boundary exists within the window.
 */
function sliceOnBoundary(str, room) {
  const cps = Array.from(str);
  if (cps.length <= room) return str;
  const window = cps.slice(0, room).join('');
  const candidates = [
    window.lastIndexOf('\n\n'),
    window.lastIndexOf('\n'),
    Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? ')),
    window.lastIndexOf(' '),
  ];
  for (const idx of candidates) {
    // Only honor a boundary if it's reasonably far into the window, else we waste space.
    if (idx > room * 0.5) return window.slice(0, idx + 1);
  }
  // Hard cut on a code-point boundary (never slices a surrogate pair / emoji in half).
  return cps.slice(0, room).join('');
}

/**
 * Split a long string into Discord-safe chunks.
 *
 * Quality rules (priority order):
 *  - Never break a fenced ``` code block across a chunk boundary: close it at the
 *    end of the chunk and reopen it (preserving the language tag) at the top of the next.
 *  - Prefer natural boundaries: paragraph break -> newline -> sentence end -> space.
 *  - Operate on Unicode code points so emoji / surrogate pairs are never sliced.
 *  - Hard-cut only as a last resort (a single unbreakable token longer than the limit).
 *
 * Verified against a local test matrix (plain text, code blocks, pure-emoji,
 * unbreakable tokens, and realistic mixed content) — every chunk <= limit and every
 * chunk has balanced ``` fences.
 *
 * @returns {string[]} ordered chunks, each <= limit code points.
 */
function smartSplitMessage(text, limit = DISCORD_MAX_CONTENT) {
  if (lpLen(text) <= limit) return [text];
  const fenceRe = /^```[^\n`]*$/;
  const lines = text.split('\n');

  const chunks = [];
  let buf = '';
  let currentFence = null; // opener string if we are *inside* a code block, else null
  let chunkFence = null; // the fence the current buf was seeded with (reopen accounting)

  const reserve = () => (currentFence ? 4 : 0); // room for a trailing "\n```"

  const closeChunk = () => {
    if (buf.length === 0) return;
    let out = buf;
    if (currentFence) out += (out.endsWith('\n') ? '' : '\n') + '```';
    chunks.push(out);
    buf = '';
    if (currentFence) {
      buf = currentFence + '\n'; // reopen the same fence at the top of the next chunk
      chunkFence = currentFence;
    } else {
      chunkFence = null;
    }
  };

  const fits = (piece) => lpLen(buf) + lpLen(piece) <= limit - reserve();

  for (let i = 0; i < lines.length; i++) {
    const isLast = i === lines.length - 1;
    const line = lines[i];
    const trimmed = line.trim();
    const isFence = fenceRe.test(trimmed);

    // Fence state AFTER this line: a fence line toggles in/out of a code block.
    let fenceAfter = currentFence;
    if (isFence) fenceAfter = currentFence ? null : trimmed === '```' ? '```' : trimmed;

    const piece = isLast ? line : line + '\n';

    if (fits(piece)) {
      buf += piece;
      currentFence = fenceAfter;
      continue;
    }

    // Doesn't fit. If buf has real content beyond a reopened fence header, flush it.
    const headerLen = chunkFence ? lpLen(chunkFence + '\n') : 0;
    if (lpLen(buf) > headerLen) closeChunk();

    // The single line itself may exceed the limit -> wrap it on soft boundaries.
    let remaining = piece;
    while (lpLen(buf) + lpLen(remaining) > limit - reserve()) {
      const room = limit - lpLen(buf) - reserve();
      const slice = sliceOnBoundary(remaining, Math.max(1, room));
      buf += slice;
      remaining = remaining.slice(slice.length);
      closeChunk();
    }
    if (remaining.length) buf += remaining;
    currentFence = fenceAfter;
  }

  // Final flush WITHOUT reopening (we're done).
  if (buf.length) {
    let out = buf;
    if (currentFence) out += (out.endsWith('\n') ? '' : '\n') + '```';
    chunks.push(out);
  }
  return chunks.filter((c) => c.trim().length > 0);
}

class DiscordAPI {
  constructor() {
    this.name = 'discord-api';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[DiscordPlugin] Executing Discord API with params:', JSON.stringify(params, null, 2));

    // ORCHESTRATOR_CHAT does NOT need a Discord gateway connection — it bridges
    // straight into AGNT's local orchestrator. Handle it before the Discord login
    // so we don't waste a WebSocket connection or require a Discord token for it.
    if (params.action === 'ORCHESTRATOR_CHAT') {
      return await this.orchestratorChat(params, workflowEngine);
    }

    try {
      const accessToken = params.__auth?.token;
      if (!accessToken) {
        throw new Error('Not connected to Discord. Connect in Settings → Connections.');
      }

      const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
        partials: [Partials.Channel],
      });

      await client.login(accessToken);

      let result;
      switch (params.action) {
        case 'SEND_MESSAGE':
          result = await this.sendMessage(client, params);
          break;
        case 'ASSIGN_ROLE':
          result = await this.assignRole(client, params);
          break;
        case 'GET_MEMBERS':
          result = await this.getMembers(client, params);
          break;
        case 'UPLOAD_FILE':
          result = await this.uploadFile(client, params);
          break;
        case 'BAN_MEMBER':
          result = await this.banMember(client, params);
          break;
        case 'RESOLVE_USER': {
          const r = await resolveUser(client, params);
          result = { success: true, result: r };
          break;
        }
        case 'TEST_DM': {
          const report = await testDM(client, params);
          result = { success: report.overall === 'ok' || report.overall === 'ready', result: report };
          break;
        }
        case 'DELETE_MESSAGE':
          result = await this.deleteMessage(client, params);
          break;
        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }

      client.destroy();

      return {
        success: true,
        result: result,
        error: null,
      };
    } catch (error) {
      console.error('[DiscordPlugin] Error executing Discord API:', error);
      return {
        success: false,
        result: null,
        error: error.message,
      };
    }
  }

  async sendMessage(client, params) {
    const channel = await resolveDestination(client, params);

    // --- chunking options (all optional, backwards compatible) ---
    const autoSplit = params.autoSplit !== false && params.autoSplit !== 'false';
    let limit = parseInt(params.splitLimit, 10);
    if (Number.isNaN(limit)) limit = DISCORD_MAX_CONTENT;
    limit = Math.min(Math.max(limit, 1), DISCORD_MAX_CONTENT);
    let delayMs = parseInt(params.splitDelayMs, 10);
    if (Number.isNaN(delayMs)) delayMs = 350;
    delayMs = Math.max(delayMs, 0);
    const numberChunks = params.numberChunks === true || params.numberChunks === 'true';

    const text = params.message ?? '';

    // Fast path: short message OR splitting disabled -> single send (unchanged behavior).
    if (!autoSplit || lpLen(text) <= limit) {
      const message = await channel.send(text);
      return this.formatSentMessage(message, { chunked: false }).result;
    }

    // Build chunks. Reserve room for a " (n/N)" suffix when numbering is enabled.
    let chunks = smartSplitMessage(text, numberChunks ? limit - 12 : limit);
    if (numberChunks) {
      const total = chunks.length;
      chunks = chunks.map((c, i) => `${c}\n\n(${i + 1}/${total})`);
    }

    const sent = [];
    for (let i = 0; i < chunks.length; i++) {
      // Ping only on the first chunk; suppress notifications on the rest while
      // still rendering any <@id> mentions as clickable text.
      const allowedMentions = i === 0 ? undefined : { parse: [] };
      try {
        const msg = await channel.send({ content: chunks[i], allowedMentions });
        sent.push(this.formatSentMessage(msg, null).result);
      } catch (err) {
        // Partial success: report what landed plus the failure point.
        return {
          chunked: true,
          chunkCount: sent.length,
          totalChunks: chunks.length,
          messages: sent,
          failedAtChunk: i + 1,
          error: `Sent ${sent.length}/${chunks.length} chunks before failing on chunk ${i + 1}: ${err.message}`,
        };
      }
      if (i < chunks.length - 1 && delayMs > 0) await sleep(delayMs);
    }

    return {
      chunked: true,
      chunkCount: sent.length,
      messages: sent,
      // convenience top-level pointers to the first message (backwards-compatible reads)
      messageId: sent[0]?.messageId ?? null,
      timestamp: sent[0]?.timestamp ?? null,
      username: sent[0]?.username ?? null,
      avatarUrl: sent[0]?.avatarUrl ?? null,
    };
  }

  /** Shape a single sent discord.js Message into our standard result envelope. */
  formatSentMessage(message, extra) {
    const messageAuthor = message.author;
    const base = {
      messageId: message.id,
      timestamp: message.createdTimestamp,
      username: messageAuthor?.username || null,
      avatarUrl: messageAuthor ? messageAuthor.displayAvatarURL({ extension: 'png', size: 256 }) : null,
    };
    if (extra && typeof extra === 'object') Object.assign(base, extra);
    return { success: true, result: base };
  }

  async assignRole(client, params) {
    const guild = await client.guilds.fetch(params.guildId);
    const role = await guild.roles.fetch(params.roleId);
    const memberIds = params.memberIds.split(',').map((id) => id.trim());

    const results = await Promise.all(
      memberIds.map(async (memberId) => {
        try {
          const member = await guild.members.fetch(memberId);
          await member.roles.add(role);
          return { memberId, success: true };
        } catch (error) {
          return { memberId, success: false, error: error.message };
        }
      }),
    );

    return {
      success: true,
      result: {
        assignedRoles: results,
      },
    };
  }

  async getMembers(client, params) {
    const { guildId, includeAvatarMeta, includeGlobalProfile, trackRoles = [], hashFields = [] } = params;
    const normalizedTrackRoles = Array.isArray(trackRoles)
      ? trackRoles
      : typeof trackRoles === 'string' && trackRoles.length
        ? trackRoles
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
        : [];
    const normalizedHashFields = Array.isArray(hashFields)
      ? hashFields
      : typeof hashFields === 'string' && hashFields.length
        ? hashFields
            .split(',')
            .map((field) => field.trim())
            .filter(Boolean)
        : [];
    const trackSet = new Set(normalizedTrackRoles);

    const guild = await client.guilds.fetch(guildId);
    await guild.members.fetch();

    const members = guild.members.cache.map((member) => {
      const base = {
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
        roles: member.roles.cache.map((role) => ({
          id: role.id,
          name: role.name,
        })),
      };

      if (includeGlobalProfile) {
        base.discriminator = member.user.discriminator;
        base.globalName = member.user.globalName;
        base.bannerHash = member.user.banner;
      }

      if (includeAvatarMeta) {
        base.avatarHash = member.user.avatar;
        base.avatarUrl = member.displayAvatarURL({ extension: 'png', size: 256 });
      }

      if (normalizedTrackRoles.length) {
        base.isTracked = member.roles.cache.some((role) => trackSet.has(role.id));
      }

      if (normalizedHashFields.length) {
        const hashes = {};
        normalizedHashFields.forEach((field) => {
          if (base[field] !== undefined && base[field] !== null) {
            hashes[field] = crypto.createHash('sha256').update(String(base[field])).digest('hex');
          }
        });
        if (Object.keys(hashes).length) {
          base.hashes = hashes;
        }
      }

      return base;
    });

    return {
      success: true,
      result: {
        members: members,
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  async uploadFile(client, params) {
    const { channelId, fileName, filePath, fileData, message, description, spoiler } = params;

    // Auto-optimization params (all optional, backwards compatible).
    // autoOptimize defaults to TRUE — this is the whole point of the helper. Set false to opt out.
    const autoOptimize = !(params.autoOptimize === false || params.autoOptimize === 'false');
    let targetLimitMB = parseFloat(params.targetLimitMB);
    if (!Number.isFinite(targetLimitMB) || targetLimitMB <= 0) targetLimitMB = 10;
    const forceOptimize = params.forceOptimize === true || params.forceOptimize === 'true';

    const channel = await resolveDestination(client, params);

    // Resolve the attachment source. Prefer filePath (no base64 bloat, streams from disk)
    // and fall back to fileData (base64) for backward compatibility.
    let source;
    let resolvedName = fileName;
    let sourceSize = null;
    let originalSize = null;
    let optimization = null; // populated when auto-optimize runs
    let cleanupOptimized = () => {};

    if (filePath && typeof filePath === 'string' && filePath.trim().length > 0) {
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) {
        throw new Error(`filePath does not exist: ${absPath}`);
      }
      const stats = fs.statSync(absPath);
      if (!stats.isFile()) {
        throw new Error(`filePath is not a regular file: ${absPath}`);
      }
      originalSize = stats.size;

      // Pre-flight optimization pass. Only runs on filePath uploads — fileData
      // (base64) callers explicitly opted into the raw path and we don't want
      // to surprise them by re-encoding.
      let uploadPath = absPath;
      if (autoOptimize) {
        try {
          const opt = optimizeForDiscord(absPath, { targetLimitMB, force: forceOptimize });
          uploadPath = opt.path;
          cleanupOptimized = opt.cleanup;
          optimization = {
            wasOptimized: opt.wasOptimized,
            strategy: opt.strategy,
            originalSize,
            finalSize: opt.size,
            targetLimitMB,
            note: opt.note,
          };
          if (opt.wasOptimized) {
            console.log(`[DiscordPlugin] Optimized attachment (${opt.strategy}): ${opt.note}`);
          }
        } catch (optErr) {
          // Optimization failure is non-fatal — fall back to the raw file and
          // record the error so the caller can see what happened.
          console.warn('[DiscordPlugin] Auto-optimize failed, uploading original:', optErr.message);
          optimization = {
            wasOptimized: false,
            strategy: 'optimize-failed',
            originalSize,
            finalSize: originalSize,
            targetLimitMB,
            note: `Optimization failed (${optErr.message}); uploading original.`,
          };
        }
      }

      const finalStats = fs.statSync(uploadPath);
      sourceSize = finalStats.size;
      // Read the whole file into a Buffer. Buffers give discord.js a deterministic
      // Content-Length on the multipart part, which is what Discord's CDN uses to
      // tag the attachment with a proper content_type (needed for inline video/image previews).
      // Streams would skip that, and some attachments lose the content_type field
      // — which is the exact cause of "click to download" tiles for valid MP4s.
      source = fs.readFileSync(uploadPath);
      if (!resolvedName) {
        // If optimization changed the extension (e.g. PNG->JPG), reflect that
        // in the resolved name so Discord tags the content_type correctly.
        resolvedName = path.basename(uploadPath);
        if (optimization?.wasOptimized && path.extname(absPath).toLowerCase() !== path.extname(uploadPath).toLowerCase()) {
          // Preserve the original stem, swap the extension.
          const origStem = path.basename(absPath, path.extname(absPath));
          resolvedName = origStem + path.extname(uploadPath);
        }
      } else if (optimization?.wasOptimized) {
        // User provided a fileName; keep the stem but swap extension if it changed.
        const providedExt = path.extname(resolvedName).toLowerCase();
        const newExt = path.extname(uploadPath).toLowerCase();
        if (providedExt !== newExt) {
          const stem = path.basename(resolvedName, path.extname(resolvedName));
          resolvedName = stem + newExt;
        }
      }
    } else if (fileData && typeof fileData === 'string' && fileData.length > 0) {
      source = Buffer.from(fileData, 'base64');
      sourceSize = source.length;
      originalSize = source.length;
      if (!resolvedName) {
        throw new Error('fileName is required when uploading via fileData (base64).');
      }
    } else {
      throw new Error('UPLOAD_FILE requires either filePath or fileData.');
    }

    // Use AttachmentBuilder so discord.js infers and sets the correct Content-Type
    // on the multipart part. Without this, raw { attachment, name } can land on
    // Discord's CDN without a content_type field, and the client falls back to a
    // download tile instead of the inline video/image player.
    const attachment = new AttachmentBuilder(source, { name: resolvedName });

    if (description && typeof description === 'string') {
      attachment.setDescription(description);
    }
    if (spoiler === true || spoiler === 'true') {
      attachment.setSpoiler(true);
    }

    let sentMessage;
    try {
      sentMessage = await channel.send({
        content: message || '',
        files: [attachment],
      });
    } finally {
      // Always clean up temp optimized files, even if the upload throws.
      cleanupOptimized();
    }

    const sentAttachment = sentMessage.attachments?.first?.();

    return {
      success: true,
      result: {
        messageId: sentMessage.id,
        timestamp: sentMessage.createdTimestamp,
        fileName: resolvedName,
        fileSize: sourceSize,
        originalSize,
        source: filePath ? 'filePath' : 'fileData',
        optimization,
        attachment: sentAttachment
          ? {
              id: sentAttachment.id,
              url: sentAttachment.url,
              proxyUrl: sentAttachment.proxyURL,
              contentType: sentAttachment.contentType || null,
              size: sentAttachment.size,
              width: sentAttachment.width || null,
              height: sentAttachment.height || null,
              name: sentAttachment.name,
            }
          : null,
      },
    };
  }

  /**
   * ORCHESTRATOR_CHAT: bridge a message into AGNT's full orchestrator (the same
   * universalChatHandler that powers the main Annie chat). Returns Annie's reply
   * text plus any generated image refs. This is the core of the "text Annie's
   * whole system from Discord" hotline.
   *
   * Memory: pass a Discord channelId and we derive a stable conversationId
   * (discord-dm-<channelId>), so each DM thread is one persistent conversation.
   * You can also pass an explicit conversationId to override.
   */
  async orchestratorChat(params, workflowEngine) {
    const message = params.message || params.orchestratorMessage;
    if (!message || !String(message).trim()) {
      throw new Error('ORCHESTRATOR_CHAT requires a message.');
    }

    // The plugin runtime gets userId from the workflow engine context (or an
    // explicit param). The bridge mints a short-lived internal JWT from it so
    // the orchestrator authenticates as this user — unlocking their memory,
    // LLM keys, tools, everything.
    const userId =
      (params.userId && String(params.userId).trim()) ||
      (workflowEngine && workflowEngine.userId) ||
      null;

    // Prefer an explicit conversationId; otherwise derive from channelId; otherwise
    // fall back to a per-user key so DMs still thread by recipient.
    const conversationId =
      (params.conversationId && String(params.conversationId).trim()) ||
      (params.channelId && conversationIdForChannel(String(params.channelId).trim())) ||
      (params.userId && `discord-user-${String(params.userId).trim()}`) ||
      'discord-adhoc';

    const result = await askOrchestrator({
      message: String(message),
      conversationId,
      userId,
      provider: params.provider || undefined,
      model: params.orchestratorModel || undefined,
      timeoutMs: params.timeoutMs ? Number(params.timeoutMs) : 180000,
    });

    return {
      success: true,
      result: {
        reply: result.reply,
        images: result.images,
        toolsUsed: result.toolsUsed,
        conversationId: result.conversationId,
      },
    };
  }

  /**
   * DELETE_MESSAGE: remove message(s) the bot authored. Three modes:
   *
   *   single      — delete one message by messageId (needs channelId or userId).
   *   purgeMine   — walk the channel/DM history and delete EVERY message the bot
   *                 itself authored (up to `limit`, default 100).
   *   purgeRecent — delete the bot's last N authored messages (`count`).
   *
   * Discord platform rules baked in here:
   *  - In a DM, a bot can ONLY delete its own messages. There is no "Manage
   *    Messages" permission in a DM, so we never even attempt to delete the
   *    user's messages — we filter to client.user.id authored messages.
   *  - bulkDelete is guild-only AND only works on messages < 14 days old, so we
   *    do NOT use it for DMs. We delete sequentially with a small pace delay.
   *  - discord.js's REST layer already queues + auto-retries on 429 rate limits,
   *    so we won't get hard-rate-limited; the pace delay is extra politeness to
   *    avoid ever tripping the limiter in the first place.
   */
  async deleteMessage(client, params) {
    const mode = (params.deleteMode || 'single').toLowerCase();
    const channel = await resolveDestination(client, params);

    // Pace between sequential deletes (ms). discord.js auto-handles 429s, but a
    // small gap keeps us comfortably under the per-route bucket.
    let paceMs = parseInt(params.deletePaceMs, 10);
    if (Number.isNaN(paceMs)) paceMs = 400;
    paceMs = Math.max(paceMs, 0);

    const botId = client.user?.id;

    // ---- single ----
    if (mode === 'single') {
      const messageId = String(params.messageId || '').trim();
      if (!messageId) throw new Error("DELETE_MESSAGE mode='single' requires messageId.");

      let msg;
      try {
        msg = await channel.messages.fetch(messageId);
      } catch (err) {
        throw new Error(`Could not fetch message ${messageId}: ${err.message}. It may have already been deleted, or it's in a different channel.`);
      }

      // Guard: in a DM the bot can only delete its own messages. Fail loud and
      // clear rather than letting Discord return a confusing 50021/50003.
      const isDM = !msg.guild;
      if (isDM && msg.author?.id !== botId) {
        throw new Error('Cannot delete this message: in a DM, the bot can only delete messages it authored. This message was sent by the user, and Discord does not allow bots to delete user DMs.');
      }

      await msg.delete();
      return {
        success: true,
        result: {
          mode: 'single',
          deletedMessageId: messageId,
          channelId: channel.id,
          wasDM: isDM,
          deletedAt: new Date().toISOString(),
        },
      };
    }

    // ---- purgeMine / purgeRecent ----
    if (mode === 'purgemine' || mode === 'purgerecent') {
      // How many of the bot's own messages to remove.
      let target = Infinity;
      if (mode === 'purgerecent') {
        target = parseInt(params.count, 10);
        if (Number.isNaN(target) || target <= 0) {
          throw new Error("DELETE_MESSAGE mode='purgeRecent' requires a positive count.");
        }
      }

      // Safety cap on how much history we scan (message objects fetched), so a
      // runaway purge can't page forever. Default 500 scanned.
      let scanCap = parseInt(params.scanLimit, 10);
      if (Number.isNaN(scanCap) || scanCap <= 0) scanCap = 500;

      const deleted = [];
      const failures = [];
      let scanned = 0;
      let beforeId; // pagination cursor

      while (deleted.length < target && scanned < scanCap) {
        const pageSize = Math.min(100, scanCap - scanned);
        const options = { limit: pageSize };
        if (beforeId) options.before = beforeId;

        let batch;
        try {
          batch = await channel.messages.fetch(options);
        } catch (err) {
          // If we can't page further, stop with what we have.
          break;
        }
        if (!batch || batch.size === 0) break;

        scanned += batch.size;
        // Track the oldest id in this batch for the next page cursor.
        beforeId = batch.last()?.id || beforeId;

        // Only the bot's own messages (this is what makes DM purging legal).
        const mine = [...batch.values()].filter((m) => m.author?.id === botId);

        for (const m of mine) {
          if (deleted.length >= target) break;
          try {
            await m.delete();
            deleted.push({ messageId: m.id, timestamp: m.createdTimestamp });
          } catch (err) {
            failures.push({ messageId: m.id, error: err.message });
          }
          if (paceMs > 0) await sleep(paceMs);
        }
      }

      return {
        success: true,
        result: {
          mode: mode === 'purgemine' ? 'purgeMine' : 'purgeRecent',
          channelId: channel.id,
          deletedCount: deleted.length,
          scanned,
          reachedScanCap: scanned >= scanCap && deleted.length < target,
          deleted,
          failures: failures.length ? failures : undefined,
          note: `Deleted ${deleted.length} of the bot's own message(s). Only bot-authored messages are removable in a DM — the user's messages are left untouched (Discord platform rule).`,
          deletedAt: new Date().toISOString(),
        },
      };
    }

    throw new Error(`Unknown deleteMode '${params.deleteMode}'. Use 'single', 'purgeMine', or 'purgeRecent'.`);
  }

  async banMember(client, params) {
    const { guildId, targetUserId, banReason, deleteMessageDays } = params;
    const guild = await client.guilds.fetch(guildId);
    const numericDays =
      typeof deleteMessageDays === 'number' ? deleteMessageDays : deleteMessageDays !== undefined ? parseInt(deleteMessageDays, 10) : 0;
    const clampedDays = Number.isNaN(numericDays) ? 0 : Math.min(Math.max(numericDays, 0), 7);
    const deleteMessageSeconds = clampedDays * 24 * 60 * 60;
    const banOptions = {};
    if (banReason) {
      banOptions.reason = banReason;
    }
    if (deleteMessageSeconds > 0) {
      banOptions.deleteMessageSeconds = deleteMessageSeconds;
    }
    await guild.members.ban(targetUserId, banOptions);

    return {
      success: true,
      result: {
        guildId,
        userId: targetUserId,
        bannedAt: new Date().toISOString(),
        deleteMessageDays: clampedDays,
        deleteMessageSeconds: deleteMessageSeconds || 0,
        reason: banReason || null,
      },
    };
  }
}

export default new DiscordAPI();