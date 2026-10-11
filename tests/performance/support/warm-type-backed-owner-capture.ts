import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { object } from "./warm-type-backed-packets.ts";
import { sha256 } from "./warm-type-backed-source.ts";

const stages = new Set(["cross-root", "native-epoch-recovered"]);

function nativeSockets(processes: Array<Record<string, unknown>>) {
  const unix = fs.readFileSync("/proc/net/unix", "utf8");
  const sockets = unix
    .split("\n")
    .map((line) => line.trim().split(/\s+/u))
    .filter((fields) => fields.length === 8 && fields[7].startsWith("/tmp/tsgo-api-"));
  return processes.flatMap((process) => {
    const directory = `/proc/${process.pid}/fd`;
    let descriptors: string[];
    try {
      descriptors = fs.readdirSync(directory).flatMap((fd) => {
        try {
          return [fs.readlinkSync(path.join(directory, fd))];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
    return sockets
      .filter((fields) => descriptors.includes(`socket:[${fields[6]}]`))
      .map((fields) => ({ pipe: fields[7], inode: fields[6], process }));
  });
}

function startupReceipts(stderr: string) {
  return stderr.split("\n").flatMap((line) => {
    const marker = 'stage="startupConfigurationSnapshot" value=';
    const start = line.indexOf(marker);
    return start === -1 ? [] : [object(JSON.parse(line.slice(start + marker.length)))];
  });
}

function projectFiles(root: string): Array<{ file: string; code: string; sha256: string }> {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.name === "node_modules" || entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return projectFiles(file);
    assert.ok(entry.isFile(), `unknown source entry: ${file}`);
    const code = fs.readFileSync(file, "utf8");
    assert.equal(Buffer.from(code).length, fs.statSync(file).size);
    return [{ file, code, sha256: sha256(code) }];
  });
}

/** Passive full bodies and kernel socket ownership, after the request's wall/CPU window. */
export function captureCompletionOwnership(
  stage: string,
  method: string,
  params: unknown,
  result: unknown,
  processes: Array<Record<string, unknown>>,
  stderr: string,
) {
  if (!stages.has(stage) || method !== "textDocument/completion") return null;
  const items = Array.isArray(result) ? result : object(result).items;
  assert.ok(Array.isArray(items));
  assert.deepEqual(
    items.map((item) => object(item).label),
    ["count", "double", "items", "add"],
  );
  const uri = object(object(params).textDocument).uri;
  assert.equal(typeof uri, "string");
  const authoredFile = fileURLToPath(uri as string);
  const authoredCode = fs.readFileSync(authoredFile, "utf8");
  const request = object(object(object(items[0]).data).vizeCompletion);
  const requestUri = request.requestUri;
  assert.equal(typeof requestUri, "string");
  const virtualFile = fileURLToPath(requestUri as string);
  const match = virtualFile.match(
    /^(.*\/editor\/sessions\/session-[^/]+\/projects\/[a-f0-9]{64})\//u,
  );
  assert.ok(match, "the complete capability belongs to a real private project");
  const root = fs.realpathSync(match[1]);
  const files = projectFiles(root).toSorted((a, b) => a.file.localeCompare(b.file));
  const virtual = files.find((entry) => entry.file === virtualFile);
  const config = files.find((entry) => entry.file === path.join(root, "tsconfig.json"));
  assert.ok(virtual && config, "the native file and complete selected config must exist");
  const startup = startupReceipts(stderr).filter(
    (receipt) => receipt.requestedConfig === config.file,
  );
  const sockets = nativeSockets(processes);
  return {
    stage,
    authored: { file: authoredFile, code: authoredCode, sha256: sha256(authoredCode) },
    requestPosition: object(params).position,
    root,
    virtualFile,
    files,
    startup,
    sockets,
  };
}
