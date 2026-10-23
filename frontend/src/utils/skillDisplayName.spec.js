// Skill names shown as people read them (2026-10-23); stored names unchanged.
import { describe, it, expect } from 'vitest';
import { skillDisplayName } from './skillDisplayName.js';

describe('skillDisplayName', () => {
  it.each([
    ['annie-universal-api-orchestrator', 'Annie Universal API Orchestrator'],
    ['agnt-plugin-builder', 'AGNT Plugin Builder'],
    ['high-end-website-design', 'High End Website Design'],
    ['pdf-research-corpus-analyzer', 'PDF Research Corpus Analyzer'],
    ['frontend-design', 'Frontend Design'],
    ['threejs-advanced-mastery', 'Three.js Advanced Mastery'],
    ['webgpu-threejs-tsl', 'WebGPU Three.js TSL'],
    ['mcp-builder', 'MCP Builder'],
    ['xlsx', 'XLSX'],
    ['hyperframes-cli', 'HyperFrames CLI'],
    ['png_alpha_silhouette_to_svg', 'PNG Alpha Silhouette to SVG'],
    ['agnt-autoresearch/experiment-contract', 'AGNT Autoresearch / Experiment Contract'],
    ['figma-bridge/figma-bridge', 'Figma Bridge / Figma Bridge'],
  ])('%s -> %s', (name, shown) => expect(skillDisplayName(name)).toBe(shown));

  it('keeps a name its author wrote, fixing only known acronyms and brands', () => {
    expect(skillDisplayName('Verified Entity Research (Search-Scrape-Attribute)')).toBe('Verified Entity Research (Search-Scrape-Attribute)');
    expect(skillDisplayName('Multi-Source Web Research & Summary')).toBe('Multi-Source Web Research & Summary');
    expect(skillDisplayName('Agnt api for the ui')).toBe('AGNT API for the UI');
    expect(skillDisplayName('Email-Based Order Tracking and Verification')).toBe('Email-Based Order Tracking and Verification');
  });

  it('never mangles words that only look like acronyms', () => {
    expect(skillDisplayName('custom-typeface-foundry')).toBe('Custom Typeface Foundry');
    expect(skillDisplayName('annie-nudes')).toBe('Annie Nudes');
    expect(skillDisplayName('')).toBe('');
    expect(skillDisplayName(null)).toBe('');
  });
});
