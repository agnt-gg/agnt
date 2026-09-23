import { createHash } from 'node:crypto';

export function skillMetadata(skill) {
  if (!skill?.metadata) return {};
  const metadata = typeof skill.metadata === 'string' ? JSON.parse(skill.metadata) : skill.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid skill metadata');
  return metadata;
}

/** Legacy human/imported skills remain usable. Generated drafts require explicit opt-in. */
export function isDefaultSkill(skill) {
  try { return !['draft', 'candidate', 'rejected', 'superseded'].includes(skillMetadata(skill).skillforge?.status); }
  catch { return false; }
}

export function skillIdentity(skill, source = 'database', instructions = skill.instructions || '') {
  const hash = createHash('sha256').update(instructions).digest('hex');
  const metadata = skillMetadata(skill);
  return { skill_id: source === 'database' ? skill.id : `filesystem:${skill.name}`, source,
    version: metadata.skillforge?.currentVersion ?? null, content_hash: hash,
    verification_status: metadata.skillforge?.status || 'user_or_imported' };
}
