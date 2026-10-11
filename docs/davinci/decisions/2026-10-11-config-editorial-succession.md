# Configuration guidance after the Japanese editorial repair

Issue: #8371; documentation journey: #8370.

The public integration settings add an English Musea shared-settings recipe and
replace its old discovery paragraph. Main's #8587 editorial check freezes those
whole English pages because that Japanese-only change did not own English edits.
The composed PR failed that check; its original digest is still required.

Keep the original editorial fixture unchanged. A separate, finite configuration
succession records the complete reviewed edits, their exact offsets and both
whole-document digests. The editorial gate verifies the entire current document,
undoes only those edits and checks every original byte against the original
fixture. Unchanged documents and every performance record retain their old gates.
Missing, modified and appended bytes are explicit refusal controls.

Future setup layers extend only their reviewed configuration documents. Native
rendered Japanese witnesses must retain the incoming readable prose; the two
shared-settings witnesses can change only to reflect the implemented Vite route,
with their original complete witnesses retained separately. Complete original
code examples and bookmarks remain covered, alongside the existing five-locale
recipe and rendered reading-path checks.

Four focused source tests pass on the public-integration composition. Exact-head
Actions, the protected Stack queue, installed/editor acceptance and release are
still required; this source repair closes none of those gates.
