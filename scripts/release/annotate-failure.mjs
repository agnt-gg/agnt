#!/usr/bin/env node
/**
 * annotate-failure: turn the end of a failed tool's log into a GitHub
 * annotation, so the reason is on the run page for anyone, signed in or not.
 *
 *   node scripts/release/annotate-failure.mjs <log> "<title>"
 *
 * Portable on purpose: the first version used GNU sed, which macOS does not
 * have, and the one failure it existed to explain was a macOS build.
 */
import fs from 'node:fs';

const [file, title = 'failed'] = process.argv.slice(2);
if (!file || !fs.existsSync(file)) process.exit(0);
const lines = fs.readFileSync(file, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).filter((l) => l.trim());
// The lines that explain a failure, then the last lines for context.
const telling = lines.filter((l) => /⨯|error|Error|ERR!|failed|Notarize|notariz|codesign|\[native\]/i.test(l)).slice(-25);
const tail = lines.slice(-15);
const body = [...new Set([...telling, '---', ...tail])].join('\n').slice(-6000);
const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
console.log(`::error title=${esc(title)}::${esc(body)}`);
