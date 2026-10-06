import express from 'express';
import SkillDiscoveryService from '../services/SkillDiscoveryService.js';
import SkillModel from '../models/SkillModel.js';
import generateUUID from '../utils/generateUUID.js';
import { authenticateToken } from './Middleware.js';

const SkillDiscoveryRoutes = express.Router();

/**
 * GET / - Filesystem-discovered skills this account may see (catalog only).
 * Every route here is scoped: the scan is per process, the skills are not.
 */
SkillDiscoveryRoutes.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const catalog = await SkillDiscoveryService.getSkillCatalogFor(userId);
    res.json({
      skills: catalog,
      lastScan: SkillDiscoveryService.lastScanTime,
      scanLocations: SkillDiscoveryService.getScanLocations(),
      total: catalog.length,
      parseFailures: await SkillDiscoveryService.getParseFailuresFor(userId),
    });
  } catch (error) {
    console.error('Error fetching discovered skills:', error);
    res.status(500).json({ error: 'Failed to fetch discovered skills' });
  }
});

/**
 * POST /rescan - Trigger a re-scan of filesystem skill locations
 */
SkillDiscoveryRoutes.post('/rescan', authenticateToken, async (req, res) => {
  try {
    const { projectRoot } = req.body || {};
    if (projectRoot) {
      await SkillDiscoveryService.setProjectRoot(projectRoot);
    } else {
      await SkillDiscoveryService.discoverAll();
    }
    const userId = req.user.userId;
    const catalog = await SkillDiscoveryService.getSkillCatalogFor(userId);
    res.json({
      skills: catalog,
      lastScan: SkillDiscoveryService.lastScanTime,
      total: catalog.length,
      parseFailures: await SkillDiscoveryService.getParseFailuresFor(userId),
    });
  } catch (error) {
    console.error('Error rescanning skills:', error);
    res.status(500).json({ error: 'Failed to rescan skills' });
  }
});

/**
 * GET /:name - Get full skill content by name
 */
SkillDiscoveryRoutes.get('/:name', authenticateToken, async (req, res) => {
  try {
    const skill = await SkillDiscoveryService.getSkillFor(req.params.name, req.user.userId);
    if (!skill) return res.status(404).json({ error: 'Discovered skill not found' });
    res.json({ skill });
  } catch (error) {
    console.error('Error fetching discovered skill:', error);
    res.status(500).json({ error: 'Failed to fetch discovered skill' });
  }
});

/**
 * GET /:name/resources - List bundled resources for a skill
 */
SkillDiscoveryRoutes.get('/:name/resources', authenticateToken, async (req, res) => {
  try {
    const resources = await SkillDiscoveryService.listResourcesFor(req.params.name, req.user.userId);
    if (!resources) return res.status(404).json({ error: 'Discovered skill not found' });
    res.json({ resources });
  } catch (error) {
    console.error('Error listing skill resources:', error);
    res.status(500).json({ error: 'Failed to list skill resources' });
  }
});

/**
 * GET /:name/resources/:path - Read a specific resource file
 */
SkillDiscoveryRoutes.get('/:name/resources/*', authenticateToken, async (req, res) => {
  try {
    // Extract the resource path from the wildcard
    const resourcePath = req.params[0];
    if (!resourcePath) return res.status(400).json({ error: 'Resource path is required' });

    const content = await SkillDiscoveryService.readResourceFor(req.params.name, resourcePath, req.user.userId);
    if (content === null) return res.status(404).json({ error: 'Resource not found' });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (error) {
    if (error.message === 'Resource path escapes skill directory') {
      return res.status(403).json({ error: 'Access denied: path outside skill directory' });
    }
    console.error('Error reading skill resource:', error);
    res.status(500).json({ error: 'Failed to read skill resource' });
  }
});

/**
 * POST /:name/import - Import a discovered filesystem skill into the database
 */
SkillDiscoveryRoutes.post('/:name/import', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const skill = await SkillDiscoveryService.getSkillContentFor(req.params.name, userId);
    if (!skill) return res.status(404).json({ error: 'Discovered skill not found' });

    // Convert kebab-case name to Title Case for display consistency with manually-created skills
    const displayName = skill.name
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    const skillData = {
      name: displayName,
      slug: skill.name, // kebab-case canonical name for lookups
      description: skill.description,
      instructions: skill.instructions || '',
      license: skill.frontmatter.license || '',
      compatibility: skill.frontmatter.compatibility || '',
      metadata: skill.frontmatter.metadata || {},
      allowedTools: skill.frontmatter['allowed-tools'] || [],
      category: 'general',
      icon: 'fas fa-puzzle-piece',
    };

    const id = generateUUID();
    await SkillModel.createOrUpdate(id, skillData, userId);
    const created = await SkillModel.findById(id);
    res.status(201).json({ skill: created, skillId: id, importedFrom: skill.dirPath });
  } catch (error) {
    console.error('Error importing discovered skill:', error);
    res.status(500).json({ error: 'Failed to import discovered skill' });
  }
});

console.log('Skill Discovery Routes Started...');

export default SkillDiscoveryRoutes;
