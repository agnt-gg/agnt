/**
 * Pure policy: Jev answers + thresholds (+ local evidence) -> allow | confirm | block.
 * Irreversible never auto-allows. API/schema failures must not reach here.
 *
 * `evidence` is the deterministic result of secretScan.mjs and OVERRIDES the
 * model in both directions, because the soak proved Jev scores filenames:
 *   - proven secret content/permission  -> block, even if Jev said allow
 *     (this is the ~/.ssh/id_ed25519 miss)
 *   - exfil claim whose every path is ABSENT, with no egress command
 *     -> the claim is about a file that cannot be read; stop calling it exfil
 *     (this is the ~/.ssh/id_rsa phantom)
 * Evidence is optional; omitting it reproduces the old model-only behaviour.
 */

export function decide(answers, thresholds, evidence = null) {
  const reasons = [];
  const t = thresholds;

  const reversibility = answers.reversibility;
  const exfil = Number(answers.exfiltrates_secrets?.noul);
  const asked = Number(answers.user_explicitly_asked?.noul);
  const jail = Number(answers.jailbreak_or_override?.noul);

  if (!reversibility || reversibility.type !== "choice" || !reversibility.choice) {
    return { action: "confirm", reasons: ["missing-reversibility-answer"] };
  }
  if (![exfil, asked, jail].every(Number.isFinite)) {
    return { action: "confirm", reasons: ["missing-noul"] };
  }

  const choice = reversibility.choice;
  const confidence = Number(reversibility.confidence);

  // Proven secret material beats any model score, in either direction.
  if (evidence?.hasRealSecret) {
    reasons.push("secret-content");
    for (const p of evidence.secretPaths || []) reasons.push(`${p.why}:${p.path}`);
    return { action: "block", choice, confidence, exfil, asked, jail, reasons, evidence: "local-scan" };
  }

  if (exfil >= t.exfilBlockNoul) {
    // A file that does not exist cannot leak. Only downgrade when the command
    // has no way to move bytes off-box and every path it names is missing.
    const phantom = evidence?.allAbsent && !evidence.egress;
    if (!phantom) {
      reasons.push("exfil");
      return { action: "block", choice, confidence, exfil, asked, jail, reasons };
    }
    reasons.push("phantom-path");
  }
  if (jail >= t.jailbreakBlockNoul) {
    reasons.push("jailbreak");
    return { action: "block", choice, confidence, exfil, asked, jail, reasons };
  }

  if (!Number.isFinite(confidence) || confidence < t.reviewFloorConfidence) {
    reasons.push("low-confidence");
    return { action: "confirm", choice, confidence, exfil, asked, jail, reasons };
  }

  if (choice === "irreversible") {
    reasons.push("irreversible");
    if (asked >= t.explicitAskNoul) reasons.push("user-asked-still-confirm");
    return { action: "confirm", choice, confidence, exfil, asked, jail, reasons };
  }

  if (choice === "reversible") {
    if (asked < t.explicitAskNoul) {
      reasons.push("not-explicitly-asked");
      return { action: "confirm", choice, confidence, exfil, asked, jail, reasons };
    }
    if (confidence < t.allowReversibleConfidence) {
      reasons.push("reversible-confidence-short");
      return { action: "confirm", choice, confidence, exfil, asked, jail, reasons };
    }
    reasons.push("reversible-explicit");
    return { action: "allow", choice, confidence, exfil, asked, jail, reasons };
  }

  if (choice === "read_only") {
    if (confidence < t.allowReadOnlyConfidence) {
      reasons.push("readonly-confidence-short");
      return { action: "confirm", choice, confidence, exfil, asked, jail, reasons };
    }
    reasons.push("read-only");
    return { action: "allow", choice, confidence, exfil, asked, jail, reasons };
  }

  reasons.push("unknown-choice");
  return { action: "confirm", choice, confidence, exfil, asked, jail, reasons };
}
