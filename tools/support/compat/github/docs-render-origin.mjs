import assert from "node:assert/strict";

const fields = new Set(["url", "href", "src", "nativeTarget", "links", "hrefs"]);
const literalTags = new Set(["pre", "code"]);
const rawTags = new Set(["script", "style", "textarea", "title"]);
const attributes = new Set(["href", "src", "action", "formaction", "poster", "xlink:href"]);

function authenticateOrigin(origin) {
  assert(
    /^http:\/\/127\.0\.0\.1:\d+$/.test(origin),
    "Authenticated ephemeral static-server origin",
  );
}

function transportUrl(value, origin) {
  if (!value.startsWith(origin) || !/^(?:[/?#]|$)/.test(value.slice(origin.length))) return value;
  try {
    if (new URL(value).origin === origin)
      return `http://docs-render.invalid${value.slice(origin.length)}`;
  } catch {
    // Literal or malformed operands remain exact; they cannot establish transport equivalence.
  }
  return value;
}

/** Only measured URL fields change; foreign URLs, authored source and code remain byte-exact. */
export function normalizeOrigin(value, origin) {
  authenticateOrigin(origin);
  function visit(entry, field = "") {
    if (typeof entry === "string") return fields.has(field) ? transportUrl(entry, origin) : entry;
    if (Array.isArray(entry)) return entry.map((item) => visit(item, field));
    if (entry && typeof entry === "object")
      return Object.fromEntries(
        Object.entries(entry).map(([key, item]) => [key, visit(item, key)]),
      );
    return entry;
  }
  return visit(value);
}

/** Canonicalize quoted transport attributes in serialized DOM, retaining all other HTML bytes. */
export function normalizeHtmlOrigins(html, origin) {
  authenticateOrigin(origin);
  const tokens = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-zA-Z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
  const literal = [];
  let output = "";
  let cursor = 0;
  for (let token; (token = tokens.exec(html));) {
    const text = token[0];
    const name = token[1]?.toLowerCase();
    const closing = text.startsWith("</");
    output += html.slice(cursor, token.index);
    if (!name || closing || literal.length || literalTags.has(name)) output += text;
    else
      output += text.replace(
        /(\s+)([^\s="'/>]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/g,
        (attribute, space, name, equals, value) => {
          if (!attributes.has(name.toLowerCase()) || !/^["']/.test(value)) return attribute;
          const quote = value[0];
          return `${space}${name}${equals}${quote}${transportUrl(value.slice(1, -1), origin)}${quote}`;
        },
      );
    cursor = tokens.lastIndex;
    if (literalTags.has(name)) {
      if (!closing) literal.push(name);
      else {
        const index = literal.lastIndexOf(name);
        if (index !== -1) literal.splice(index);
      }
    }
    if (rawTags.has(name) && !closing) {
      const end = new RegExp(`</${name}\\s*>`, "gi");
      end.lastIndex = cursor;
      const close = end.exec(html);
      const after = close ? end.lastIndex : html.length;
      output += html.slice(cursor, after);
      cursor = after;
      tokens.lastIndex = after;
    }
  }
  return output + html.slice(cursor);
}
