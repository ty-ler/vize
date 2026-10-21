# Type-checking performance

Use this guide when `vize check` is slow or uses too much memory. Start with the defaults and a
profile, then change one setting at a time. For the other options, see
[type-checking with the CLI](./cli.md#check) and the [Type Checking guide](./type-checking.md).

## Find where the time goes

```sh
vpx vize check --profile
```

The last line splits the run into phases:

```text
✗ Type checked 1 files in 624.27ms (collect: 105.94ms, imports: 0.00ns, gen: 114.51ms, corsa: 339.05ms)
```

| Phase     | What it covers                                                      |
| --------- | ------------------------------------------------------------------- |
| `collect` | Reading `tsconfig.json` and finding the files to check              |
| `imports` | Following imports between components                                |
| `gen`     | Turning each `.vue` file into virtual TypeScript                    |
| `corsa`   | Running TypeScript's native compiler (Corsa) on the generated files |

The profile table and the virtual files are written under `node_modules/.vize`. When `corsa`
dominates, the notes at the end name the largest generated files; those are usually the
components to split or simplify.

## Tune the run

| Symptom                                | Try                                                                  |
| -------------------------------------- | -------------------------------------------------------------------- |
| Uses too much memory                   | `--servers 1` runs a single TypeScript process                       |
| Large project, idle CPU cores          | Leave `--servers` unset; it is sized from CPU count and file count  |
| `corsa` dominates on one big project   | The default four checkers parallelize work inside each process     |
| Many short runs while editing          | Keep a [`check-server`](./type-checking.md#speed-on-large-projects) running |

```sh
vpx vize check --checkers 4 --servers 1
```

> [!WARNING]
> Corsa v2's default four-checker mode is covered by Vize's real-project snapshots.
> If you replace the bundled runtime, compare its output with `--checkers 1` before using a custom width in CI.

`--checkers` accepts a positive integer and overrides the `VIZE_CHECKERS` environment variable.
`--servers` (`1`–`32`) sets how many separate TypeScript processes run; automatic sizing accounts for
the checker workers in each process. Set the server count for every run with `vue.typeChecker.servers`.
