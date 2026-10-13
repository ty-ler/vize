# Recover a queued Stack child after its parent merges

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

On 2026-10-13, [#8875](https://github.com/ubugeeei-prod/vize/pull/8875)
merged as `929d07665d5f044b72fee606915f4dacaf0d02f5`, but its queued child
[#8922](https://github.com/ubugeeei-prod/vize/pull/8922) still targeted the
old parent branch in Stack #8924. The dequeue API looked for a merge queue
on that old branch and failed. GitHub also rejected a queued branch update
and a stacked PR base change. Converting the child to draft did not dequeue it.

Use this recovery only after verifying that stale state and the actual parent
merge. Normal Stack delivery keeps its native membership.

1. Preserve the child's remote SHA and prepare the rebase in its owned worktree.
2. Temporarily close the child and verify its queue entry is absent. Confirm
   any higher layers are also no longer queued before editing their branches.
3. Unstack the eligible remaining layers with `gh stack unstack`. Already
   merged entries may remain in the historical Stack; verify each active PR.
4. Reopen the child **before rewriting its remote head**, then retarget it to
   the correct base. Reopening after a head rewrite failed in this incident;
   restoring the captured SHA allowed the same PR to reopen.
5. Push the prepared rebase with an explicit lease on the captured remote SHA.
   Mark the PR ready, and link two or more remaining dependent layers with
   `gh stack link --remote origin`, verifying their ordered membership.
6. Require Actions on every new head before normal queue admission. Track the
   actual merge; neither reopening nor queue registration is completion.

In this incident only one active layer remained after the parent merged, so it
temporarily became independent. It later joined the mold Stack because the two
CI changes overlapped. No queue jump or protection bypass was used.

Retire this workaround when GitHub's normal parent-merge handling reliably
retargets the remaining layers and allows their queue entries to be removed.
