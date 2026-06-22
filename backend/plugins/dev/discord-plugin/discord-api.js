import { Client, GatewayIntentBits, Partials, AttachmentBuilder } from 'discord.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Discord API Plugin Tool
 *
 * This is a plugin-based tool that loads discord.js from its own isolated node_modules.
 * The plugin system automatically runs `npm install` on server startup.
 */

// Discord's hard content cap for a single message (non-Nitro bots).
const DISCORD_MAX_CONTENT = 2000;

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
    const channel = await client.channels.fetch(params.channelId);

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

    const channel = await client.channels.fetch(channelId);

    // Resolve the attachment source. Prefer filePath (no base64 bloat, streams from disk)
    // and fall back to fileData (base64) for backward compatibility.
    let source;
    let resolvedName = fileName;
    let sourceSize = null;

    if (filePath && typeof filePath === 'string' && filePath.trim().length > 0) {
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) {
        throw new Error(`filePath does not exist: ${absPath}`);
      }
      const stats = fs.statSync(absPath);
      if (!stats.isFile()) {
        throw new Error(`filePath is not a regular file: ${absPath}`);
      }
      sourceSize = stats.size;
      // Read the whole file into a Buffer. Buffers give discord.js a deterministic
      // Content-Length on the multipart part, which is what Discord's CDN uses to
      // tag the attachment with a proper content_type (needed for inline video/image previews).
      // Streams would skip that, and some attachments lose the content_type field
      // — which is the exact cause of "click to download" tiles for valid MP4s.
      source = fs.readFileSync(absPath);
      if (!resolvedName) {
        resolvedName = path.basename(absPath);
      }
    } else if (fileData && typeof fileData === 'string' && fileData.length > 0) {
      source = Buffer.from(fileData, 'base64');
      sourceSize = source.length;
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

    const sentMessage = await channel.send({
      content: message || '',
      files: [attachment],
    });

    const sentAttachment = sentMessage.attachments?.first?.();

    return {
      success: true,
      result: {
        messageId: sentMessage.id,
        timestamp: sentMessage.createdTimestamp,
        fileName: resolvedName,
        fileSize: sourceSize,
        source: filePath ? 'filePath' : 'fileData',
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