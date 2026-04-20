import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Remotion Compose Plugin Tool
 *
 * Takes a shot-list of MP4 files + brand configuration, scaffolds a Remotion
 * React project, and renders a final branded MP4 with:
 *   - Seedance AI clips as B-roll
 *   - Typography overlays (title, CTA)
 *   - Color grade unification across clips
 *   - Optional voiceover audio track
 *
 * Self-contained: no external API, no auth required.
 * Uses `npx remotion render` under the hood (requires Node.js on host).
 */
class RemotionCompose {
  constructor() {
    this.name = 'remotion-compose';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[RemotionPlugin] Executing remotion-compose with', params.shots?.length ?? 0, 'shots');

    const renderStart = Date.now();

    try {
      if (!Array.isArray(params.shots) || params.shots.length === 0) {
        throw new Error('`shots` array is required and must contain at least one shot');
      }

      // Normalize shots + parse JSON-encoded array if needed
      let shots = params.shots;
      if (typeof shots === 'string') {
        try {
          shots = JSON.parse(shots);
        } catch {
          throw new Error('`shots` must be a valid JSON array or array of objects');
        }
      }

      const userDataPath = process.env.USER_DATA_PATH || process.cwd();
      const projectId = params.projectId || `remotion_${randomUUID().slice(0, 8)}`;
      const projectDir = path.join(
        userDataPath,
        'plugin-data',
        'remotion',
        String(workflowEngine?.userId ?? 'default'),
        projectId
      );

      // ─── Scaffold project directories ───────────────────────────
      await fs.mkdir(path.join(projectDir, 'src'), { recursive: true });
      await fs.mkdir(path.join(projectDir, 'public'), { recursive: true });
      await fs.mkdir(path.join(projectDir, 'out'), { recursive: true });

      // ─── Copy Seedance MP4s + voiceover into public/ ───────────
      const normalizedShots = [];
      for (const shot of shots) {
        if (!shot.filePath) {
          throw new Error('Each shot must have a `filePath`');
        }
        const publicName = path.basename(shot.filePath);
        const dest = path.join(projectDir, 'public', publicName);
        await fs.copyFile(shot.filePath, dest);
        normalizedShots.push({
          filePath: publicName, // relative name for staticFile() in Remotion
          durationFrames: Number(shot.durationFrames) || Number(params.fps) * 5 || 150,
          overlayText: shot.overlayText || null,
        });
      }

      let voiceoverPublicName = null;
      if (params.voiceoverPath) {
        try {
          voiceoverPublicName = 'voice' + path.extname(params.voiceoverPath);
          await fs.copyFile(
            params.voiceoverPath,
            path.join(projectDir, 'public', voiceoverPublicName)
          );
        } catch (e) {
          console.warn('[RemotionPlugin] Could not copy voiceover:', e.message);
          voiceoverPublicName = null;
        }
      }

      // ─── Write Root.tsx + BrandFilm.tsx from templates ─────────
      const totalFrames = normalizedShots.reduce((n, s) => n + s.durationFrames, 0);
      const width = Number(params.width) || 1080;
      const height = Number(params.height) || 1920;
      const fps = Number(params.fps) || 30;

      const rootTmpl = await fs.readFile(
        path.join(__dirname, 'templates', 'Root.tsx.tmpl'),
        'utf8'
      );
      const filmTmpl = await fs.readFile(
        path.join(__dirname, 'templates', 'BrandFilm.tsx.tmpl'),
        'utf8'
      );
      const tsconfigTmpl = await fs.readFile(
        path.join(__dirname, 'templates', 'tsconfig.json.tmpl'),
        'utf8'
      );
      const configTmpl = await fs.readFile(
        path.join(__dirname, 'templates', 'remotion.config.ts.tmpl'),
        'utf8'
      );

      const replace = (tpl, vars) =>
        Object.entries(vars).reduce(
          (acc, [k, v]) => acc.split(`__${k}__`).join(String(v)),
          tpl
        );

      const templateVars = {
        WIDTH: width,
        HEIGHT: height,
        FPS: fps,
        DURATION_FRAMES: totalFrames,
        BRAND_PRIMARY: params.brandPrimary || '#e53d8f',
        BRAND_ACCENT: params.brandAccent || '#12e0ff',
        BACKGROUND_COLOR: params.backgroundColor || '#0b0b14',
        SHOTS_JSON: JSON.stringify(normalizedShots).replace(/</g, '\\u003c'),
        TITLE_TEXT: (params.titleText || '').replace(/"/g, '\\"'),
        CTA_TEXT: (params.ctaText || '').replace(/"/g, '\\"'),
        VOICEOVER_FILE: voiceoverPublicName || '',
        HAS_VOICEOVER: voiceoverPublicName ? 'true' : 'false',
      };

      await fs.writeFile(
        path.join(projectDir, 'src', 'Root.tsx'),
        replace(rootTmpl, templateVars)
      );
      await fs.writeFile(
        path.join(projectDir, 'src', 'BrandFilm.tsx'),
        replace(filmTmpl, templateVars)
      );
      await fs.writeFile(
        path.join(projectDir, 'tsconfig.json'),
        tsconfigTmpl
      );
      await fs.writeFile(
        path.join(projectDir, 'remotion.config.ts'),
        configTmpl
      );

      await fs.writeFile(
        path.join(projectDir, 'package.json'),
        JSON.stringify(
          {
            name: 'agnt-remotion-render',
            version: '1.0.0',
            private: true,
            scripts: {
              render: 'remotion render src/Root.tsx BrandFilm out/final.mp4'
            },
            dependencies: {
              remotion: '^4.0.0',
              '@remotion/cli': '^4.0.0',
              react: '^18.0.0',
              'react-dom': '^18.0.0'
            },
            devDependencies: {
              '@types/react': '^18.0.0',
              typescript: '^5.0.0'
            }
          },
          null,
          2
        )
      );

      // ─── Install deps (skipped on re-renders if projectId supplied) ──
      const nodeModulesExists = await fs
        .access(path.join(projectDir, 'node_modules'))
        .then(() => true)
        .catch(() => false);

      if (params.skipInstall !== 'Yes' && !nodeModulesExists) {
        console.log('[RemotionPlugin] Running npm install in', projectDir);
        await exec('npm', ['install', '--silent', '--no-audit', '--no-fund'], {
          cwd: projectDir,
          shell: process.platform === 'win32',
          maxBuffer: 50 * 1024 * 1024,
        });
      }

      // ─── Render ────────────────────────────────────────────────
      const outFile = path.join(projectDir, 'out', 'final.mp4');
      console.log('[RemotionPlugin] Rendering to', outFile);
      await exec(
        'npx',
        [
          'remotion',
          'render',
          'src/Root.tsx',
          'BrandFilm',
          outFile,
          '--codec=h264',
          '--concurrency=4',
          '--log=info',
        ],
        {
          cwd: projectDir,
          shell: process.platform === 'win32',
          maxBuffer: 100 * 1024 * 1024,
        }
      );

      const stat = await fs.stat(outFile);
      const renderDurationMs = Date.now() - renderStart;

      console.log(
        `[RemotionPlugin] Rendered ${outFile} (${stat.size} bytes) in ${renderDurationMs}ms`
      );

      return {
        success: true,
        filePath: outFile,
        sizeBytes: stat.size,
        durationSeconds: totalFrames / fps,
        totalFrames,
        projectDir,
        renderDurationMs,
        error: null,
      };
    } catch (error) {
      console.error('[RemotionPlugin] Error:', error.message);
      return {
        success: false,
        filePath: null,
        renderDurationMs: Date.now() - renderStart,
        error: error.stderr?.toString() || error.message,
      };
    }
  }
}

export default new RemotionCompose();
