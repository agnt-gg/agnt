/**
 * What recovery does with the journal FILE, which is the only copy of an
 * interrupted turn.
 *
 * The deletion policy is the whole point of these tests. Deleting after a
 * decision is correct: the decision will be the same on the next boot, so
 * keeping the file would mean re-deciding it forever. Deleting after an
 * EXCEPTION is not, because an exception at boot is frequently transient — a
 * database still opening, a locked sqlite file, a disk hiccup — and the file
 * being deleted is the only record that the turn ever happened.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./runJournal.js', () => ({
  listJournals: vi.fn(),
  removeJournalFile: vi.fn(async () => {}),
  MAX_JOURNAL_AGE_MS: 24 * 60 * 60 * 1000,
}));

vi.mock('./persistTurnTranscript.js', () => ({
  writeTranscript: vi.fn(),
}));

import { recoverJournaledRuns } from './recoverJournaledRuns.js';
import { listJournals, removeJournalFile, MAX_JOURNAL_AGE_MS } from './runJournal.js';
import { writeTranscript } from './persistTurnTranscript.js';

/** A journal with enough substance that messagesFromJournal returns messages. */
function journal(overrides = {}) {
  return {
    file: '/tmp/run-journal/conv-abc-1234.json',
    conversationId: 'conv-abc',
    userId: 'user-1',
    journaledAt: Date.now(),
    userMessage: 'does this survive?',
    events: [
      { eventName: 'assistant_message', data: { id: 'msg-1', content: 'a partial answer' } },
    ],
    ...overrides,
  };
}

describe('recoverJournaledRuns — when the journal file is deleted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('KEEPS the journal when the write throws, because the failure may be transient', async () => {
    listJournals.mockResolvedValue([journal()]);
    // The shape of a boot-time failure: the database is not ready yet.
    writeTranscript.mockRejectedValue(new Error('SQLITE_BUSY: database is locked'));

    const summary = await recoverJournaledRuns();

    expect(removeJournalFile).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    expect(summary.recovered).toBe(0);
  });

  it('still does not throw when recovery fails, so a bad journal cannot stop the boot', async () => {
    listJournals.mockResolvedValue([journal()]);
    writeTranscript.mockRejectedValue(new Error('kaboom'));

    await expect(recoverJournaledRuns()).resolves.toMatchObject({ found: 1 });
  });

  it('keeps the journal for one failure but not forever — age expiry still collects it', async () => {
    const old = journal({ journaledAt: Date.now() - (MAX_JOURNAL_AGE_MS + 60_000) });
    listJournals.mockResolvedValue([old]);

    const summary = await recoverJournaledRuns();

    // Expiry runs before any write is attempted, so a journal that fails every
    // boot is still bounded: it is collected once it ages out.
    expect(writeTranscript).not.toHaveBeenCalled();
    expect(removeJournalFile).toHaveBeenCalledWith(old.file);
    expect(summary.expired).toBe(1);
  });

  it('REMOVES the journal once the transcript is written', async () => {
    const j = journal();
    listJournals.mockResolvedValue([j]);
    writeTranscript.mockResolvedValue({ written: true });

    const summary = await recoverJournaledRuns();

    expect(removeJournalFile).toHaveBeenCalledWith(j.file);
    expect(summary.recovered).toBe(1);
  });

  it('REMOVES the journal when the write declines for a permanent reason', async () => {
    const j = journal();
    listJournals.mockResolvedValue([j]);
    writeTranscript.mockResolvedValue({ written: false, reason: 'saved_copy_is_richer' });

    const summary = await recoverJournaledRuns();

    // Not an error: the saved copy already says more. That verdict cannot change
    // on a later boot, so keeping the file would re-decide it forever.
    expect(removeJournalFile).toHaveBeenCalledWith(j.file);
    expect(summary.skipped).toBe(1);
  });

  it('does not let one failing journal stop the next one from being recovered', async () => {
    const bad = journal({ file: '/tmp/bad.json', conversationId: 'conv-bad' });
    const good = journal({ file: '/tmp/good.json', conversationId: 'conv-good' });
    listJournals.mockResolvedValue([bad, good]);
    writeTranscript
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ written: true });

    const summary = await recoverJournaledRuns();

    expect(summary.recovered).toBe(1);
    expect(removeJournalFile).toHaveBeenCalledWith(good.file);
    expect(removeJournalFile).not.toHaveBeenCalledWith(bad.file);
  });
});
