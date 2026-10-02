import { describe, it, expect } from 'vitest';
import { createAttemptResponse } from './attemptResponse.js';

function fakeRes() {
  const log = [];
  return {
    log,
    headersSent: true,
    write: (chunk) => { log.push(['write', String(chunk)]); return true; },
    end: (chunk) => { log.push(['end', chunk === undefined ? undefined : String(chunk)]); },
    status(code) { log.push(['status', code]); return this; },
    send: (body) => { log.push(['send', String(body)]); },
    setHeader: () => {},
  };
}

describe('createAttemptResponse', () => {
  it('a setup error before any content is captured, not sent', async () => {
    const res = fakeRes();
    const { response, state, settled } = createAttemptResponse(res);
    response.status(500).write(`data: ${JSON.stringify({ error: 'Stream error: 429 rate limit' })}\n\n`);
    response.end();
    expect(await settled).toMatchObject({ failed: true, committed: false, error: 'Stream error: 429 rate limit' });
    expect(state.failed).toBe(true);
    expect(res.log).toEqual([]);
  });

  it('a 500 send before content is a failure (Anthropic setup path)', async () => {
    const res = fakeRes();
    const { response, settled } = createAttemptResponse(res);
    response.status(500).send('Error setting up stream');
    expect((await settled).error).toBe('Error setting up stream');
    expect(res.log).toEqual([]);
  });

  it('the streamId line is held until content, so an async error after it is still recoverable', async () => {
    const res = fakeRes();
    const { response, settled } = createAttemptResponse(res);
    response.write('{ streamId: abc }\n\n');
    response.status(500).write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
    expect((await settled).failed).toBe(true);
    expect(res.log).toEqual([]);
  });

  it('first content commits: the held streamId is flushed first, then everything passes through', async () => {
    const res = fakeRes();
    const { response, settled } = createAttemptResponse(res);
    response.write('{ streamId: abc }\n\n');
    response.write('Hello');
    expect((await settled).committed).toBe(true);
    response.write(' world');
    response.end();
    expect(res.log).toEqual([['write', '{ streamId: abc }\n\n'], ['write', 'Hello'], ['write', ' world'], ['end', undefined]]);
  });

  it('after commit, a mid-stream error reaches the client (never spliced with another model)', () => {
    const res = fakeRes();
    const { response } = createAttemptResponse(res);
    response.write('partial');
    response.status(500).write('data: {"error":"Stream error"}\n\n');
    expect(res.log.map((e) => e[0])).toEqual(['write', 'status', 'write']);
  });

  it('an empty successful stream still ends the response', async () => {
    const res = fakeRes();
    const { response, settled } = createAttemptResponse(res);
    response.write('{ streamId: abc }\n\n');
    response.end();
    expect((await settled).committed).toBe(true);
    expect(res.log).toEqual([['write', '{ streamId: abc }\n\n'], ['end', undefined]]);
  });

  it('writes after a failure are ignored', async () => {
    const res = fakeRes();
    const { response } = createAttemptResponse(res);
    response.status(401).send('nope');
    response.write('late');
    response.end('later');
    expect(res.log).toEqual([]);
  });
});
