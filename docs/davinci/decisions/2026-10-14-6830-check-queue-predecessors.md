# Check the preceding queue candidate before admitting a Stack

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

On 2026-10-13, all three source heads in Stack #8925 passed Actions and
GitHub reported each PR as mergeable. After admission, all three queue
entries were `UNMERGEABLE` without a candidate commit.

A read-only `git merge-tree --write-tree` comparison of the last preceding
queue candidate, `aba13c9d97a1396c02fd9b925fdda474777d4d5e`, with bottom
head `32722f1b4132eeab80c971462d85b24b4b8b78ce` exposed one modify/delete
conflict. [#8947](https://github.com/ubugeeei-prod/vize/pull/8947) retired
the native-release input fixture and its consumers, while
[#8887](https://github.com/ubugeeei-prod/vize/pull/8887) had updated that
fixture for a new parser-recovery input. The source-to-parent ancestry was
valid; checking only the source branch against main missed the queued change.

Before admitting a ready Stack, check its composition with the current last
preceding queue candidate as well as main. Inspect the merge result without
updating any branch. A source check result alone does not establish that
composition. Repeat the check if the preceding candidate changes.

For this conflict, normal dequeue of the bottom PR removed all three queue
entries. Once #8947 and the remaining CI changes merged, the Stack took
fresh main at `aba13c9d97a1396c02fd9b925fdda474777d4d5e`. Keep the intended
fixture deletion together with its already-retired consumers, propagate the
resolved parent through the Stack, and qualify every new source head before
readmission. Queue order and required checks remain unchanged.
