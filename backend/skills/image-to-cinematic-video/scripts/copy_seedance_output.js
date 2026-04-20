/**
 * copy_seedance_output.js
 *
 * ⚠ CRITICAL quirk of the `seedance_api` tool:
 *
 *   The `filename` parameter you pass to `seedance_api` is treated as
 *   a RELATIVE path — the plugin prepends its own plugin-data root:
 *
 *     C:\Users\Studio\AppData\Roaming\AGNT\plugin-data\seedance\<userId>\<filename>
 *
 *   If you pass an absolute path like
 *     filename: 'C:/.../projects/run/scenes/scene1.mp4'
 *   the plugin will write to
 *     C:\...\plugin-data\seedance\<userId>\C:\...\projects\run\scenes\scene1.mp4
 *   and ffmpeg-side file handling breaks (ENOENT).
 *
 * SO THE RULE IS:
 *   1. Always pass a simple RELATIVE filename to `seedance_api`
 *        e.g.  filename: 'scifi_scene1.mp4'
 *   2. After the seedance call returns, COPY the file out of
 *      plugin-data into your project folder using this helper.
 *
 * Usage:
 *   const { copySeedanceOutput, SEEDANCE_PLUGIN_DIR }
 *     = require('C:/Users/Studio/.agnt/skills/image-to-cinematic-video/scripts/copy_seedance_output.js');
 *
 *   // After: await seedance_api({ filename: 'scifi_scene1.mp4', ... })
 *   const dst = copySeedanceOutput('scifi_scene1.mp4',
 *                                  path.join(projectDir, 'scenes/scene1.mp4'));
 *   // dst === path.join(projectDir, 'scenes/scene1.mp4')
 */

const fs = require('fs');
const path = require('path');

// Your AGNT user id — this is the folder seedance writes into. If it
// ever changes, `fs.readdirSync(root)` to find the one non-hidden child.
const SEEDANCE_PLUGIN_DIR = 'C:\\Users\\Studio\\AppData\\Roaming\\AGNT\\plugin-data\\seedance\\{YOUR_USER_ID}}';

/**
 * Copy `filename` out of the seedance plugin directory to `destPath`.
 *
 * @param {string} filename  the same relative filename you passed to
 *                           seedance_api (e.g. 'scifi_scene1.mp4')
 * @param {string} destPath  absolute destination path in your project
 *                           folder. Parent dirs are created.
 * @returns {string} destPath
 */
function copySeedanceOutput(filename, destPath) {
  const src = path.join(SEEDANCE_PLUGIN_DIR, filename);
  if (!fs.existsSync(src)) {
    throw new Error(`Seedance output not found at ${src}. ` + `Did you pass an absolute filename? Always pass a relative one.`);
  }
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, destPath);
  return destPath;
}

module.exports = { copySeedanceOutput, SEEDANCE_PLUGIN_DIR };
