import { describe, expect, it } from 'vitest';
import { mimeFor, normalizeBundlePath, resolveManifestFile, shouldExclude } from './manifest.js';

// Bundle contents are gathered by portableBundle.js (references, patterns, opted-in folders); these are the
// shared path rules it relies on.
describe('artifact bundle manifest', () => {
  it('excludes secrets, hidden paths, dependencies and archives', () => {
    expect(shouldExclude('.env')).toBe('secret_like_name');
    expect(shouldExclude('node_modules', true)).toBe('generated_or_dependency_directory');
    expect(shouldExclude('out.zip')).toBe('temporary_or_archive');
    expect(shouldExclude('assets/.cache-file')).toBe('hidden_path');
    expect(shouldExclude('.well-known/assetlinks.json')).toBeNull();
    expect(mimeFor('assets/threshold/04.jpg')).toBe('image/jpeg');
  });
  it('rejects traversal and absolute paths', () => {
    expect(() => normalizeBundlePath('../secret')).toThrow(/Unsafe/);
    expect(() => normalizeBundlePath('C:/secret')).toThrow(/Unsafe/);
    expect(() => resolveManifestFile('C:/workspace','site','../secret')).toThrow(/Unsafe/);
  });
  it('resolves a manifest file inside its root and refuses to leave it', () => {
    const resolved = resolveManifestFile('C:/workspace', 'project', 'site/index.html').replace(/\\/g, '/');
    expect(resolved.endsWith('/workspace/project/site/index.html')).toBe(true);
  });
  it('recognizes credential-like names', () => {
    expect(shouldExclude('assets/client.pem')).toBe('secret_like_name');
    expect(shouldExclude('assets/image.png')).toBeNull();
  });
});
