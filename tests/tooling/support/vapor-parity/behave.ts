// Mount official and Vize Vapor output under the same published runtime and
// compare DOM, handler calls, warnings and errors through a few state steps.
// usage: node behave.ts <vapor_sweep binary> [id-prefix]
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { compile } from "@vue/compiler-vapor";
import { templates, type Case } from "./corpus.ts";

const [binary, filter] = process.argv.slice(2);
const cases: Case[] = templates.filter((c) => !filter || c.id.startsWith(filter));
const here = new URL("./", import.meta.url).pathname;
const out = `${here}out/`;
const mods = `${out}mods/`;
rmSync(mods, { recursive: true, force: true });
mkdirSync(mods, { recursive: true });
writeFileSync(`${out}cases.json`, JSON.stringify(cases));

const window = new Window({ url: "http://localhost/" });
for (const key of [
  "window", "document", "Node", "Element", "HTMLElement", "SVGElement", "Comment", "Text",
  "DocumentFragment", "Event", "MouseEvent", "KeyboardEvent", "CustomEvent", "MutationObserver",
  "HTMLTemplateElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement",
  "navigator", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "MathMLElement",
  "ShadowRoot", "customElements", "CSSStyleDeclaration", "HTMLOptionElement",
] as const) {
  const value = (window as unknown as Record<string, unknown>)[key];
  if (value !== undefined) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
}
const runtimeUrl = pathToFileURL(
  `${here}node_modules/vue/dist/vue.runtime-with-vapor.esm-browser.js`,
).href;
const vue = await import(runtimeUrl);

function upstream(c: Case): { code: string; errors: string[] } {
  const errors: string[] = [];
  try {
    const result = compile(c.source, {
      prefixIdentifiers: true,
      mode: "module", comments: false,
      expressionPlugins: ["typescript"],
      onError: (e) => errors.push(e.message),
      onWarn: () => {},
    });
    return { code: result.code, errors };
  } catch (e) {
    return { code: "", errors: [...errors, `THROW ${(e as Error).message}`] };
  }
}
const vizeAll: { id: string; result: { code?: string; errors?: string[]; panic?: boolean } }[] =
  JSON.parse(execFileSync(binary, [`${out}cases.json`], { maxBuffer: 1 << 28 }).toString());
const vizeById = new Map(vizeAll.map((v) => [v.id, v.result]));

const child = (template: string) => {
  const { code } = compile(template, { prefixIdentifiers: true, mode: "module" });
  return code;
};
const childSources: Record<string, string> = {
  Comp: `<section class="comp"><slot :a="1" :b="2" :items="[{ id: 1, name: 'n1' }, { id: 2, name: 'n2' }]" :props="{ id: 'p', title: 'pt' }" :data="{ id: 7, name: 'dn' }" :v="'v'" :x="'sx'"/><slot name="x" :a="2" :v="'vx'"/><slot name="header"/><slot name="item" :data="{ id: 8, name: 'in' }"/><slot name="a" :a="3"/><slot name="b" :a="4"/></section>`,
  Inner: `<article class="inner"><slot :a="5" :b="6"/><slot name="b" :a="7"/></article>`,
  Other: `<aside class="other"><slot/></aside>`,
};
let seq = 0;
async function load(code: string): Promise<Record<string, unknown>> {
  const file = `${mods}m${seq++}.mts`;
  writeFileSync(file, code.replaceAll(/from ['"]vue['"]/g, `from ${JSON.stringify(runtimeUrl)}`));
  return import(pathToFileURL(file).href);
}
const childComponents: Record<string, unknown> = {};
for (const [name, source] of Object.entries(childSources)) {
  const mod = await load(child(source));
  childComponents[name] = vue.defineVaporComponent({ name, setup: () => ({}), render: mod.render });
}

function makeState(log: string[], identifiers: Set<string>) {
  const fn = (name: string) => (...args: unknown[]) => {
    log.push(`${name}(${args.map((a) => (a && typeof a === "object" && "type" in a ? `Event:${(a as Event).type}` : JSON.stringify(a))).join(",")})`);
  };
  const base: Record<string, unknown> = {
    ok: true, a: true, b: false, deep: true, vis: true, d: "M0 0", ok2: false,
    c: "cls", s: { color: "red" }, t: "title", h: "<b>h</b>", x: "x", y: "y", w: 10, r: 2,
    list: [1, 2, 3], l: [{ id: 1, n: "one", a: true, v: "v1", ok: true, name: "n1" }, { id: 2, n: "two", a: false, v: "v2", ok: false, name: "n2" }],
    rows: [[1, 2], [3, 4]], ps: ["10%", "20%"], stops: [0, 1], os: ["a", "b"], slots: ["a", "b"],
    obj: { a: { b: "ab" }, k: "kv", count: 0, x: 1, y: 2 }, arr: ["a0", "a1"], key: "k", k: "title",
    m: "model", msg: "msg", id: "the-id", tag: "g", src: "s.png", attrs: { r: "3", "data-q": "q" },
    name: "x", dyn: "title", e: "click", event: "click", count: 0, u: "/u", v: "val", n: "default",
    p: { q: 1 }, props: { title: "pt" }, outer: "outer", class: "kls", items: [], handlers: {},
    i: { ok: true, v: "iv" }, j: "j", title: "T", to: "body", is: "div", cls: "z", label: "L",
    foo: fn("foo"), bar: fn("bar"), baz: fn("baz"), go: fn("go"), onInput: fn("onInput"),
    onSubmit: fn("onSubmit"), setRef: fn("setRef"), k2: fn("k"), a2: fn("a"),
  };
  base.handlers = { click: fn("h.click"), focus: fn("h.focus") };
  for (const id of identifiers) if (!(id in base) && id !== "vaporTemplateRefSetter") base[id] = `<${id}>`;
  return vue.reactive(base);
}

async function run(code: string, log: string[]): Promise<string[]> {
  const snapshots: string[] = [];
  const identifiers = new Set([...code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!));
  const mod = await load(code);
  const state = makeState(log, identifiers);
  const App = vue.defineVaporComponent({ setup: () => state, render: mod.render });
  const host = document.body.appendChild(document.createElement("div"));
  const app = vue.createVaporApp(App);
  for (const [name, component] of Object.entries(childComponents)) app.component(name, component);
  app.config.errorHandler = (error: Error) => log.push(`ERR ${String(error?.message ?? error).split("\n")[0]}`);
  app.config.warnHandler = (message: string) => log.push(`WARN ${message.split("\n")[0]}`);
  const snap = async () => {
    await vue.nextTick();
    snapshots.push(host.innerHTML);
  };
  try {
    app.mount(host);
    await snap();
    for (const [key, value] of Object.entries(state)) if (typeof value === "boolean") state[key] = !value;
    await snap();
    for (const value of Object.values(state)) if (Array.isArray(value)) value.reverse();
    state.list = [...state.list, 4];
    await snap();
    for (const [key, value] of Object.entries(state)) if (typeof value === "string" && !["e", "event", "tag", "is", "to", "dyn", "k", "key", "name", "n"].includes(key)) state[key] = `${value}!`;
    await snap();
    for (const type of ["click", "mouseenter", "input", "keyup", "submit"]) {
      for (const el of [...host.querySelectorAll("*")]) {
        const event = type === "keyup" ? new KeyboardEvent("keyup", { key: "Enter", bubbles: true }) : new Event(type, { bubbles: true, cancelable: true });
        el.dispatchEvent(event as unknown as Event);
      }
    }
    await snap();
    for (const [key, value] of Object.entries(state)) if (typeof value === "boolean") state[key] = !value;
    await snap();
  } catch (e) {
    log.push(`THROW ${String((e as Error)?.message ?? e).split("\n")[0]}`);
  } finally {
    try { app.unmount(); } catch (e) { log.push(`UNMOUNT-THROW ${String((e as Error)?.message).split("\n")[0]}`); }
    host.remove();
  }
  return snapshots;
}

let same = 0;
const summary: string[] = [];
const report: string[] = [];
for (const c of cases) {
  const u = upstream(c);
  const v = vizeById.get(c.id) ?? {};
  const vErr = (v.errors ?? []).length > 0 || v.panic === true || !v.code;
  const uErr = u.errors.length > 0 || !u.code;
  if (uErr || vErr) {
    if (uErr && vErr) { same++; continue; }
    summary.push(`${vErr ? "VIZE-COMPILE-ERR" : "UP-COMPILE-ERR"}\t${c.id}\t${c.source.replaceAll("\n", "\\n").slice(0, 100)}`);
    report.push(`=== ${c.id} compile\n${c.source}\nupstream errors=${JSON.stringify(u.errors)}\nvize errors=${JSON.stringify(v.errors)} panic=${v.panic}\n`);
    continue;
  }
  const uLog: string[] = [], vLog: string[] = [];
  const uSnap = await run(u.code, uLog);
  const vSnap = await run(v.code!, vLog);
  const domSame = JSON.stringify(uSnap) === JSON.stringify(vSnap);
  const logSame = JSON.stringify(uLog) === JSON.stringify(vLog);
  if (domSame && logSame) { same++; continue; }
  const kind = !domSame ? "DOM" : "LOG";
  summary.push(`${kind}\t${c.id}\t${c.source.replaceAll("\n", "\\n").slice(0, 100)}`);
  const lines = [`=== ${c.id} [${kind}]`, c.source];
  uSnap.forEach((s, i) => { if (s !== vSnap[i]) lines.push(`step${i} upstream: ${s}`, `step${i} vize    : ${vSnap[i]}`); });
  if (uSnap.length !== vSnap.length) lines.push(`snapshots upstream=${uSnap.length} vize=${vSnap.length}`);
  if (!logSame) lines.push(`log upstream: ${JSON.stringify(uLog)}`, `log vize    : ${JSON.stringify(vLog)}`);
  lines.push("--- upstream code", u.code, "--- vize code", v.code!, "");
  report.push(lines.join("\n"));
}
writeFileSync(`${out}behave-report.txt`, report.join("\n"));
writeFileSync(`${out}behave-summary.tsv`, summary.join("\n"));
console.log(`cases=${cases.length} same=${same} different=${cases.length - same}`);
console.log(summary.join("\n"));
process.exit(0);
