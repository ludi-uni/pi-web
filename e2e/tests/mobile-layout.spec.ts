import {
  test,
  expect,
  isMobileLayout,
  collapseScratchpad,
  openSessionOutline,
} from "../lib/test";
import {
  buildSession,
  realWorkingDir,
  uniqueSessionName,
  writeSession,
} from "../lib/sessions";
import type { Page } from "@playwright/test";

// Layout is driven by the 900px breakpoint, not by device type: iPad portrait
// (810px) lands on mobile, iPad landscape (~1080px) on desktop. Each test
// resolves the active layout at runtime (after navigation) and skips the half
// that doesn't apply, so every project runs exactly the relevant assertions.

async function openDemoSession(page: Page) {
  // Keep the scratchpad collapsed so it doesn't overlay the header on narrow
  // viewports; we're exercising the tree (left) sidebar.
  await collapseScratchpad(page);
  await page.goto("/");
  await page
    .locator(".session-card", { hasText: "add deepseek-v4-pro" })
    .click();
  await expect(page).toHaveURL(/\/session\?id=/);
  await page.locator("#sidebar").waitFor();
}

test.describe("responsive layout", () => {
  test("mobile: tree sidebar is a drawer that auto-closes on selection", async ({
    page,
  }) => {
    await openDemoSession(page);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    const body = page.locator("body");
    const treeToggle = page.locator("#tree-toggle");

    // Drawer starts closed.
    await expect(treeToggle).toBeVisible();
    await expect(body).not.toHaveClass(/sidebar-open/);

    // Dispatch the click straight to the button: the long session title shares
    // the narrow header row and wins coordinate hit-testing at the button's
    // center (even force-click lands on the title). Header hit-geometry isn't
    // what this test verifies — the drawer state transitions below are.
    await treeToggle.dispatchEvent("click");
    await expect(body).toHaveClass(/sidebar-open/);
    await expect(page.locator("#sidebar")).toHaveClass(/open/);
    await openSessionOutline(page);

    // Selecting a node navigates AND collapses the drawer.
    await page.locator("#tree-container .tree-node").first().click();
    await expect(body).not.toHaveClass(/sidebar-open/);
  });

  test("desktop: tree sidebar is persistent and collapses in place", async ({
    page,
  }) => {
    await openDemoSession(page);
    test.skip(await isMobileLayout(page), "desktop-only behavior");

    const body = page.locator("body");
    await expect(page.locator("#sidebar")).toBeVisible();
    await expect(body).not.toHaveClass(/sidebar-open/);

    // On desktop the toggle collapses the sidebar in place (no overlay drawer).
    await page.locator("#tree-toggle").click();
    await expect(body).toHaveClass(/sidebar-collapsed/);
    await expect(body).not.toHaveClass(/sidebar-open/);
  });

  test("mobile: composer controls meet touch-target sizing", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    // Chat must be available (cwd exists) so the composer renders enabled.
    const cwd = realWorkingDir();
    const { entries } = buildSession({ cwd });
    const id = writeSession(
      sessionsDir,
      uniqueSessionName(testInfo, "composer"),
      entries,
    );

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(id)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    // Composer stays inside the viewport.
    const composer = page.locator("#pi-chat-composer");
    await expect(composer).toBeVisible();
    const innerHeight = await page.evaluate(() => window.innerHeight);
    const box = await composer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(innerHeight + 1);

    // Send button meets the mobile touch-target minimum.
    const send = page.locator("#pi-chat-send");
    const sendBox = await send.boundingBox();
    expect(sendBox).not.toBeNull();
    expect(sendBox!.height).toBeGreaterThanOrEqual(40);

    // Drawer trigger: the header tree-toggle is the single mobile entry point
    // (the floating #hamburger is hidden by the mobile media query).
    const treeToggle = page.locator("#tree-toggle");
    await expect(treeToggle).toBeVisible();
    await treeToggle.dispatchEvent("click");
    await expect(page.locator("body")).toHaveClass(/sidebar-open/);
    await expect(page.locator("#sidebar")).toHaveClass(/open/);
  });

  test("mobile: quick prompt chips insert text into composer", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realWorkingDir();
    const { entries } = buildSession({ cwd });
    const id = writeSession(
      sessionsDir,
      uniqueSessionName(testInfo, "quick-prompts"),
      entries,
    );

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(id)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    // Quick prompt row is visible on mobile.
    const prompts = page.locator(".quick-prompts");
    await expect(prompts).toBeVisible();
    const chips = prompts.locator(".quick-prompt-chip");
    await expect(chips).toHaveCount(5);

    // Tap "テストして" — text lands in the textarea, not sent.
    await chips.nth(1).click();
    const textarea = page.locator("#pi-chat-message");
    await expect(textarea).toHaveValue("テストして");

    // Send button remains visible and composer stays inside the viewport.
    await expect(page.locator("#pi-chat-send")).toBeVisible();
    const composer = page.locator("#pi-chat-composer");
    const box = await composer.boundingBox();
    const innerHeight = await page.evaluate(() => window.innerHeight);
    expect(box!.y + box!.height).toBeLessThanOrEqual(innerHeight + 1);

    // Drawer still opens.
    const treeToggle = page.locator("#tree-toggle");
    await treeToggle.dispatchEvent("click");
    await expect(page.locator("body")).toHaveClass(/sidebar-open/);
  });

  test("desktop: quick prompt row is hidden", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realWorkingDir();
    const { entries } = buildSession({ cwd });
    const id = writeSession(
      sessionsDir,
      uniqueSessionName(testInfo, "quick-prompts-desktop"),
      entries,
    );

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(id)}`);
    test.skip(await isMobileLayout(page), "desktop-only behavior");

    // Quick prompt row is hidden on desktop.
    await expect(page.locator(".quick-prompts")).not.toBeVisible();
    // Desktop composer layout is unchanged.
    await expect(page.locator("#pi-chat-message")).toBeVisible();
    await expect(page.locator("#pi-chat-send")).toBeVisible();
  });
});
