# Docs browser worker measurement (#6830)

The completed [Doctor Docs run](https://github.com/ubugeeei-prod/vize/actions/runs/38105975586)
built source `14365e502ac8aa554e1689e46400ed07b09766d6`. Its general navigation
proof completed all 48 routes and 96 desktop/mobile jobs with two workers in
2,868.312 seconds. The separate Open Graph gate took approximately 25 seconds.
The original general `timings.json` records 5,577.532 accumulated job seconds;
capture and theme capture account for 4,802.217 seconds, or 86.1% of that work.

The four EN/JA All Rules jobs account for 2,786.567 job seconds (50.0%). Each
page has 116,439–116,977 descendants and a height of 518,024–577,825 pixels,
requiring 65–72 complete PNG tiles per theme. The ten Vue category jobs across
five locales account for another 1,980.304 seconds (35.5%). Whole rule-packet
checks take 35.255 accumulated seconds and linked-page checks take 1.038 seconds.
These are recorded phases; they do not separately measure rasterization, PNG
encoding, CPU utilization or process-tree memory.

The original render artifact is `11690702750`, with provider digest
`sha256:9feecfe5411d7c00e8276f7c5ae9b2bc09556eb732925b3de6b3ff725c187b33`.
Selected original JSON carriers are CRC-validated from that ZIP. All 2,308
source and complete-code SHA256 observations match 634 unique authored source
files at the original source SHA. The full 841 MB ZIP was not independently
downloaded or hashed. Different catalogue sources or expanded route manifests
cannot inherit this measurement.

## Accepted diagnostic

The [issue decision](https://github.com/ubugeeei-prod/vize/issues/6830#issuecomment-6105268134)
is mirrored in the foundation record. The diagnostic's true parent is the
complete external Markdown destination fix #8566,
`f9898e19eb313d41828c642e208eed9c2a1a66b4`. Its original CLI default contains
53 routes and 106 desktop/mobile jobs, ordered-route SHA256
`cf1506ba32f214a41ba58c4a6d6aec09828b7b64b28ba8d29e244e8f153be814`.
This historical source differs from current main: for example, observed
`db6e7805e5c26aafe8ae1614bc77668cd3459d1d` has 103 complete default routes
and 206 jobs after translated-category/subgroup additions. The base list alone
does not establish either workload. Neither the preceding 96-job observation
nor this historical-source diagnostic qualifies a different main source.

Both arms execute the byte-authenticated original default CLI without
`--routes`, derive jobs from its complete actual `timings.routes`, and require
identical routes, order and requested jobs. Renderer, page, capture, CSS,
catalogue and generator sources are retained from the true parent; only the
bounded concurrency control and its isolated measurement workflow are added.

Keep the shipping default and production workflow at two workers. Add four
only as a bounded diagnostic control, retaining one/two-worker controls and
the complete existing manifest, assertions, failure draining and context
cleanup. The manual `docs-workers` component builds the native packages and
site once, then runs complete two- and four-worker proofs sequentially on
that exact source and runner. It preserves both PNG/HTML carriers, all 317
whole rule-packet/reference checks, theme controls, linked targets, layout
rectangles, the original capture falsification/fallback and the 1px budget.

Record actual timings, GNU time's waited CPU/resource report and 200ms Linux
process-tree samples with PID/start-tick identities. Summed RSS counts shared
pages in each process; sampled CPU ticks exclude unobserved work after a
process's final sample. Report these limits instead of claiming exact physical
memory or complete CPU accounting. Preserve sampling failures and real child
outcomes; failure cannot establish a speedup.

Authenticate every original PNG/HTML carrier hash before comparing complete
receipts. Only the invocation's authenticated ephemeral static-server origin
is canonicalized in measured URL fields and actual quoted DOM transport
attributes, retaining paths, queries, fragments and all foreign URLs. Authored
text, code, comments, raw script/style bodies and other attributes remain exact;
a foreign URL's nested loopback operand is not a transport origin.
Preserve the full original HTML bytes and a canonicalization journal; PNG
hashes, layout rectangles, code and all remaining packet fields stay exact.

Independent review found that a global origin substring replacement could erase
authored or nested foreign operands. Add explicit negative controls and use the
strict receiver for terminal acceptance. The immutable paired run
`38111126388` measures source `4040e6b96a15d50680fa0dd93af272fe6cbd7276`;
its original raw carriers remain authoritative. A manual `docs-workers-verify`
invocation authenticates that completed run, checks out its measured source,
downloads its original artifact and records the corrected verifier source and
hashes separately. It neither rebuilds the site nor repeats browser measurements.
The older comparator result alone cannot establish promotion readiness.

Measured complete equivalence, peak resources and a useful walltime reduction
are required before proposing four production workers. The unchanged-job-time
scheduling projection of approximately 1,444 seconds is not a measurement.
The All Rules readability/index change remains separately owned and must
measure its own actual source, complete manifest and preserved obligations.
