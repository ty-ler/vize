const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vscode = require("vscode");
const { getWorkspaceFolderPath } = require("./real-server-support.cjs");

const packets = [];
const completionPackets = [];
let requestOrder = 0;

function beginHover(document, position, expected) {
  const source = document.getText();
  return {
    order: ++requestOrder,
    startedAt: new Date().toISOString(),
    source,
    sourceSha256: crypto.createHash("sha256").update(source).digest("hex"),
    document: {
      uri: document.uri.toString(),
      version: document.version,
      languageId: document.languageId,
    },
    provider: {
      serverPath: process.env.VIZE_TEST_SERVER_PATH,
      packagedExtensionsPath: process.env.VIZE_TEST_PACKAGED_EXTENSIONS_DIR,
      sourceExtensionPath: process.env.VIZE_TEST_SOURCE_EXTENSION_PATH,
      githubSha: process.env.GITHUB_SHA,
    },
    request: {
      method: "vscode.executeHoverProvider",
      position: { line: position.line, character: position.character },
    },
    expected,
  };
}

function retainHover(request, hovers) {
  packets.push({
    ...request,
    resultType: hovers === null ? "null" : Array.isArray(hovers) ? "array" : typeof hovers,
    actual: hovers,
    publicContents: Array.isArray(hovers)
      ? hovers.map((hover) => ({
          range: hover?.range,
          contents: Array.isArray(hover?.contents)
            ? hover.contents.map((content) => ({
                raw: content,
                language: content?.language,
                value: content?.value,
                isTrusted: content?.isTrusted,
                supportThemeIcons: content?.supportThemeIcons,
                supportHtml: content?.supportHtml,
                baseUri: content?.baseUri?.toString(),
              }))
            : hover?.contents,
        }))
      : undefined,
  });
  const output = path.join(getWorkspaceFolderPath(), "node_modules/.vize/rich-hover.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, packets }, null, 2)}\n`);
}

function beginCompletion(document, position, expected, maxItemsToResolve) {
  const request = beginHover(document, position, expected);
  request.request.method = "vscode.executeCompletionItemProvider";
  request.request.maxItemsToResolve = maxItemsToResolve;
  return request;
}

async function retainCompletion(request, completions) {
  const label = (item) => (typeof item.label === "string" ? item.label : item.label.label);
  const selectedIndex = completions?.items.findIndex(
    (item) => label(item) === request.expected.label,
  );
  const candidate = completions?.items[selectedIndex];
  const packet = {
    ...request,
    receivedAt: new Date().toISOString(),
    resultType: completions === null ? "null" : typeof completions,
    actual: completions,
    selectedIndex,
    publicItems: completions?.items.map((item, index) => ({
      index,
      ...item,
      label: item.label,
      kind: item.kind,
      detail: item.detail,
      data: item.data,
      documentation: {
        raw: item.documentation,
        type: typeof item.documentation,
        constructor: item.documentation?.constructor?.name,
        isMarkdownString: item.documentation instanceof vscode.MarkdownString,
        value: item.documentation?.value,
        isTrusted: item.documentation?.isTrusted,
        supportHtml: item.documentation?.supportHtml,
        supportThemeIcons: item.documentation?.supportThemeIcons,
        baseUri: item.documentation?.baseUri?.toString(),
      },
    })),
  };
  completionPackets.push(packet);
  const output = path.join(getWorkspaceFolderPath(), "node_modules/.vize/rich-completion.json");
  const write = () => {
    const bytes = `${JSON.stringify({ schemaVersion: 1, packets: completionPackets }, null, 2)}\n`;
    for (const destination of [output, process.env.VIZE_TEST_COMPLETION_EVIDENCE].filter(Boolean)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
    }
  };
  // Preserve the actual provider result before any diagnostic request can
  // change its native session. This probe never replaces the asserted item.
  write();
  if (candidate?.documentation instanceof vscode.MarkdownString) return;
  packet.failureProbe = { requests: [] };
  const probe = packet.failureProbe;
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(getWorkspaceFolderPath(), "vize.config.json"), "utf8"),
    );
    const nativePath = config.typeChecker.corsaPath;
    const version = spawnSync(nativePath, ["--version"], { encoding: "utf8", timeout: 10_000 });
    probe.native = {
      path: nativePath,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(nativePath)).digest("hex"),
      status: version.status,
      stdout: version.stdout,
      stderr: version.stderr,
    };
    const requestRaw = async (method, params) => {
      const observation = {
        order: ++requestOrder,
        method,
        params,
        startedAt: new Date().toISOString(),
      };
      probe.requests.push(observation);
      write();
      let timeout;
      try {
        observation.result = await Promise.race([
          vscode.commands.executeCommand("vize.test.executeLspRequest", { method, params }),
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error(`Diagnostic ${method} exceeded 10 seconds`)),
              10_000,
            );
          }),
        ]);
        return observation.result;
      } catch (error) {
        observation.error = { message: error.message, stack: error.stack };
        throw error;
      } finally {
        clearTimeout(timeout);
        observation.finishedAt = new Date().toISOString();
        write();
      }
    };
    const raw = await requestRaw("textDocument/completion", {
      textDocument: { uri: request.document.uri },
      position: request.request.position,
    });
    const items = Array.isArray(raw) ? raw : raw?.items;
    const selected = items?.find((item) => item.label === request.expected.label);
    if (selected) await requestRaw("completionItem/resolve", selected);
  } catch (error) {
    probe.error = { message: error.message, stack: error.stack };
  } finally {
    write();
  }
}

module.exports = { beginHover, retainHover, beginCompletion, retainCompletion };
