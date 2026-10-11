# Retain live native-owner facts before retirement

For #8371, private original 79/16 run38120489979 failed after 1/79 and 0/16.
The unchanged strace 6.8 filter selected only `write`; process birth and exec
events were absent. The first hover completed in 4874.874621ms, but its
post-query ownership sample first checked the earlier stream failure.
TID 16129's executable had disappeared before that failure handler sampled it.
Its whole 50-byte `???( <detached ...>` line remains unqualified, SHA256
`fd66621e451a59245bda050a7744a6fbb50ee89a930bebfe376a324bbfd344e5`.

The private collector now retains the actual initial per-thread kernel census,
process/thread birth, raw-pointer exec and retirement events alongside writes.
Live captures bind PID/Tgid/starttime, the complete selected SDK ELF's retained
inode handle/hash, numbered FD targets, and actual named API socket inodes.
An actual kernel birth plus a consistent live child binds later actors;
CLONE_THREAD/CLONE_PARENT use the kernel's distinct Tgid/PPid contracts.
Whole raw input and complete actor/event metadata share the original 64MiB
retention bound. Original 4MiB-line/5s/79/16/20-field budgets remain unchanged.
No production launch, provider API, client, packet or primary oracle changes.

Only a currently live, independently bound non-native actor with complete descriptor
ownership may classify its undecoded detach outside the native protocol scope.
Any selected-native execution epoch, parent/native transport ownership, missing
early actor, pending lifecycle, PID reuse or incomplete evidence still refuses.
Raw bytes are saved before parsing; selected pipe/socket writes still enter the
original strict decoder. Initial threads are observed rather than assumed born
after attachment. Exec argv/environment values are never decoded or recorded.
Every decoded original write joins its whole live actor/FD event before the
unchanged attachment/socket oracles run; historical TID/image unions cannot
authorize a foreign exec epoch. Each executable read hashes fresh complete bytes;
equal metadata grants no cached byte authority. Stream, launch, interrupt and
reap failures preserve the first refusal and still attempt bounded FD cleanup.

An earlier leader-only snapshot may defer to a later actual thread witness only
when the write's captured PID/Tgid/PPid, process birth, full executable identity,
and both stdin/stdout pipe owners match completely. No unknown actor or foreign
execution epoch gains authority from an old thread list. A real CLONE_THREAD
fixture fails under the prior collector and passes with the bounded correction;
missing thread, PID/birth/image or either pipe witness still refuses.

Successful exec metadata requires a distinct captured full image from the prior
epoch. Buffered SDK/foreign/SDK records observed only after the final SDK image
cannot prove their intervening epoch and refuse before write qualification.
Same-image exec also remains unqualified; complete raw events and final live
snapshots are retained before the first refusal. Local fixture failure under
the preceding collector and success here prove this conservative refusal only.

Local 37 laws retain all original 21 byte/protocol/refusal laws, 8 lifecycle
and whole-custody laws, and 8 write-epoch/cleanup laws. These are fixture evidence.
Asynchronous evidence arriving after a process disappears and nonleader exec
migration remain unqualified. No new observer run has been dispatched; the
original 20-field comparison remains red pending the sole composed-source run.

Kernel contracts: [clone](https://man7.org/linux/man-pages/man2/clone.2.html),
[execve](https://man7.org/linux/man-pages/man2/execve.2.html), and
[proc_pid_stat](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html).
