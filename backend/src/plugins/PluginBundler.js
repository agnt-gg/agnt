/**
 * PRD-057: Bundle-as-Plugin authoring.
 *
 * Takes a user's selection of agents/workflows/skills/widgets/tools and
 * produces a `.agnt` archive that can be installed on another instance.
 *
 * The output mirrors a hand-built plugin layout:
 *   <plugin-name>/
 *     manifest.json
 *     agents/<slug>.json
 *     workflows/<slug>.json
 *     skills/<slug>.SKILL.md
 *     widgets/<slug>.json
 *
 * Cross-asset references inside agent payloads are rewritten from local UUIDs
 * back to plugin-namespaced slugs (`<plugin>/<slug>`) so the receiving
 * instance can resolve them at install time.
 */

import fs from 'fs/promises';
import path from 'path';
import db from '../models/database/index.js';
import AgentModel from '../models/AgentModel.js';
import SkillModel from '../models/SkillModel.js';
import WorkflowModel from '../models/WorkflowModel.js';
import { buildAgentEnvelope } from '../services/AgentImportService.js';
import { buildWorkflowEnvelope } from '../services/WorkflowImportService.js';
import { serializeSkillMd } from '../utils/skillValidation.js';
import { makeSlugRef } from '../utils/pluginSlugResolver.js';

function getRow(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

/**
 * Bundle a selection into a plugin layout under `outDir`. Returns the manifest
 * the caller can serialize alongside the asset files. Caller is responsible
 * for creating the .agnt archive.
 *
 * @param {object} args
 * @param {string} args.pluginName        kebab-case plugin name (becomes archive folder name)
 * @param {string} args.version           semver string
 * @param {string} [args.description]
 * @param {string} [args.author]
 * @param {string} [args.icon]
 * @param {object} args.selection         { agentIds, workflowIds, skillIds, widgetIds, toolTypes }
 * @param {string} args.outDir            empty directory to write asset files into
 */
export async function bundleSelection(args) {
  const { pluginName, version, description, author, icon, selection, outDir } = args;
  if (!pluginName) throw new Error('bundleSelection requires pluginName');
  if (!version) throw new Error('bundleSelection requires version');
  if (!outDir) throw new Error('bundleSelection requires outDir');

  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(path.join(outDir, 'agents'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'workflows'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'skills'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'widgets'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'tools'), { recursive: true });

  // Build slug maps so cross-references can be rewritten.
  // Local UUID -> plugin-namespaced slug.
  const toolMap = new Map();   // tool name -> "<plugin>/<slug>" (only for tools we own)
  const skillMap = new Map();  // skill localId -> "<plugin>/<slug>"
  const workflowMap = new Map(); // workflow localId -> "<plugin>/<slug>"

  // Slugify helper (kebab-case)
  const toSlug = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled';

  const manifest = {
    name: pluginName,
    version,
    description: description || '',
    author: author || '',
    icon: icon || 'fa-cube',
    tools: [],
    agents: [],
    workflows: [],
    skills: [],
    widgets: [],
  };

  // 0) Tools — bundle each user-authored tool's source.
  // Frontend may send either the DB UUID OR the tool's `type` name (the
  // orchestrator-tools endpoint flattens custom tools to id=type), so we try
  // both. We log every step so silent failures are impossible.
  if (Array.isArray(selection.toolIds)) {
    console.log(`[PluginBundler] tools selection: ${JSON.stringify(selection.toolIds)}`);
    for (const id of selection.toolIds) {
      // Try id first, then type
      let tool = await getRow('SELECT * FROM tools WHERE id = ?', [id]);
      if (!tool) {
        tool = await getRow('SELECT * FROM tools WHERE type = ?', [id]);
        if (tool) console.log(`[PluginBundler] resolved tool by type "${id}" → row id ${tool.id}`);
      } else {
        console.log(`[PluginBundler] resolved tool by id "${id}" → type "${tool.type}"`);
      }

      if (!tool) {
        console.warn(`[PluginBundler] tool "${id}" not found in DB — skipping (likely a built-in or plugin tool that doesn't need bundling)`);
        continue;
      }

      const slug = toSlug(tool.type || tool.title || id);
      const fileName = `${slug}.js`;

      // Write source if we have it; otherwise write a stub so the receiving
      // instance gets a clear error rather than a silently missing file.
      const code = tool.code || `// PRD-057: tool "${tool.type || slug}" had no source code at bundle time.\n// The receiving AGNT instance must already have this tool registered (built-in or plugin).\nexport default async function execute() { throw new Error('Tool ${tool.type || slug} has no bundled source'); }\n`;
      await fs.writeFile(path.join(outDir, 'tools', fileName), code, 'utf-8');

      let parameters = {};
      let outputs = {};
      try { parameters = JSON.parse(tool.parameters || '{}'); } catch {}
      try { outputs = JSON.parse(tool.outputs || '{}'); } catch {}

      const toolType = tool.type || slug;
      manifest.tools.push({
        type: toolType,
        entryPoint: `./tools/${fileName}`,
        schema: {
          // The orchestrator's toolRegistry reads `schema.type` to derive the
          // LLM-callable function name, so it MUST be inside the schema too.
          type: toolType,
          title: tool.title || toolType,
          description: tool.description || '',
          category: tool.category || 'action',
          icon: tool.icon || 'puzzle-piece',
          parameters,
          outputs,
        },
      });
      console.log(`[PluginBundler] bundled tool "${tool.type || slug}" → manifest.tools[${manifest.tools.length - 1}]`);
    }
    console.log(`[PluginBundler] tools done: ${manifest.tools.length} bundled`);
  }

  // 1) Skills
  if (Array.isArray(selection.skillIds)) {
    for (const id of selection.skillIds) {
      const skill = await SkillModel.findById(id);
      if (!skill) continue;
      const slug = toSlug(skill.slug || skill.name);
      const filename = `${slug}.SKILL.md`;
      const md = serializeSkillMd(skill);
      await fs.writeFile(path.join(outDir, 'skills', filename), md, 'utf-8');
      manifest.skills.push({ slug, source: `./skills/${filename}` });
      skillMap.set(id, makeSlugRef(pluginName, slug));
    }
  }

  // 2) Widgets
  if (Array.isArray(selection.widgetIds)) {
    for (const id of selection.widgetIds) {
      const row = await getRow('SELECT * FROM widget_definitions WHERE id = ?', [id]);
      if (!row) continue;
      const slug = toSlug(row.name);
      const filename = `${slug}.json`;
      const envelope = {
        _format: 'agnt-widget',
        _version: '1.0',
        name: row.name,
        description: row.description,
        icon: row.icon,
        category: row.category,
        widget_type: row.widget_type,
        source_code: row.source_code,
        config: JSON.parse(row.config || '{}'),
        data_bindings: JSON.parse(row.data_bindings || '[]'),
        default_size: JSON.parse(row.default_size || '{"cols":4,"rows":3}'),
        min_size: JSON.parse(row.min_size || '{"cols":2,"rows":2}'),
        thumbnail: row.thumbnail || null,
      };
      await fs.writeFile(path.join(outDir, 'widgets', filename), JSON.stringify(envelope, null, 2), 'utf-8');
      manifest.widgets.push({ slug, definition: `./widgets/${filename}` });
    }
  }

  // 3) Workflows
  if (Array.isArray(selection.workflowIds)) {
    for (const id of selection.workflowIds) {
      const row = await WorkflowModel.findOne(id);
      if (!row) continue;
      const data = JSON.parse(row.workflow_data);
      const slug = toSlug(data.name || id);
      const envelope = buildWorkflowEnvelope(data);
      const filename = `${slug}.json`;
      await fs.writeFile(path.join(outDir, 'workflows', filename), JSON.stringify(envelope, null, 2), 'utf-8');
      manifest.workflows.push({ slug, definition: `./workflows/${filename}` });
      workflowMap.set(id, makeSlugRef(pluginName, slug));
    }
  }

  // 4) Agents (with cross-asset reference rewriting)
  if (Array.isArray(selection.agentIds)) {
    for (const id of selection.agentIds) {
      const agent = await AgentModel.findOne(id);
      if (!agent) continue;
      const slug = toSlug(agent.name);
      const filename = `${slug}.json`;

      // Rewrite skills/workflows lists from local IDs to plugin-namespaced slugs
      // when those targets are bundled in this plugin.
      const rewriteAgentSkills = (agent.assignedSkills || []).map((s) => skillMap.get(s) || s);
      const rewriteAgentWorkflows = (agent.assignedWorkflows || []).map((w) => workflowMap.get(w) || w);

      const envelope = buildAgentEnvelope(
        {
          ...agent,
          assignedSkills: rewriteAgentSkills,
          assignedWorkflows: rewriteAgentWorkflows,
        },
        {}
      );
      await fs.writeFile(path.join(outDir, 'agents', filename), JSON.stringify(envelope, null, 2), 'utf-8');
      manifest.agents.push({ slug, definition: `./agents/${filename}` });
    }
  }

  // 5) Write the manifest itself
  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  return { manifest };
}
