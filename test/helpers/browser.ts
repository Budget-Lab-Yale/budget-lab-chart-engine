// The Chromium the browser suites share. Not a test file.
import { existsSync } from "node:fs";
import { chromium, type Browser, type LaunchOptions } from "playwright";

/** Whether playwright's Chromium is installed. Suites that can run without it gate on this with
 *  `describe.skipIf(!HAS_BROWSER)`; CI checks the image has it, so there the gate never skips. */
export const HAS_BROWSER: boolean = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

export function launchBrowser(options?: LaunchOptions): Promise<Browser> {
  return chromium.launch(options);
}

/** How long `closeBrowser` waits. `browser.close()` has no timeout of its own and has hung under
 *  full-suite load (the icon-fits-box flake), failing a suite whose tests had all passed. */
export const CLOSE_TIMEOUT_MS = 10_000;

/** The hook timeout to pass to an `afterAll` that calls `closeBrowser`: longer than its wait, so a
 *  hung close is abandoned by `closeBrowser` rather than failing the hook. */
export const CLOSE_HOOK_TIMEOUT_MS = CLOSE_TIMEOUT_MS + 5_000;

/** Close `browser`, giving up after `CLOSE_TIMEOUT_MS` with a warning. A close that hangs is
 *  abandoned rather than failed: by teardown every test has run, and playwright kills the browser
 *  process when the worker exits. */
export async function closeBrowser(browser: Browser | undefined): Promise<void> {
  if (!browser) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), CLOSE_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([browser.close(), gaveUp]);
    if (result === "timeout") console.warn(`closeBrowser: browser.close() did not finish in ${CLOSE_TIMEOUT_MS} ms; abandoned`);
  } finally {
    clearTimeout(timer);
  }
}
