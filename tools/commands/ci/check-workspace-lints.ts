// Ratchet for first-party workspace lint inheritance. Upstream sources keep their own policy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pendingMembers: readonly string[] = [];
const upstreamMembers = new Set([
  "vendor/oxc_parser",
  "vendor/oxc_formatter",
  "vendor/oxlint_html_renderer186",
  "vendor/lightningcss",
  "vendor/parcel_sourcemap",
  "vendor/corsa_core",
  "vendor/corsa_jsonrpc",
  "vendor/corsa_client",
  "vendor/corsa_lsp",
  "vendor/corsa_orchestrator",
  "vendor/corsa",
]);

type Output = { status: number; stdout: string; stderr: string };

// Keep the existing checker grammar: the literal quoted members array and exact lint opt-in.
function workspaceMembers(root: string): string[] {
  const marker = "members = [";
  const start = root.indexOf(marker);
  if (start < 0) return [];
  return root
    .slice(start + marker.length)
    .split("]", 1)[0]
    .split(",")
    .flatMap((entry) => {
      const trimmed = entry.trim();
      return trimmed.startsWith('"') && trimmed.endsWith('"') ? [trimmed.slice(1, -1)] : [];
    });
}

function inheritsWorkspaceLints(manifest: string): boolean {
  let inLints = false;
  for (const line of manifest.split("\n").map((line) => line.trim())) {
    if (line.startsWith("[")) {
      inLints = line === "[lints]";
      continue;
    }
    if (inLints && line.replaceAll(" ", "") === "workspace=true") return true;
  }
  return false;
}

export function runWorkspaceLints(
  check: boolean,
  readText: (file: string) => string = (file) => fs.readFileSync(file, "utf8"),
  pending: readonly string[] = pendingMembers,
): Output {
  const read = (file: string): string => {
    try {
      return readText(file);
    } catch (error) {
      throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  try {
    const members = workspaceMembers(read("Cargo.toml")).filter(
      (member) => !upstreamMembers.has(member),
    );
    if (members.length === 0) throw new Error("no workspace members found in Cargo.toml");
    const problems: string[] = [];
    let joined = 0;
    for (const member of members) {
      const optedIn = inheritsWorkspaceLints(read(`${member}/Cargo.toml`));
      const isPending = pending.includes(member);
      if (optedIn && isPending)
        problems.push(`${member} opted into the workspace lints; remove it from PENDING`);
      else if (!optedIn && !isPending)
        problems.push(`${member} must add \`[lints] workspace = true\` (or be listed in PENDING)`);
      else if (optedIn) joined += 1;
    }
    for (const member of pending)
      if (!members.includes(member))
        problems.push(`${member} is in PENDING but is not a workspace member`);
    const summary = `workspace lints: ${joined}/${members.length} members joined, ${members.length - joined} pending\n`;
    if (!check || problems.length === 0)
      return {
        status: 0,
        stdout: summary + problems.map((problem) => `  ${problem}\n`).join(""),
        stderr: "",
      };
    return { status: 1, stdout: summary, stderr: problems.join("\n") + "\n" };
  } catch (error) {
    return {
      status: 1,
      stdout: "",
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = runWorkspaceLints(process.argv.slice(2).includes("--check"));
  process.stdout.write(output.stdout);
  process.stderr.write(output.stderr);
  process.exitCode = output.status;
}
