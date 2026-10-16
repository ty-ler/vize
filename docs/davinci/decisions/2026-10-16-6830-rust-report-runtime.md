# Run the Rust aggregate with native Node

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

The fresh push at `08f798af09931b4f6339a0a5422f13feaf80dfbc` passed all nine
ordinary workflows. [Check 38901193268](https://github.com/ubugeeei-prod/vize/actions/runs/38901193268)
took 295 seconds from creation to its required report; the complete workflow
span was 301 seconds, including managed Code Quality's earlier start. All
18,187 selected Rust tests and Clippy passed. Its tested merge was
`5997d7c3702a20f96ccbffa887000c9b86abbcf8`, with actual base
`a39af7c010ce94f93da6173a3877d1c5e063cf86`.

After the final Rust cohort completed, three strict aggregate jobs occupied
another 37 seconds. The Rust report took 16 seconds, including two seconds for
Vite+ bootstrap caching and seven for setup-vp; its actual Rust-tier assertion
took less than one reported second. The other aggregate jobs already used
setup-node, taking two seconds to provision Node.

Use the same pinned Node setup for the Rust report and disable package-manager
cache discovery. Its required-tier validator, source-bound worker selector and
typechecker aggregate import only Node builtins and repository modules. The
queue's TypeScript aggregate therefore runs directly through Node's native
type stripping, without Vite+ or an install. Keep the same job dependencies,
assertions, failure/cancellation rules, exact-source worker selection, complete
fixture observations and artifact publication.

Existing strict-gate, worker-selection, typechecker transport and workflow
contracts run under Node 24.14.0. Hosted normal-PR and merge-queue execution
remain the acceptance authority. The seven-second setup difference is an
observed opportunity, not a promised saving or a five-minute guarantee.
