#!/usr/bin/python3
"""Tests for the hosted tool launcher's workspace check (scripts/agnt-tool-run.py).

Runs with the image's own python3, where the launcher ships:
  docker run --rm --entrypoint python3 -v "$PWD/scripts:/t:ro" <image> /t/agnt-tool-run.test.py
Exits non-zero on any failure.
"""
import importlib.machinery
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.environ.get('LAUNCHER', os.path.join(HERE, 'agnt-tool-run.py'))
loader = importlib.machinery.SourceFileLoader('launcher', SOURCE)
spec = importlib.util.spec_from_loader('launcher', loader)
launcher = importlib.util.module_from_spec(spec)
loader.exec_module(launcher)

REAL = {'/app/data/projects', '/app/data/projects/site', '/app/data/workspaces/member-2', '/app/data/workspaces/member-2/sub'}
LINKS = {'/app/data/workspaces/linked': '/app/data/projects'}
realpath = lambda p: LINKS.get(p, p)
isdir = lambda p: p in REAL or p in LINKS

failures = []


def check(name, condition):
    print(('ok   ' if condition else 'FAIL ') + name)
    if not condition:
        failures.append(name)


def resolves(requested, cwd):
    return launcher.resolve_workspace(requested, cwd, realpath=realpath, isdir=isdir)


def refused(requested, cwd):
    try:
        resolves(requested, cwd)
        return False
    except launcher.Refused:
        return True


check('no request mounts the projects folder (internal runs)', resolves('', '/app/data/projects') == ('/app/data/projects', '/app/data/projects', 'owner'))
check('the owner may work in a folder inside projects', resolves('/app/data/projects/site', '/app/data/projects/site')[2] == 'owner')
check('a member mounts only their own folder, with their own tmp', resolves('/app/data/workspaces/member-2', '/app/data/workspaces/member-2/sub') == ('/app/data/workspaces/member-2', '/app/data/workspaces/member-2/sub', 'member-member-2'))
check('a member cwd in the projects folder is refused', refused('/app/data/workspaces/member-2', '/app/data/projects'))
check('a member cwd in another member folder is refused', refused('/app/data/workspaces/member-2', '/app/data/workspaces/member-3'))
for bad in ['/app/data', '/', '/etc', '/app/data/workspaces', '/app/data/workspaces/a/b', '/app/data/projects-x',
            '/app/data/workspaces/../projects', 'app/data/projects', '/app/data/workspaces/a b']:
    check('refuses workspace ' + bad, refused(bad, bad))
check('a member folder that is a symlink is refused', refused('/app/data/workspaces/linked', '/app/data/workspaces/linked'))
check('a member folder that does not exist is refused', refused('/app/data/workspaces/member-9', '/app/data/workspaces/member-9'))

if failures:
    print('%d FAILED' % len(failures))
    sys.exit(1)
print('ALL PASSED')
