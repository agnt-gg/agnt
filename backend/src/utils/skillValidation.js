/**
 * Skill validation and parsing utilities for the Agent Skills standard (agentskills.io)
 */

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
    // Fallback: parse loose markdown format (# Title, ## Description, ## When to Use, --- separator)
    return _parseLooseFormat(content, result);
  }

  const yamlStr = fmMatch[1];
  result.instructions = fmMatch[2].trim();

  // Simple YAML parser for frontmatter fields
  const parsed = {};
  let currentKey = null;
  let currentArray = null;
  let inMetadata = false;

  for (const line of yamlStr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Array item
    if (trimmed.startsWith('- ') && currentKey) {
      if (!currentArray) currentArray = [];
      currentArray.push(trimmed.slice(2).replace(/^["']|["']$/g, ''));
      continue;
    }

    // Save previous array
    if (currentKey && currentArray) {
      parsed[currentKey] = currentArray;
      currentArray = null;
    }

    // Nested key (indented) for metadata
    if (line.startsWith('  ') && inMetadata) {
      const nestedMatch = trimmed.match(/^([\w][\w-]*)\s*:\s*(.*)$/);
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

  // Save trailing array
  if (currentKey && currentArray) {
    parsed[currentKey] = currentArray;
  }

  // Map parsed YAML to frontmatter
  result.frontmatter = {
    name: parsed.name || null,
    description: parsed.description || null,
    license: parsed.license || null,
    compatibility: parsed.compatibility || null,
    metadata: parsed.metadata || null,
    'allowed-tools': null,
  };

  // Handle allowed-tools: support both space-delimited string and YAML array
  if (parsed['allowed-tools']) {
    if (Array.isArray(parsed['allowed-tools'])) {
      result.frontmatter['allowed-tools'] = parsed['allowed-tools'].join(' ');
    } else {
      result.frontmatter['allowed-tools'] = parsed['allowed-tools'];
    }
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

  // Extract ## sections
  let description = '';
  let source = '';
  const sections = {};
  let currentSection = null;

  for (const line of lines) {
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
  const yamlLines = [];

  // Required fields
  if (skill.name) yamlLines.push(`name: ${quoteYamlValue(skill.name)}`);
  if (skill.description) yamlLines.push(`description: ${quoteYamlValue(skill.description)}`);

  // Optional fields
  if (skill.license) yamlLines.push(`license: ${quoteYamlValue(skill.license)}`);
  if (skill.compatibility) yamlLines.push(`compatibility: ${quoteYamlValue(skill.compatibility)}`);

  // allowed-tools as space-delimited string per spec
  const allowedTools = normalizeAllowedTools(skill.allowed_tools || skill.allowedTools);
  if (allowedTools) {
    yamlLines.push(`allowed-tools: ${quoteYamlValue(allowedTools)}`);
  }

  // Metadata as nested YAML
  const metadata = normalizeMetadata(skill.metadata);
  if (metadata && Object.keys(metadata).length > 0) {
    yamlLines.push('metadata:');
    for (const [k, v] of Object.entries(metadata)) {
      yamlLines.push(`  ${k}: ${quoteYamlValue(String(v))}`);
    }
  }

  const frontmatter = `---\n${yamlLines.join('\n')}\n---`;
  const body = skill.instructions || '';
  return `${frontmatter}\n\n${body}\n`;
}

/**
 * Quote a YAML value if it contains characters that could break parsing.
 */
function quoteYamlValue(val) {
  if (!val) return '""';
  // Quote if contains colons, quotes, or special YAML chars
  if (/[:#{}[\],&*?|>!%@`]/.test(val) || val.includes('"') || val.includes("'")) {
    return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return val;
}

/**
 * Normalize allowed_tools from various formats to a space-delimited string.
 */
function normalizeAllowedTools(tools) {
  if (!tools) return null;
  if (typeof tools === 'string') {
    // Could be JSON array string or already space-delimited
    try {
      const parsed = JSON.parse(tools);
      if (Array.isArray(parsed)) return parsed.join(' ');
    } catch (e) {
      // Already a string (possibly space-delimited)
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
