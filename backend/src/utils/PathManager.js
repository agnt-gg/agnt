import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PathManager {
  constructor() {
    // Determine the base user data path
    // In production (Electron), this is passed via env var
    // In development (Node), we fallback to a local 'data' directory or OS temp/home
    this.userDataPath = process.env.USER_DATA_PATH || path.join(process.cwd(), 'data');

    // Ensure user data path exists
    if (!fs.existsSync(this.userDataPath)) {
      try {
        fs.mkdirSync(this.userDataPath, { recursive: true });
      } catch (error) {
        console.error(`Failed to create user data directory at ${this.userDataPath}:`, error);
        // Fallback to temp dir if we can't write to current dir
        this.userDataPath = path.join(os.tmpdir(), 'agnt-data');
        if (!fs.existsSync(this.userDataPath)) {
          fs.mkdirSync(this.userDataPath, { recursive: true });
        }
      }
    }

    // Determine the source root (where the backend code lives)
    // In ASAR, this is inside the archive. In dev, it's the backend folder.
    // We assume this file is in src/utils/PathManager.js, so backend root is ../..
    this.backendRoot = path.resolve(__dirname, '../../');
  }

  /**
   * Get the path for writable user data.
   * @returns {string} Path to the writable data directory.
   */
  getUserDataPath() {
    return this.userDataPath;
  }

  /**
   * Get the path to a specific file or directory in user data.
   * @param {...string} parts - Path segments.
   * @returns {string} Joined path.
   */
  getPath(...parts) {
    return path.join(this.userDataPath, ...parts);
  }

  /**
   * Get the path to a source asset (read-only).
   * @param {...string} parts - Path segments relative to backend root.
   * @returns {string} Joined path.
   */
  getSourcePath(...parts) {
    return path.join(this.backendRoot, ...parts);
  }

  /**
   * Helper to ensure a resource exists in user data by copying it from source if missing.
   * Useful for initializing config files or databases.
   * @param {string} relativePath - Path relative to backend root/user data root.
   */
  async ensureFile(relativePath) {
    const targetPath = this.getPath(relativePath);
    if (!fs.existsSync(targetPath)) {
      const sourcePath = this.getSourcePath(relativePath);
      if (fs.existsSync(sourcePath)) {
        try {
          // Ensure target directory exists
          const targetDir = path.dirname(targetPath);
          if (!fs.existsSync(targetDir)) {
            await fs.promises.mkdir(targetDir, { recursive: true });
          }
          await fs.promises.copyFile(sourcePath, targetPath);
          console.log(`Initialized ${relativePath} in user data.`);
        } catch (error) {
          console.error(`Failed to copy ${relativePath} to user data:`, error);
        }
      }
    }
    return targetPath;
  }
}

export default new PathManager();
