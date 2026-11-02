#!/usr/bin/python3
"""Kernel boundary for hosted tool children; never used by desktop installs.
Only immutable runtime files and ONE workspace enter the mount namespace: the
acting account's own (the owner's is the projects folder, a member's is
/app/data/workspaces/<id>). So a member's code never sees the owner's files or
another member's. The backend, its /proc entries, database, secrets and
credential store never enter. No fallback to unsandboxed execution exists.

Besides that workspace, the teamspace Files the caller may use (decided by the
server, teamFolders.js) are mounted at <workspace>/Teamspaces/<name>. Each is
re-checked here: the source must be a real teamspace files folder and the
target a real folder directly under the workspace's Teamspaces folder.
"""
import json
import os
import re
import sys

PROJECTS = '/app/data/projects'
MEMBER_WORKSPACE = re.compile(r'/app/data/workspaces/[A-Za-z0-9_-]{1,80}')
RUNTIME = ['/usr', '/lib', '/bin', '/sbin', '/etc/ssl', '/etc/fonts', '/etc/ca-certificates', '/etc/pki', '/etc/services', '/etc/protocols', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/passwd', '/etc/group',
           # yt-dlp's system config (the JS runtime YouTube needs); see the Dockerfile.
           '/etc/yt-dlp.conf']
SAFE_ENV = {'LANG', 'LC_ALL', 'TZ', 'TERM', 'PYTHONIOENCODING', 'PYTHONUTF8', 'AGNT_JS_EXECUTOR_CHILD', 'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE',
            # The run's temporary, instance-bound proxy key, never the user's session.
            'AGNT_AUTH_TOKEN',
            # '<port>=<socket in the workspace>': sandbox-network.cjs exposes that loopback port.
            'AGNT_TOOL_EXPOSE'}
# /tmp survives between tool calls, as it did before the sandbox. It sits OUTSIDE
# the workspace, so workload code can fill it but can never swap the directory
# itself for a symlink to backend state.
# Each workspace gets its own /tmp, so one account's temp files never reach another's.
TOOL_TMP_ROOT = '/app/data/.tool-tmp'
TEAM_FILES = re.compile(r'/app/data/workspace-files/[0-9a-f]{64}')
TEAM_FOLDER_NAME = re.compile(r'[A-Za-z0-9 _-][A-Za-z0-9 ._-]{0,59}')
MAX_TEAM_MOUNTS = 50


class Refused(Exception):
    pass


def inside(child, parent):
    return child == parent or child.startswith(parent + '/')


def resolve_workspace(requested, cwd, realpath=os.path.realpath, isdir=os.path.isdir):
    """The workspace to mount and the tmp key for it, or Refused.

    `requested` comes from the trusted server (toolProcess.js); it is still
    re-checked here because this file is the boundary, not the server.
    """
    workspace = requested or PROJECTS
    if os.path.normpath(workspace) != workspace or not workspace.startswith('/'):
        raise Refused('workspace must be a normalised absolute path')
    if inside(workspace, PROJECTS):
        tmp_key = 'owner'
    elif MEMBER_WORKSPACE.fullmatch(workspace):
        tmp_key = 'member-' + workspace.rsplit('/', 1)[1]
    else:
        raise Refused('workspace must be the projects folder or a member folder: ' + workspace)
    if not isdir(workspace) or realpath(workspace) != workspace:
        raise Refused('workspace must be a real directory at ' + workspace)
    current = realpath(cwd)
    if not inside(current, workspace):
        raise Refused('working directory must be inside the workspace')
    return workspace, current, tmp_key


def team_mounts(raw, workspace, realpath=os.path.realpath, isdir=os.path.isdir, islink=os.path.islink):
    """bwrap arguments for the teamspace folders, or Refused. `raw` is AGNT_TOOL_TEAM_MOUNTS (JSON)."""
    if not raw:
        return []
    try:
        mounts = json.loads(raw)
    except ValueError:
        raise Refused('team mounts must be JSON')
    if not isinstance(mounts, list) or len(mounts) > MAX_TEAM_MOUNTS:
        raise Refused('team mounts must be a short list')
    parent = workspace + '/Teamspaces'
    if mounts and (not isdir(parent) or islink(parent) or realpath(parent) != parent):
        raise Refused('the Teamspaces folder must be a real directory')
    args = []
    seen = set()
    for mount in mounts:
        if not isinstance(mount, dict):
            raise Refused('a team mount must be an object')
        source, target, rw = mount.get('source'), mount.get('target'), mount.get('rw')
        if not isinstance(source, str) or not TEAM_FILES.fullmatch(source):
            raise Refused('a team mount source must be a teamspace files folder')
        if not isdir(source) or islink(source) or realpath(source) != source:
            raise Refused('a team mount source must be a real directory')
        if not isinstance(target, str) or os.path.dirname(target) != parent or not TEAM_FOLDER_NAME.fullmatch(os.path.basename(target)):
            raise Refused('a team mount target must be a folder directly under Teamspaces')
        if not isdir(target) or islink(target) or realpath(target) != target or target in seen:
            raise Refused('a team mount target must be a real, unused directory')
        if not isinstance(rw, bool):
            raise Refused('a team mount must say read-only or read-write')
        seen.add(target)
        args += ['--bind' if rw else '--ro-bind', source, target]
    return args


def fail(message):
    print('tool sandbox: ' + message, file=sys.stderr)
    sys.exit(126)


def private_dir(path):
    os.makedirs(path, mode=0o700, exist_ok=True)
    if os.path.realpath(path) != path:
        fail(path + ' cannot be a symlink')


def main():
    if len(sys.argv) < 2:
        fail('a command is required')
    try:
        workspace, current, tmp_key = resolve_workspace(os.environ.get('AGNT_TOOL_WORKSPACE', ''), os.getcwd())
    except Refused as refused:
        fail(str(refused))
    # Private tool home is IN the workspace; it never exposes the server HOME.
    home = workspace + '/.tool-home'
    private_dir(home)
    private_dir(TOOL_TMP_ROOT)
    tool_tmp = TOOL_TMP_ROOT + '/' + tmp_key
    private_dir(tool_tmp)
    args = ['/usr/bin/bwrap', '--unshare-user', '--uid', '1000', '--gid', '1000',
            '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-net', '--hostname', 'tool',
            '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv']
    for source in RUNTIME:
        if os.path.exists(source):
            args += ['--ro-bind', source, source]
    # Code/dependencies are immutable and contain no .env or writable server state.
    for source in ['/app/node_modules', '/app/package.json', '/app/backend/src', '/app/backend/package.json']:
        if os.path.exists(source):
            args += ['--ro-bind', source, source]
    os.environ['AGNT_TOOL_WORKSPACE_MOUNTED'] = workspace
    args += ['--bind', workspace, workspace, '--proc', '/proc', '--dev', '/dev',
             '--bind', tool_tmp, '/tmp', '--tmpfs', '/var/tmp', '--dir', '/run',
             '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin',
             '--setenv', 'HOME', home, '--setenv', 'TMPDIR', '/tmp',
             '--setenv', 'NODE_PATH', workspace + '/node_modules:/app/node_modules',
             '--setenv', 'NODE_ENV', 'production', '--setenv', 'USER_DATA_PATH', '/app/data',
             '--setenv', 'AGNT_TOOL_SANDBOX', '1', '--chdir', current]
    # After the workspace bind, so each teamspace folder overlays its mount point inside it.
    try:
        args += team_mounts(os.environ.get('AGNT_TOOL_TEAM_MOUNTS', ''), workspace)
    except Refused as refused:
        fail(str(refused))
    for name in SAFE_ENV | {'AGNT_TOOL_WORKSPACE_MOUNTED'}:
        if name in os.environ:
            args += ['--setenv', name, os.environ[name]]
    # Possession of this one Unix socket grants only this run's scoped API and
    # filtered internet egress. No bearer credential enters code or its env.
    import stat
    broker = os.environ.get('AGNT_TOOL_SOCKET', '')
    if not broker.startswith('/app/data/.tool-network/run-') or not stat.S_ISSOCK(os.stat(broker).st_mode):
        fail('a per-run network broker is required')
    args += ['--ro-bind', broker, '/run/agnt/proxy.sock', '--remount-ro', '/proc', '--remount-ro', '/']
    # Parent chooses which descriptors to preserve for Node's fork IPC.
    ipc = os.environ.get('NODE_CHANNEL_FD')
    keep = int(ipc) if ipc is not None else 2
    if keep not in (2, 3):
        fail('unexpected IPC descriptor')
    if keep == 3:
        os.set_inheritable(3, True)
    seccomp = os.open('/usr/local/lib/agnt/tool-seccomp.bpf', os.O_RDONLY)
    # Move BPF beyond optional IPC, and mark it for the exec. bwrap closes it after loading.
    import fcntl
    descriptor = fcntl.fcntl(seccomp, fcntl.F_DUPFD, keep + 1)
    os.close(seccomp)
    os.set_inheritable(descriptor, True)
    args += ['--seccomp', str(descriptor), '--', '/usr/local/bin/node',
             '/usr/local/lib/agnt/sandbox-network.cjs'] + sys.argv[1:]
    # Everything else inherited from a library (socket, open DB, credential file) is closed.
    for entry in os.listdir('/proc/self/fd'):
        number = int(entry)
        if number > 2 and number != descriptor and not (keep == 3 and number == 3):
            try:
                os.close(number)
            except OSError:
                pass
    os.execve(args[0], args, {'PATH': '/usr/bin:/bin'})


if __name__ == '__main__':
    main()
