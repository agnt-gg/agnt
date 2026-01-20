const { execSync } = require('child_process');
const path = require('path');

exports.default = async function (context) {
  const { electronPlatformName, arch } = context;

  console.log(`Rebuilding native modules for ${electronPlatformName} ${arch}`);

  const appDir = context.appOutDir;
  const nodeModulesPath = path.join(appDir, 'node_modules');

  try {
    execSync(`npx electron-rebuild --force --arch=${arch} --module-dir="${nodeModulesPath}"`, { stdio: 'inherit' });
    console.log(`Successfully rebuilt native modules for ${arch}`);
  } catch (error) {
    console.error('Failed to rebuild native modules:', error);
    throw error;
  }
};
