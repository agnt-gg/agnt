#!/usr/bin/env python3
"""One own-child netlink diagnostic, never a sandbox acceptance result.
No attach, arbitrary command, env dump, read/write tracing or private mounts.
"""
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

SYSCALLS = 'socket,sendmsg,sendto,recvmsg,recvfrom,clone,clone3,unshare,setns,capset'
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C'}


def workload():
    return ['/usr/bin/bwrap', '--unshare-net', '--unshare-pid', '--unshare-ipc',
            '--die-with-parent', '--new-session', '--clearenv',
            '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin',
            '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
            '--tmpfs', '/etc', '--tmpfs', '/home', '--tmpfs', '/tmp',
            '--proc', '/proc', '--dev', '/dev', '--setenv', 'PATH', '/usr/bin:/bin',
            '--', '/usr/bin/true']


def trace_argv(raw):
    # Fixed synthetic workload only. send/recv decoding is needed for rtnetlink;
    # there is no application code, external service or inherited socket here.
    return ['/usr/bin/strace', '-f', '-qq', '-v', '-s', '256',
            '-e', 'trace=' + SYSCALLS, '-e', 'signal=none', '-o', str(raw),
            '--'] + workload()


def parse(text):
    """Only received NLMSG_ERROR is a kernel ACK/error; sends aren't evidence.
    Preserve raw text separately. Unknown/truncated/resumed records stay OPEN.
    EPERM alone does not distinguish capability denial from LSM policy denial.
    """
    replies = []
    unresolved = []
    for line in text.splitlines():
        if 'NLMSG_ERROR' not in line or not re.search(r'\brecv(?:msg|from)\(', line):
            continue
        codes = re.findall(r'\berror=(-?[A-Z][A-Z0-9_]*|-?\d+)\b', line)
        if not codes:
            unresolved.append(line)
        for code in codes:
            if code.lstrip('-').isdigit():
                value = int(code)
            else:
                number = getattr(errno, code.lstrip('-'), None)
                value = -number if number is not None and code.startswith('-') else None
            replies.append({'decoded': code, 'value': value,
                            'ack': value == 0 if value is not None else None,
                            'requestTypes': re.findall(r'nlmsg_type=(RTM_\w+)', line)})
    return {'replies': replies, 'unresolved': unresolved,
            'status': 'observed' if replies and not unresolved and all(r['value'] is not None for r in replies) else 'OPEN'}


def own():
    # Pre-exec observer credentials, NOT asserted to be post-exec bwrap policy.
    allowed = {'Uid', 'Gid', 'CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb',
               'NoNewPrivs', 'Seccomp'}
    result = {'status': [s for s in Path('/proc/self/status').read_text().splitlines()
                         if s.split(':')[0] in allowed]}
    try:
        result['preExecLabel'] = Path('/proc/self/attr/current').read_text().strip()
    except OSError as error:
        result['labelErrno'] = error.errno
    result['bwrapChildLabel'] = {'status': 'OPEN', 'reason':
        'No race-prone peer scan or ptrace stop injection; short-lived post-exec label not sampled.'}
    st = Path('/usr/bin/bwrap').stat()
    result['bwrap'] = {'mode': oct(st.st_mode), 'uid': st.st_uid, 'gid': st.st_gid,
                      'sha256': hashlib.sha256(Path('/usr/bin/bwrap').read_bytes()).hexdigest()}
    try:
        result['bwrap']['fileCapabilityHex'] = os.getxattr('/usr/bin/bwrap', 'security.capability').hex()
    except OSError as error:
        result['bwrap']['fileCapabilityErrno'] = error.errno
    return result


def self_test():
    # Given decoded synthetic kernel replies, ACK differs from denial/protocol error.
    prefix = '42 recvmsg(3, {msg_iov=[{iov_base=[{nlmsg_type=NLMSG_ERROR}, {error='
    def reply(code):
        return prefix + code + ', msg={nlmsg_type=RTM_NEWADDR}}]}]}) = 52'
    for code, value in [('0', 0), ('-EPERM', -1), ('-EACCES', -13), ('-EINVAL', -22), ('-95', -95)]:
        result = parse(reply(code))
        assert result['replies'][0]['value'] == value
        assert result['replies'][0]['ack'] == (value == 0)
    assert not parse(reply('-EPERM').replace('recvmsg(', 'sendmsg('))['replies']
    assert parse('recvmsg(3, {nlmsg_type=NLMSG_ERROR, ...})')['status'] == 'OPEN'
    assert parse('')['status'] == 'OPEN'
    assert parse(reply('-UNKNOWN'))['replies'][0]['value'] is None
    argv = trace_argv('/receipt/raw.strace')
    assert argv[argv.index('--') + 1:] == workload()
    assert set(SYSCALLS.split(',')) == {'socket', 'sendmsg', 'sendto', 'recvmsg', 'recvfrom', 'clone', 'clone3', 'unshare', 'setns', 'capset'}
    assert ENV == {'PATH': '/usr/bin:/bin', 'LANG': 'C'}
    assert workload().count('--ro-bind') == 1
    assert workload()[-2:] == ['--', '/usr/bin/true']
    assert not any(x in argv for x in ['-p', '--attach', '-E', '--user', '--unshare-user', '--cap-add'])
    print('PASS: synthetic ACK/EPERM/EACCES/EINVAL/numeric/unknown/truncated/send-only; fixed argv, syscall and environment allowlists')


def main():
    if sys.argv[1:] == ['--self-test']:
        self_test()
        return 0
    if len(sys.argv) != 2:
        raise SystemExit('usage: pr145-namespace.py OUTPUT | --self-test')
    spec = importlib.util.spec_from_file_location('observer', Path(__file__).with_name('pr145-observer.py'))
    observer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(observer)
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=False)
    observer.save(out / 'metadata.json', {'preExec': own(), 'environment': ENV,
        'scope': 'Only own fixed bwrap child; AF_NETLINK expected from loopback setup. No read/write/execve buffers traced.',
        'comparison': 'Prior untraced hosted run 35809579895 original-empty: exit 1, Failed RTM_NEWADDR: Operation not permitted. Native suite in this job is the current untraced comparison.',
        'limitations': 'ptrace can suppress setuid/file-capability privilege transitions and alter timing. EPERM is not unique to capability or AppArmor denial. No causal fix or policy attribution from errno alone.'})
    raw = out / 'raw.strace'
    result = observer.observe(trace_argv(raw), out / 'trace', ENV, deadline=20)
    text = raw.read_text() if raw.exists() else ''
    if raw.exists():
        raw.chmod(0o444)
    observer.save(out / 'netlink.json', {**parse(text), 'traceExit': result['returncode'],
        'wrapperExit': result['wrapperExit'], 'rawSha256': hashlib.sha256(text.encode()).hexdigest(),
        'suiteAcceptance': False})
    # Retain true child failure in receipt; clean diagnostic collection isn't suite success.
    return (result['wrapperExit'] or 1) if (result['timeout'] or result['spawnError'] or
        result['observerErrors'] or result['cancelSignal']) else 0


if __name__ == '__main__':
    sys.exit(main())
