#!/usr/bin/env python3
import importlib.util
import os
from pathlib import Path
import signal
import json
import hashlib
import subprocess
import time
import sys
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('observer', Path(__file__).with_name('pr145-observer.py'))
o = importlib.util.module_from_spec(spec)
spec.loader.exec_module(o)

def descendant_stopped(status):
    try:
        # One read: the owned process may disappear during open/read, not just before it.
        return status.read_text().rsplit(')', 1)[1].split()[0] == 'Z'
    except (FileNotFoundError, ProcessLookupError):
        return True

class Controls(unittest.TestCase):
    def setUp(self):
        self.root = Path(os.environ['PR145_CONTROL_ROOT']) / self._testMethodName
        self.root.mkdir(parents=True, exist_ok=False)
    def run_fake(self, source, **kw):
        fake = self.root / 'fake executable.py'
        fake.write_text(source)
        r = o.observe([sys.executable, str(fake), 'argument with spaces'], self.root / 'out',
                      {'PATH': '/usr/bin:/bin'}, deadline=.25, grace=.1, **kw)
        self.assertEqual((self.root / 'out/installer.stdout').read_bytes(), b'partial stdout\n')
        self.assertIn(b'partial stderr', (self.root / 'out/installer.stderr').read_bytes())
        self.assertEqual(json.loads((self.root/'out/installer.json').read_text()), r)
        self.assertEqual((self.root/'out/installer.stdout').stat().st_mode & 0o222, 0)
        return r
    prefix = "import sys,os,signal,time\nprint('partial stdout',flush=True)\nprint('partial stderr',file=sys.stderr,flush=True)\nassert sys.argv[1]=='argument with spaces'\n"
    def test_success(self):
        r = self.run_fake(self.prefix)
        self.assertEqual((r['returncode'],r['wrapperExit']), (0,0))
    def test_nonzero(self):
        r = self.run_fake(self.prefix + 'sys.exit(23)\n')
        self.assertEqual((r['returncode'],r['wrapperExit']), (23,23))
    def test_signal(self):
        r = self.run_fake(self.prefix + 'os.kill(os.getpid(),signal.SIGUSR1)\n')
        self.assertEqual((r['returncode'],r['signal'],r['wrapperExit']), (-10,10,138))
    def test_hang(self):
        r = self.run_fake(self.prefix + 'signal.signal(signal.SIGTERM,signal.SIG_IGN)\ntime.sleep(30)\n')
        self.assertTrue(r['timeout'])
        self.assertEqual((r['returncode'],r['signal'],r['wrapperExit']), (-9,9,124))
        self.assertLess(r['elapsedSeconds'],3)
    def test_spawn_failure(self):
        r = o.observe(['/does-not-exist'], self.root/'out', {}, deadline=.2)
        self.assertEqual(r['spawnError']['errno'],2)
        self.assertIsNone(r['returncode'])
        self.assertEqual(r['wrapperExit'],127)
    def test_archive_allowlist(self):
        tmp=self.root/'tmp';tmp.mkdir()
        d=tmp/'playwright-download-test';d.mkdir()
        out=self.root/'out';out.mkdir()
        (d/'unrelated.zip').write_bytes(b'private')
        f=d/'playwright-download-chromium-linux-test.zip'
        f.write_bytes(b'wrong size')
        self.assertFalse(o.retain(tmp,out))
        with f.open('wb') as stream: stream.truncate(o.SIZE)
        self.assertTrue(o.retain(tmp,out))
        self.assertEqual((out/o.ARCHIVE).stat().st_size,o.SIZE)
        self.assertFalse((out/'unrelated.zip').exists())
    def test_archive_symlink_directory_excluded(self):
        tmp=self.root/'tmp';tmp.mkdir()
        (tmp/'playwright-download-link').symlink_to(self.root, target_is_directory=True)
        out=self.root/'out';out.mkdir()
        self.assertFalse(o.retain(tmp,out))
    def test_archive_requires_markers(self):
        tmp=self.root/'tmp';tmp.mkdir()
        d=tmp/'playwright-download-test';d.mkdir()
        with (d/'playwright-download-chromium-linux-test.zip').open('wb') as stream: stream.truncate(o.SIZE)
        r=self.run_fake(self.prefix,tmp=tmp)
        self.assertFalse(r['archiveRetained'])
    def test_archive_observed(self):
        tmp=self.root/'tmp';tmp.mkdir()
        d=tmp/'playwright-download-test';d.mkdir()
        with (d/'playwright-download-chromium-linux-test.zip').open('wb') as stream: stream.truncate(o.SIZE)
        r=self.run_fake(self.prefix+f"print({o.URL!r},file=sys.stderr,flush=True)\nprint('SUCCESS downloading; extracting archive',file=sys.stderr,flush=True)\n",tmp=tmp)
        self.assertTrue(r['archiveRetained'])
        self.assertEqual(r['returncode'],0)


    def test_cancellation(self):
        # Fake child cancels only its own observer parent, never a host PID.
        r=self.run_fake(self.prefix + 'os.kill(os.getppid(),signal.SIGTERM)\ntime.sleep(30)\n')
        self.assertEqual(r['cancelSignal'],signal.SIGTERM)
        self.assertFalse(r['timeout'])
        self.assertEqual(r['wrapperExit'],143)
        self.assertEqual(r['returncode'],-15)

    def test_descendant_disappears_during_read(self):
        from unittest.mock import Mock
        for error in (FileNotFoundError(2, 'gone'), ProcessLookupError(3, 'gone')):
            self.assertTrue(descendant_stopped(Mock(read_text=Mock(side_effect=error))))

    def test_descendant_liveness_is_not_weakened(self):
        from unittest.mock import Mock
        for state in ('R', 'S', 'D', 'T'):
            self.assertFalse(descendant_stopped(Mock(read_text=Mock(return_value=f'123 (name with spaces) {state} 1'))))
        self.assertTrue(descendant_stopped(Mock(read_text=Mock(return_value='123 (name) Z 1'))))
        with self.assertRaises(PermissionError):
            descendant_stopped(Mock(read_text=Mock(side_effect=PermissionError(13, 'denied'))))

    def test_descendant_cleanup(self):
        pidfile=self.root/'descendant.pid'
        source=self.prefix+f"child=os.fork()\nif child==0:\n signal.signal(signal.SIGTERM,signal.SIG_IGN)\n open({str(pidfile)!r},'w').write(str(os.getpid()))\n time.sleep(30)\nelse:\n while not os.path.exists({str(pidfile)!r}): time.sleep(.005)\n"
        r=self.run_fake(source)
        self.assertEqual((r['returncode'],r['wrapperExit']),(0,0))
        pid=int(pidfile.read_text())
        for _ in range(100):
            status=Path(f'/proc/{pid}/stat')
            if descendant_stopped(status):break
            time.sleep(.01)
        else:self.fail('owned descendant still running after observer exit')

    def test_archive_receipt_exact(self):
        tmp=self.root/'tmp';tmp.mkdir();d=tmp/'playwright-download-exact';d.mkdir()
        with (d/'playwright-download-chromium-linux-test.zip').open('wb') as stream:stream.truncate(o.SIZE)
        r=self.run_fake(self.prefix+f"print({o.URL!r},file=sys.stderr,flush=True)\nprint('SUCCESS downloading; extracting archive',file=sys.stderr,flush=True)\n",tmp=tmp)
        self.assertTrue(r['archiveRetained'])
        archive=self.root/'out'/o.ARCHIVE
        receipt=json.loads((self.root/'out/archive.json').read_text())
        self.assertEqual(receipt['bytes'],o.SIZE)
        self.assertEqual(receipt['url'],o.URL)
        self.assertEqual(receipt['sha256'],hashlib.sha256(archive.read_bytes()).hexdigest())
        self.assertEqual(archive.stat().st_mode & 0o222,0)

if __name__=='__main__': unittest.main(verbosity=2)
