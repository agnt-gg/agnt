import path from 'path';
import os from 'os';
import fs from 'fs';
import { requireApiKey, BASE_API_V1, parseExtra, atlasFetch, pollPrediction, firstOutputUrl, allOutputUrls, downloadTo } from './_atlas-core.js';

function agntImagesDir() {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'AGNT', 'Data', 'images');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'AGNT', 'Data', 'images');
  return path.join(home, '.config', 'AGNT', 'Data', 'images');
}

class AtlasImageTool {
  constructor() { this.name = 'atlas-image'; }
  async execute(params) {
    try {
      const apiKey = requireApiKey(params);
      const { model, prompt, imageUrl, size, aspectRatio, outputFormat, maxImages, seed, extraParams, pollTimeoutSec, saveToDisk } = params;
      if (!model) throw new Error('Parameter "model" is required');
      if (!prompt) throw new Error('Parameter "prompt" is required');
      // openai/gpt-image-2-developer/* expects only `prompt` at top level. Sending
      // size/aspect_ratio/output_format/max_images/seed causes the upstream model
      // to emit a response shape Atlas's Go parser cannot unmarshal, surfacing as
      // HTTP 500 "cannot unmarshal string into Go struct field *** of type int"
      // during polling. Strip extras for this model family; user can still pass
      // anything via extraParams JSON if a future variant accepts more fields.
      const isMinimalParamsModel = /(^|\/)openai\/gpt-image-2/i.test(String(model));
      const extras = parseExtra(extraParams);
      const body = isMinimalParamsModel
        ? {
            model,
            prompt,
            ...(imageUrl ? { image_url: imageUrl, reference_images: [imageUrl] } : {}),
            ...extras,
          }
        : {
            model,
            prompt,
            ...(size ? { size } : {}),
            ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
            ...(outputFormat ? { output_format: outputFormat } : {}),
            ...(maxImages ? { max_images: Number(maxImages) } : {}),
            ...(seed ? { seed: Number(seed) } : {}),
            ...(imageUrl ? { image_url: imageUrl, reference_images: [imageUrl] } : {}),
            ...extras,
          };
      const submit = await atlasFetch(`${BASE_API_V1}/model/generateImage`, { apiKey, body });
      const predictionId = submit?.data?.id || submit?.id;
      if (!predictionId) throw new Error(`No prediction ID returned: ${JSON.stringify(submit)}`);
      const data = await pollPrediction(predictionId, apiKey, Number(pollTimeoutSec || 180), 2000);
      const url = firstOutputUrl(data);
      const urls = allOutputUrls(data);
      if (!url) throw new Error(`No image URL in completed prediction: ${JSON.stringify(data)}`);
      let savedPath = null, imageRef = null;
      if (saveToDisk && url) {
        const ext = (outputFormat || 'png').toLowerCase();
        const imgId = `img-atlas-${predictionId}`;
        const dir = agntImagesDir();
        fs.mkdirSync(dir, { recursive: true });
        savedPath = path.join(dir, `${imgId}.${ext}`);
        await downloadTo(url, savedPath);
        imageRef = `{{IMAGE_REF:${imgId}}}`;
      }
      return { predictionId, status: data.status || 'completed', imageUrl: url, imageUrls: urls, imageRef, savedPath };
    } catch (error) {
      console.error('[atlas-image] Error:', error);
      return { error: error.message };
    }
  }
}

export default new AtlasImageTool();
