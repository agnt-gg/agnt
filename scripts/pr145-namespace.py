#!/usr/bin/env python3
import os,sys,pathlib,json,fcntl,importlib.util
spec=importlib.util.spec_from_file_location('observer',pathlib.Path(__file__).with_name('pr145-observer.py'))
observer=importlib.util.module_from_spec(spec);spec.loader.exec_module(observer)
def own():
    status=pathlib.Path('/proc/self/status').read_text().splitlines()
    result={'uid':os.getuid(),'gid':os.getgid(),'status':[s for s in status if s.split(':')[0] in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs','Seccomp')], 'namespaces':{},'maps':{}}
    for n in ('user','net','pid','mnt','ipc'):
        result['namespaces'][n]={'id':os.readlink('/proc/self/ns/'+n)}
        try:
            fd=os.open('/proc/self/ns/'+n,os.O_RDONLY)
            try:
                owner=fcntl.ioctl(fd,0xb701) # NS_GET_USERNS; own namespace only
                try: result['namespaces'][n]['owner_inode']=os.fstat(owner).st_ino
                finally: os.close(owner)
            finally: os.close(fd)
        except OSError as e:result['namespaces'][n]['owner_errno']=e.errno
    for n in ('uid_map','gid_map'):result['maps'][n]=pathlib.Path('/proc/self/'+n).read_text()
    # Self-label and fixed read-only policy switches only; never enumerate env,
    # credentials, process peers, audit logs or arbitrary host files.
    result['policy']={}
    for name in ('/proc/self/attr/current', '/proc/self/attr/apparmor/current',
                 '/sys/module/apparmor/parameters/enabled',
                 '/proc/sys/kernel/apparmor_restrict_unprivileged_userns',
                 '/proc/sys/kernel/apparmor_restrict_unprivileged_unconfined'):
        try: result['policy'][name]={'value':pathlib.Path(name).read_text().strip()}
        except OSError as e: result['policy'][name]={'errno':e.errno}
    return result


if sys.argv[1]=='own':
    print(json.dumps(own()));sys.exit(0)
out=pathlib.Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=False)
observer.save(out/'metadata.json',{'own':own(),'note':'expected mixed probe outcomes are diagnostic, never suite acceptance'})
mounts=['--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64','--tmpfs','/etc','--tmpfs','/home','--tmpfs','/tmp','--proc','/proc','--dev','/dev','--ro-bind',str(pathlib.Path(__file__).resolve().parent),'/tools','--setenv','PATH','/usr/bin:/bin']
flags=['--unshare-net','--unshare-pid','--unshare-ipc','--die-with-parent','--new-session','--clearenv']
results=[]
for name,extra in [('original',[]),('explicit-userns',['--unshare-user'])]:
    for suffix,cmd in [('empty',['/usr/bin/true']),('own',['/usr/bin/python3','/tools/pr145-namespace.py','own'])]:
        results.append(observer.observe(['/usr/bin/bwrap']+extra+flags+mounts+['--']+cmd,out/(name+'-'+suffix),{'PATH':'/usr/bin:/bin'},deadline=20))
observer.save(out/'comparison.json',{'probes':results,'note':'Denial is an observed probe result, not suite skip/pass. Native suite remains independently gating; no policy or chosen sandbox flags changed.'})
# A cleanly collected denial is an expected observation, not collection failure.
sys.exit(1 if any(r['timeout'] or r['spawnError'] or r['observerErrors'] or r['cancelSignal'] for r in results) else 0)
