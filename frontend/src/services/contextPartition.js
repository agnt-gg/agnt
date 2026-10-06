/**
 * The request as four disjoint buckets: System, Tools, Skills, Messages.
 *
 * The backend reports three raw buckets (system / tools / messages) because
 * that is how a request is physically built. Skills straddle two of them: the
 * catalog and pinned skills live in the system prompt, activated playbooks in
 * the message history. `manifest.skills` says how much of each is skills, and
 * this carves it out so the four numbers on screen add up to the request and
 * nothing is counted twice.
 *
 * Pure. Both inputs must already be in display units (see contextCalibration).
 *
 * @param {object|null} breakdown context_status breakdown { systemTokens, toolTokens, messagesTokens }
 * @param {object|null} manifest  context_manifest payload (may lack `skills`: older backend)
 * @returns {{system: number, tools: number, skills: number, messages: number, skillsResident: number, skillsLoaded: number}}
 */
export function partitionContext(breakdown, manifest) {
  const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  const systemRaw = num(breakdown?.systemTokens ?? manifest?.system?.total);
  const tools = num(breakdown?.toolTokens ?? manifest?.tools?.total);
  const messagesRaw = num(breakdown?.messagesTokens ?? manifest?.messages?.total);

  // Clamped to the bucket each part lives in: the manifest and the status
  // event are estimated separately and must never produce a negative bucket.
  const skillsResident = Math.min(systemRaw, num(manifest?.skills?.resident));
  const skillsLoaded = Math.min(messagesRaw, num(manifest?.skills?.loadedTokens));

  return {
    system: systemRaw - skillsResident,
    tools,
    skills: skillsResident + skillsLoaded,
    messages: messagesRaw - skillsLoaded,
    skillsResident,
    skillsLoaded,
  };
}
