/**
 * Skill validation and parsing utilities for the Agent Skills standard (agentskills.io)
 */
import yaml from 'js-yaml';

/**
 * Validate a skill name against the Agent Skills specification.
 * Rules: 1-64 chars, lowercase alphanumeric + hyphens, no leading/trailing/consecutive hyphens.
 */
export function isValidSkillName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 64) return false;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) return false;
  if (name.includes('--')) return false;
  return true;
}

/**
 * Best-effort conversion from a display name to a kebab-case skill name.
 */
export function toKebabCase(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

/**
 * Parse a SKILL.md file content into structured data.
 * Uses js-yaml for robust YAML parsing (handles multiline, colons, block scalars, etc.).
 * Falls back to loose markdown format for files without YAML frontmatter.
 * Returns { frontmatter, instructions, errors, warnings }.
 */
export function parseSkillMd(content) {
  const result = {
    frontmatter: {},
    instructions: '',
    errors: [],
    warnings: [],
  };

  if (!content || typeof content !== 'string') {
    result.errors.push('Content is empty or not a string');
    return result;
  }

  // Parse YAML frontmatter (between --- delimiters)
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!fmMatch) {
    // Fallback: parse loose markdown format (# Title, ## Description, --- separator)
    return _parseLooseFormat(content, result);
  }

  const yamlStr = fmMatch[1];
  result.instructions = fmMatch[2].trim();

  // Parse YAML with js-yaml (handles multiline, colons in values, block scalars, nested objects)
  let parsed = {};
  try {
    parsed = yaml.load(yamlStr) || {};
  } catch (yamlError) {
    result.warnings.push(`YAML parse warning: ${yamlError.message}`);
    // Fallback to simple regex parser for malformed YAML
    parsed = _fallbackYamlParse(yamlStr);
  }

  // Map parsed YAML to frontmatter (spec fields only: name, description, license, compatibility, metadata, allowed-tools)
  result.frontmatter = {
    name: _str(parsed.name),
    description: _str(parsed.description),
    license: _str(parsed.license),
    compatibility: _str(parsed.compatibility),
    metadata: parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : null,
    'allowed-tools': null,
  };

  // Handle allowed-tools: support both space-delimited string and YAML array
  const at = parsed['allowed-tools'];
  if (at) {
    result.frontmatter['allowed-tools'] = Array.isArray(at) ? at.join(' ') : String(at);
  }

  // Validate required fields
  if (!result.frontmatter.name) {
    result.errors.push('Missing required "name" field in frontmatter');
  } else if (!isValidSkillName(result.frontmatter.name)) {
    result.warnings.push(
      `Name "${result.frontmatter.name}" does not conform to Agent Skills spec (kebab-case, 1-64 chars, no uppercase/consecutive hyphens)`
    );
  }

  if (!result.frontmatter.description) {
    result.errors.push('Missing required "description" field in frontmatter');
  } else if (result.frontmatter.description.length > 1024) {
    result.warnings.push('Description exceeds 1024 character recommendation');
  }

  return result;
}

/**
 * Coerce a value to string or null. Handles numbers, booleans, etc. from YAML.
 */
function _str(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val || null;
  return String(val);
}

/**
 * Fallback regex-based YAML parser for malformed YAML that js-yaml rejects.
 * Handles simple key:value pairs and one level of nesting for metadata.
 */
function _fallbackYamlParse(yamlStr) {
  const parsed = {};
  let currentKey = null;
  let inMetadata = false;

  for (const line of yamlStr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Nested key (indented) for metadata
    if (line.startsWith('  ') && inMetadata) {
      const nestedMatch = trimmed.match(/^([\w][\w.-]*)\s*:\s*(.*)$/);
      if (nestedMatch) {
        if (!parsed.metadata) parsed.metadata = {};
        parsed.metadata[nestedMatch[1]] = nestedMatch[2].replace(/^["']|["']$/g, '');
      }
      continue;
    }

    // Top-level key: value
    const kvMatch = trimmed.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      inMetadata = currentKey === 'metadata';
      const val = kvMatch[2].replace(/^["']|["']$/g, '').trim();
      if (val) {
        parsed[currentKey] = val;
      }
    }
  }

  return parsed;
}

/**
 * Parse a loose markdown skill file (no YAML frontmatter).
 * Expected format: # Name, ## Description, optional ## When to Use / ## Source, then --- separator before instructions body.
 * Compatible with community skill formats (e.g., Anthropic skills, obra/superpowers).
 */
function _parseLooseFormat(content, result) {
  const lines = content.split('\n');

  // Extract name from first # heading
  const nameMatch = lines.find((l) => /^# /.test(l));
  const displayName = nameMatch ? nameMatch.replace(/^# /, '').trim() : null;
  const kebabName = displayName
    ? displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : null;

  // Extract ## sections from header only (before --- separator)
  const separatorLineIndex = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  const headerLines = separatorLineIndex !== -1 ? lines.slice(0, separatorLineIndex) : lines;

  let description = '';
  let source = '';
  const sections = {};
  let currentSection = null;

  for (const line of headerLines) {
    const sectionMatch = line.match(/^## (.+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim().toLowerCase();
      sections[currentSection] = [];
      continue;
    }
    if (currentSection && !line.match(/^# /)) {
      sections[currentSection].push(line);
    }
  }

  // Pull description from ## Description section (first non-empty line)
  if (sections['description']) {
    description = sections['description'].find((l) => l.trim())?.trim() || '';
  }

  // Pull source if available
  if (sections['source']) {
    source = sections['source'].find((l) => l.trim())?.trim() || '';
  }

  // Instructions: everything after the --- separator, or the whole file if none
  const separatorIndex = content.indexOf('\n---\n');
  const instructions = separatorIndex !== -1 ? content.substring(separatorIndex + 5).trim() : content;

  result.frontmatter = {
    name: kebabName || null,
    description: description || null,
    displayName: displayName || null,
    license: null,
    compatibility: null,
    metadata: source ? { source } : null,
    'allowed-tools': null,
  };
  result.instructions = instructions;

  if (!result.frontmatter.name) {
    result.errors.push('Missing skill name (no # heading found)');
  } else if (!isValidSkillName(result.frontmatter.name)) {
    result.warnings.push(
      `Name "${result.frontmatter.name}" does not conform to Agent Skills spec (kebab-case, 1-64 chars)`
    );
  }

  if (!result.frontmatter.description) {
    result.errors.push('Missing required "description" (no ## Description section found)');
  }

  return result;
}

/**
 * Serialize a skill object into SKILL.md format (YAML frontmatter + markdown body).
 */
export function serializeSkillMd(skill) {
  const fm = {};

  if (skill.name) fm.name = skill.name;
  if (skill.description) fm.description = skill.description;
  if (skill.license) fm.license = skill.license;
  if (skill.compatibility) fm.compatibility = skill.compatibility;

  // allowed-tools as space-delimited string per spec
  const allowedTools = normalizeAllowedTools(skill.allowed_tools || skill.allowedTools);
  if (allowedTools) fm['allowed-tools'] = allowedTools;

  // Metadata as nested map
  const metadata = normalizeMetadata(skill.metadata);
  if (metadata && Object.keys(metadata).length > 0) fm.metadata = metadata;

  const frontmatter = `---\n${yaml.dump(fm, { lineWidth: -1, quotingType: '"', forceQuotes: false }).trim()}\n---`;
  const body = skill.instructions || '';
  return `${frontmatter}\n\n${body}\n`;
}

/**
 * Normalize allowed_tools from various formats to a space-delimited string.
 */
function normalizeAllowedTools(tools) {
  if (!tools) return null;
  if (typeof tools === 'string') {
    try {
      const parsed = JSON.parse(tools);
      if (Array.isArray(parsed)) return parsed.join(' ');
    } catch (e) {
      return tools.trim() || null;
    }
  }
  if (Array.isArray(tools)) return tools.join(' ');
  return null;
}

/**
 * Normalize metadata from string (JSON) or object.
 */
function normalizeMetadata(metadata) {
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch (e) {
      return null;
    }
  }
  if (typeof metadata === 'object') return metadata;
  return null;
}
