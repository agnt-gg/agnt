/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Skip downloading Chromium - we'll use Electron's bundled Chromium instead
  skipDownload: true,
};
