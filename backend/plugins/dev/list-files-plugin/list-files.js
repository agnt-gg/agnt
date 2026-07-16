import { readdir, stat } from 'fs/promises';
import path from 'path';

class ListFilesPlugin {
  constructor() {
    this.name = 'list-files';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[list-files-plugin] Executing with params:', JSON.stringify(params, null, 2));

    const extensionFilter = params.extensionFilter
      ? params.extensionFilter.trim().replace(/^\./, '').toLowerCase()
      : '';
    const includeHidden = typeof params.includeHidden === 'boolean' ? params.includeHidden : false;

    try {
      const currentDir = process.cwd();
      const entries = await readdir(currentDir, { withFileTypes: true });
      const files = [];

      for (const entry of entries) {
        // Handle hidden files
        if (!includeHidden && entry.name.startsWith('.')) {
          continue;
        }

        // Full path for stat
        const fullPath = path.join(currentDir, entry.name);

        // Stat the entry to get size and last modified
        let fileStat;
        try {
          fileStat = await stat(fullPath);
        } catch (error) {
          console.warn(`[list-files-plugin] Could not stat "${entry.name}":`, error.message);
          continue;
        }

        // If extensionFilter is set, apply the filter (only to files, not directories)
        if (
          extensionFilter &&
          !entry.isDirectory() &&
          !entry.name.toLowerCase().endsWith('.' + extensionFilter)
        ) {
          continue;
        }

        files.push({
          name: entry.name,
          size: fileStat.size,
          isDirectory: entry.isDirectory(),
          lastModified: fileStat.mtime.toISOString(),
        });
      }

      return {
        files: files,
        success: true,
        error: null,
      };
    } catch (error) {
      console.error('[list-files-plugin] Error:', error);
      return {
        files: [],
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  }
}

export default new ListFilesPlugin();