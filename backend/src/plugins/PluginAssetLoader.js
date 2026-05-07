/**
 * PRD-057: PluginAssetLoader
 *
 * Tracks every plugin-installed asset (agents, workflows, skills, widgets,
 * AND tools) in `installed_plugin_assets` so uninstall and update flows can
 * walk them uniformly. Tool source lives as files in the plugin folder
 * (registered via PluginManager.toolToPlugin), so the registry row's
 * `local_id` for a tool is just its `type` — there's no DB row to update.
 *
 * The loader is stateless — call `installAssets(...)` once per plugin install
 * (or update). Tracks every minted local id in `installed_plugin_assets` so
 * uninstall and update can find what to remove or compare.
 *
 * Update semantics:
 *   - new slugs       → install fresh
 *   - existing slug   → if the underlying asset has is_user_modified=1, leave alone
 *                       (return a "skipped" entry); else, overwrite
 *   - missing slugs   → mark `deprecated_at = now()` (caller can decide to remove)
 */

import fs from 'fs/promises';
import path from 'path';
import db from '../models/database/index.js';
import AgentModel from '../models/AgentModel.js';
import { parseAgentEnvelope, importAgent } from '../services/AgentImportService.js';
import { parseWorkflowEnvelope, importWorkflow } from '../services/WorkflowImportService.js';
import { importSkillFromMd } from '../services/SkillService.js';
import { importWidgetEnvelope } from '../services/WidgetDefinitionService.js';
import { resolveRefList, makeSlugRef } from '../utils/pluginSlugResolver.js';

/**
 * Helper: lookup a previously-installed plugin asset by (plugin, type, slug).
 */
function lookupInstalledFactory() {
  return (pluginName, assetType, slug) =>
    new Promise((resolve, reject) => {
      db.get(
        `SELECT local_id FROM installed_plugin_assets
         WHERE plugin_name = ? AND asset_type = ? AND asset_slug = ?
         AND deprecated_at IS NULL`,
        [pluginName, assetType, slug],
        (err, row) => (err ? reject(err) : resolve(row?.local_id || null))
      );
    });
}

function getRow(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

class PluginAssetLoader {
  /**
   * Install all asset arrays from a plugin manifest.
   *
   * @param {string} pluginName        canonical plugin name (manifest.name)
   * @param {string} pluginVersion     manifest version
   * @param {object} manifest          full parsed manifest
   * @param {string} pluginDir         absolute path to extracted plugin directory
   * @param {string} userId            user installing the plugin (binds new rows to them)
   * @returns {Promise<{ installed: object, skipped: object[], deprecated: object[], errors: string[] }>}
   */
  async installAssets(pluginName, pluginVersion, manifest, pluginDir, userId) {
    const summary = {
      installed: { agents: [], workflows: [], skills: [], widgets: [], tools: [] },
      skipped: [],     // user-modified assets we did not overwrite during update
      deprecated: [],  // slugs removed in this version of the manifest
      errors: [],
      noop: false,
    };

    // Skip the entire install if we already have rows for this plugin at the
    // exact same version. Avoids re-importing assets on every app restart
    // (which would otherwise reset metadata and risk overwriting unmodified
    // assets during normal startup).
    const existingVersionRow = await getRow(
      `SELECT plugin_version FROM installed_plugin_assets WHERE plugin_name = ? LIMIT 1`,
      [pluginName]
    );
    if (existingVersionRow && existingVersionRow.plugin_version === pluginVersion) {
      summary.noop = true;
      return summary;
    }

    // bundleMap: in-bundle resolution `<plugin>/<type>/<slug>` -> local id
    const bundleMap = new Map();
    const lookupInstalled = lookupInstalledFactory();
    const resolveCtx = { bundleMap, lookupInstalled };

    // 1) Skills first (no cross-dependencies among bundled skills)
    if (Array.isArray(manifest.skills)) {
      for (const entry of manifest.skills) {
        try {
          const slug = entry.slug;
          const filePath = path.join(pluginDir, entry.source.replace(/^\.\//, ''));
          const content = await fs.readFile(filePath, 'utf-8');

          const decision = await this._decideUpdate(pluginName, 'skill', slug);
          if (decision.action === 'skip') {
            summary.skipped.push({ kind: 'skill', slug, reason: 'is_user_modified' });
            bundleMap.set(`${pluginName}/skill/${slug}`, decision.localId);
            continue;
          }
          if (decision.action === 'overwrite') {
            // Delete the old skill row first
            await runSql(`DELETE FROM skills WHERE id = ?`, [decision.localId]);
          }

          const result = await importSkillFromMd(content, userId, {
            sourcePlugin: pluginName,
            slugOverride: makeSlugRef(pluginName, slug),
          });
          bundleMap.set(`${pluginName}/skill/${slug}`, result.id);
          summary.installed.skills.push({ slug, id: result.id });
          await this._record(pluginName, pluginVersion, 'skill', slug, result.id);
        } catch (e) {
          summary.errors.push(`skill ${entry.slug}: ${e.message}`);
        }
      }
    }

    // 2) Widgets (also no inter-asset references)
    if (Array.isArray(manifest.widgets)) {
      for (const entry of manifest.widgets) {
        try {
          const slug = entry.slug;
          const filePath = path.join(pluginDir, entry.definition.replace(/^\.\//, ''));
          const raw = await fs.readFile(filePath, 'utf-8');
          const envelope = JSON.parse(raw);

          const decision = await this._decideUpdate(pluginName, 'widget', slug);
          if (decision.action === 'skip') {
            summary.skipped.push({ kind: 'widget', slug, reason: 'is_user_modified' });
            bundleMap.set(`${pluginName}/widget/${slug}`, decision.localId);
            continue;
          }
          if (decision.action === 'overwrite') {
            await runSql(`DELETE FROM widget_definitions WHERE id = ?`, [decision.localId]);
          }

          const result = await importWidgetEnvelope(envelope, userId, { sourcePlugin: pluginName });
          bundleMap.set(`${pluginName}/widget/${slug}`, result.id);
          summary.installed.widgets.push({ slug, id: result.id });
          await this._record(pluginName, pluginVersion, 'widget', slug, result.id);
        } catch (e) {
          summary.errors.push(`widget ${entry.slug}: ${e.message}`);
        }
      }
    }

    // 3) Workflows (may reference plugin tools by type, no cross-asset slug refs needed)
    if (Array.isArray(manifest.workflows)) {
      for (const entry of manifest.workflows) {
        try {
          const slug = entry.slug;
          const filePath = path.join(pluginDir, entry.definition.replace(/^\.\//, ''));
          const raw = await fs.readFile(filePath, 'utf-8');
          const envelope = JSON.parse(raw);
          const payload = parseWorkflowEnvelope(envelope);

          const decision = await this._decideUpdate(pluginName, 'workflow', slug);
          if (decision.action === 'skip') {
            summary.skipped.push({ kind: 'workflow', slug, reason: 'is_user_modified' });
            bundleMap.set(`${pluginName}/workflow/${slug}`, decision.localId);
            continue;
          }
          if (decision.action === 'overwrite') {
            await runSql(`DELETE FROM workflows WHERE id = ?`, [decision.localId]);
          }

          const result = await importWorkflow(payload, userId, { sourcePlugin: pluginName });
          bundleMap.set(`${pluginName}/workflow/${slug}`, result.id);
          summary.installed.workflows.push({
            slug, id: result.id, missingToolTypes: result.missingToolTypes,
          });
          await this._record(pluginName, pluginVersion, 'workflow', slug, result.id);
        } catch (e) {
          summary.errors.push(`workflow ${entry.slug}: ${e.message}`);
        }
      }
    }

    // 4) Agents last (resolve refs to skills/workflows/tools via bundleMap)
    if (Array.isArray(manifest.agents)) {
      for (const entry of manifest.agents) {
        try {
          const slug = entry.slug;
          const filePath = path.join(pluginDir, entry.definition.replace(/^\.\//, ''));
          const raw = await fs.readFile(filePath, 'utf-8');
          const envelope = JSON.parse(raw);
          const payload = parseAgentEnvelope(envelope);

          const decision = await this._decideUpdate(pluginName, 'agent', slug);
          if (decision.action === 'skip') {
            summary.skipped.push({ kind: 'agent', slug, reason: 'is_user_modified' });
            bundleMap.set(`${pluginName}/agent/${slug}`, decision.localId);
            continue;
          }
          if (decision.action === 'overwrite') {
            await runSql(`UPDATE agents SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [decision.localId]);
          }

          const result = await importAgent(payload, userId, {
            sourcePlugin: pluginName,
            resolveCtx,
          });
          bundleMap.set(`${pluginName}/agent/${slug}`, result.id);
          summary.installed.agents.push({
            slug, id: result.id, missingRefs: result.missingRefs,
          });
          await this._record(pluginName, pluginVersion, 'agent', slug, result.id);
        } catch (e) {
          summary.errors.push(`agent ${entry.slug}: ${e.message}`);
        }
      }
    }

    // 5) Tools — track each manifest tool entry in installed_plugin_assets so
    //    they're listed alongside other assets and can be inspected /
    //    uninstalled uniformly. The actual tool registration in PluginManager
    //    is independent of this; here we're only writing the registry row.
    if (Array.isArray(manifest.tools)) {
      for (const tool of manifest.tools) {
        try {
          if (!tool || !tool.type) continue;
          const slug = tool.type;
          const localId = tool.type; // no DB row; type is the runtime identifier
          await this._record(pluginName, pluginVersion, 'tool', slug, localId);
          summary.installed.tools.push({ slug, id: localId, entryPoint: tool.entryPoint });
          bundleMap.set(`${pluginName}/tool/${slug}`, localId);
        } catch (e) {
          summary.errors.push(`tool ${tool?.type}: ${e.message}`);
        }
      }
    }

    // 6) Mark removed-in-this-version slugs as deprecated
    await this._markDeprecatedSlugs(pluginName, manifest, summary);

    // 6) Bump plugin_version on all rows we visited
    await runSql(
      `UPDATE installed_plugin_assets SET plugin_version = ? WHERE plugin_name = ?`,
      [pluginVersion, pluginName]
    );

    return summary;
  }

  /**
   * Decide what to do for a given (plugin, type, slug):
   *   - 'install'   → no existing row, install fresh
   *   - 'overwrite' → existing row, NOT user-modified, replace
   *   - 'skip'      → existing row IS user-modified, leave alone
   */
  async _decideUpdate(pluginName, assetType, slug) {
    const row = await getRow(
      `SELECT local_id FROM installed_plugin_assets
       WHERE plugin_name = ? AND asset_type = ? AND asset_slug = ?
       AND deprecated_at IS NULL`,
      [pluginName, assetType, slug]
    );
    if (!row) return { action: 'install' };

    // Tools have no backing DB row — there's no is_user_modified to check
    // (you can't "modify" a plugin-installed tool through the UI). On update,
    // just always overwrite the registry row.
    if (assetType === 'tool') {
      return { action: 'overwrite', localId: row.local_id };
    }

    const tableMap = {
      agent: 'agents',
      workflow: 'workflows',
      skill: 'skills',
      widget: 'widget_definitions',
    };
    const table = tableMap[assetType];
    if (!table) return { action: 'install' };

    const assetRow = await getRow(`SELECT is_user_modified FROM ${table} WHERE id = ?`, [row.local_id]);
    if (!assetRow) {
      // The asset was deleted out from under us; clean up the registry row
      await runSql(`DELETE FROM installed_plugin_assets WHERE plugin_name = ? AND asset_type = ? AND asset_slug = ?`,
        [pluginName, assetType, slug]);
      return { action: 'install' };
    }
    if (assetRow.is_user_modified) {
      return { action: 'skip', localId: row.local_id };
    }
    return { action: 'overwrite', localId: row.local_id };
  }

  async _record(pluginName, pluginVersion, assetType, slug, localId) {
    await runSql(
      `INSERT INTO installed_plugin_assets (plugin_name, plugin_version, asset_type, asset_slug, local_id, installed_at, deprecated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL)
       ON CONFLICT(plugin_name, asset_type, asset_slug) DO UPDATE SET
         plugin_version = excluded.plugin_version,
         local_id = excluded.local_id,
         installed_at = CURRENT_TIMESTAMP,
         deprecated_at = NULL`,
      [pluginName, pluginVersion, assetType, slug, localId]
    );
  }

  /**
   * On update: anything previously installed but not in the new manifest gets
   * a deprecated_at timestamp. The asset row stays in place — user can clean
   * up manually via uninstall mode 'purge' or 'clean'.
   */
  async _markDeprecatedSlugs(pluginName, manifest, summary) {
    const declared = new Set();
    const declare = (arr, kind) => {
      if (!Array.isArray(arr)) return;
      for (const e of arr) declared.add(`${kind}::${e.slug}`);
    };
    declare(manifest.agents, 'agent');
    declare(manifest.workflows, 'workflow');
    declare(manifest.skills, 'skill');
    declare(manifest.widgets, 'widget');
    // Tools manifest entries use `type` as their identifier (no `slug` field)
    if (Array.isArray(manifest.tools)) {
      for (const t of manifest.tools) {
        if (t?.type) declared.add(`tool::${t.type}`);
      }
    }

    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT asset_type, asset_slug, local_id FROM installed_plugin_assets
         WHERE plugin_name = ? AND deprecated_at IS NULL`,
        [pluginName],
        (err, r) => (err ? reject(err) : resolve(r || []))
      );
    });

    for (const r of rows) {
      const key = `${r.asset_type}::${r.asset_slug}`;
      if (!declared.has(key)) {
        await runSql(
          `UPDATE installed_plugin_assets SET deprecated_at = CURRENT_TIMESTAMP
           WHERE plugin_name = ? AND asset_type = ? AND asset_slug = ?`,
          [pluginName, r.asset_type, r.asset_slug]
        );
        summary.deprecated.push({ kind: r.asset_type, slug: r.asset_slug, localId: r.local_id });
      }
    }
  }

  /**
   * Uninstall plugin assets in a particular mode:
   *   - 'clean' (default): delete rows where is_user_modified = 0; orphan the rest
   *   - 'purge': delete all rows regardless
   *   - 'detach': leave rows in place; just clear source_plugin
   */
  async uninstallAssets(pluginName, mode = 'clean') {
    const validModes = ['clean', 'purge', 'detach'];
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid uninstall mode "${mode}"; expected one of ${validModes.join(', ')}`);
    }

    const result = { mode, deleted: [], orphaned: [], detached: [] };

    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT asset_type, asset_slug, local_id FROM installed_plugin_assets
         WHERE plugin_name = ?`,
        [pluginName],
        (err, r) => (err ? reject(err) : resolve(r || []))
      );
    });

    const tableMap = {
      agent: 'agents',
      workflow: 'workflows',
      skill: 'skills',
      widget: 'widget_definitions',
    };

    for (const r of rows) {
      // Tools have no DB row — their lifecycle is owned by the plugin folder.
      // Uninstall just clears the registry; the plugin folder removal
      // (handled by PluginInstaller.uninstallPlugin) takes care of the file.
      if (r.asset_type === 'tool') {
        result.deleted.push({ kind: 'tool', slug: r.asset_slug, localId: r.local_id });
        continue;
      }

      const table = tableMap[r.asset_type];
      if (!table) continue;
      const assetRow = await getRow(
        `SELECT is_user_modified FROM ${table} WHERE id = ?`,
        [r.local_id]
      );
      if (!assetRow) continue; // already gone

      if (mode === 'detach') {
        await runSql(
          `UPDATE ${table} SET source_plugin = NULL WHERE id = ?`,
          [r.local_id]
        );
        result.detached.push({ kind: r.asset_type, slug: r.asset_slug, localId: r.local_id });
        continue;
      }

      if (mode === 'purge') {
        // Hard-ish delete (uses table soft-delete where it exists)
        if (table === 'agents' || table === 'workflows') {
          await runSql(
            `UPDATE ${table} SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [r.local_id]
          );
        } else {
          await runSql(`DELETE FROM ${table} WHERE id = ?`, [r.local_id]);
        }
        result.deleted.push({ kind: r.asset_type, slug: r.asset_slug, localId: r.local_id });
        continue;
      }

      // 'clean' mode
      if (assetRow.is_user_modified) {
        await runSql(
          `UPDATE ${table} SET source_plugin = NULL WHERE id = ?`,
          [r.local_id]
        );
        result.orphaned.push({ kind: r.asset_type, slug: r.asset_slug, localId: r.local_id });
      } else {
        if (table === 'agents' || table === 'workflows') {
          await runSql(
            `UPDATE ${table} SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [r.local_id]
          );
        } else {
          await runSql(`DELETE FROM ${table} WHERE id = ?`, [r.local_id]);
        }
        result.deleted.push({ kind: r.asset_type, slug: r.asset_slug, localId: r.local_id });
      }
    }

    // Always clear the registry
    await runSql(`DELETE FROM installed_plugin_assets WHERE plugin_name = ?`, [pluginName]);

    return result;
  }
}

export default new PluginAssetLoader();
