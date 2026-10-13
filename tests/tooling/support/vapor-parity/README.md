# Vapor parity harness (work in progress)

Discovery scripts for the Vapor parity work. They are not wired into CI yet.

- `corpus.ts`: 340 templates grouped by class (namespaces, fallthrough, slot
  props, event handlers, directives).
- `behave.ts`: mounts this compiler's output and `@vue/compiler-vapor`'s output
  under the same published runtime in happy-dom, drives a few state steps and
  events, and reports every case whose DOM, handler calls, warnings or errors
  differ.
- `hydrate.ts`: server-renders each template with `@vue/compiler-ssr`
  (`vapor: true`) and hydrates the HTML with both compilers' client output.
- `vapor_sweep.rs.txt`: the Rust example that compiles a JSON corpus through
  `compile_vapor`; copy it to `crates/vize_atelier_sfc/examples/vapor_sweep.rs`.

Run them from a scratch directory that has `vue`, `@vue/compiler-vapor`,
`@vue/compiler-ssr`, `@vue/server-renderer` (all `3.6.0-rc.11`) and
`happy-dom` installed:

```sh
cargo build -p vize_atelier_sfc --example vapor_sweep
node behave.ts <target>/debug/examples/vapor_sweep
node hydrate.ts <target>/debug/examples/vapor_sweep
```
