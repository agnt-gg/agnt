import { describe, it, expect } from 'vitest';
import { goalArtifactSource, writtenPath, toFileUrl } from './goalArtifacts.js';
import { collectChatArtifacts } from '@/utils/chatArtifacts.js';

const task = (content, toolExecutions) => ({ output: JSON.stringify({ content, toolExecutions }) });

describe('goal artifacts', () => {
  it('counts writes, never reads, lists or runs', () => {
    expect(writtenPath({ name: 'file_operations', arguments: { operation: 'write', path: 'C:/p/report.html' } })).toBe('C:/p/report.html');
    expect(writtenPath({ name: 'file_operations', arguments: { operation: 'read', path: 'C:/p/in.md' } })).toBeNull();
    expect(writtenPath({ name: 'write_file', arguments: JSON.stringify({ path: 'C:/p/a.md' }) })).toBe('C:/p/a.md');
    expect(writtenPath({ name: 'file_system_operation', arguments: { operation: 'writeFile', rootDirectory: 'C:/root/', path: '/out.csv' } })).toBe('C:/root/out.csv');
    expect(writtenPath({ name: 'execute_shell_command', arguments: { command: 'echo > x.html' } })).toBeNull();
  });

  it('feeds ArtifactCards deliverables first, deduped, with file links and images from the answers', () => {
    const tasks = [
      task('Wrote it: file:///C:/p/Weekly%20Report.pdf and {{IMAGE_REF:img1}}\n```json\n{"noise":true}\n```', [
        { name: 'file_operations', arguments: { operation: 'write', path: 'C:\\p\\helper.mjs' } },
        { name: 'file_operations', arguments: { operation: 'write', path: 'C:/p/site/index.html' } },
        { name: 'file_operations', arguments: { operation: 'read', path: 'C:/p/source.md' } },
      ]),
      task('again file:///C:/p/Weekly%20Report.pdf', [{ name: 'write_file', arguments: { path: 'C:/p/site/index.html' } }]),
    ];
    const { content, files, toolCalls } = goalArtifactSource(tasks);
    expect(files).toEqual(['C:/p/site/index.html', 'C:/p/helper.mjs']);
    expect(toolCalls).toHaveLength(4);
    const cards = collectChatArtifacts(content);
    expect(cards.map((c) => c.name)).toEqual(['index.html', 'helper.mjs', 'Weekly Report.pdf', 'Generated image']);
    expect(cards.some((c) => c.language === 'json')).toBe(false);
  });

  it('survives tasks with no or unparseable output', () => {
    expect(goalArtifactSource([{}, { output: 'plain text' }, { output: null }])).toEqual({ content: '', toolCalls: [], files: [] });
  });

  it('encodes paths with spaces so the file link stays one token', () => {
    expect(toFileUrl('C:\\My Files\\a b.html')).toBe('file:///C:/My%20Files/a%20b.html');
  });
});
