import { test, expect, isMobileLayout } from "../lib/test";
import {
  buildSession,
  realWorkingDir,
  uniqueSessionName,
  writeSession,
  assistantTextEntry,
} from "../lib/sessions";
import type { Page } from "@playwright/test";

// Mobile block/message action visibility + clipboard behavior. Clipboard is
// stubbed via init script (headless Chromium has no system clipboard grant).

async function openSessionWithCode(page: Page, sessionsDir: string, testInfo) {
  const { entries, lastId } = buildSession({ cwd: realWorkingDir() });
  const codeMsg = assistantTextEntry(
    lastId,
    "Here is code:\n\n```js\nconst answer = 42;\n```\n\nDone.",
  );
  const name = uniqueSessionName(testInfo, "copy");
  writeSession(sessionsDir, name, [...entries, codeMsg.entry]);
  await page.goto(`/session?id=${encodeURIComponent(name)}`);
  await page.locator(".assistant-message").last().waitFor();
}

test.describe("copy actions", () => {
  test("mobile: code block copy button is visible without hover", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    await openSessionWithCode(page, sessionsDir, testInfo);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    const btn = page.locator(".code-block .copy-block-btn").first();
    await expect(btn).toBeVisible();
    // Touch target ≥ 40px.
    const box = await btn.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);
  });

  test("mobile: message action buttons are visible without hover", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    await openSessionWithCode(page, sessionsDir, testInfo);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    const copyLink = page.locator(".assistant-message .copy-link-btn").last();
    await expect(copyLink).toBeVisible();
    const box = await copyLink.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);
  });

  test("mobile: tapping code copy writes plain text to the clipboard", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    await page.addInitScript(() => {
      // Capture clipboard writes; headless has no real clipboard permission.
      (window as any).__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: (t: string) => (
            (window as any).__copied.push(t),
            Promise.resolve()
          ),
        },
        configurable: true,
      });
    });
    await openSessionWithCode(page, sessionsDir, testInfo);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    await page.locator(".code-block .copy-block-btn").first().click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__copied.at(-1)))
      .toBe("const answer = 42;");
    // Copied state flashes (not color-only: the icon swaps to a check).
    await expect(page.locator(".copy-block-btn.copied")).toBeVisible();
  });
});
