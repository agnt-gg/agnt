import { it, expect, vi } from 'vitest';
import { ConversationWorkScheduler } from './conversationWorkScheduler.js';
it('bounds concurrent admissions and stops scheduling', async () => {
  let release;
  const supervisor = {run: vi.fn(() => new Promise(resolve => {release = resolve;}))};
  const store = {due: vi.fn(async () => [{id: 'one', owner_id: 'owner'}])};
  const scheduler = new ConversationWorkScheduler({store, supervisor});
  scheduler.start();
  await vi.waitFor(() => expect(supervisor.run).toHaveBeenCalledTimes(1));
  await scheduler.tick();
  expect(supervisor.run).toHaveBeenCalledTimes(1);
  scheduler.stop(); release(); await scheduler.drain(); await scheduler.tick();
  expect(supervisor.run).toHaveBeenCalledTimes(1);
});
it('automatically admits unfinished work again without a user message', async () => {
  const store = {due: vi.fn(async () => supervisor.run.mock.calls.length < 2 ? [{id: 'one', owner_id: 'owner'}] : [])};
  const supervisor = {run: vi.fn(async () => ({status: 'queued'}))};
  const scheduler = new ConversationWorkScheduler({store, supervisor, intervalMs: 10});
  try {
    scheduler.start();
    await vi.waitFor(() => expect(supervisor.run).toHaveBeenCalledTimes(2));
  } finally {await scheduler.drain();}
});
