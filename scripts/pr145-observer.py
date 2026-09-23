#!/usr/bin/env python3
"""External observer of the supported Playwright CLI; no dependency hooks.
Debug text and temporary archive layout are best-effort observations, not APIs.
Only the pinned public Chromium archive is eligible for retention.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

URL = 'https://cdn.playwright.dev/chrome-for-testing-public/145.0.7632.6/linux64/chrome-linux64.zip'
SIZE = 175440843
ARCHIVE = 'chromium-145.0.7632.6.zip'


def save(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
    path.chmod(0o444)


def retain(tmp, out):
    """No symlink/hardlink/FIFO follows, bounded read, exact pinned size only."""
    for directory in tmp.glob('playwright-download-*'):
        ds = directory.lstat()
        if not stat.S_ISDIR(ds.st_mode):
            continue
        dfd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for name in os.listdir(dfd):
                if not name.startswith('playwright-download-chromium-') or not name.endswith('.zip'):
                    continue
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dfd)
                try:
                    before = os.fstat(fd)
                    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size != SIZE:
                        continue
                    with os.fdopen(os.dup(fd), 'rb') as stream:
                        data = stream.read(SIZE + 1)
                    after = os.fstat(fd)
                    if len(data) != SIZE or (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
                        continue
                    with (out / ARCHIVE).open('xb') as stream:
                        stream.write(data)
                    (out / ARCHIVE).chmod(0o444)
                    save(out / 'archive.json', {'url': URL, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'authenticity': 'observed only, not independently authenticated'})
                    return True
                finally:
                    os.close(fd)
        finally:
            os.close(dfd)
    return False


def observe(argv, out, env, deadline=480, grace=2, tmp=None):
    """Dedicated process group; actual child exit/signal separate from wrapper status.
    Descendants remaining in the owned group are killed even after parent success.
    CI job/container boundary remains responsible for descendants escaping the group.
    """
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    start = time.monotonic()
    result = {'argv': argv, 'returncode': None, 'signal': None, 'spawnError': None,
              'timeout': False, 'cancelSignal': None, 'archiveRetained': False, 'observerErrors': []}
    child = None
    previous = {}
    def cancelled(sig, frame):
        result['cancelSignal'] = sig
    for sig in (signal.SIGTERM, signal.SIGINT):
        previous[sig] = signal.signal(sig, cancelled)
    try:
        with (out / 'installer.stdout').open('xb') as stdout, (out / 'installer.stderr').open('xb') as stderr:
            try:
                child = subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL, stdout=stdout,
                                         stderr=stderr, close_fds=True, start_new_session=True)
            except OSError as error:
                result['spawnError'] = {'errno': error.errno, 'type': type(error).__name__}
            if child:
                # Bounded rolling marker buffer; complete raw logs stay on disk.
                tail = b''
                markers = [False, False, False]
                with (out / 'installer.stderr').open('rb') as log:
                    while True:
                        tail = (tail + log.read(65536))[-131072:]
                        for i, marker in enumerate((URL.encode(), b'SUCCESS downloading', b'extracting archive')):
                            markers[i] |= marker in tail
                        if tmp and all(markers) and not result['archiveRetained']:
                            try:
                                result['archiveRetained'] = retain(Path(tmp), out)
                            except OSError as error:
                                result['observerErrors'].append({'errno': error.errno, 'type': type(error).__name__})
                                tmp = None
                        if child.poll() is not None:
                            break
                        if time.monotonic() - start >= deadline or result['cancelSignal']:
                            result['timeout'] = not bool(result['cancelSignal'])
                            break
                        time.sleep(.02)
    finally:
        if child:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=grace)
            except subprocess.TimeoutExpired:
                pass
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait(timeout=grace)
            result['returncode'] = child.returncode
            result['signal'] = -child.returncode if child.returncode < 0 else None
        result['elapsedSeconds'] = time.monotonic() - start
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        for name in ('installer.stdout', 'installer.stderr'):
            (out / name).chmod(0o444)
        result['wrapperExit'] = (128 + result['cancelSignal'] if result['cancelSignal'] else
                                124 if result['timeout'] else 127 if result['spawnError'] else
                                1 if result['observerErrors'] else
                                128 + result['signal'] if result['signal'] else result['returncode'])
        save(out / 'installer.json', result)
    return result


def main():
    out = Path(sys.argv[1]).resolve()
    scratch = out.parent / (out.name + '-private')
    scratch.mkdir(exist_ok=False)
    for name in ('home', 'tmp', 'browsers'):
        (scratch / name).mkdir()
    node = Path(sys.argv[2]).resolve()
    env = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(scratch / 'home'),
           'TMPDIR': str(scratch / 'tmp'), 'LANG': 'C.UTF-8', 'DEBUG': 'pw:install',
           'PLAYWRIGHT_BROWSERS_PATH': str(scratch / 'browsers'),
           'PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT': '60000'}
    result = observe([str(node), str(Path.cwd() / 'node_modules/playwright/cli.js'), 'install', 'chromium'],
                     out, env, tmp=scratch / 'tmp')
    if result['wrapperExit'] == 0:
        with open(os.environ['GITHUB_ENV'], 'a') as stream:
            stream.write('PLAYWRIGHT_BROWSERS_PATH=' + str(scratch / 'browsers') + '\n')
    return result['wrapperExit']


if __name__ == '__main__':
    sys.exit(main())
