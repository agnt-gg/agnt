import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * Seedance 2.0 Video Generation Plugin
 *
 * Generates cinematic AI video clips via ByteDance Seedance 2.0 on OpenRouter.
 * Async workflow: submit generation job -> poll status -> download MP4.
 *
 * Auth: OpenRouter bearer token injected as params.__auth.token by PluginManager.
 */
class SeedanceAPI {
  constructor() {
    this.name = 'seedance-api';
    this.API_BASE = 'https://openrouter.ai/api/v1/videos';
    this.POLL_INTERVAL_MS = 10_000;
    this.MAX_WAIT_MS = 10 * 60 * 1000;
    this.MAX_RETRIES = 3;
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[SeedancePlugin] Executing Seedance API with params:', JSON.stringify({
      duration: params.duration,
      resolution: params.resolution,
      aspectRatio: params.aspectRatio,
      useFastTier: params.useFastTier,
      hasFirstFrame: !!params.firstFrameUrl,
      promptLength: params.prompt?.length,
    }, null, 2));

    try {
      const apiKey = params.__auth?.token;
      if (!apiKey) {
        throw new Error('Not connected to OpenRouter. Connect in Settings → Connections.');
      }

      if (!params.prompt || typeof params.prompt !== 'string') {
        throw new Error('`prompt` is required (string describing the shot)');
      }

      // Build request body
      const body = {
        model: params.useFastTier === 'Yes'
          ? 'bytedance/seedance-2.0-fast'
          : 'bytedance/seedance-2.0',
        prompt: params.prompt,
        duration: Number(params.duration) || 5,
        resolution: params.resolution || '1080p',
        aspect_ratio: params.aspectRatio || '9:16',
        generate_audio: params.generateAudio === 'Yes',
      };

      // Optional first/last-frame image conditioning
      if (params.firstFrameUrl) {
        body.frame_images = [{
          type: 'image_url',
          image_url: { url: params.firstFrameUrl },
          frame_type: 'first_frame',
        }];
        if (params.lastFrameUrl) {
          body.frame_images.push({
            type: 'image_url',
            image_url: { url: params.lastFrameUrl },
            frame_type: 'last_frame',
          });
        }
      }

      // ─── 1. Submit generation job ───────────────────────────────
      const submit = await this._withRetry(() =>
        axios.post(this.API_BASE, body, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://agnt.gg',
            'X-Title': 'AGNT Seedance Plugin',
          },
        })
      );

      const jobId = submit.data.id;
      const pollUrl = submit.data.polling_url || `${this.API_BASE}/${jobId}`;
      console.log(`[SeedancePlugin] Submitted job ${jobId}, polling...`);

      // ─── 2. Poll until completion ───────────────────────────────
      const started = Date.now();
      let lastStatus = null;
      while (Date.now() - started < this.MAX_WAIT_MS) {
        await new Promise((r) => setTimeout(r, this.POLL_INTERVAL_MS));

        const poll = await axios.get(pollUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        lastStatus = poll.data.status;
        console.log(`[SeedancePlugin] Job ${jobId} status: ${lastStatus}`);

        if (lastStatus === 'completed') {
          // ─── 3. Download video bytes ──────────────────────────
          const contentUrl =
            poll.data.content_url ||
            poll.data.unsigned_urls?.[0] ||
            `${this.API_BASE}/${jobId}/content`;

          const videoRes = await axios.get(contentUrl, {
            headers: { Authorization: `Bearer ${apiKey}` },
            responseType: 'arraybuffer',
          });
          const videoBuffer = Buffer.from(videoRes.data);

          // ─── 4. Persist to user data directory ───────────────
          const userDataPath = process.env.USER_DATA_PATH || process.cwd();
          const outDir = path.join(
            userDataPath,
            'plugin-data',
            'seedance',
            String(workflowEngine?.userId ?? 'default')
          );
          await fs.mkdir(outDir, { recursive: true });

          // Ensure the output file always ends with .mp4, regardless of
          // whether the user supplied a filename. Preserves a user-supplied
          // .mp4 extension (case-insensitive) to avoid double extensions.
          let filename = params.filename || `clip_${randomUUID().slice(0, 8)}`;
          if (!/\.mp4$/i.test(filename)) {
            filename += '.mp4';
          }
          const filePath = path.join(outDir, filename);
          await fs.writeFile(filePath, videoBuffer);

          console.log(`[SeedancePlugin] Saved ${filePath} (${videoBuffer.length} bytes)`);

          return {
            success: true,
            filePath,
            filename,
            sizeBytes: videoBuffer.length,
            duration: body.duration,
            resolution: body.resolution,
            aspectRatio: body.aspect_ratio,
            jobId,
            cost: poll.data.usage?.cost ?? null,
            model: body.model,
            error: null,
          };
        }

        if (lastStatus === 'failed') {
          throw new Error(
            `Seedance job ${jobId} failed: ${poll.data.error || 'unknown error'}`
          );
        }
      }

      throw new Error(
        `Seedance job ${jobId} timed out after ${this.MAX_WAIT_MS / 1000}s ` +
        `(last status: ${lastStatus})`
      );
    } catch (error) {
      console.error('[SeedancePlugin] Error executing Seedance API:', error.message);
      return {
        success: false,
        filePath: null,
        error:
          error.response?.data?.error?.message ||
          error.response?.data?.error ||
          error.message,
      };
    }
  }

  async _withRetry(fn, attempt = 0) {
    try {
      return await fn();
    } catch (e) {
      const status = e.response?.status;
      const retryable = !status || status >= 500 || status === 429;
      if (retryable && attempt < this.MAX_RETRIES) {
        const wait = 1000 * 2 ** attempt;
        console.log(`[SeedancePlugin] Retry attempt ${attempt + 1} after ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        return this._withRetry(fn, attempt + 1);
      }
      throw e;
    }
  }
}

export default new SeedanceAPI();
