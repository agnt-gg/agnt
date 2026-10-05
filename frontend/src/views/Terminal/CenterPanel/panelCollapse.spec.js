/**
 * Closing a panel on one page must not close it on any other.
 *
 * Reported: closing the right panel on Chat closed it on every page. The
 * collapse state was one app-wide value every kept-alive screen watched.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isPanelCollapsed, setPanelCollapsed, panelCollapseKey, __resetPanelCollapseForTests } from './panelCollapse.js';

beforeEach(() => {
  localStorage.clear();
  __resetPanelCollapseForTests();
});

describe('panel collapse is per screen', () => {
  it('closing a panel on one screen leaves every other screen alone', () => {
    setPanelCollapsed('right', 'AgentsScreen', true);
    setPanelCollapsed('left', 'AgentsScreen', true);
    expect(isPanelCollapsed('right', 'AgentsScreen')).toBe(true);
    expect(isPanelCollapsed('left', 'AgentsScreen')).toBe(true);
    for (const screen of ['ToolsScreen', 'WorkflowsScreen', 'SettingsScreen']) {
      expect(isPanelCollapsed('right', screen), screen).toBe(false);
      expect(isPanelCollapsed('left', screen), screen).toBe(false);
    }
  });

  it('the two panels of one screen are independent', () => {
    setPanelCollapsed('left', 'ToolsScreen', true);
    expect(isPanelCollapsed('right', 'ToolsScreen')).toBe(false);
  });

  it('remembers each screen across reloads, under its own key', () => {
    setPanelCollapsed('left', 'ToolsScreen', true);
    expect(localStorage.getItem(panelCollapseKey('left', 'ToolsScreen'))).toBe('true');
    __resetPanelCollapseForTests();
    expect(isPanelCollapsed('left', 'ToolsScreen')).toBe(true);
    expect(isPanelCollapsed('left', 'AgentsScreen')).toBe(false);
  });

  it("a screen's registry default wins until it is toggled (Chat starts with the inspector closed)", () => {
    expect(isPanelCollapsed('right', 'ChatScreen')).toBe(true);
    setPanelCollapsed('right', 'ChatScreen', false);
    expect(isPanelCollapsed('right', 'ChatScreen')).toBe(false);
  });

  it("keeps Chat's existing remembered key", () => {
    localStorage.setItem('rightPanelCollapsed:ChatScreen', 'false');
    expect(isPanelCollapsed('right', 'ChatScreen')).toBe(false);
  });

  it('an untoggled screen starts from the old app-wide value, so layouts do not change on upgrade', () => {
    localStorage.setItem('leftPanelCollapsed', 'true');
    expect(isPanelCollapsed('left', 'AgentsScreen')).toBe(true);
    setPanelCollapsed('left', 'AgentsScreen', false);
    // Toggling one screen never writes the old shared value.
    expect(localStorage.getItem('leftPanelCollapsed')).toBe('true');
    expect(isPanelCollapsed('left', 'ToolsScreen')).toBe(true);
  });

  it('refuses a side it does not know', () => {
    expect(() => isPanelCollapsed('top', 'ChatScreen')).toThrow(/left or right/);
  });
});
