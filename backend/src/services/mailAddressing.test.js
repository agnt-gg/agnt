import { describe, it, expect } from 'vitest';
import { workflowTag, workflowAddress, deliveredTag } from './mailAddressing.js';

const WF = '7a02b5c3-b080-4906-b3d5-8f98a31dbee7';

describe('per-workflow mail addresses', () => {
  it('a UUID workflow id fits the service tag limit whole', () => {
    expect(workflowTag(WF)).toBe('wf-' + WF);
    expect(workflowTag(WF).length).toBeLessThanOrEqual(40);
    expect(workflowAddress('operator-check@mail.agnt.gg', WF)).toBe(`operator-check+wf-${WF}@mail.agnt.gg`);
  });

  it('strips characters the service would refuse', () => {
    expect(workflowTag('WF_Upper.Case')).toBe('wf-wfuppercase');
  });

  it('reads the tag from deliveredTo, in bare or display-name form, case-insensitively', () => {
    expect(deliveredTag({ deliveredTo: `operator-check+wf-${WF}@mail.agnt.gg` })).toBe('wf-' + WF);
    expect(deliveredTag({ deliveredTo: `Ops <Operator-Check+WF-${WF.toUpperCase()}@Mail.AGNT.gg>` })).toBe('wf-' + WF);
  });

  it('bare inbox delivery has no tag, and deliveredTo wins over To', () => {
    expect(deliveredTag({ deliveredTo: '', to: 'operator-check@mail.agnt.gg' })).toBeNull();
    expect(deliveredTag({ deliveredTo: 'operator-check@mail.agnt.gg', to: 'operator-check+wf-x@mail.agnt.gg' })).toBeNull();
    expect(deliveredTag({ to: 'operator-check+wf-x@mail.agnt.gg' })).toBe('wf-x');
  });

  it('a To list with several recipients is not mistaken for a single tagged address', () => {
    expect(deliveredTag({ to: 'a@x.com, operator-check+wf-x@mail.agnt.gg' })).toBeNull();
  });
});
