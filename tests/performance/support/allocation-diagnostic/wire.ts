import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import type { ProcessIdentity } from "./identity.ts";

type Message = Record<string, any>;

function relocate(messages: Message[], workspace: string): Message[] {
  assert(workspace.startsWith("/"), "authenticated absolute fixture root required");
  return JSON.parse(
    JSON.stringify(messages)
      .replaceAll(pathToFileURL(workspace).href, "$WORKSPACE_URI")
      .replaceAll(workspace, "$WORKSPACE_PATH"),
  );
}

/** Only the one original initialize PID can differ between authenticated owners. */
export function originalClientVector(
  messages: Message[],
  workspace: string,
  owner: Pick<ProcessIdentity, "pid" | "parentPid">,
): Message[] {
  assert(Number.isSafeInteger(owner.pid) && owner.pid > 0);
  assert(Number.isSafeInteger(owner.parentPid) && owner.parentPid > 0);
  const initialize = messages.filter((message) => message.method === "initialize");
  assert.equal(initialize.length, 1, "exactly one original initialize request required");
  const request = initialize[0];
  assert.equal(request.jsonrpc, "2.0");
  assert(Number.isSafeInteger(request.id), "original numeric query ID required");
  assert.equal(request.params?.processId, owner.parentPid, "initialize PID must bind actual owner");
  assert(!messages.some((message) => message.method === "textDocument/completion"));
  let pidFields = 0;
  const visit = (value: any, allowed = false) => {
    if (value === null || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (["processId", "parentPid", "pid"].includes(key)) {
        assert(allowed && key === "processId", "unbound or additional PID field refused");
        pidFields += 1;
      }
      visit(nested, value === request && key === "params");
    }
  };
  for (const message of messages) visit(message);
  assert.equal(pidFields, 1);
  const result = structuredClone(messages);
  result[messages.indexOf(request)].params.processId = "$AUTHENTICATED_CLIENT_PID";
  return relocate(result, workspace);
}

/** Diagnostic payloads, query IDs and server message order remain exact. */
export function originalServerVector(messages: Message[], workspace: string): Message[] {
  return relocate(messages, workspace);
}
