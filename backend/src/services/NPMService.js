import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class NPMService {
  /**
   * Search NPM registry for MCP servers
   */
  async searchMCPServers(req, res) {
    try {
      const { query, limit = 20 } = req.query;

      // Search NPM registry for packages with 'mcp' in the name or keywords
      const searchQuery = query || 'mcp-server';
      const npmSearchUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(searchQuery)}&size=${limit}`;

      const response = await fetch(npmSearchUrl);
      if (!response.ok) {
        throw new Error(`NPM registry error: ${response.status}`);
      }

      const data = await response.json();

      // Format results - no filtering, let users search for any package
      const packages = data.objects.map((obj) => ({
        name: obj.package.name,
        version: obj.package.version,
        description: obj.package.description,
        author: obj.package.author?.name || obj.package.publisher?.username,
        keywords: obj.package.keywords || [],
        homepage: obj.package.links?.homepage,
        repository: obj.package.links?.repository,
        npm: obj.package.links?.npm,
        downloads: obj.score?.detail?.popularity || 0,
        quality: obj.score?.detail?.quality || 0,
        maintenance: obj.score?.detail?.maintenance || 0,
        score: obj.score?.final || 0,
      }));

      res.json({
        success: true,
        packages: packages,
        total: packages.length,
      });
    } catch (error) {
      console.error('Error searching NPM for MCP servers:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get package details from NPM
   */
  async getPackageDetails(req, res) {
    try {
      const { packageName } = req.params;

      const npmUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
      const response = await fetch(npmUrl);

      if (!response.ok) {
        throw new Error(`Package not found: ${packageName}`);
      }

      const data = await response.json();
      const latestVersion = data['dist-tags']?.latest;
      const versionData = data.versions?.[latestVersion];

      res.json({
        success: true,
        package: {
          name: data.name,
          version: latestVersion,
          description: data.description,
          readme: data.readme,
          author: versionData?.author,
          license: versionData?.license,
          homepage: data.homepage,
          repository: data.repository,
          keywords: versionData?.keywords || [],
          dependencies: versionData?.dependencies || {},
          bin: versionData?.bin,
        },
      });
    } catch (error) {
      console.error('Error getting package details:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Test if a package can be run with npx
   */
  async testPackage(req, res) {
    try {
      const { packageName } = req.body;

      // Try to get package info to verify it exists
      const npmUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
      const response = await fetch(npmUrl);

      if (!response.ok) {
        return res.json({
          success: true,
          canRun: false,
          message: 'Package not found in NPM registry',
        });
      }

      const data = await response.json();
      const latestVersion = data['dist-tags']?.latest;
      const versionData = data.versions?.[latestVersion];

      // Check if package has a bin entry (can be run as command)
      const hasBin = !!versionData?.bin;

      res.json({
        success: true,
        canRun: hasBin,
        message: hasBin ? 'Package can be run with npx' : 'Package does not have executable commands',
        bin: versionData?.bin,
      });
    } catch (error) {
      console.error('Error testing package:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get popular MCP servers
   */
  async getPopularServers(req, res) {
    try {
      // List of known popular MCP servers
      const popularServers = [
        '@modelcontextprotocol/server-github',
        '@modelcontextprotocol/server-filesystem',
        '@modelcontextprotocol/server-postgres',
        '@modelcontextprotocol/server-sqlite',
        '@modelcontextprotocol/server-brave-search',
        '@modelcontextprotocol/server-google-maps',
        'chrome-devtools-mcp',
      ];

      const serverDetails = await Promise.all(
        popularServers.map(async (packageName) => {
          try {
            const npmUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
            const response = await fetch(npmUrl);

            if (!response.ok) return null;

            const data = await response.json();
            const latestVersion = data['dist-tags']?.latest;
            const versionData = data.versions?.[latestVersion];

            return {
              name: data.name,
              version: latestVersion,
              description: data.description,
              keywords: versionData?.keywords || [],
              homepage: data.homepage,
              repository: data.repository,
            };
          } catch (error) {
            console.error(`Error fetching ${packageName}:`, error);
            return null;
          }
        })
      );

      res.json({
        success: true,
        packages: serverDetails.filter((p) => p !== null),
      });
    } catch (error) {
      console.error('Error getting popular servers:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

export default new NPMService();
