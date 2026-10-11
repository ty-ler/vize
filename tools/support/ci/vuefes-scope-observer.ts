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
  const receipt = await page.evaluate(() => {
    const serialize = (value: unknown, seen = new Set<unknown>()): unknown => {
      if (value === undefined) return { type: "undefined" };
      if (typeof value === "function") return { type: "function", source: value.toString() };
      if (typeof value === "symbol") return { type: "symbol", value: value.toString() };
      if (value === null || typeof value !== "object") return value;
      if (seen.has(value)) return { type: "circular", constructor: value.constructor?.name };
      seen.add(value);
      const result = Array.isArray(value)
        ? value.map((child) => serialize(child, seen))
        : Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, serialize(child, seen)]),
          );
      seen.delete(value);
      return result;
    };
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
      const vue = (heading as HTMLElement & { __vueParentComponent?: any }).__vueParentComponent;
      const instances = [];
      for (let instance = vue; instance; instance = instance.parent) {
        instances.push({
          uid: instance.uid,
          name: instance.type.__name ?? instance.type.name,
          file: instance.type.__file,
          scopeId: instance.type.__scopeId,
          render: instance.render?.toString(),
          props: serialize(instance.props),
          attrs: serialize(instance.attrs),
          vnodeScopeId: instance.vnode.scopeId,
          slotScopeIds: instance.vnode.slotScopeIds,
        });
      }
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
        instances,
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
  const text = JSON.stringify({ ...receipt, responses: await responses() }, null, 2) + "\n";
  const output = path.resolve("../target/app-e2e-logs/vuefes-scope");
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `${name}.json`), text);
  fs.writeFileSync(
    path.join(output, `${name}.sha256`),
    createHash("sha256").update(text).digest("hex") + "\n",
  );
}
