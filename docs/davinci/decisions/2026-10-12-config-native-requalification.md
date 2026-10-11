# Qualify configuration repairs against their complete source

Owner: [#8371](https://github.com/ubugeeei-prod/vize/issues/8371).

Exact-head Actions on the native configuration layer found an obsolete large
enum lint expectation after navigation moved into an `Arc`, test fixture
helpers using unchecked unwraps and indexes, a complex test hook type and an
unneeded unit expression. Remove the obsolete expectation, require named
fixture members and values, introduce the hook alias and preserve every test
assertion. Keep the zero-warning budget. Sort paths with an explicit code-unit
comparison so the complete original order remains unchanged.

The literal reviewed-source controls require four immutable historical commit
objects. A shallow Actions checkout did not contain them; `git show` failures
had been indistinguishable from genuinely absent files. Fetch only missing
exact commits from their preserved origin history and require every commit to
exist before comparing complete files and the genuine complete diff. Missing
history is a failure; current files, generated hashes and skipped controls are
not substitutes. Retain the original reviewed manifest and qualifier unchanged.

The new two-buffer native replay regression also exposed a real
`source file not found` error for the retained second buffer after a disk event.
Repair and qualify that production path separately. Admit only an explicit
finite successor for the reviewed repair bodies while requiring the unchanged
original complete source witness. Actual Linux native execution, full source
checks and the protected queue remain required before merge; installed editor
and consumer campaigns remain required before closing the delivery issue.
