# Authenticate the npmX canonical corpus input migration

Refs [#6830](https://github.com/ubugeeei-prod/vize/issues/6830) and the
[original Linux IO decision](./2026-10-08-canonical-corpus-linux-io-diagnostic.md).

The IO diagnostic admitted only the historical 44,367-source vector. The
authenticated npmX fixture update changes that complete vector to 44,379
sources, so the count assertion refused it after ordinary SSR/pug execution.
Keep the historical epoch and admit precisely this additional source identity.
This changes input custody only. It supplies no new semantic, performance,
product parity, merge, issue closure or release evidence.

## Captured authority

The historical source artifact is
[11705104759, run 38147452278](https://github.com/ubugeeei-prod/vize/actions/runs/38147452278/artifacts/11705104759),
attempt 1, provider `137c1576dfa702e5f8a42bab2c7332dba8520df0`, tested union
`5fea783a661d67d94a7d6c00c34fdc1c173f13bd`. The updated source artifact is
[11705404503, run 38147490520](https://github.com/ubugeeei-prod/vize/actions/runs/38147490520/artifacts/11705404503),
attempt 1, provider `0ee44bd70f0db2138190b22fcb586d7b640b0d82`, tested union
`67f7d10edd9c64a9ef4bd838fc47bd258af666f7`. Their complete tree, repository,
provider, run and artifact identities remain in the
[epoch declaration](../../../tools/support/compat/github/canonical-corpus-input-epochs.json).
These historical identities identify the captured data; each new execution
still has to authenticate its own checkout, tree, run and all tracked bytes.

Both epochs contain exactly 148 gitlinks. The sole pin change is npmX from
`c9e8be91e61eeeae956e2068722caa09e293cc68` to
`83e38d9d40025ba45d800caf066012c0e7bef753`. All 147 other fixture pin rows,
their complete ordered source membership and each source's SHA-256, byte
length and Git blob identity are identical. npmX changes from 224 to 236 SFCs:
14 added, two removed and 32 changed. The declaration retains every added
and removed entry and both complete old/new tuples for all 32 changes, plus
the updated npmX source order. No entry is abbreviated or replaced by a count.

| Fingerprint                           | Historical epoch                                                   | Updated epoch                                                      |
| ------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 148 ordered gitlinks                  | `87bf3fca438483c5422dbbae5eda00d1281014a77c6261f3d84b6f24aac0082a` | `9a5346e57ff626cad02981c4bbe1f165b3dc00303143be2bd381f8e1ba96d36c` |
| Complete ordered membership           | `30df21cd1f239ce5840f27258ca0f5044ae1bff9eec4f3ca89a4357cea7379ce` | `34dd9cc31905861d0f180440518e0af83ee987756be8285773403835d7f78b7f` |
| Complete four-field source entries    | `ccd98e9ff918661b9c8d547a09b457a13b82701815cb0b88b15af5d35f6a2508` | `be49fc468115b73a8bbd3a02f5fa3bda1b1a759f8199f717d2ed383b6887c2a9` |
| Original NUL-terminated native vector | `7838356ee9c1a27bff13d3f348486c7760e4d9ac5438f722b0401caae379e1e5` | `85249d969cb79d06d40be14ec51968258289a62a19f88b3ec1816f6d25c24017` |

## Admission and unchanged IO qualification

The new finite epoch helper checks the complete pin rows and their digest,
committed inventory, submodule metadata, full entry digest, collector source
and body, kernel boundary and native vector identity. Unknown or self-resealed
metadata refuses before loading the files/vector artifacts, compiling a
collector or reading selected corpus sources. A known identity still has to
match every ordered tuple and path, including the whole vector's raw bytes.
The original explicit 44,367 assertion remains; the additional epoch has its
own explicit 44,379 assertion. These are exact identities, not permitted
growth ranges or alternative acceptable diagnostics.

Both epochs preserve all 5,576 logical Jellyfin inputs, the original pin,
symlink, blob identities and kernel traversal boundary. Every original IO
operation, full byte comparison, literal root spelling, pathname prefix,
minimal reproducer and fatal error remains unchanged. The receipt reports
the qualified epoch and actual source count. Ordinary SSR/pug still runs
before the IO diagnostic; existing worker custody, failure policy and all
semantic oracles remain required. Epoch metadata and fixtures themselves
select canonical Actions in both PR and merge-group contexts.

## Durable source checks and remaining qualification

The test fixture losslessly compresses the complete authentic historical
four-field vector. Tests apply only the declared complete npmX delta and its
captured order to reconstruct the updated whole vector. Both complete vectors
must reproduce all declared fingerprints. Tests compare every other fixture
row and pin, and refuse an omitted member, one changed authentic npmX source
byte, one vector byte, reordered members, foreign pins, unknown identity,
self-resealed entries and a foreign collector before input IO where applicable.
The source-byte control retains the original 99-byte `SkeletonBlock.vue` blob
`05ef97ae8cecf0f198b91ab033680d42094cbb05`.

Run the focused source tests with Node 24.14.0 and Rust 1.99.0:

```sh
node --test tests/tooling/davinci-canonical-corpus-input-epochs.test.mjs \
  tests/tooling/davinci-canonical-corpus-io-probe.test.mjs \
  tests/tooling/davinci-canonical-corpus-workflow.test.ts
```

TODO: obtain the fresh composed exact-source canonical Actions packet. Require
the complete 44,379-input SSR/pug, IO diagnostic and all existing observers
and aggregate custody to pass. Source tests and historical packets do not
satisfy that hosted gate. Every future input migration requires another
explicitly authenticated complete epoch; unknown migrations continue to fail.
