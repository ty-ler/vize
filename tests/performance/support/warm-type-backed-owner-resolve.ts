import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { LspSession } from "../../tooling/support/lsp/session.ts";
import type { JsonRpcMessage } from "../../tooling/support/lsp/protocol.ts";
import { decodeFrames } from "../../differential/lsp-wire.ts";
import { controls } from "./warm-type-backed-controls.ts";
import { QueryRecorder } from "./warm-type-backed-measure.ts";
import {
  assertOriginalFrames,
  assertTypedPackets,
  finishWire,
  object,
  requests,
  waitForInitialTypes,
  type Packet,
  type RequestSpec,
} from "./warm-type-backed-packets.ts";
import { awaitRetired, nativeIdentities } from "./warm-type-backed-processes.ts";
import { generateWorkspace, runtimeIdentity } from "./warm-type-backed-source.ts";
import { startup } from "./warm-type-backed-startup.ts";
import { NativeApiSyscallObserver } from "./warm-type-backed-owner-tracer.ts";

class OwnerRecorder extends QueryRecorder {
  observer: NativeApiSyscallObserver | undefined;
  readonly additional: Array<Record<string, unknown>> = [];
  readonly refusalFailures: string[] = [];
  private currentMain: Record<string, unknown> | undefined;
  private retiredMain: Record<string, unknown> | undefined;

  private async extra(stage: string, params: Record<string, unknown>, refusal: boolean) {
    let id!: number;
    const result = await this.session.request("completionItem/resolve", params, 60_000, (value) => {
      id = value;
      return [];
    });
    const responses = this.responses.filter((response) => response.id === id);
    assert.equal(responses.length, 1);
    this.additional.push({ stage, id, params, response: responses[0], result, refusal });
    if (refusal) {
      try {
        assert.deepEqual(result, params, `${stage} must retain the whole refused item`);
      } catch (failure) {
        this.refusalFailures.push(
          failure instanceof Error ? (failure.stack ?? failure.message) : String(failure),
        );
      }
    } else {
      assert.equal(object(result).label, params.label);
      assert.equal(typeof object(result).detail, "string", `${stage} requires native detail`);
    }
    return result;
  }

  override async query(
    stage: string,
    spec: RequestSpec,
    following?: (id: number) => JsonRpcMessage[],
  ) {
    const packet: Packet = await super.query(stage, spec, following);
    if (this.observer) {
      const row = this.rows.at(-1);
      assert.ok(row);
      this.observer.sample(row);
    }
    if (spec.method !== "textDocument/completion") return packet;
    const items = Array.isArray(packet.result) ? packet.result : object(packet.result).items;
    if (!Array.isArray(items) || !items.length) return packet;
    if (stage !== "cross-root" && stage !== "native-epoch-recovered") {
      this.currentMain = object(items[0]);
      this.retiredMain = this.currentMain;
      return packet;
    }
    assert.equal(items.length, 4);
    for (const item of items) {
      const label = object(item).label;
      if (typeof label !== "string") throw new Error("a complete native item requires its label");
      await this.extra(`${stage}/resolve/${label}`, object(item), false);
    }
    const stale = structuredClone(object(items[0]));
    const staleData = object(object(stale.data).vizeCompletion);
    const revision = staleData.revision;
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision <= 0)
      throw new Error("the negative control requires a complete native revision");
    staleData.revision = revision + 1;
    await this.extra(`${stage}/stale-revision`, stale, true);
    const wrongFile = structuredClone(object(items[0]));
    const native = object(object(object(object(wrongFile.data).vizeCompletion).item).data);
    const fileName = native.fileName;
    if (typeof fileName !== "string" || !path.isAbsolute(fileName))
      throw new Error("the negative control requires its actual absolute native file");
    native.fileName = `${fileName}.foreign`;
    await this.extra(`${stage}/foreign-native-file`, wrongFile, true);
    const wrongPosition = structuredClone(object(items[0]));
    const position = object(object(object(object(wrongPosition.data).vizeCompletion).item).data);
    const offset = position.position;
    if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)
      throw new Error("the negative control requires its actual native offset");
    position.position = offset + 1;
    await this.extra(`${stage}/foreign-native-position`, wrongPosition, true);
    if (stage === "cross-root") {
      assert.ok(this.currentMain);
      const foreign = structuredClone(object(items[0]));
      const data = object(object(foreign.data).vizeCompletion);
      const main = object(object(this.currentMain.data).vizeCompletion);
      data.uri = main.uri;
      data.revision = main.revision;
      await this.extra(`${stage}/foreign-authored-owner`, foreign, true);
    } else {
      assert.ok(this.retiredMain);
      await this.extra(`${stage}/retired-process`, this.retiredMain, true);
    }
    return packet;
  }
}

/** A separate real process repeats the original protocol and resolves all eight migrated items. */
export async function runOwnerResolveFixture(
  repoRoot: string,
  workspace: string,
  output: string,
  observeNativeAPI = false,
) {
  const runtime = runtimeIdentity();
  const binary = path.join(repoRoot, "target/ci/vize");
  const captureRoot = path.join(repoRoot, "target/differential/lsp-sessions");
  fs.mkdirSync(captureRoot, { recursive: true });
  const previous = fs.readdirSync(captureRoot);
  const input = generateWorkspace(workspace, runtime);
  const source = input.source["src/c/Comp0.vue"];
  const uri = pathToFileURL(path.join(workspace, "src/c/Comp0.vue")).href;
  const session = new LspSession({ repoRoot, binary });
  const recorder = new OwnerRecorder(session, runtime.executable, binary, true);
  let initialization: unknown;
  let failure: unknown;
  let observerFailure: unknown;
  let nativeAPIObserver: unknown;
  const native = new Map<string, ReturnType<typeof nativeIdentities>[number]>();
  try {
    if (observeNativeAPI)
      recorder.observer = await NativeApiSyscallObserver.start(
        session.processId,
        path.join(output, "native-api"),
        runtime.executable,
      );
    ({ initialization } = await startup(recorder, workspace, uri, source, true));
    await waitForInitialTypes(session, uri);
    assertTypedPackets(await recorder.sweep("prime", requests(uri, source)), workspace);
    for (let i = 1; i <= 5; i++)
      assertTypedPackets(await recorder.sweep(`warm-${i}`, requests(uri, source)), workspace);
    await controls(recorder, workspace, source, runtime);
    assert.deepEqual(recorder.failures, []);
  } catch (error) {
    failure = error instanceof Error ? error.stack : String(error);
  } finally {
    for (const row of recorder.rows)
      for (const item of row.processes as Array<{
        executable: string | null;
        pid: number;
        birth_ticks: number;
      }>)
        if (item.executable === runtime.executable)
          native.set(`${item.pid}:${item.birth_ticks}`, item);
    recorder.sampler.stop();
    try {
      await recorder.observer?.stop();
    } catch (error) {
      observerFailure = error instanceof Error ? error.stack : String(error);
    }
    await session.shutdown();
    await awaitRetired([...native.values()]);
  }
  try {
    nativeAPIObserver = recorder.observer?.receipt();
  } catch (error) {
    observerFailure = error instanceof Error ? error.stack : String(error);
  }
  const wire = await finishWire(repoRoot, previous, captureRoot);
  const capture = wire.capture;
  fs.mkdirSync(output, { recursive: true });
  fs.cpSync(capture, path.join(output, "wire"), { recursive: true });
  const receipt = {
    input,
    initialization,
    rows: recorder.rows,
    additional: recorder.additional,
    refusalFailures: recorder.refusalFailures,
    failure,
    wire,
    nativeAPIObserver,
    observerFailure,
  };
  fs.writeFileSync(path.join(output, "resolved.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  const client = decodeFrames(fs.readFileSync(path.join(capture, "client.bin"))).messages;
  const server = decodeFrames(fs.readFileSync(path.join(capture, "server.bin"))).messages;
  const additional = new Set(recorder.additional.map((row) => row.id));
  assert.equal(additional.size, recorder.additional.length);
  assertOriginalFrames(
    client.filter((row) => !additional.has(row.id)),
    server.filter((row) => !additional.has(row.id)),
    initialization,
    { repoRoot, workspace, source },
  );
  for (const row of recorder.additional) {
    assert.deepEqual(
      client.filter((message) => message.id === row.id),
      [{ jsonrpc: "2.0", id: row.id, method: "completionItem/resolve", params: row.params }],
    );
    assert.deepEqual(
      server.filter((message) => message.id === row.id),
      [row.response],
    );
  }
  assert.equal(failure, undefined, "all supplemental resolve/refusal outcomes are required");
  assert.equal(observerFailure, undefined, "missing or partial native API facts cannot qualify");
  assert.equal(recorder.rows.length, 79);
  assert.equal(recorder.additional.filter((row) => !row.refusal).length, 8);
  assert.equal(recorder.additional.filter((row) => row.refusal).length, 8);
  return receipt;
}
