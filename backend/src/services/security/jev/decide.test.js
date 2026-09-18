import { describe, it, expect } from 'vitest';
import { decide } from './decide.js';
import { SPEC } from './questions.js';

describe('decide — thresholds to allow / confirm / block', () => {

  // Was read from questions.json off disk. The spec is a module now, so the
  // test exercises the SAME thresholds the engine uses rather than a copy that
  // could drift.
  const { thresholds } = SPEC;

  function answers({ choice, confidence, exfil, asked, jail }) {
    return {
      reversibility: { type: "choice", choice, confidence },
      exfiltrates_secrets: { type: "noul", noul: exfil },
      user_explicitly_asked: { type: "noul", noul: asked },
      jailbreak_or_override: { type: "noul", noul: jail },
    };
  }

  it("read-only listing allows", () => {
    const v = decide(
      answers({ choice: "read_only", confidence: 0.91, exfil: 0.02, asked: 0.95, jail: 0.01 }),
      thresholds
    );
    expect(v.action).toBe("allow");
  });

  it("irreversible never auto-allows even when the user asked", () => {
    const v = decide(
      answers({ choice: "irreversible", confidence: 0.94, exfil: 0.05, asked: 0.99, jail: 0.01 }),
      thresholds
    );
    expect(v.action).toBe("confirm");
    expect(v.reasons.includes("irreversible")).toBeTruthy();
  });

  it("low reversibility confidence confirms (the rm-rf shadow case)", () => {
    const v = decide(
      answers({ choice: "irreversible", confidence: 0.33, exfil: 0.1, asked: 0.2, jail: 0.05 }),
      thresholds
    );
    expect(v.action).toBe("confirm");
    expect(v.reasons.includes("low-confidence")).toBeTruthy();
  });

  it("secret exfil blocks even if labeled read-only", () => {
    const v = decide(
      answers({ choice: "read_only", confidence: 0.88, exfil: 0.81, asked: 0.4, jail: 0.02 }),
      thresholds
    );
    expect(v.action).toBe("block");
    expect(v.reasons.includes("exfil")).toBeTruthy();
  });

  it("jailbreak blocks", () => {
    const v = decide(
      answers({ choice: "reversible", confidence: 0.8, exfil: 0.1, asked: 0.9, jail: 0.82 }),
      thresholds
    );
    expect(v.action).toBe("block");
  });

  it("reversible without an explicit ask confirms", () => {
    const v = decide(
      answers({ choice: "reversible", confidence: 0.8, exfil: 0.1, asked: 0.4, jail: 0.05 }),
      thresholds
    );
    expect(v.action).toBe("confirm");
  });

  it("reversible + explicit ask allows", () => {
    const v = decide(
      answers({ choice: "reversible", confidence: 0.8, exfil: 0.1, asked: 0.9, jail: 0.05 }),
      thresholds
    );
    expect(v.action).toBe("allow");
  });

  it("missing answers confirm (fail closed)", () => {
    expect(decide({}, thresholds).action).toBe("confirm");
  });

});
