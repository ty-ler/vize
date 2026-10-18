import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
process.env.NODE_ENV = "production";
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function importFromRoots(specifier, roots) {
  for (const root of roots) {
    if (!root) continue;
    const observation = capture?.beginImport(specifier, root);
    try {
      const require = createRequire(path.join(root, "package.json"));
      const resolved = require.resolve(specifier);
      const imported = await import(pathToFileURL(resolved).href);
      capture?.observeImport(observation, resolved, imported);
      return imported;
    } catch (error) {
      if (observation)
        Object.assign(observation, { status: "failed", error: toErrorMessage(error) });
      // Try the next root, then the default resolver below.
    }
  }
  const observation = capture?.beginImport(specifier, null);
  try {
    const imported = await import(specifier);
    if (capture) {
      try {
        capture.observeImport(observation, fileURLToPath(import.meta.resolve(specifier)), imported);
      } catch (error) {
        Object.assign(observation, { status: "loaded", observationError: toErrorMessage(error) });
      }
    }
    return imported;
  } catch (error) {
    if (observation) Object.assign(observation, { status: "failed", error: toErrorMessage(error) });
    throw error;
  }
}

function normalizeCompilerMessages(messages) {
  return (messages ?? []).map((message) => {
    if (message instanceof Error) return message.message;
    if (typeof message === "object" && message && "message" in message) {
      return String(message.message);
    }
    return String(message);
  });
}

function descriptorUsesTypeScript(descriptor) {
  const langs = [descriptor.script?.lang, descriptor.scriptSetup?.lang];
  return langs.some((lang) => lang === "ts" || lang === "tsx");
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function loadFormatter(roots) {
  try {
    const [prettier, parserBabel, parserEstree, parserTypescript] = await Promise.all([
      importFromRoots("prettier/standalone", roots),
      importFromRoots("prettier/plugins/babel", roots),
      importFromRoots("prettier/plugins/estree", roots),
      importFromRoots("prettier/plugins/typescript", roots),
    ]);
    const exportedApi = (module, name) => (name in module ? module : (module.default ?? module));
    return {
      prettier: exportedApi(prettier, "format"),
      parserBabel: exportedApi(parserBabel, "parsers"),
      parserEstree: exportedApi(parserEstree, "printers"),
      parserTypescript: exportedApi(parserTypescript, "parsers"),
    };
  } catch {
    return null;
  }
}

async function formatCode(source, parser, formatter, role) {
  if (!source || !formatter) {
    capture?.formatEvents.push({
      file: capture.currentFile,
      role,
      parser,
      status: source ? "formatter-unavailable" : "empty",
    });
    return source ?? "";
  }
  const plugins =
    parser === "typescript"
      ? [formatter.parserTypescript, formatter.parserEstree]
      : [formatter.parserBabel, formatter.parserEstree];
  try {
    const formatted = await formatter.prettier.format(source, {
      parser,
      plugins,
      semi: true,
      singleQuote: false,
      printWidth: 100,
    });
    capture?.formatEvents.push({ file: capture.currentFile, role, parser, status: "formatted" });
    return formatted;
  } catch (error) {
    capture?.formatEvents.push({
      file: capture.currentFile,
      role,
      parser,
      status: "raw-fallback",
      error: toErrorMessage(error),
    });
    return source;
  }
}

async function compileOfficialVue(file, target, compiler, formatter) {
  const start = performance.now();
  try {
    const officialTarget = target === "ssr" ? "ssr" : "dom";
    const parsed = compiler.parse(file.source, { filename: file.path });
    const descriptor = parsed.descriptor;
    const isTypeScript = descriptorUsesTypeScript(descriptor);
    const parser = isTypeScript ? "typescript" : "babel";
    const warnings = normalizeCompilerMessages(parsed.errors);
    let bindingMetadata = {};
    let scriptCode = "";
    const scoped = descriptor.styles.some((style) => style.scoped);
    const inlineTemplate = Boolean(
      descriptor.scriptSetup && descriptor.template && officialTarget === "dom",
    );

    if (descriptor.script || descriptor.scriptSetup) {
      const script = compiler.compileScript(descriptor, {
        id: file.path,
        inlineTemplate,
        isProd: true,
        templateOptions: inlineTemplate
          ? {
              filename: file.path,
              id: file.path,
              scoped,
              slotted: descriptor.slotted,
              isProd: true,
              compilerOptions: {
                expressionPlugins: isTypeScript ? ["typescript"] : undefined,
              },
            }
          : { ssr: officialTarget === "ssr" },
      });
      scriptCode = script.content;
      bindingMetadata = script.bindings;
    }

    let templateCode = "";
    if (descriptor.template && !inlineTemplate) {
      const template = compiler.compileTemplate({
        source: descriptor.template.content,
        filename: file.path,
        id: file.path,
        scoped,
        slotted: descriptor.slotted,
        isProd: true,
        ssr: officialTarget === "ssr",
        ssrCssVars: descriptor.cssVars,
        compilerOptions: {
          bindingMetadata,
          expressionPlugins: isTypeScript ? ["typescript"] : undefined,
        },
      });
      templateCode = template.code;
      warnings.push(...normalizeCompilerMessages(template.errors));
      warnings.push(...normalizeCompilerMessages(template.tips));
    }

    const code = [scriptCode, templateCode].filter(Boolean).join("\n\n");
    return {
      code,
      formattedCode: await formatCode(code, parser, formatter, "official"),
      warnings,
      error: null,
      timeMs: performance.now() - start,
    };
  } catch (error) {
    return {
      code: "",
      formattedCode: "",
      warnings: [],
      error: toErrorMessage(error),
      timeMs: performance.now() - start,
    };
  }
}

function parserForFile(file, compiler) {
  try {
    const parsed = compiler.parse(file.source, { filename: file.path });
    return descriptorUsesTypeScript(parsed.descriptor) ? "typescript" : "babel";
  } catch {
    return "babel";
  }
}

function createCapture(rawInput) {
  const directory = process.env.VIZE_INSPECTOR_CAPTURE_DIR;
  if (!directory) return null;
  fs.mkdirSync(path.join(directory, "bytes"), { recursive: true });
  fs.writeFileSync(path.join(directory, "input.json"), rawInput);
  function retain(file, role, keepBytes = true) {
    const physical = fs.realpathSync(file);
    const bytes = fs.readFileSync(physical);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (keepBytes) fs.writeFileSync(path.join(directory, "bytes", sha256), bytes);
    return {
      file,
      physical,
      role,
      size: bytes.length,
      sha256,
      ...(keepBytes ? { retainedBytes: `bytes/${sha256}` } : {}),
    };
  }
  const state = {
    imports: [],
    formatEvents: [],
    currentFile: null,
    beginImport(specifier, root) {
      const entry = { specifier, root, status: "pending" };
      state.imports.push(entry);
      return entry;
    },
    observeImport(entry, resolved, imported) {
      Object.assign(entry, { resolved, status: "loaded", manifests: [] });
      try {
        const version = Object.getOwnPropertyDescriptor(imported, "version");
        entry.moduleVersion =
          version && "value" in version && typeof version.value === "string" ? version.value : null;
        entry.image = retain(resolved, "post-import-entry");
        for (let owner = path.dirname(resolved); ; owner = path.dirname(owner)) {
          const manifest = path.join(owner, "package.json");
          if (fs.existsSync(manifest)) {
            const value = JSON.parse(fs.readFileSync(manifest, "utf8"));
            const identity = retain(manifest, "post-import-package");
            entry.manifests.push(identity);
            if (typeof value.name === "string" && typeof value.version === "string") {
              entry.package = { name: value.name, version: value.version, manifest: identity };
              break;
            }
          }
          if (owner === path.dirname(owner)) break;
        }
      } catch (error) {
        entry.observationError = toErrorMessage(error);
      }
    },
    finish() {
      const commonJs = Object.keys(
        createRequire(path.join(process.cwd(), "package.json")).cache,
      ).map((file) => {
        try {
          return retain(file, "post-compile-commonjs-cache");
        } catch (error) {
          return { file, error: toErrorMessage(error) };
        }
      });
      fs.writeFileSync(
        path.join(directory, "receipt.json"),
        JSON.stringify(
          {
            node: retain(process.execPath, "actual-node-image", false),
            nodeVersion: process.version,
            cwd: process.cwd(),
            nodeEnv: process.env.NODE_ENV,
            imports: state.imports,
            pendingImports: state.imports
              .filter((entry) => entry.status === "pending")
              .map((entry) => ({ specifier: entry.specifier, root: entry.root })),
            formatEvents: state.formatEvents,
            commonJs,
            authorityUnproved: [
              "post-import file bytes are not an exec-time read trace",
              "complete ESM/transitive module membership",
              "pending formatter imports may settle after this receipt; original await semantics unchanged",
            ],
          },
          null,
          2,
        ) + "\n",
      );
    },
  };
  return state;
}

const rawInput = await readStdin();
const input = JSON.parse(rawInput);
const capture = createCapture(rawInput);
try {
  const roots = [process.cwd(), input.moduleRoot].filter(Boolean);
  const compiler = await importFromRoots("vue/compiler-sfc", roots);
  const formatter = await loadFormatter(roots);
  const files = [];

  for (const file of input.files) {
    if (capture) capture.currentFile = file.path;
    const parser = parserForFile(file, compiler);
    const official = await compileOfficialVue(file, input.target, compiler, formatter);
    files.push({
      path: file.path,
      parser,
      official,
      vizeFormattedCode: await formatCode(file.vizeCode, parser, formatter, "vize"),
    });
  }

  process.stdout.write(JSON.stringify({ files }));
} finally {
  capture?.finish();
}
