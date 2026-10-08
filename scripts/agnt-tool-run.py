#!/usr/bin/python3
"""Kernel boundary for hosted tool children; never used by desktop installs.
Only immutable runtime files and the tenant workspace enter the mount namespace.
The backend, its /proc entries, database, secrets and credential store do not.
No fallback to unsandboxed execution exists.
"""
import os
import sys

WORKSPACE = '/app/data/projects'
RUNTIME = ['/usr', '/lib', '/bin', '/sbin', '/etc/ssl', '/etc/fonts', '/etc/ca-certificates', '/etc/pki', '/etc/services', '/etc/protocols', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/passwd', '/etc/group']
SAFE_ENV = {'LANG', 'LC_ALL', 'TZ', 'TERM', 'PYTHONIOENCODING', 'PYTHONUTF8', 'AGNT_JS_EXECUTOR_CHILD', 'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE'}


def fail(message):
    print('tool sandbox: ' + message, file=sys.stderr)
    sys.exit(126)


def main():
    if len(sys.argv) < 2:
        fail('a command is required')
    if not os.path.isdir(WORKSPACE) or os.path.realpath(WORKSPACE) != WORKSPACE:
        fail('workspace must be a real directory at ' + WORKSPACE)
    current = os.path.realpath(os.getcwd())
    if current != WORKSPACE and not current.startswith(WORKSPACE + '/'):
        fail('working directory must be inside the workspace')
    # Private tool home is IN the workspace; it never exposes the server HOME.
    home = WORKSPACE + '/.tool-home'
    os.makedirs(home, mode=0o700, exist_ok=True)
    if os.path.realpath(home) != home:
        fail('tool home cannot be a symlink')
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
    args += ['--bind', WORKSPACE, WORKSPACE, '--proc', '/proc', '--dev', '/dev',
             '--tmpfs', '/tmp', '--tmpfs', '/var/tmp', '--dir', '/run',
             '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin',
             '--setenv', 'HOME', home, '--setenv', 'TMPDIR', '/tmp',
             '--setenv', 'NODE_PATH', WORKSPACE + '/node_modules:/app/node_modules',
             '--setenv', 'NODE_ENV', 'production', '--setenv', 'USER_DATA_PATH', '/app/data',
             '--setenv', 'AGNT_TOOL_SANDBOX', '1', '--chdir', current]
    for name in SAFE_ENV:
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
