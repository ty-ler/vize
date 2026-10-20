import type { Browser, BrowserType, LaunchOptions } from "playwright";

export function mergeChromiumLaunchOptions(
  launchOptions: LaunchOptions = {},
  internalArgs: string[] = [],
): LaunchOptions {
  const args = [...internalArgs, ...(launchOptions.args ?? [])];
  return {
    headless: true,
    ...launchOptions,
    ...(args.length > 0 ? { args } : {}),
  };
}

export function launchChromium(
  chromium: Pick<BrowserType, "launch">,
  launchOptions: LaunchOptions = {},
  internalArgs: string[] = [],
): Promise<Browser> {
  return chromium.launch(mergeChromiumLaunchOptions(launchOptions, internalArgs));
}
