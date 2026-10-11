import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Page, Response } from "@playwright/test";

type ResponseReceipt = {
  order: number;
  url: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
  sha256?: string;
  error?: string;
};

export function observeVuefesResponses(page: Page) {
  const responses: ResponseReceipt[] = [];
  const pending = new Set<Promise<void>>();
  page.on("response", (response: Response) => {
    const url = response.url();
    if (!/VFHeading|main\.css|type=style|\.css(?:\?|$)/i.test(url)) return;
    const receipt: ResponseReceipt = {
      order: responses.length,
      url,
      status: response.status(),
      headers: response.headers(),
    };
    responses.push(receipt);
    const task = response
      .text()
      .then((body) => {
        receipt.body = body;
        receipt.sha256 = createHash("sha256").update(body).digest("hex");
      })
      .catch((error: unknown) => {
        receipt.error = String(error);
      })
      .finally(() => pending.delete(task));
    pending.add(task);
  });
  return async () => {
    await Promise.all([...pending]);
    return responses;
  };
}

export async function captureVuefesPage(
  page: Page,
  name: string,
  responses: ReturnType<typeof observeVuefesResponses>,
) {
  try {
    await captureVuefesPageComplete(page, name, responses);
  } catch (error) {
    const output = path.resolve("../target/app-e2e-logs/vuefes-scope");
    const failure = { complete: false, name, error: String(error) };
    try {
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, `${name}-error.json`), JSON.stringify(failure, null, 2));
    } catch (writeError) {
      console.error("VueFes observer failure", failure, String(writeError));
    }
  }
}

async function captureVuefesPageComplete(
  page: Page,
  name: string,
  responses: ReturnType<typeof observeVuefesResponses>,
) {
  const receipt = await page.evaluate(() => {
    type RuleReceipt = {
      index: number;
      text: string;
      selector?: string;
      children?: RuleReceipt[];
      href?: string;
      error?: string;
    };
    const rules = (sheet: CSSStyleSheet | CSSGroupingRule): RuleReceipt[] =>
      Array.from(sheet.cssRules, (rule, index) => {
        const receipt: RuleReceipt = { index, text: rule.cssText };
        if (rule instanceof CSSStyleRule) receipt.selector = rule.selectorText;
        if (rule instanceof CSSGroupingRule) receipt.children = rules(rule);
        if (rule instanceof CSSImportRule) {
          receipt.href = rule.href;
          try {
            if (rule.styleSheet) receipt.children = rules(rule.styleSheet);
          } catch (error) {
            receipt.error = String(error);
          }
        }
        return receipt;
      });
    const sheets = [...document.styleSheets].map((sheet, order) => {
      try {
        return {
          order,
          href: sheet.href,
          disabled: sheet.disabled,
          media: sheet.media.mediaText,
          owner: sheet.ownerNode instanceof Element ? sheet.ownerNode.outerHTML : null,
          rules: rules(sheet),
        };
      } catch (error) {
        return { order, href: sheet.href, error: String(error) };
      }
    });
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((heading, order) => {
      const style = getComputedStyle(heading);
      const rect = heading.getBoundingClientRect();
      const matched = (list: RuleReceipt[], sheet: number, parents: string[] = []): unknown[] =>
        list.flatMap((rule) => {
          const nested = rule.children
            ? matched(rule.children, sheet, [
                ...parents,
                rule.text.slice(0, rule.text.indexOf("{")),
              ])
            : [];
          const selector = rule.selector;
          if (!selector) return nested;
          try {
            return heading.matches(selector)
              ? [{ sheet, index: rule.index, selector, text: rule.text, parents }, ...nested]
              : nested;
          } catch (error) {
            return [
              {
                sheet,
                index: rule.index,
                selector,
                text: rule.text,
                parents,
                error: String(error),
              },
              ...nested,
            ];
          }
        });
      const matchedRules = sheets.flatMap((sheet) => matched(sheet.rules ?? [], sheet.order));
      return {
        order,
        outerHTML: heading.outerHTML,
        text: heading.textContent,
        attributes: [...heading.attributes].map(({ name, value }) => ({ name, value })),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        computed: Object.fromEntries(
          Array.from(style, (name) => [name, style.getPropertyValue(name)]),
        ),
        pseudoBefore: { content: getComputedStyle(heading, "::before").content },
        matchedRules,
      };
    });
    return {
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      html: document.documentElement.outerHTML,
      sheets,
      headings,
    };
  });
  const output = path.resolve("../target/app-e2e-logs/vuefes-scope");
  fs.mkdirSync(output, { recursive: true });
  const save = (suffix: string, value: unknown) => {
    const text = JSON.stringify(value, null, 2) + "\n";
    fs.writeFileSync(path.join(output, `${name}${suffix}.json`), text);
    fs.writeFileSync(
      path.join(output, `${name}${suffix}.sha256`),
      createHash("sha256").update(text).digest("hex") + "\n",
    );
  };
  const network = await responses();
  save("-dom", { ...receipt, responses: network });
  let vueGraph: unknown;
  try {
    vueGraph = await page.evaluate(() => {
      const ids = new Map<object, number>();
      const queue: object[] = [];
      const errors: { node?: number; key?: unknown; error: string }[] = [];
      const symbolIds = new Map<symbol, number>();
      const symbols: unknown[] = [];
      const symbolReference = (value: symbol) => {
        let id = symbolIds.get(value);
        if (id === undefined) {
          id = symbols.length;
          symbolIds.set(value, id);
          symbols.push({
            id,
            description: value.description ?? { type: "undefined" },
            globalKey: Symbol.keyFor(value) ?? { type: "undefined" },
          });
        }
        return { symbolReference: id };
      };
      const encode = (value: unknown): unknown => {
        if (value === undefined) return { type: "undefined" };
        if (typeof value === "function") return { type: "function", source: value.toString() };
        if (typeof value === "symbol") return symbolReference(value);
        if (typeof value === "bigint") {
          return { type: typeof value, value: value.toString() };
        }
        if (typeof value === "number" && !Number.isFinite(value)) {
          return { type: "number", value: String(value) };
        }
        if (value === null || typeof value !== "object") return value;
        let id = ids.get(value);
        if (id === undefined) {
          id = queue.length;
          ids.set(value, id);
          queue.push(value);
        }
        return { reference: id };
      };
      const instances: unknown[] = [];
      const instanceIds = new Map<object, number>();
      const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((heading, order) => {
        const chain: number[] = [];
        const seen = new Set<object>();
        let cycle: number | undefined;
        let instance = (heading as HTMLElement & { __vueParentComponent?: any })
          .__vueParentComponent;
        while (instance) {
          let id = instanceIds.get(instance);
          if (id === undefined) {
            id = instances.length;
            instanceIds.set(instance, id);
            instances.push({
              id,
              uid: encode(instance.uid),
              name: encode(instance.type.__name ?? instance.type.name),
              file: encode(instance.type.__file),
              scopeId: encode(instance.type.__scopeId),
              render: encode(instance.render),
              props: encode(instance.props),
              attrs: encode(instance.attrs),
              vnodeScopeId: encode(instance.vnode.scopeId),
              slotScopeIds: encode(instance.vnode.slotScopeIds),
            });
          }
          if (seen.has(instance)) {
            cycle = id;
            break;
          }
          seen.add(instance);
          chain.push(id);
          instance = instance.parent;
        }
        return { order, chain, cycle };
      });
      const nodes: unknown[] = [];
      for (let id = 0; id < queue.length; id++) {
        const value = queue[id];
        const entries: { key: unknown; value?: unknown; error?: string }[] = [];
        let keys: (string | symbol)[] = [];
        try {
          keys = Reflect.ownKeys(value).filter(
            (key) => Object.getOwnPropertyDescriptor(value, key)?.enumerable,
          );
        } catch (error) {
          errors.push({ node: id, error: String(error) });
        }
        for (const key of keys) {
          const recordedKey = typeof key === "symbol" ? symbolReference(key) : key;
          try {
            entries.push({
              key: recordedKey,
              value: encode((value as Record<PropertyKey, unknown>)[key]),
            });
          } catch (error) {
            entries.push({ key: recordedKey, error: String(error) });
            errors.push({ node: id, key: recordedKey, error: String(error) });
          }
        }
        nodes.push({
          id,
          array: Array.isArray(value),
          length: Array.isArray(value) ? value.length : undefined,
          entries,
        });
      }
      return { complete: errors.length === 0, headings, instances, nodes, symbols, errors };
    });
  } catch (error) {
    vueGraph = { complete: false, error: String(error) };
  }
  save("-vue", vueGraph);
  save("", { ...receipt, responses: await responses(), vueGraph });
}
