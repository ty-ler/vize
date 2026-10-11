# npmX authentic fixture pin migration

**Status:** The maintainer selected the immutable current-source pin on 2026-10-11. The original private proposal and 404 remain retained. The approved pin is composed with the required ElementPlus merge-queue fixture preparation. Genuine consumer/native acceptance and release remain pending.

The original npmX fixture is [c9e8be91e61eeeae956e2068722caa09e293cc68](https://github.com/npmx-dev/npmx.dev/commit/c9e8be91e61eeeae956e2068722caa09e293cc68). Its authored manifest and lock require `https://pkg.pr.new/lunariajs/lunaria/@lunariajs/core@904b935`. Original composed source `888a4898a86a0fccfda99490e532eb407fc79157` failed preparation with HTTP 404 in [run 38129574946](https://github.com/ubugeeei-prod/vize/actions/runs/38129574946); its unchanged checker never ran for this fixture. The original expected vector and this failure stay retained.

The original package integrity is `sha512-N0PDFIitA/Vzh5V6BtTacWU9jgSDJJtPLHamRLMU85mohmyuVW/pggHX8dzdV5ieqZeHEz8pDZSzH4I0hOYxOg==`. The existing Dev preparation replaces this package with 0.1.1, whose integrity differs. That Dev result cannot recover or qualify this original consumer.

The concrete alternative changes only the npmX Gitlink to [83e38d9d40025ba45d800caf066012c0e7bef753](https://github.com/npmx-dev/npmx.dev/commit/83e38d9d40025ba45d800caf066012c0e7bef753), observed on primary upstream main at 2026-10-11 10:08:27 UTC. Its whole Git tree is `941789c69c321b98bffa3a992697941e457bfb9d`; the original tree is `fa6f13e8aec2867bb5f10d617c99c749a467d2ee`. This is a complete authored-source migration with authentic manifests, workspace settings and lock, rather than a package override.

The candidate authentically declares `@lunariajs/core@0.2.0`. Its [registry tarball](https://registry.npmjs.org/@lunariajs/core/-/core-0.2.0.tgz) returned HTTP 200, 40,004 bytes; actual SHA-256 `5ec1da2182f23ff0e294919d6f08ff1b77a69956599e102caa37d4c1f4e4fd77` and SHA-512 integrity `sha512-JuQsDStxiznw4Km0ab/FNH2VxVfWm08oJdjevRUOY7duN6nPKvBkk9rvXD6zPDlvauPWTf9RFuJ3lD4l+o9M4g==` agree with both the primary registry metadata and the candidate lock. The tarball contains 77 files and its package manifest identifies the same name/version. These bytes belong to 0.2.0; the original 904b935 tarball has not been recovered.

## Maintainer decision

The maintainer explicitly selected option 1: update to immutable commit `83e38d9d40025ba45d800caf066012c0e7bef753` and retain all original 32 projects and checks. This authorizes the whole-source pin migration; it does not approve changed diagnostic expectations or claim consumer success.

1. Select this immutable full-source pin migration, keeping the original 404 as historical evidence and qualifying the migrated consumer before accepting any new expected vector.
2. Keep the original pin and provide the original tarball bytes matching its recorded SHA-512 integrity. The failed fixture remains a release blocker until those authentic bytes can be consumed.

The fixture patch is one Gitlink change. The candidate has 217 changed upstream members: 34 added, seven removed and 176 modified, with 1,162 original versus 1,189 candidate tracked members. It changes 46 direct dependency declarations and 15 catalog/override declarations. Both root manifests require Node 24; the authored package-manager pin changes from pnpm 11.20.0 to 11.22.0. Candidate preparation and all other package availability remain unproved.

## Complete changed direct declarations

| Manifest          | Section         | Package                       | Original                                                     | Candidate     |
| ----------------- | --------------- | ----------------------------- | ------------------------------------------------------------ | ------------- |
| package.json      | dependencies    | @atproto/api                  | 0.20.36                                                      | 0.20.41       |
| package.json      | dependencies    | @atproto/lex                  | 0.3.2                                                        | 0.3.6         |
| package.json      | dependencies    | @atproto/lex-password-session | 0.1.9                                                        | 0.2.0         |
| package.json      | dependencies    | @iconify-json/lucide          | 1.2.121                                                      | 1.2.123       |
| package.json      | dependencies    | @iconify-json/vscode-icons    | 1.2.68                                                       | 1.2.73        |
| package.json      | dependencies    | @lunariajs/core               | https://pkg.pr.new/lunariajs/lunaria/@lunariajs/core@904b935 | 0.2.0         |
| package.json      | dependencies    | @napi-rs/canvas               | 1.0.3                                                        | 1.0.6         |
| package.json      | dependencies    | @nuxt/scripts                 | 1.3.2                                                        | 1.3.5         |
| package.json      | dependencies    | @nuxt/test-utils              | 4.0.3                                                        | 4.1.0         |
| package.json      | dependencies    | @nuxtjs/i18n                  | 10.5.0                                                       | 10.6.0        |
| package.json      | dependencies    | @shikijs/langs                | 4.4.1                                                        | 4.4.3         |
| package.json      | dependencies    | @shikijs/markdown-exit        | 4.4.1                                                        | 4.4.3         |
| package.json      | dependencies    | @shikijs/themes               | 4.4.1                                                        | 4.4.3         |
| package.json      | dependencies    | @takumi-rs/core               | 2.5.4                                                        | 2.9.2         |
| package.json      | dependencies    | @takumi-rs/wasm               | 2.5.4                                                        | 2.9.2         |
| package.json      | dependencies    | @upstash/redis                | 1.38.1                                                       | 1.38.2        |
| package.json      | dependencies    | @vite-pwa/assets-generator    | 1.0.2                                                        | 2.0.0         |
| package.json      | dependencies    | @vueuse/router                | ^14.2.1                                                      | ^14.4.0       |
| package.json      | dependencies    | hls.js                        | 1.6.16                                                       | 1.7.0         |
| package.json      | dependencies    | ipaddr.js                     | 2.4.0                                                        | 2.5.0         |
| package.json      | dependencies    | marked                        | 18.0.7                                                       | 18.0.9        |
| package.json      | dependencies    | module-replacements           | 3.1.0                                                        | 3.3.0         |
| package.json      | dependencies    | nuxt                          | 4.4.8                                                        | 4.5.2         |
| package.json      | dependencies    | nuxt-og-image                 | 6.7.5                                                        | 6.7.8         |
| package.json      | dependencies    | ohash                         | 2.0.11                                                       | 2.0.12        |
| package.json      | dependencies    | sanitize-html                 | 2.17.6                                                       | 2.17.7        |
| package.json      | dependencies    | shiki                         | 4.4.1                                                        | 4.4.3         |
| package.json      | dependencies    | verkit                        | 0.3.2                                                        | 0.4.0         |
| package.json      | dependencies    | virtua                        | 0.50.0                                                       | 0.50.1        |
| package.json      | dependencies    | vite-plugin-pwa               | 1.3.0                                                        | 2.0.0         |
| package.json      | dependencies    | vue                           | 3.5.39                                                       | 3.5.42        |
| package.json      | dependencies    | vue-data-ui                   | 3.23.2                                                       | 3.26.1        |
| package.json      | devDependencies | @e18e/eslint-plugin           | 0.8.0                                                        | 0.8.1         |
| package.json      | devDependencies | axe-core                      | 4.12.1                                                       | 4.13.0        |
| package.json      | devDependencies | chromatic                     | 18.1.0                                                       | 18.2.0        |
| package.json      | devDependencies | devalue                       | 5.9.0                                                        | 6.0.0         |
| package.json      | devDependencies | eslint-plugin-regexp          | 3.1.1                                                        | 3.3.1         |
| package.json      | devDependencies | knip                          | 6.32.0                                                       | 6.38.0        |
| package.json      | devDependencies | rolldown                      | 1.2.1                                                        | 1.2.4         |
| package.json      | devDependencies | vue-tsc                       | 3.3.9                                                        | 3.3.10        |
| cli/package.json  | dependencies    | @lydell/node-pty              | 1.2.0-beta.14                                                | 1.2.0-beta.15 |
| cli/package.json  | dependencies    | obug                          | ^2.1.3                                                       | ^3.0.0        |
| cli/package.json  | dependencies    | srvx                          | ^0.12.0                                                      | ^1.0.0        |
| docs/package.json | dependencies    | @nuxtjs/mdc                   | 0.22.2                                                       | 0.23.1        |
| docs/package.json | dependencies    | better-sqlite3                | 13.0.2                                                       | 13.0.3        |
| docs/package.json | dependencies    | nuxt                          | 4.4.8                                                        | 4.5.2         |

## Complete changed workspace dependency declarations

| Section   | Package                              | Original                                               | Candidate                                               |
| --------- | ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------- |
| catalogs  | msw/msw                              | ^2.13.2                                                | ^3.0.0                                                  |
| catalogs  | vite-plus/@vitest/browser-playwright | 4.1.10                                                 | 5.0.3                                                   |
| catalogs  | vite-plus/@vitest/coverage-v8        | 4.1.10                                                 | 5.0.3                                                   |
| catalogs  | vite-plus/vite                       | npm:@voidzero-dev/vite-plus-core@0.2.7                 | npm:@voidzero-dev/vite-plus-core@1.1.0                  |
| catalogs  | vite-plus/vite-plus                  | 0.2.7                                                  | 1.1.0                                                   |
| catalogs  | vite-plus/vitest                     | 4.1.10                                                 | 5.0.3                                                   |
| overrides | @nuxtjs/i18n>@nuxt/kit               | absent                                                 | 4.5.2                                                   |
| overrides | nuxt-og-image                        | ^6.6.0                                                 | ^6.7.5                                                  |
| overrides | oxc-parser                           | 0.142.0                                                | 0.144.0                                                 |
| overrides | typescript                           | npm:typescript-native-bridge@6.0.3-bridge.9.tsgo.7.0.2 | npm:typescript-native-bridge@6.0.3-bridge.13.tsgo.7.0.2 |
| overrides | vite                                 | catalog:vite-plus                                      | absent                                                  |
| overrides | vite@*                               | absent                                                 | catalog:vite-plus                                       |
| overrides | vitest                               | catalog:vite-plus                                      | absent                                                  |
| overrides | vitest@*                             | absent                                                 | catalog:vite-plus                                       |
| overrides | vue                                  | absent                                                 | 3.5.42                                                  |

The authentic lock changes all three importers, 820 package records and 1,102 snapshot records. The full original and candidate lock bytes and complete ordered record differences are retained in local delivery custody. Primary lock Git blobs are `14f6418226033a8249bc1415cb469578530b4d128` and `2dd5874dfdd977ea38a2584d71cc9fd744eb81b4`; SHA-256 values are `49462888719521ac8664116b766856f6d2b8fc9fdff83e504d7710d8c2952cac` and `3497f83fb7640993d87793b1350a008828ea96e048afd9d048daf0686b8ce041`. Catalog identities and override keys remain authored, including their native TypeScript bridge and Vite changes.

## Required acceptance after selection

The same original 32 App projects, all 15 intentional TS2322 injection/repair controls, unchanged deadlines and complete native syntax/semantic/repair controls remain required. All original test bodies, checker argv/config selection, capture behavior, expected vectors and producer sources are untouched by this proposal. The candidate must use its genuine authored package/config graph and the original consumer commands; package substitution, source patching and expectation/count normalization do not qualify it.

Retain complete installed-package/lock/source and actual native config authority during the already planned composed qualification. Compare complete same-config native diagnostic vectors and authored source before accepting an independently justified migration golden. Nothing here makes the original 404 or the candidate consumer green.
