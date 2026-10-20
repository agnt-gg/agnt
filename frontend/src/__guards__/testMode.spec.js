/**
 * The frontend suite runs in test mode no matter which shell launched it.
 *
 * Under an inherited NODE_ENV=production, Vite resolved Node built-ins to
 * browser stubs and Vue loaded its production build: 189 of 508 files failed
 * locally while CI was green. tests/setup/forceTestMode.mjs pins the mode;
 * this fails if that guard is ever dropped from vitest.config.js.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';

describe('test mode', () => {
  it('NODE_ENV is test, not whatever the launching shell had', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('vite is not in production mode', () => {
    expect(import.meta.env.PROD).toBe(false);
    expect(import.meta.env.MODE).toBe('test');
  });

  it('Node built-ins are real, not browser stubs (what source-scanning specs need)', () => {
    expect(typeof fileURLToPath).toBe('function');
    expect(typeof path.resolve).toBe('function');
  });
});
