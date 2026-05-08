import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * Seedance 2.0 Video Generation Plugin (v1.1.0)
 *
 * Generates cinematic AI video clips via ByteDance Seedance 2.0 on OpenRouter.
 * Async workflow: submit generation job -> poll status -> download MP4.
 *
 * v1.1 adds multimodal reference inputs (PRD-061):
 *   - referenceImageUrls (≤9), referenceVideoUrls (≤3), referenceAudioUrls (≤3)
 *   - referencePayloadMode: openrouter-normalized | provider-lists | content-array | raw-only | auto
 *   - rawPassthroughJson escape hatch (merged last)
 *   - seed, includeDebugRequest
 *   - returns contentUrl / unsignedUrl / pollUrl / referenceSummary / requestShape / debugRequest
 *
 * Auth: OpenRouter bearer token injected as params.__auth.token by PluginManager.
 */
class SeedanceAPI {
  constructor() {
    this.name = 'seedance-api';
    this.API_BASE = 'https://openrouter.ai/api/v1/videos';
    this.MODELS_URL = 'https://openrouter.ai/api/v1/videos/models';
    this.POLL_INTERVAL_MS = 10_000;
    this.MAX_WAIT_MS = 10 * 60 * 1000;
    this.MAX_RETRIES = 3;

    // Reference input limits (per ByteDance Seedance 2.0 spec).
    this.MAX_REFERENCE_IMAGES = 9;
    this.MAX_REFERENCE_VIDEOS = 3;
    this.MAX_REFERENCE_AUDIO = 3;
    this.MAX_TOTAL_REFERENCES = 12;
  }

  // ───────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────

  /**
   * Accepts arrays or textarea strings (newline- and/or comma-separated).
   * Returns a deduped, trimmed list of non-empty strings.
   */
  parseUrlList(value) {
    if (!value) return [];
    const raw = Array.isArray(value)
      ? value.map(String)
      : String(value).split(/[\n,]+/);
    const seen = new Set();
    const out = [];
    for (const item of raw) {
      const s = String(item).trim();
      if (!s) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  /**
   * Validate reference URL counts and shape. Throws Error with an actionable
   * message before any paid provider call is made.
   */
  validateReferences({ images, videos, audios, hasFrame }) {
    if (images.length > this.MAX_REFERENCE_IMAGES) {
      throw new Error(`Seedance reference input limit exceeded: image references support at most ${this.MAX_REFERENCE_IMAGES} URLs.`);
    }
    if (videos.length > this.MAX_REFERENCE_VIDEOS) {
      throw new Error(`Seedance reference input limit exceeded: video references support at most ${this.MAX_REFERENCE_VIDEOS} URLs.`);
    }
    if (audios.length > this.MAX_REFERENCE_AUDIO) {
      throw new Error(`Seedance reference input limit exceeded: audio references support at most ${this.MAX_REFERENCE_AUDIO} URLs.`);
    }
    if (images.length + videos.length + audios.length > this.MAX_TOTAL_REFERENCES) {
      throw new Error(`Seedance reference input limit exceeded: total references support at most ${this.MAX_TOTAL_REFERENCES} URLs.`);
    }

    if (audios.length > 0 && !hasFrame && images.length === 0 && videos.length === 0) {
      throw new Error('Reference audio cannot be used alone. Add at least one image, video, first frame, or last frame reference.');
    }

    const allRefs = [...images, ...videos, ...audios];
    for (const url of allRefs) {
      if (!/^https?:\/\//i.test(url)) {
        throw new Error(`Reference URL must be public http(s): ${url}.`);
      }
    }
  }

  /**
   * Parse rawPassthroughJson. Returns null when empty/undefined; throws on
   * non-object JSON (arrays, scalars, or invalid syntax).
   */
  parseRawPassthrough(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value;

    let parsed;
    try {
      parsed = JSON.parse(String(value));
    } catch (err) {
      throw new Error(`rawPassthroughJson must be valid JSON: ${err.message}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('rawPassthroughJson must be a JSON object.');
    }
    return parsed;
  }

  /**
   * Shorten a URL for debug output: drop query string (which may carry signed
   * auth tokens) and truncate the path to the first two segments.
   */
  redactUrl(url) {
    try {
      const u = new URL(url);
      const segments = u.pathname.split('/').filter(Boolean).slice(0, 2);
      const truncated = segments.length ? `/${segments.join('/')}/...` : '/...';
      return `${u.origin}${truncated}`;
    } catch {
      return '[invalid-url]';
    }
  }

  /**
   * URL basename for human-readable summary output.
   */
  urlBasename(url) {
    try {
      const u = new URL(url);
      const last = u.pathname.split('/').filter(Boolean).pop() || u.host;
      return last;
    } catch {
      return '[invalid-url]';
    }
  }

  /**
   * Detect whether the prompt mentions any of the provider's reference
   * conventions. Used to warn (not block) when references are submitted but
   * not addressed in the prompt.
   */
  promptMentionsReferences(prompt) {
    if (!prompt) return false;
    return /\[(?:Image|Video|Audio)\d*\]|@(?:Image|Video|Audio)\d*/i.test(prompt);
  }

  // ───────────────────────────────────────────────────────────────────
  // Request body construction
  // ───────────────────────────────────────────────────────────────────

  /**
   * Core body shared by every payload mode (model + prompt + duration etc.).
   */
  buildCoreBody(params) {
    return {
      model: params.useFastTier === 'Yes'
        ? 'bytedance/seedance-2.0-fast'
        : 'bytedance/seedance-2.0',
      prompt: params.prompt,
      duration: Number(params.duration) || 5,
      resolution: params.resolution || '1080p',
      aspect_ratio: params.aspectRatio || '9:16',
      generate_audio: params.generateAudio === 'Yes',
    };
  }

  /**
   * Apply first/last-frame image conditioning. Behavior is identical to
   * v1.0.0 to preserve backwards compatibility.
   */
  applyFrameImages(body, params) {
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
  }

  /**
   * Mode A — OpenRouter normalized: reference_images / reference_videos /
   * reference_audios arrays of typed entries.
   */
  applyOpenRouterNormalized(body, refs) {
    const { images, videos, audios } = refs;
    if (images.length) {
      body.reference_images = images.map((url) => ({
        type: 'image_url',
        image_url: { url },
      }));
    }
    if (videos.length) {
      body.reference_videos = videos.map((url) => ({
        type: 'video_url',
        video_url: { url },
      }));
    }
    if (audios.length) {
      body.reference_audios = audios.map((url) => ({
        type: 'audio_url',
        audio_url: { url },
      }));
    }
  }

  /**
   * Mode B — Provider lists: image_urls / video_urls / audio_urls (fal.ai /
   * Replicate native shape).
   */
  applyProviderLists(body, refs) {
    const { images, videos, audios } = refs;
    if (images.length) body.image_urls = images;
    if (videos.length) body.video_urls = videos;
    if (audios.length) body.audio_urls = audios;
  }

  /**
   * Mode C — Content array: a multimodal `content` array with role labels
   * for providers that expect chat-like multimodal payloads.
   */
  applyContentArray(body, refs, params) {
    const { images, videos, audios } = refs;
    body.content = [
      { type: 'text', text: params.prompt },
      ...images.map((url) => ({ type: 'image_url', image_url: { url }, role: 'reference_image' })),
      ...videos.map((url) => ({ type: 'video_url', video_url: { url }, role: 'reference_video' })),
      ...audios.map((url) => ({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })),
    ];
  }

  /**
   * Construct the final request body for the chosen payload mode.
   * Merge order: core → frame_images → references → seed → rawPassthroughJson.
   * rawPassthroughJson wins on key conflicts (advanced escape hatch).
   *
   * Returns { body, requestShape } where requestShape is the mode actually used.
   */
  buildRequestBody(params, mode, refs, rawPassthrough) {
    const body = this.buildCoreBody(params);
    this.applyFrameImages(body, params);

    let requestShape;
    switch (mode) {
      case 'provider-lists':
        this.applyProviderLists(body, refs);
        requestShape = 'provider-lists';
        break;
      case 'content-array':
        this.applyContentArray(body, refs, params);
        requestShape = 'content-array';
        break;
      case 'raw-only':
        // Skip generated reference fields — only rawPassthroughJson contributes.
        requestShape = 'raw-only';
        break;
      case 'openrouter-normalized':
      default:
        this.applyOpenRouterNormalized(body, refs);
        requestShape = 'openrouter-normalized';
        break;
    }

    if (params.seed != null && params.seed !== '') {
      const n = Number(params.seed);
      if (Number.isFinite(n)) body.seed = n;
    }

    if (rawPassthrough) {
      Object.assign(body, rawPassthrough);
    }

    return { body, requestShape };
  }

  /**
   * Produce a redacted copy of the request body for debug output.
   */
  redactRequestBody(body) {
    const clone = JSON.parse(JSON.stringify(body));
    const redactList = (arr, key) => {
      if (!Array.isArray(arr)) return;
      for (const entry of arr) {
        if (entry && typeof entry === 'object' && entry[key]?.url) {
          entry[key].url = this.redactUrl(entry[key].url);
        }
      }
    };
    redactList(clone.frame_images, 'image_url');
    redactList(clone.reference_images, 'image_url');
    redactList(clone.reference_videos, 'video_url');
    redactList(clone.reference_audios, 'audio_url');
    if (Array.isArray(clone.image_urls)) clone.image_urls = clone.image_urls.map((u) => this.redactUrl(u));
    if (Array.isArray(clone.video_urls)) clone.video_urls = clone.video_urls.map((u) => this.redactUrl(u));
    if (Array.isArray(clone.audio_urls)) clone.audio_urls = clone.audio_urls.map((u) => this.redactUrl(u));
    if (Array.isArray(clone.content)) {
      for (const item of clone.content) {
        if (item?.image_url?.url) item.image_url.url = this.redactUrl(item.image_url.url);
        if (item?.video_url?.url) item.video_url.url = this.redactUrl(item.video_url.url);
        if (item?.audio_url?.url) item.audio_url.url = this.redactUrl(item.audio_url.url);
      }
    }
    return clone;
  }

  /**
   * Capability discovery. Best-effort; never blocks generation. Used
   * primarily during integration testing and the optional debug envelope.
   */
  async getVideoModelCapabilities(apiKey, model) {
    try {
      const res = await axios.get(this.MODELS_URL, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 5000,
      });
      const all = res.data?.data || res.data?.models || res.data || [];
      if (!model) return all;
      if (!Array.isArray(all)) return all;
      return all.find((m) => m?.id === model || m?.name === model) || null;
    } catch (err) {
      console.warn('[SeedancePlugin] Capability discovery failed (non-fatal):', err.message);
      return null;
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Submit + poll
  // ───────────────────────────────────────────────────────────────────

  /**
   * Submit the generation job. Returns { submit, body, requestShape, modeUsed }.
   * Implements `auto` retry: if openrouter-normalized fails with a pre-job
   * 400 that names unknown reference fields, retry once with provider-lists.
   * Never retries after a job ID is returned.
   */
  async submitJob(apiKey, params, refs, rawPassthrough, requestedMode) {
    const tried = [];

    const attempt = async (mode) => {
      const { body, requestShape } = this.buildRequestBody(params, mode, refs, rawPassthrough);
      tried.push(requestShape);
      try {
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
        return { submit, body, requestShape };
      } catch (err) {
        // Bubble up so the caller can inspect status / decide on retry.
        err.__attemptedShape = requestShape;
        err.__attemptedBody = body;
        throw err;
      }
    };

    const isUnknownFieldError = (err) => {
      if (err?.response?.status !== 400) return false;
      const data = err.response?.data || {};
      const text = JSON.stringify(data).toLowerCase();
      // Heuristic: "unknown", "unrecognized", "invalid_field", or mentions of
      // reference_* / *_urls keys in the error payload.
      return /unknown|unrecognized|invalid[_ ]field|not allowed|unsupported/.test(text)
        && /(reference_|_urls|video|audio|image)/.test(text);
    };

    if (requestedMode === 'auto') {
      try {
        const result = await attempt('openrouter-normalized');
        return { ...result, modeRequested: 'auto', modesTried: tried };
      } catch (err) {
        if (isUnknownFieldError(err) && (refs.images.length || refs.videos.length || refs.audios.length)) {
          console.warn('[SeedancePlugin] auto: openrouter-normalized rejected unknown reference fields — retrying with provider-lists');
          const result = await attempt('provider-lists');
          return { ...result, modeRequested: 'auto', modesTried: tried };
        }
        throw err;
      }
    }

    const result = await attempt(requestedMode || 'openrouter-normalized');
    return { ...result, modeRequested: requestedMode || 'openrouter-normalized', modesTried: tried };
  }

  // ───────────────────────────────────────────────────────────────────
  // Main entry
  // ───────────────────────────────────────────────────────────────────

  async execute(params, inputData, workflowEngine) {
    const referenceImageUrls = this.parseUrlList(params.referenceImageUrls);
    const referenceVideoUrls = this.parseUrlList(params.referenceVideoUrls);
    const referenceAudioUrls = this.parseUrlList(params.referenceAudioUrls);
    const refs = { images: referenceImageUrls, videos: referenceVideoUrls, audios: referenceAudioUrls };
    const requestedMode = params.referencePayloadMode || 'auto';
    const debugRequested = params.includeDebugRequest === 'Yes';

    console.log('[SeedancePlugin] Executing Seedance API with params:', JSON.stringify({
      duration: params.duration,
      resolution: params.resolution,
      aspectRatio: params.aspectRatio,
      useFastTier: params.useFastTier,
      generateAudio: params.generateAudio,
      hasFirstFrame: !!params.firstFrameUrl,
      hasLastFrame: !!params.lastFrameUrl,
      referenceImageCount: referenceImageUrls.length,
      referenceVideoCount: referenceVideoUrls.length,
      referenceAudioCount: referenceAudioUrls.length,
      referencePayloadMode: requestedMode,
      hasRawPassthrough: !!params.rawPassthroughJson,
      hasSeed: params.seed != null && params.seed !== '',
      includeDebugRequest: debugRequested,
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

      // ─── 0. Pre-submit validation ───────────────────────────────
      this.validateReferences({
        images: referenceImageUrls,
        videos: referenceVideoUrls,
        audios: referenceAudioUrls,
        hasFrame: !!params.firstFrameUrl || !!params.lastFrameUrl,
      });

      const rawPassthrough = this.parseRawPassthrough(params.rawPassthroughJson);

      const totalRefs = referenceImageUrls.length + referenceVideoUrls.length + referenceAudioUrls.length;
      const referenceSummary = {
        imageCount: referenceImageUrls.length,
        videoCount: referenceVideoUrls.length,
        audioCount: referenceAudioUrls.length,
        totalCount: totalRefs,
        imageNames: referenceImageUrls.map((u) => this.urlBasename(u)),
        videoNames: referenceVideoUrls.map((u) => this.urlBasename(u)),
        audioNames: referenceAudioUrls.map((u) => this.urlBasename(u)),
        warnings: [],
      };
      if (totalRefs > 0 && !this.promptMentionsReferences(params.prompt)) {
        referenceSummary.warnings.push(
          'References supplied but the prompt does not address any of them with [Image1]/[Video1]/[Audio1] or @Image1/@Video1/@Audio1. Models may ignore them. See plugin README for prompt conventions.'
        );
      }

      // ─── 1. Submit generation job (with auto-retry) ─────────────
      const { submit, body, requestShape } = await this.submitJob(
        apiKey,
        params,
        refs,
        rawPassthrough,
        requestedMode
      );

      const jobId = submit.data.id;
      const pollUrl = submit.data.polling_url || `${this.API_BASE}/${jobId}`;
      console.log(`[SeedancePlugin] Submitted job ${jobId} (shape=${requestShape}), polling...`);

      const debugRequest = debugRequested ? this.redactRequestBody(body) : null;

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
          // ─── 3. Resolve content URLs ─────────────────────────
          const reportedContentUrl = poll.data.content_url || null;
          const reportedUnsignedUrl = poll.data.unsigned_urls?.[0] || null;
          const downloadUrl =
            reportedContentUrl ||
            reportedUnsignedUrl ||
            `${this.API_BASE}/${jobId}/content`;

          // ─── 4. Download video bytes ─────────────────────────
          const videoRes = await axios.get(downloadUrl, {
            headers: { Authorization: `Bearer ${apiKey}` },
            responseType: 'arraybuffer',
          });
          const videoBuffer = Buffer.from(videoRes.data);

          // ─── 5. Persist to user data directory ───────────────
          const userDataPath = process.env.USER_DATA_PATH || process.cwd();
          const outDir = path.join(
            userDataPath,
            'plugin-data',
            'seedance',
            String(workflowEngine?.userId ?? 'default')
          );
          await fs.mkdir(outDir, { recursive: true });

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
            contentUrl: reportedContentUrl,
            unsignedUrl: reportedUnsignedUrl,
            pollUrl,
            referenceSummary,
            requestShape,
            debugRequest,
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

      const providerMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.error ||
        error.message;

      let message = providerMessage || error.message;
      // Surface a hint when the provider rejected the reference payload so
      // users know to switch payload mode rather than retry blindly.
      if (error?.response?.status === 400 && /(reference_|_urls|video|audio|image)/i.test(JSON.stringify(error.response.data || {}))) {
        const mode = error.__attemptedShape || 'unknown';
        message = `${message}\n[Hint] OpenRouter/Seedance rejected the reference payload (mode=${mode}). Try referencePayloadMode=provider-lists, content-array, or raw-only with rawPassthroughJson, and inspect debugRequest for the exact body.`;
      }

      return {
        success: false,
        filePath: null,
        contentUrl: null,
        unsignedUrl: null,
        pollUrl: null,
        referenceSummary: null,
        requestShape: error.__attemptedShape || null,
        debugRequest: null,
        error: message,
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
