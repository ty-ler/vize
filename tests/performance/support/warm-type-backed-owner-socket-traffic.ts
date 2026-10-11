import assert from "node:assert/strict";

import { decodeFrames } from "../../differential/lsp-wire.ts";
import { sha256 } from "./warm-type-backed-source.ts";
import { syscallWrites, type NativeProcessWitness } from "./warm-type-backed-owner-syscalls.ts";

/** Bind complete original JSON-RPC pipe traffic to both authenticated kernel socket peers. */
export function nativeApiSocketTraffic(
  writes: ReturnType<typeof syscallWrites>,
  native: NativeProcessWitness,
  socket: { pipe: string; inode: string },
  parents: NativeProcessWitness[],
) {
  assert.ok(parents.length > 0);
  const parent = parents[0];
  assert.equal(native.ppid, parent.pid);
  const parentThreads = new Set(parents.flatMap((entry) => entry.threads));
  const nativeThreads = new Set(native.threads);
  const directions = { client: [] as Buffer[], server: [] as Buffer[] };
  const peers = new Set<string>();
  for (const write of writes) {
    if (!write.descriptor.startsWith("UNIX-STREAM:")) continue;
    const descriptor = write.descriptor.match(
      /^UNIX-STREAM:\[(\d+)(?:->(\d+))?(?:,"[^"\n]+")?\]$/u,
    );
    assert.ok(descriptor, "unknown Unix socket descriptors cannot grant authority");
    const [, own, peer] = descriptor;
    if (own !== socket.inode && peer !== socket.inode) continue;
    assert.ok(peer, "every API write must retain its independent actual peer");
    if (own === socket.inode) {
      assert.ok(
        nativeThreads.has(write.thread),
        "the API server write must belong to its native owner",
      );
      assert.ok(
        !parentThreads.has(write.thread),
        "independent API processes cannot share a writer",
      );
      directions.server.push(write.bytes);
      peers.add(peer);
    } else {
      assert.ok(
        parentThreads.has(write.thread),
        "the API client write must belong to the original launch",
      );
      assert.ok(
        !nativeThreads.has(write.thread),
        "independent API processes cannot share a writer",
      );
      directions.client.push(write.bytes);
      peers.add(own);
    }
  }
  assert.equal(peers.size, 1, "one actual returned API socket must have exactly one original peer");
  assert.ok(!peers.has(socket.inode), "an independent client cannot claim the server socket");
  assert.ok(
    directions.client.length && directions.server.length,
    "both original API directions are required",
  );
  const client = Buffer.concat(directions.client);
  const server = Buffer.concat(directions.server);
  return {
    authority: "complete-original-jsonrpc-api-traffic-and-independent-kernel-peers",
    socket,
    clientInode: [...peers][0],
    clientSHA256: sha256(client),
    serverSHA256: sha256(server),
    clientBytes: client.length,
    serverBytes: server.length,
    client: decodeFrames(client).messages,
    server: decodeFrames(server).messages,
  };
}
