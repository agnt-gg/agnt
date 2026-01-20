import fs from 'fs';
import path from 'path';
import png2icons from 'png2icons';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_FILE = path.join(__dirname, '../build/icon.png');
const OUTPUT_ICNS = path.join(__dirname, '../build/icon.icns');
const OUTPUT_ICO = path.join(__dirname, '../build/icon.ico');

console.log(`Generating icons from ${INPUT_FILE}...`);

try {
  const input = fs.readFileSync(INPUT_FILE);

  // Generate ICNS (Mac) - Only needed on Mac usually, but we'll try to generate it if possible
  // Wrap in try-catch specifically for ICNS generation as it might fail on some platforms/configs
  try {
    const icns = png2icons.createICNS(input, png2icons.BILINEAR, 0);
    if (icns) {
      fs.writeFileSync(OUTPUT_ICNS, icns);
      console.log(`Successfully created: ${OUTPUT_ICNS}`);
    } else {
      console.error('Failed to create ICNS file (skippable on Windows/Linux)');
    }
  } catch (icnsErr) {
    console.warn('Skipping ICNS generation (not critical for Windows/Linux builds):', icnsErr.message);
  }

  // Generate ICO (Windows)
  const ico = png2icons.createICO(input, png2icons.BILINEAR, 0, true);
  if (ico) {
    fs.writeFileSync(OUTPUT_ICO, ico);
    console.log(`Successfully created: ${OUTPUT_ICO}`);
  } else {
    console.error('Failed to create ICO file');
  }
} catch (err) {
  console.error('Error generating icons:', err);
  process.exit(1);
}
