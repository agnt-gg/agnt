import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import PathManager from './PathManager.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

class YouTubeCaptionExtractor {
  constructor() {
    this.cookiesPath = PathManager.getPath('cookies.txt');
    // Ensure cookies.txt exists in user data
    this.initCookies();
  }

  async initCookies() {
    // Try to copy from source if exists
    if (!fs.existsSync(this.cookiesPath)) {
      try {
        const sourceCookies = PathManager.getSourcePath('src/cookies.txt');
        if (fs.existsSync(sourceCookies)) {
          await fs.promises.copyFile(sourceCookies, this.cookiesPath);
        }
      } catch (e) {
        console.error('Failed to init cookies.txt', e);
      }
    }
  }

  /**
   * Extract video ID from YouTube URL
   */
  extractVideoId(url) {
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname.includes('youtube.com')) {
        return urlObj.searchParams.get('v');
      } else if (urlObj.hostname.includes('youtu.be')) {
        return urlObj.pathname.substring(1);
      }
    } catch (e) {
      console.error('Invalid URL:', e.message);
    }
    return null;
  }

  /**
   * Check if cookies.txt exists and warn if not
   */
  checkCookies() {
    const cookiesExist = fs.existsSync(this.cookiesPath);
    if (!cookiesExist) {
      console.warn('[yt-dlp] Warning: cookies.txt not found at', this.cookiesPath);
      console.warn('[yt-dlp] YouTube downloads may fail with 403 errors without cookies.');
    } else {
      try {
        const stats = fs.statSync(this.cookiesPath);
        console.log(`[yt-dlp] Found cookies.txt file (size: ${stats.size} bytes, modified: ${stats.mtime})`);
      } catch (err) {
        console.warn('[yt-dlp] Error checking cookies.txt:', err.message);
      }
    }
    return cookiesExist;
  }

  /**
   * Get cookies arguments for yt-dlp
   */
  getCookiesArgs() {
    return this.checkCookies() ? ['--cookies', this.cookiesPath] : [];
  }

  /**
   * Regenerate cookies using yt-dlp
   */
  async regenerateCookies() {
    try {
      console.log('[yt-dlp] Regenerating cookies...');
      // First, try to extract cookies by accessing a video page
      const { stdout, stderr } = await execFileAsync('yt-dlp', [
        '--cookies',
        this.cookiesPath,
        '--skip-download',
        '--no-warnings',
        '--print',
        'id',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      ]);

      console.log('[yt-dlp] Cookies regenerated successfully');
      return true;
    } catch (error) {
      console.error('[yt-dlp] Failed to regenerate cookies:', error.message);
      return false;
    }
  }

  /**
   * Parse VTT content to extract clean text
   */
  parseVTTContent(vttContent) {
    const lines = vttContent.split('\n');
    let captionText = [];
    let inCue = false;
    let lastLine = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line === 'WEBVTT' || line.startsWith('NOTE ')) continue;

      if (line.includes('-->')) {
        inCue = true;
        continue;
      }

      if (inCue && line) {
        let cleanedLine = line
          .replace(/<[^>]*>/g, '') // Remove HTML tags
          .replace(/\[.*?\]/g, '') // Remove [music], [applause], etc.
          .replace(/&nbsp;/g, ' ') // Replace HTML entities
          .replace(/\([^)]*\)/g, '') // Remove (background noise), etc.
          .trim();

        if (cleanedLine && cleanedLine !== lastLine) {
          captionText.push(cleanedLine);
          lastLine = cleanedLine;
        }

        if (!lines[i + 1] || lines[i + 1].includes('-->')) {
          inCue = false;
        }
      }
    }

    return captionText.join(' ');
  }

  /**
   * Parse SRT content to extract clean text
   */
  parseSRTContent(srtContent) {
    const lines = srtContent.split('\n');
    let captionText = [];
    let lastLine = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip sequence numbers and timestamps
      if (!line || /^\d+$/.test(line) || line.includes('-->')) continue;

      let cleanedLine = line
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/\[.*?\]/g, '') // Remove [music], [applause], etc.
        .replace(/&nbsp;/g, ' ') // Replace HTML entities
        .replace(/\([^)]*\)/g, '') // Remove (background noise), etc.
        .trim();

      if (cleanedLine && cleanedLine !== lastLine) {
        captionText.push(cleanedLine);
        lastLine = cleanedLine;
      }
    }

    return captionText.join(' ');
  }

  /**
   * Check if video has available subtitles
   */
  async checkAvailableSubtitles(youtubeUrl) {
    const cookiesArgs = this.getCookiesArgs();
    const listSubsArgs = [...cookiesArgs, '--list-subs', '--skip-download', youtubeUrl];

    try {
      console.log(`[yt-dlp] Checking available subtitles: yt-dlp ${listSubsArgs.join(' ')}`);
      const { stdout, stderr } = await execFileAsync('yt-dlp', listSubsArgs);

      console.log('[yt-dlp] Available subtitles info:');
      console.log('stdout:', stdout);
      if (stderr) {
        console.log('stderr:', stderr);
        // Check for cookie expiration warnings
        if (stderr.includes('cookies are no longer valid') || stderr.includes('cookies have expired')) {
          console.warn('[yt-dlp] YouTube cookies are expired or invalid. Attempting to regenerate...');
          const regenerated = await this.regenerateCookies();
          if (regenerated) {
            // Retry with new cookies
            console.log('[yt-dlp] Retrying with regenerated cookies...');
            const { stdout: retryStdout, stderr: retryStderr } = await execFileAsync('yt-dlp', listSubsArgs);
            if (retryStderr && (retryStderr.includes('cookies are no longer valid') || retryStderr.includes('cookies have expired'))) {
              console.warn('[yt-dlp] YouTube cookies still invalid after regeneration.');
              throw new Error('YouTube cookies are expired or invalid. Failed to regenerate valid cookies.');
            }
            console.log('[yt-dlp] Subtitle check successful with regenerated cookies');
            console.log('stdout:', retryStdout);
            if (retryStdout.includes('has no subtitles')) {
              return { hasSubtitles: false, info: retryStdout };
            }
            return { hasSubtitles: true, info: retryStdout };
          } else {
            throw new Error('YouTube cookies are expired or invalid. Failed to regenerate cookies.');
          }
        }
      }

      if (stdout.includes('has no subtitles')) {
        return { hasSubtitles: false, info: stdout };
      }

      return { hasSubtitles: true, info: stdout };
    } catch (error) {
      console.warn('[yt-dlp] Error checking subtitles list:', error.message);
      return { hasSubtitles: null, info: error.message };
    }
  }

  /**
   * Extract captions using yt-dlp with multiple fallback strategies
   */
  async extractCaptions(youtubeUrl) {
    console.log(`[yt-dlp] Starting caption extraction for: ${youtubeUrl}`);

    const tempDir = os.tmpdir();
    const uniquePrefix = `caption_extract_${Date.now()}`;
    const captionDir = path.join(tempDir, `${uniquePrefix}_captions`);

    try {
      // Create caption directory
      fs.mkdirSync(captionDir, { recursive: true });
      console.log(`[yt-dlp] Created caption directory: ${captionDir}`);

      const cookiesArgs = this.getCookiesArgs();

      // Check if subtitles are available first
      const subtitleCheck = await this.checkAvailableSubtitles(youtubeUrl);
      if (subtitleCheck.hasSubtitles === false) {
        throw new Error('Video has no subtitles according to yt-dlp');
      }

      // Use a simple approach without complex output templates
      const strategies = [
        {
          name: 'Auto + Manual VTT',
          args: [...cookiesArgs, '--skip-download', '--write-auto-sub', '--write-subs', '--sub-format', 'vtt', '--sub-lang', 'en', youtubeUrl],
          workingDir: captionDir,
        },
        {
          name: 'Manual only VTT',
          args: [...cookiesArgs, '--skip-download', '--write-subs', '--sub-format', 'vtt', '--sub-lang', 'en', youtubeUrl],
          workingDir: captionDir,
        },
        {
          name: 'Auto-generated only VTT',
          args: [...cookiesArgs, '--skip-download', '--write-auto-sub', '--sub-format', 'vtt', '--sub-lang', 'en', youtubeUrl],
          workingDir: captionDir,
        },
        {
          name: 'Simple VTT download',
          args: [...cookiesArgs, '--skip-download', '--write-sub', '--sub-format', 'vtt', '--sub-lang', 'en', youtubeUrl],
          workingDir: captionDir,
        },
        {
          name: 'SRT format fallback',
          args: [...cookiesArgs, '--skip-download', '--write-auto-sub', '--write-subs', '--sub-format', 'srt', '--sub-lang', 'en', youtubeUrl],
          workingDir: captionDir,
        },
      ];

      let captionContent = null;
      let usedStrategy = null;

      for (const strategy of strategies) {
        try {
          console.log(`[yt-dlp] Trying strategy: ${strategy.name}`);
          console.log(`[yt-dlp] Command: yt-dlp ${strategy.args.join(' ')}`);
          console.log(`[yt-dlp] Working directory: ${strategy.workingDir}`);

          // Try using Python module first
          try {
            console.log(`[yt-dlp] Attempting with Python module: python -m yt_dlp ${strategy.args.join(' ')}`);
            const { stdout: pyStdout, stderr: pyStderr } = await execAsync(`python -m yt_dlp ${strategy.args.join(' ')}`, {
              cwd: strategy.workingDir,
            });

            console.log(`[yt-dlp] Python module stdout:`, pyStdout);
            if (pyStderr) {
              console.log(`[yt-dlp] Python module stderr:`, pyStderr);
              // Check for cookie expiration warnings in stderr
              if (pyStderr.includes('cookies are no longer valid') || pyStderr.includes('cookies have expired')) {
                console.warn('[yt-dlp] YouTube cookies are expired or invalid during strategy execution. Attempting to regenerate...');
                const regenerated = await this.regenerateCookies();
                if (regenerated) {
                  // Retry with new cookies
                  console.log('[yt-dlp] Retrying with regenerated cookies...');
                  const { stdout: retryStdout, stderr: retryStderr } = await execAsync(`python -m yt_dlp ${strategy.args.join(' ')}`, {
                    cwd: strategy.workingDir,
                  });
                  if (retryStderr && (retryStderr.includes('cookies are no longer valid') || retryStderr.includes('cookies have expired'))) {
                    console.warn('[yt-dlp] YouTube cookies still invalid after regeneration.');
                    throw new Error('YouTube cookies are expired or invalid. Failed to regenerate valid cookies.');
                  }
                  console.log('[yt-dlp] Strategy successful with regenerated cookies');
                  console.log('stdout:', retryStdout);
                } else {
                  throw new Error('YouTube cookies are expired or invalid. Failed to regenerate cookies.');
                }
              }
            }
            console.log(`[yt-dlp] Python module command completed successfully for strategy: ${strategy.name}`);
          } catch (pythonError) {
            console.log(`[yt-dlp] Python module failed, falling back to standalone executable:`, pythonError.message);
            // Execute yt-dlp in the caption directory
            console.log(`[yt-dlp] Executing command: yt-dlp ${strategy.args.join(' ')}`);
            const { stdout, stderr } = await execFileAsync('yt-dlp', strategy.args, {
              cwd: strategy.workingDir,
            });

            console.log(`[yt-dlp] stdout:`, stdout);
            if (stderr) {
              console.log(`[yt-dlp] stderr:`, stderr);
              // Check for cookie expiration warnings in stderr
              if (stderr.includes('cookies are no longer valid') || stderr.includes('cookies have expired')) {
                console.warn('[yt-dlp] YouTube cookies are expired or invalid during strategy execution. Attempting to regenerate...');
                const regenerated = await this.regenerateCookies();
                if (regenerated) {
                  // Retry with new cookies
                  console.log('[yt-dlp] Retrying with regenerated cookies...');
                  const { stdout: retryStdout, stderr: retryStderr } = await execFileAsync('yt-dlp', strategy.args, {
                    cwd: strategy.workingDir,
                  });
                  if (retryStderr && (retryStderr.includes('cookies are no longer valid') || retryStderr.includes('cookies have expired'))) {
                    console.warn('[yt-dlp] YouTube cookies still invalid after regeneration.');
                    throw new Error('YouTube cookies are expired or invalid. Failed to regenerate valid cookies.');
                  }
                  console.log('[yt-dlp] Strategy successful with regenerated cookies');
                  console.log('stdout:', retryStdout);
                } else {
                  throw new Error('YouTube cookies are expired or invalid. Failed to regenerate cookies.');
                }
              }
            }
          }

          console.log(`[yt-dlp] Command completed successfully for strategy: ${strategy.name}`);

          // Check for created caption files
          const files = fs.readdirSync(captionDir);
          console.log(`[yt-dlp] Files in directory:`, files);

          const captionFiles = files.filter((file) => file.endsWith('.vtt') || file.endsWith('.srt'));

          if (captionFiles.length > 0) {
            console.log(`[yt-dlp] Strategy ${strategy.name} succeeded. Found files:`, captionFiles);

            // Use the first caption file found
            const captionFilePath = path.join(captionDir, captionFiles[0]);
            const rawContent = fs.readFileSync(captionFilePath, 'utf8');

            console.log(`[yt-dlp] Raw content length: ${rawContent.length}`);
            console.log(`[yt-dlp] First 200 chars:`, rawContent.substring(0, 200));

            // Parse based on file extension
            if (captionFiles[0].endsWith('.vtt')) {
              captionContent = this.parseVTTContent(rawContent);
            } else if (captionFiles[0].endsWith('.srt')) {
              captionContent = this.parseSRTContent(rawContent);
            }

            if (captionContent && captionContent.trim().length > 0) {
              usedStrategy = strategy.name;
              console.log(`[yt-dlp] Parsed content length: ${captionContent.length}`);
              break;
            } else {
              console.log(`[yt-dlp] Strategy ${strategy.name} produced empty content`);
            }
          } else {
            console.log(`[yt-dlp] Strategy ${strategy.name} produced no caption files`);
          }
        } catch (error) {
          console.log(`[yt-dlp] Strategy ${strategy.name} error:`, error.message);
          // If it's a cookie error, don't continue with other strategies
          if (error.message.includes('cookies are expired') || error.message.includes('cookies are invalid')) {
            throw error;
          }
          continue;
        }
      }

      // Clean up caption directory
      try {
        const files = fs.readdirSync(captionDir);
        files.forEach((file) => {
          fs.unlinkSync(path.join(captionDir, file));
        });
        fs.rmdirSync(captionDir);
        console.log(`[yt-dlp] Cleaned up caption directory`);
      } catch (cleanupError) {
        console.warn('[yt-dlp] Error cleaning up caption files:', cleanupError.message);
      }

      if (!captionContent) {
        throw new Error('All caption extraction strategies failed');
      }

      return {
        success: true,
        content: captionContent,
        method: `yt-dlp (${usedStrategy})`,
        length: captionContent.length,
      };
    } catch (error) {
      // Clean up on error
      try {
        if (fs.existsSync(captionDir)) {
          const files = fs.readdirSync(captionDir);
          files.forEach((file) => {
            fs.unlinkSync(path.join(captionDir, file));
          });
          fs.rmdirSync(captionDir);
        }
      } catch (cleanupError) {
        console.warn('[yt-dlp] Error cleaning up after failure:', cleanupError.message);
      }

      throw new Error(`Caption extraction failed: ${error.message}`);
    }
  }

  /**
   * Download audio for Whisper transcription
   */
  async downloadAudio(youtubeUrl) {
    const tempDir = os.tmpdir();
    const uniquePrefix = `audio_download_${Date.now()}`;
    const tempAudioName = `${uniquePrefix}_audio`;
    const tempAudioPathBase = path.join(tempDir, tempAudioName);

    const cookiesArgs = this.getCookiesArgs();
    const ytDlpArgs = [...cookiesArgs, '-f', 'bestaudio', '-o', `${tempAudioPathBase}.%(ext)s`, '--no-playlist', youtubeUrl];

    try {
      console.log(`[yt-dlp] Downloading audio: yt-dlp ${ytDlpArgs.join(' ')}`);
      const { stdout, stderr } = await execFileAsync('yt-dlp', ytDlpArgs);

      if (stderr && (stderr.includes('cookies are no longer valid') || stderr.includes('cookies have expired'))) {
        console.warn('[yt-dlp] YouTube cookies are expired or invalid during audio download. Attempting to regenerate...');
        const regenerated = await this.regenerateCookies();
        if (regenerated) {
          // Retry with new cookies
          console.log('[yt-dlp] Retrying audio download with regenerated cookies...');
          const { stdout: retryStdout, stderr: retryStderr } = await execFileAsync('yt-dlp', ytDlpArgs);
          if (retryStderr && (retryStderr.includes('cookies are no longer valid') || retryStderr.includes('cookies have expired'))) {
            console.warn('[yt-dlp] YouTube cookies still invalid after regeneration.');
            throw new Error('YouTube cookies are expired or invalid. Failed to regenerate valid cookies.');
          }
          console.log('[yt-dlp] Audio download successful with regenerated cookies');
          console.log('stdout:', retryStdout);
        } else {
          throw new Error('YouTube cookies are expired or invalid. Failed to regenerate cookies.');
        }
      } else if (stderr) {
        console.warn('[yt-dlp] Audio download messages:', stderr);
      }

      // Find the downloaded file
      const files = fs.readdirSync(tempDir);
      const downloadedFile = files.find((f) => f.startsWith(tempAudioName));

      if (!downloadedFile) {
        throw new Error(`Failed to find downloaded audio file starting with: ${tempAudioName}`);
      }

      const actualTempAudioPath = path.join(tempDir, downloadedFile);
      const fileSize = fs.statSync(actualTempAudioPath).size;

      console.log(`[yt-dlp] Audio downloaded successfully: ${actualTempAudioPath}`);
      console.log(`[yt-dlp] File size: ${Math.round((fileSize / (1024 * 1024)) * 100) / 100} MB`);

      return {
        success: true,
        filePath: actualTempAudioPath,
        fileSize: fileSize,
      };
    } catch (error) {
      throw new Error(`Audio download failed: ${error.message}`);
    }
  }

  /**
   * Get video duration using yt-dlp
   */
  async getVideoDuration(youtubeUrl) {
    const cookiesArgs = this.getCookiesArgs();

    try {
      const { stdout, stderr } = await execFileAsync('yt-dlp', [...cookiesArgs, '--skip-download', '--print', 'duration', youtubeUrl]);

      if (stderr && (stderr.includes('cookies are no longer valid') || stderr.includes('cookies have expired'))) {
        console.warn('[yt-dlp] YouTube cookies are expired or invalid during duration check. Attempting to regenerate...');
        const regenerated = await this.regenerateCookies();
        if (regenerated) {
          // Retry with new cookies
          console.log('[yt-dlp] Retrying duration check with regenerated cookies...');
          const { stdout: retryStdout, stderr: retryStderr } = await execFileAsync('yt-dlp', [
            ...cookiesArgs,
            '--skip-download',
            '--print',
            'duration',
            youtubeUrl,
          ]);
          if (retryStderr && (retryStderr.includes('cookies are no longer valid') || retryStderr.includes('cookies have expired'))) {
            console.warn('[yt-dlp] YouTube cookies still invalid after regeneration.');
            throw new Error('YouTube cookies are expired or invalid. Failed to regenerate valid cookies.');
          }
          console.log('[yt-dlp] Duration check successful with regenerated cookies');
          const durationSeconds = parseFloat(retryStdout.trim());
          return durationSeconds / 60; // Return duration in minutes
        } else {
          throw new Error('YouTube cookies are expired or invalid. Failed to regenerate cookies.');
        }
      }

      const durationSeconds = parseFloat(stdout.trim());
      return durationSeconds / 60; // Return duration in minutes
    } catch (error) {
      console.warn('[yt-dlp] Error getting video duration:', error.message);
      return null;
    }
  }
}

export default YouTubeCaptionExtractor;
