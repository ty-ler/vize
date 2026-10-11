import assert from "node:assert/strict";

/** Preserve the first refusal while attempting the original bounded reap and every FD close. */
export async function retireKernelObserver(
  interrupt: () => void,
  closed: Promise<unknown>,
  proveRetired: () => void,
  checkStream: () => void,
  closeHandles: () => void,
) {
  let firstFailure: unknown;
  const attempt = (action: () => void) => {
    try {
      action();
    } catch (failure) {
      firstFailure ??= failure;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    attempt(checkStream);
    attempt(interrupt);
    try {
      const exit = await Promise.race([
        closed,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 5000);
        }),
      ]);
      assert.ok(exit, "the independent tracer must be reaped in five seconds");
    } catch (failure) {
      firstFailure ??= failure;
    }
    attempt(proveRetired);
    attempt(checkStream);
  } finally {
    if (timer) clearTimeout(timer);
    attempt(closeHandles);
  }
  if (firstFailure) throw firstFailure;
}
