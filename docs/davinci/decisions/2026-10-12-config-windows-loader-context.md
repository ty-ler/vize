# Config qualification retains the preceding Windows module import repair

Owner: [#8371](https://github.com/ubugeeei-prod/vize/issues/8371).
The production repair is independently owned by
[#8685](https://github.com/ubugeeei-prod/vize/pull/8685).

Windows native smoke failed the original first TypeScript configuration cell:
the selected filesystem path had a verbatim drive prefix that Rolldown could
not resolve as a JavaScript module import. The production fix converts only
that import boundary through the already selected config URL. Rust's physical
path identity, transport and complete configuration handling remain unchanged.

The original configuration qualifier freezes both the Rust loader and its
embedded JavaScript runtime. Keep that original manifest unchanged. A separate
finite inherited context authenticates the two complete original and repaired
bodies from sources `a49936db` and `a6d8bd85`. A configuration child must retain
both repaired bodies on both sides; the Windows production change itself is
not a configuration child and receives no authorization from this context.

Only after both actual loader bodies match that inherited context can the
existing complete configuration qualifier read its original loader pair.
Its original 112/96 source footprint, 51 preserved bodies, three harness
extensions, reviewed native repair and mandatory original witness remain
required. Missing, altered, one-sided or foreign bodies refuse qualification.
Historical original receipts remain historical and are tried without change.

Five controls authenticate both literal commits, retain the complete original
witness, and reject every missing, changed or foreign context. Their local
success qualifies this finite source adaptation. The independent actual
Windows smoke, protected merge and installed release remain required; this
record does not claim those pending results.
