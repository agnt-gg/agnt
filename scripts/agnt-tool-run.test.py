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

# Teamspace Files mounted under <workspace>/Teamspaces/<name>.
import json
TEAM = '/app/data/workspace-files/' + 'a' * 64
W = '/app/data/workspaces/member-2'
T_REAL = {W + '/Teamspaces', W + '/Teamspaces/Sales', W + '/Teamspaces/Ops', TEAM, '/app/data/secrets'}
T_LINKS = {W + '/Teamspaces/Linked': '/app/data/secrets'}
t_isdir = lambda p: p in T_REAL or p in T_LINKS
t_islink = lambda p: p in T_LINKS
t_realpath = lambda p: T_LINKS.get(p, p)


def mounts(items):
    return launcher.team_mounts(json.dumps(items), W, realpath=t_realpath, isdir=t_isdir, islink=t_islink)


def mount_refused(items):
    try:
        mounts(items)
        return False
    except launcher.Refused:
        return True


check('no team mounts adds nothing', launcher.team_mounts('', W) == [])
check('a writable teamspace folder is a read-write bind', mounts([{'source': TEAM, 'target': W + '/Teamspaces/Sales', 'rw': True}]) == ['--bind', TEAM, W + '/Teamspaces/Sales'])
check('a read-only teamspace folder is a read-only bind', mounts([{'source': TEAM, 'target': W + '/Teamspaces/Ops', 'rw': False}]) == ['--ro-bind', TEAM, W + '/Teamspaces/Ops'])
for name, bad in [
    ('a source outside workspace-files', {'source': '/app/data/secrets', 'target': W + '/Teamspaces/Sales', 'rw': True}),
    ('the database as a source', {'source': '/app/data/agnt.db', 'target': W + '/Teamspaces/Sales', 'rw': True}),
    ('a target outside Teamspaces', {'source': TEAM, 'target': W + '/Sales', 'rw': True}),
    ('a nested target', {'source': TEAM, 'target': W + '/Teamspaces/Sales/x', 'rw': True}),
    ('a dotted target', {'source': TEAM, 'target': W + '/Teamspaces/..', 'rw': True}),
    ('a symlinked target', {'source': TEAM, 'target': W + '/Teamspaces/Linked', 'rw': True}),
    ('a target that does not exist', {'source': TEAM, 'target': W + '/Teamspaces/Missing', 'rw': True}),
    ('a mode that is not a boolean', {'source': TEAM, 'target': W + '/Teamspaces/Sales', 'rw': 'yes'}),
]:
    check('refuses ' + name, mount_refused([bad]))
check('refuses the same target twice', mount_refused([{'source': TEAM, 'target': W + '/Teamspaces/Sales', 'rw': True}] * 2))
try:
    launcher.team_mounts('not json', W)
    check('refuses non-JSON mounts', False)
except launcher.Refused:
    check('refuses non-JSON mounts', True)

if failures:
    print('%d FAILED' % len(failures))
    sys.exit(1)
print('ALL PASSED')
