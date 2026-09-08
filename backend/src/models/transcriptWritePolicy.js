/** Ordinary saves cannot manufacture completion authority. The actual revision
 * is a database column written only by the internal completion CAS. */
export function stripClientCompletion(content) {
  try {
    const value = JSON.parse(content);
    if (value && typeof value === 'object' && !Array.isArray(value) && 'serverCompletion' in value) {
      delete value.serverCompletion;
      return JSON.stringify(value);
    }
  } catch { /* legacy non-JSON content */ }
  return content;
}

/** Atomic predicate, evaluated in the UPSERT against the latest stored row.
 * A completed prefix is immutable, but later user turns may be appended.
 * Compare semantic message identity/content, not volatile rendering metadata.
 * Missing/malformed JSON fails closed for a sealed row. */
export const PRESERVES_COMPLETED_PREFIX = `
  CASE WHEN json_valid(excluded.content) AND json_valid(content_outputs.content)
    THEN json_type(excluded.content, '$.messages') = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(content_outputs.content, '$.messages') AS old
        WHERE (json_extract(old.value, '$.role') = 'user' OR old.key <= (
          SELECT MAX(final.key) FROM json_each(content_outputs.content, '$.messages') AS final
          WHERE json_extract(final.value, '$.id') = json_extract(content_outputs.content, '$.serverCompletion.assistantMessageId')
        )) AND (
          json_extract(old.value, '$.role') IS NOT json_extract(excluded.content, '$.messages[' || old.key || '].role') OR
          json_extract(old.value, '$.id') IS NOT json_extract(excluded.content, '$.messages[' || old.key || '].id') OR
          json_extract(old.value, '$.content') IS NOT json_extract(excluded.content, '$.messages[' || old.key || '].content')
        )
      )
      AND EXISTS (
        SELECT 1 FROM json_each(content_outputs.content, '$.messages') AS final
        WHERE json_extract(final.value, '$.id') = json_extract(content_outputs.content, '$.serverCompletion.assistantMessageId')
      )
    ELSE 0 END`;
