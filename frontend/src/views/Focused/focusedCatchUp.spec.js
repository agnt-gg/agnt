import { describe, it, expect } from 'vitest';
import { appsSentence } from './focusedCatchUp.js';

describe('the apps line on the chat start screen', () => {
  it('names a few apps and counts the rest', () => {
    expect(appsSentence(['Gmail'])).toBe('Gmail');
    expect(appsSentence(['Gmail', 'Slack'])).toBe('Gmail and Slack');
    expect(appsSentence(['Gmail', 'Slack', 'Notion', 'GitHub'])).toBe('Gmail, Slack, Notion and GitHub');
    expect(appsSentence(['Gmail', 'Slack', 'Notion', 'GitHub', 'Stripe', 'Zoom'])).toBe('Gmail, Slack, Notion and 3 more');
  });

  it('ignores blanks and repeats, and says nothing about no apps', () => {
    expect(appsSentence(['Gmail', ' ', 'Gmail', null, 'Slack'])).toBe('Gmail and Slack');
    expect(appsSentence([])).toBe('');
    expect(appsSentence()).toBe('');
  });
});
