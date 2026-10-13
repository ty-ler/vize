// Server-render with the official SSR compiler (vapor: true), then hydrate the
// HTML with official and Vize Vapor client output and compare the outcomes.
// usage: node hydrate.ts <vapor_sweep binary> [id-prefix]
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { compile } from "@vue/compiler-vapor";
import { compile as compileSsr } from "@vue/compiler-ssr";
import { templates, type Case } from "./corpus.ts";
import { baseState, childSources } from "./state.ts";

const [binary, filter] = process.argv.slice(2);
const skipRe = /\$attrs|\$slots|\$emit|new Date|Teleport|v-memo|: MouseEvent|: Event|as any|as string|foo!|<T,>|: any|: \{ a: string \}/;
const cases: Case[] = templates.filter((c) => (!filter || c.id.startsWith(filter)) && !skipRe.test(c.source));
const here = new URL("./", import.meta.url).pathname;
const out = `${here}out/`;
const mods = `${here}hmods/`;
rmSync(mods, { recursive: true, force: true });
mkdirSync(mods, { recursive: true });
writeFileSync(`${out}hcases.json`, JSON.stringify(cases));

// ---- server (node build of vue + server-renderer) ----
const serverVue = await import("vue");
const { renderToString } = await import("@vue/server-renderer");
let seq = 0;
async function loadServer(code: string) {
  const file = `${mods}s${seq++}.mjs`;
  writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}
const ssrOptions = { prefixIdentifiers: true, mode: "module" as const, vapor: true, comments: false, onWarn: () => {} };
const serverChildren: Record<string, unknown> = {};
for (const [name, source] of Object.entries(childSources)) {
  const mod = await loadServer(compileSsr(source, ssrOptions).code);
  serverChildren[name] = { name, __vapor: true, setup: () => ({}), ssrRender: mod.ssrRender };
}
async function serverHtml(c: Case): Promise<string> {
  const errors: string[] = [];
  const { code } = compileSsr(c.source, { ...ssrOptions, onError: (e: Error) => errors.push(e.message) });
  if (errors.length) throw new Error(`ssr compile: ${errors[0]}`);
  const mod = await loadServer(code);
  const identifiers = new Set([...code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!));
  const state = baseState(() => () => {});
  for (const id of identifiers) if (!(id in state)) state[id] = `<${id}>`;
  const app = serverVue.createSSRApp({ __vapor: true, setup: () => state, ssrRender: mod.ssrRender });
  for (const [name, component] of Object.entries(serverChildren)) app.component(name, component as never);
  app.config.warnHandler = () => {};
  return renderToString(app);
}

// ---- client (browser bundle under happy-dom) ----
const window = new Window({ url: "http://localhost/" });
for (const key of [
  "window", "document", "Node", "Element", "HTMLElement", "SVGElement", "Comment", "Text",
  "DocumentFragment", "Event", "MouseEvent", "KeyboardEvent", "CustomEvent", "MutationObserver",
  "HTMLTemplateElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement",
  "navigator", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "MathMLElement",
  "ShadowRoot", "customElements", "CSSStyleDeclaration", "HTMLOptionElement",
] as const) {
  const value = (window as unknown as Record<string, unknown>)[key];
  if (value !== undefined) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
const runtimeUrl = pathToFileURL(`${here}node_modules/vue/dist/vue.runtime-with-vapor.esm-browser.js`).href;
const vue = await import(runtimeUrl);
async function loadClient(code: string): Promise<Record<string, unknown>> {
  const file = `${mods}c${seq++}.mts`;
  writeFileSync(file, code.replaceAll(/from ['"]vue['"]/g, `from ${JSON.stringify(runtimeUrl)}`));
  return import(pathToFileURL(file).href);
}
const clientOptions = { prefixIdentifiers: true, mode: "module" as const, comments: false, expressionPlugins: ["typescript" as const], onWarn: () => {} };
const clientChildren: Record<string, unknown> = {};
for (const [name, source] of Object.entries(childSources)) {
  const mod = await loadClient(compile(source, clientOptions).code);
  clientChildren[name] = vue.defineVaporComponent({ name, setup: () => ({}), render: mod.render });
}
const vizeAll: { id: string; result: { code?: string; errors?: string[] } }[] =
  JSON.parse(execFileSync(binary, [`${out}hcases.json`], { maxBuffer: 1 << 28 }).toString());
const vizeById = new Map(vizeAll.map((v) => [v.id, v.result]));

interface Outcome { log: string[]; kept: string; snapshots: string[] }
async function hydrate(code: string, html: string): Promise<Outcome> {
  const log: string[] = [];
  const snapshots: string[] = [];
  const identifiers = new Set([...code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!));
  const fn = (name: string) => (...args: unknown[]) => { log.push(`${name}(${args.length})`); };
  const base = baseState(fn);
  for (const id of identifiers) if (!(id in base) && id !== "vaporTemplateRefSetter") base[id] = `<${id}>`;
  const state = vue.reactive(base);
  const mod = await loadClient(code);
  const App = vue.defineVaporComponent({ setup: () => state, render: mod.render });
  const host = document.body.appendChild(document.createElement("div"));
  host.innerHTML = html;
  const serverElements = [...host.querySelectorAll("*")];
  const app = vue.createVaporSSRApp(App);
  for (const [name, component] of Object.entries(clientChildren)) app.component(name, component);
  app.config.errorHandler = (error: Error) => log.push(`ERR ${String(error?.message ?? error).split("\n")[0]}`);
  app.config.warnHandler = (message: string) => log.push(`WARN ${message.split("\n")[0]}`);
  const originalWarn = console.warn, originalError = console.error;
  console.warn = (...args: unknown[]) => log.push(`CWARN ${String(args[0]).split("\n")[0]}`);
  console.error = (...args: unknown[]) => log.push(`CERR ${String(args[0]).split("\n")[0]}`);
  let kept = "";
  const snap = async () => { await vue.nextTick(); snapshots.push(host.innerHTML); };
  try {
    app.mount(host);
    await snap();
    const alive = serverElements.filter((el) => host.contains(el)).length;
    kept = `${alive}/${serverElements.length}`;
    for (const [key, value] of Object.entries(state)) if (typeof value === "boolean") state[key] = !value;
    await snap();
    for (const value of Object.values(state)) if (Array.isArray(value)) value.reverse();
    state.list = [...state.list, 4];
    await snap();
    for (const el of [...host.querySelectorAll("*")]) el.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }) as unknown as Event);
    await snap();
  } catch (e) {
    log.push(`THROW ${String((e as Error)?.message ?? e).split("\n")[0]}`);
  } finally {
    console.warn = originalWarn; console.error = originalError;
    try { app.unmount(); } catch (e) { log.push(`UNMOUNT-THROW ${String((e as Error)?.message).split("\n")[0]}`); }
    host.remove();
  }
  return { log, kept, snapshots };
}

let same = 0, upstreamClean = 0;
const summary: string[] = [];
const report: string[] = [];
for (const c of cases) {
  let html: string;
  try { html = await serverHtml(c); } catch (e) { summary.push(`SSR-FAIL\t${c.id}\t${String((e as Error).message).slice(0, 80)}`); continue; }
  const errors: string[] = [];
  let uCode = "";
  try { uCode = compile(c.source, { ...clientOptions, onError: (e) => errors.push(e.message) }).code; } catch { errors.push("throw"); }
  const v = vizeById.get(c.id) ?? {};
  if (errors.length || !uCode || !v.code || (v.errors ?? []).length) { summary.push(`COMPILE-SKIP\t${c.id}`); continue; }
  const u = await hydrate(uCode, html);
  const z = await hydrate(v.code, html);
  const uClean = !u.log.some((l) => /mismatch|ERR|THROW/i.test(l));
  if (uClean) upstreamClean++;
  const equal = JSON.stringify(u) === JSON.stringify(z);
  if (equal) { same++; continue; }
  const zBad = z.log.filter((l) => /mismatch|ERR|THROW/i.test(l));
  const kind = !uClean ? "UP-UNCLEAN" : zBad.length ? "VIZE-MISMATCH" : u.kept !== z.kept ? "VIZE-RECREATED" : "DIFF";
  summary.push(`${kind}\t${c.id}\t${c.source.replaceAll("\n", "\\n").slice(0, 90)}`);
  const lines = [`=== ${c.id} [${kind}]`, c.source, `html: ${html}`, `kept upstream=${u.kept} vize=${z.kept}`];
  u.snapshots.forEach((s, i) => { if (s !== z.snapshots[i]) lines.push(`step${i} upstream: ${s}`, `step${i} vize    : ${z.snapshots[i]}`); });
  lines.push(`log upstream: ${JSON.stringify(u.log)}`, `log vize    : ${JSON.stringify(z.log)}`, "--- upstream code", uCode, "--- vize code", v.code, "");
  report.push(lines.join("\n"));
}
writeFileSync(`${out}hydrate-report.txt`, report.join("\n"));
writeFileSync(`${out}hydrate-summary.tsv`, summary.join("\n"));
console.log(`cases=${cases.length} same=${same} upstreamClean=${upstreamClean} listed=${summary.length}`);
process.exit(0);
