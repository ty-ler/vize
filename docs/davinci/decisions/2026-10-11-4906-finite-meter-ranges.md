# Preserve finite Meter ranges and percentages

Tracked in [#4906](https://github.com/ubugeeei-prod/vize/issues/4906).

`getMeterState` previously divided differences that could overflow even when
every input was finite. For `min=-Number.MAX_VALUE`, `max=Number.MAX_VALUE`, and
`value=0`, it reported 0% instead of 50%. The maximum produced `NaN`. Separately,
repairing an invalid maximum with `min + 1` could round back to `min`, making
the percentage divide by zero.

Keep ordinary normalization and percentage arithmetic unchanged. Scale the
percentage differences by one half only when the span overflows. Keep valid
authored bounds, values, and thresholds intact. If an invalid maximum cannot
be increased by one at the supplied precision, preserve the finite collapsed
native range, report zero percent, and mark the state invalid. The
[HTML meter rules](https://html.spec.whatwg.org/multipage/form-elements.html#the-meter-element)
permit equal minimum and maximum values. This exception does not change the
existing ordinary `min=2, max=2` repair to `2..3`.

The owning [behavior contract](../../../npm/ui/src/families/feedback/meter/meter.behavior.md)
documents the public result. Pure tests cover signed ranges, endpoints,
thresholds, collapsed precision, ordinary repair, and subnormal ranges.
Mounted prop updates, isolated SSR requests, and additive native-generated
SSR/Vapor/hydration fixtures cover the same public attributes and exposed
state. Bundle budgets, focus, announcement policy, and package exports are
unchanged.

The source-coverage test now compares the unique fixture source paths with
every original canonical SFC, and separately requires unique source/name pairs.
This permits multiple edge cases for one component without dropping any
source from the SSR and hydration sweep or replacing its original case.
Historical labels can repeat across different SFCs; they remain unchanged.

This is one bounded feedback-family correctness slice. #4906 and #4913 remain
open: component presence alone does not establish the full family acceptance
criteria. The related progress-bar and slider range calculations need their
own audit and regression controls before any analogous change. Actions,
actual merge, and an included public release are still required before
claiming delivery.
