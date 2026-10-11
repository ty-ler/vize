# Original VueFes heading cascade diagnosis

Related compiler fixture gate: [#6880](https://github.com/ubugeeei-prod/vize/issues/6880).

The full App E2E VueFes VRT row on immutable release source
`605429c660b328bb03bec5bbfef15961e59fcaf0` failed its original desktop home
comparison in [run 38111801880](https://github.com/ubugeeei-prod/vize/actions/runs/38111801880).
The reference image is 1280 by 17968 pixels, while the candidate is 1280 by
17870 pixels. Fourteen heading height differences of seven pixels are
consistent with that 98-pixel difference; image geometry alone does not
establish which compiler or CSS producer caused it.

Keep the original source, fixture pin
`8eff3cd7dd79a7f47bbf2b78202b9aa2070ec5a6`, ordered 38 dev/preview comparisons,
all original thresholds, screenshots, and verdict function unchanged. A
supplementary observer may run before the original assertion to preserve
complete DOM, recursive CSSOM, stylesheet order, fetched CSS/module bodies,
heading computed styles, and actual component props and scope IDs.

The observer driver is a separate commit, not part of the immutable release
source. [Run 38113769744](https://github.com/ubugeeei-prod/vize/actions/runs/38113769744)
uses driver `e2dcbb3b61cd5ed0dc6c1be9285f443e2d9c7d81`, checks out the literal
release source, and authenticates the complete original producer blobs before
installing its observer. The candidate browser crashed inside the observer
before the original visual assertion, so that run retained only the complete
reference DOM/CSS packet. It does not prove the application cause. The strict
post-build source gate then rejected the regenerated native declaration before
binary identity capture. The complete generated declaration delta contains
formatting, declaration order, documentation, enum, and `unknown`/`any`
differences; it must not be normalized or exempted.

The corrected observer saves the whole DOM/CSS first, then represents every
enumerable props/attrs field in an identity graph. Shared and cyclic objects
retain explicit references, and each actual ancestor is recorded once. A real
Vue `3.6.0-alpha.2` component control preserved the complete original heading
module and all props: a 15-object shared graph that the old serializer expanded
into 32,767 objects now retains its 15 graph identities and cyclic leaf. These
controls diagnose the observer; they do not qualify the release source. The
original visual assertion always runs, observer completeness is a separate
failing gate, and exact native binary identity plus the complete post-build
source delta are saved before the unchanged strict source-diff gate.

An isolated published-0.443.0 control preserved the complete original heading
SFC and found its default `nth=2` and dynamic `h1`/`h2`/`h3` scope attributes
present in SSR, cold DOM, and hydration. That older artifact cannot qualify the
release source. Another isolated control retained the complete original global
stylesheet and heading scoped CSS: global-first order produced 20px text and a
34px heading; global-last order produced 18px text and a 27px heading with
identical scoped heading HTML. Both `:root h2` and `h2[data-v-*]` have the same
selector specificity. This explains a possible seven-pixel gap, not the actual
application's CSS ordering.

The real application cause, minimal production correction, differential
fixture, full unrelaxed VRT result, protected merge, and installed release
verification remain unfinished. Do not change stylesheets, expected images,
thresholds, or route coverage to make this failure disappear.
