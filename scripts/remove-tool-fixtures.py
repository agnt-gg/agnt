#!/usr/bin/python3
"""Image build only: omit bundled development private keys, not public CAs."""
from pathlib import Path
import re
root = Path('/app/node_modules')
removed = 0
for filename in root.rglob('*'):
    if filename.is_symlink() or not filename.is_file() or filename.suffix not in ('.key', '.pem'):
        continue
    # These files are package fixtures, never the application's credential store.
    if not any(part in ('test', 'tests', 'fixtures', 'example', 'examples') for part in filename.parts):
        continue
    with filename.open('rb') as stream:
        header = stream.read(16384)
    if re.search(rb'-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----', header):
        filename.unlink()
        removed += 1
print('Removed development key fixtures:', removed)
