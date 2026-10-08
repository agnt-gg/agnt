/* Build-time compiler for the tool workload's seccomp layer. bubblewrap loads
 * this AFTER setting up namespaces; children inherit it and cannot remove it.
 * Namespace + read-only mounts enforce access. This layer removes kernel admin,
 * process inspection, and kernel attack surfaces code/tools do not need.
 */
#include <seccomp.h>
#include <errno.h>
#include <linux/sched.h>
#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
static void require(int rc) { if (rc < 0) { fprintf(stderr,"seccomp build failed: %d\n",rc); exit(1); } }
int main(void) {
    scmp_filter_ctx context = seccomp_init(SCMP_ACT_ALLOW);
    if (!context) return 1;
    const char *blocked[] = {"mount","umount2","pivot_root","chroot","setns","unshare",
        "ptrace","process_vm_readv","process_vm_writev","pidfd_getfd", "kexec_load","kexec_file_load",
        "init_module","finit_module","delete_module","reboot","swapon","swapoff","syslog",
        "bpf","perf_event_open","userfaultfd","open_by_handle_at","name_to_handle_at",
        "keyctl","add_key","request_key","io_uring_setup","io_uring_enter","io_uring_register",
        "fsopen","fsmount","fsconfig","open_tree","move_mount","mount_setattr",NULL};
    for (int i=0; blocked[i]; i++) {
        int call = seccomp_syscall_resolve_name(blocked[i]);
        if (call != __NR_SCMP_ERROR) require(seccomp_rule_add(context, SCMP_ACT_ERRNO(EPERM), call, 0));
    }
    /* clone3 stores its flags behind a pointer: seccomp cannot inspect them.
     * ENOSYS requests the libc/thread-runtime's ordinary clone fallback. */
    int clone3 = seccomp_syscall_resolve_name("clone3");
    if (clone3 != __NR_SCMP_ERROR) require(seccomp_rule_add(context, SCMP_ACT_ERRNO(ENOSYS), clone3, 0));
    unsigned long namespaces[] = {CLONE_NEWUSER,CLONE_NEWNS,CLONE_NEWNET,CLONE_NEWPID,CLONE_NEWIPC,CLONE_NEWUTS,CLONE_NEWCGROUP};
    for(unsigned int i=0;i<sizeof(namespaces)/sizeof(namespaces[0]);i++)
        require(seccomp_rule_add(context, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(clone), 1,
            SCMP_A0(SCMP_CMP_MASKED_EQ, namespaces[i], namespaces[i])));
    require(seccomp_export_bpf(context, STDOUT_FILENO));
    seccomp_release(context);
    return 0;
}
