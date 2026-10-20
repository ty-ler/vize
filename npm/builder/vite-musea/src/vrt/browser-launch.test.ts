import assert from "node:assert/strict";
import test from "node:test";
import type { Browser, BrowserType, LaunchOptions } from "playwright";
import { launchChromium } from "./browser-launch.ts";

void test("Chromium receives configured launch options after internal arguments", async () => {
  let received: LaunchOptions | undefined;
  const browser = {} as Browser;
  const chromium = {
    async launch(options?: LaunchOptions) {
      received = options;
      return browser;
    },
  } as Pick<BrowserType, "launch">;

  const launched = await launchChromium(
    chromium,
    {
      headless: false,
      channel: "chromium",
      chromiumSandbox: true,
      args: ["--disable-partial-raster"],
    },
    ["--ignore-certificate-errors-spki-list=certificate"],
  );

  assert.equal(launched, browser);
  assert.deepEqual(received, {
    headless: false,
    channel: "chromium",
    chromiumSandbox: true,
    args: ["--ignore-certificate-errors-spki-list=certificate", "--disable-partial-raster"],
  });
});
