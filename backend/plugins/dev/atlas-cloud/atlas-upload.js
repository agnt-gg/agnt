import { requireApiKey, uploadMedia } from './_atlas-core.js';

class AtlasUploadTool {
  constructor() { this.name = 'atlas-upload'; }
  async execute(params) {
    try {
      const apiKey = requireApiKey(params);
      if (!params.filePath) throw new Error('Parameter "filePath" is required');
      const { url, raw } = await uploadMedia(params.filePath, apiKey);
      return { url, raw };
    } catch (error) {
      console.error('[atlas-upload] Error:', error);
      return { error: error.message };
    }
  }
}

export default new AtlasUploadTool();
