import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { requireApiKey, BASE_API_V1, parseExtra, atlasFetch, pollPrediction, uploadMedia, firstOutputUrl, downloadTo } from './_atlas-core.js';

function defaultProjectsDir() {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'AGNT', 'projects');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'AGNT', 'projects');
  return path.join(home, '.config', 'AGNT', 'projects');
}

function isWanImageToVideoModel(model) {
  const m = String(model || '').toLowerCase();
  return m.includes('/wan-2.7/image-to-video') || m.includes('/wan-2.5/image-to-video');
}

function normalizeResolution(resolution, wanMode) {
  if (!resolution) return undefined;
  const r = String(resolution).trim();
  if (wanMode && /^(720|1080)p$/i.test(r)) return r.toUpperCase();
  return r;
}

function normalizeSeed(seed) {
  if (seed === undefined || seed === null || seed === '') return undefined;
  const n = Number(seed);
  return Number.isFinite(n) ? n : undefined;
}

function boolParam(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(s);
}

function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

function extractLastFrame(videoPath, outputPath) {
  if (!videoPath) throw new Error('Cannot extract last frame: no local video path was produced.');
  if (!fs.existsSync(videoPath)) throw new Error('Cannot extract last frame: video file does not exist at ' + videoPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const attempts = [
    ['-y', '-sseof', '-0.1', '-i', videoPath, '-frames:v', '1', '-q:v', '2', outputPath],
    ['-y', '-sseof', '-1', '-i', videoPath, '-update', '1', '-q:v', '2', outputPath],
  ];

  let lastErr = null;
  for (const args of attempts) {
    try {
      execFileSync(ffmpegBin(), args, { stdio: 'pipe' });
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return outputPath;
      lastErr = new Error('ffmpeg completed but did not create a non-empty frame at ' + outputPath);
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error('Last-frame ffmpeg extraction failed: ' + (lastErr?.stderr?.toString() || lastErr?.message || String(lastErr)));
}

class AtlasVideoTool {
  constructor() { this.name = 'atlas-video'; }

  async execute(params) {
    try {
      const apiKey = requireApiKey(params);
      const {
        model,
        prompt,
        negativePrompt,
        firstFrameUrl,
        lastFrameUrl: inputLastFrameUrl,
        firstFramePath,
        image,
        lastImage,
        video,
        audio,
        audioUrl,
        duration,
        resolution,
        aspectRatio,
        promptExtend,
        generateAudio,
        seed,
        extraParams,
        pollTimeoutSec,
        saveToDisk,
        savePath,
        extractLastFrame: extractLastFrameParam,
        lastFramePath: requestedLastFramePath,
        uploadLastFrame,
      } = params;

      if (!model) throw new Error('Parameter "model" is required');

      const wanMode = isWanImageToVideoModel(model);
      let firstUrl = firstFrameUrl || image;
      if (!firstUrl && firstFramePath) {
        const up = await uploadMedia(firstFramePath, apiKey);
        firstUrl = up.url;
      }

      if (wanMode && !firstUrl) {
        throw new Error('Atlas model ' + model + ' requires a first-frame image URL. Provide firstFrameUrl, image, or firstFramePath. Wan expects the request field named "image".');
      }
      if (!prompt && !wanMode) throw new Error('Parameter "prompt" is required');

      const finalLastImage = inputLastFrameUrl || lastImage;
      const finalAudio = audio || audioUrl;
      const finalSeed = normalizeSeed(seed);
      const finalResolution = normalizeResolution(resolution, wanMode);

      const body = {
        model,
        ...(prompt ? { prompt } : {}),
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
        ...(firstUrl ? { image: firstUrl, image_url: firstUrl, first_frame_url: firstUrl } : {}),
        ...(finalLastImage ? { last_image: finalLastImage, last_frame_url: finalLastImage, last_image_url: finalLastImage } : {}),
        ...(video ? { video } : {}),
        ...(finalAudio ? { audio: finalAudio, audio_url: finalAudio } : {}),
        ...(duration ? { duration: Number(duration) } : {}),
        ...(finalResolution ? { resolution: finalResolution } : {}),
        ...(aspectRatio && !wanMode ? { aspect_ratio: aspectRatio } : {}),
        ...(promptExtend !== undefined ? { prompt_extend: boolParam(promptExtend) } : (wanMode ? { prompt_extend: true } : {})),
        ...(boolParam(generateAudio, false) ? { generate_audio: true } : {}),
        ...(finalSeed !== undefined ? { seed: finalSeed } : (wanMode ? { seed: -1 } : {})),
        ...parseExtra(extraParams),
      };

      const submit = await atlasFetch(`${BASE_API_V1}/model/generateVideo`, { apiKey, body });
      const predictionId = submit?.data?.id || submit?.id;
      if (!predictionId) throw new Error(`No prediction ID returned: ${JSON.stringify(submit)}`);

      let data;
      try {
        data = await pollPrediction(predictionId, apiKey, Number(pollTimeoutSec || 600), 5000);
      } catch (pollErr) {
        // Return a structured result so downstream nodes can see predictionId/error
        // instead of the whole workflow failing with no usable outputs.
        return {
          predictionId,
          status: 'failed',
          videoUrl: null,
          savedPath: null,
          lastFramePath: null,
          lastFrameUrl: null,
          lastFrameError: null,
          lastFrameDiagnostics: null,
          durationSec: null,
          cost: null,
          raw: submit,
          error: pollErr.message,
        };
      }
      const videoUrl = firstOutputUrl(data);
      if (!videoUrl) {
        return {
          predictionId,
          status: data.status || 'completed_without_video_url',
          videoUrl: null,
          savedPath: null,
          lastFramePath: null,
          lastFrameUrl: null,
          lastFrameError: null,
          lastFrameDiagnostics: null,
          durationSec: data?.duration || Number(duration) || null,
          cost: data?.cost || data?.price || null,
          raw: data,
          error: `No video URL in completed prediction: ${JSON.stringify(data)}`,
        };
      }

      const shouldExtractLastFrame = boolParam(extractLastFrameParam, true);
      const shouldSaveVideo = boolParam(saveToDisk, false) || shouldExtractLastFrame;

      let savedPath = null;
      if (shouldSaveVideo) {
        const out = savePath || path.join(defaultProjectsDir(), `atlas-video-${predictionId}.mp4`);
        await downloadTo(videoUrl, out);
        savedPath = out;
      }

      let extractedLastFramePath = null;
      let uploadedLastFrameUrl = null;
      let lastFrameError = null;
      const lastFrameDiagnostics = {
        requestedExtractLastFrame: extractLastFrameParam,
        shouldExtractLastFrame,
        requestedUploadLastFrame: uploadLastFrame,
        shouldUploadLastFrame: boolParam(uploadLastFrame, false),
        requestedGenerateAudio: generateAudio,
        shouldGenerateAudio: boolParam(generateAudio, false),
        savedPath,
      };

      if (shouldExtractLastFrame) {
        const framePath = requestedLastFramePath || path.join(defaultProjectsDir(), `atlas-video-${predictionId}-last-frame.jpg`);
        lastFrameDiagnostics.targetFramePath = framePath;
        try {
          extractedLastFramePath = extractLastFrame(savedPath, framePath);
          lastFrameDiagnostics.extracted = true;
          lastFrameDiagnostics.extractedSizeBytes = fs.existsSync(extractedLastFramePath) ? fs.statSync(extractedLastFramePath).size : 0;
        } catch (frameErr) {
          lastFrameDiagnostics.extracted = false;
          lastFrameError = frameErr.message;
        }

        if (extractedLastFramePath && boolParam(uploadLastFrame, false)) {
          try {
            const up = await uploadMedia(extractedLastFramePath, apiKey);
            uploadedLastFrameUrl = up.url;
            lastFrameDiagnostics.uploaded = true;
            lastFrameDiagnostics.uploadRaw = up.raw;
          } catch (uploadErr) {
            lastFrameDiagnostics.uploaded = false;
            lastFrameError = [lastFrameError, 'Last-frame upload failed: ' + uploadErr.message].filter(Boolean).join(' | ');
          }
        }
      }

      return {
        predictionId,
        status: data.status || 'completed',
        videoUrl,
        savedPath,
        lastFramePath: extractedLastFramePath,
        lastFrameUrl: uploadedLastFrameUrl,
        lastFrameError,
        lastFrameDiagnostics,
        durationSec: data?.duration || Number(duration) || null,
        cost: data?.cost || data?.price || null,
        raw: data,
      };
    } catch (error) {
      console.error('[atlas-video] Error:', error);
      return { error: error.message };
    }
  }
}

export default new AtlasVideoTool();
