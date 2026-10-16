# Reuse the checked-out PR comparison parent

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

Observed source-planning jobs took 20–21 seconds, including 9–11 seconds in
the comparison-base fetch, while the actual source planner took under one
second. Checkout now includes two generations of commits so the tested merge
commit's direct parents are normally available without another network fetch.

The existing comparison-base resolver still validates full SHAs, the checked
out commit and the PR head before selecting the merge's first parent. A stale
event base never replaces that verified parent. An unverified PR merge keeps
its conservative event-base fallback, and a merge-group event keeps its own
declared base even when that commit is not a direct merge parent.

After resolution, the workflow uses `git cat-file -e "${comparison_base}^{commit}"`
to check local availability. It fetches the same validated SHA only when the
commit is missing. An all-zero resolved base still skips fetching. Invalid
comparison identities and failed fetches still fail the planning step. All
source selectors, package closures, native lanes and required reports remain
unchanged.

The existing comparison contracts now execute the actual workflow shell in
temporary Git repositories with shallow checkouts. Git traces prove no fetch
for a present verified parent or zero base, and exactly one fetch for a missing
parent, an unverified PR's event base, or a queue event base outside the direct
parents. Invalid SHAs and unavailable remote commits fail. The resulting file
diffs still exclude newer main changes for the verified PR merge and retain
the broader comparison for the conservative fallback.

Run `node --test tests/tooling/comparison-base.test.ts` for the focused proof.
Actions timing on a subsequent real source change remains the performance
acceptance; this change does not claim a measured end-to-end speedup yet.
