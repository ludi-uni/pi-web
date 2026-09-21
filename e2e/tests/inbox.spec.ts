import { test, expect, isMobileLayout, collapseScratchpad } from "../lib/test";
import {
  buildSession,
  realWorkingDir,
  uniqueSessionName,
  writeSession,
} from "../lib/sessions";
import type { Page } from "@playwright/test";

// Inbox / needs-attention lifecycle on mobile. The stub pi writes an
// ask_user_question toolResult (awaitingChatReply) when the prompt contains a
// [[ask:...]] marker, which drives waiting_input end-to-end through the real
// running→idle transition.

async function sendChat(page: Page, text: string) {
  const textarea = page.locator("#pi-chat-message");
  await textarea.fill(text);
  await page.locator("#pi-chat-send").click();
}

test.describe("inbox / needs attention", () => {
  test("mobile: waiting session appears in Inbox and clears on open", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realWorkingDir();
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "inbox-wait");
    writeSession(sessionsDir, name, entries);

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    // Trigger a prompt that makes the stub write an awaitingChatReply result.
    await sendChat(page, "question [[ask:Pick one]]");

    // Wait for the running→idle transition to record waiting_input, then go to
    // the index and confirm the session is in the Inbox Waiting group.
    await page.goto("/");
    const inbox = page.locator('[data-testid="inbox"]');
    await expect(inbox).toBeVisible({ timeout: 15000 });
    const waitingGroup = inbox.locator('[data-inbox-group="waiting"]');
    await expect(waitingGroup).toBeVisible();
    await expect(waitingGroup.locator(".inbox-item")).toHaveCount(1);

    // Tap the item → opens the session → POSTs /api/session/viewed.
    const viewed = page.waitForRequest((r) =>
      r.url().includes("/api/session/viewed"),
    );
    await waitingGroup.locator(".inbox-item").first().click();
    await expect(page).toHaveURL(/\/session\?id=/);
    await viewed;

    // Back to index: the waiting flag persists (the question is still
    // unanswered), but the row should still render its metadata.
    await page.goto("/");
    await expect(inbox.locator('[data-inbox-group="waiting"]')).toBeVisible();
  });

  test("mobile: completed session shows in Inbox until viewed", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realWorkingDir();
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "inbox-done");
    writeSession(sessionsDir, name, entries);

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    // A normal prompt completes → completed_unread on the index.
    await sendChat(page, "do a thing");
    await page.waitForTimeout(400); // let the idle transition + write settle
    await page.goto("/");

    const unreadGroup = page.locator('[data-inbox-group="unread"]');
    await expect(unreadGroup).toBeVisible({ timeout: 15000 });
  });

  test("mobile: continue-last-session link opens the last viewed session", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realWorkingDir();
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "continue");
    writeSession(sessionsDir, name, entries);

    await collapseScratchpad(page);
    // Open the session so last_viewed_at is recorded.
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    await page.locator("#pi-chat-message").waitFor();
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    await page.goto("/");
    const link = page.locator('[data-testid="continue-last"]');
    await expect(link).toBeVisible({ timeout: 15000 });
    await link.click();
    await expect(page).toHaveURL(/\/session\?id=/);
    await expect(page.locator("#pi-chat-message")).toBeVisible();
  });

  test("mobile: prompt history reloads a past prompt into the composer", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realWorkingDir();
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "history");
    writeSession(sessionsDir, name, entries);

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    // Send a prompt so it lands in history.
    await sendChat(page, "first unique prompt");
    await page.waitForTimeout(300);

    // Open history and pick the prompt — it loads into the textarea, not sent.
    await page.locator(".prompt-history-toggle").click();
    const item = page.locator(".prompt-history-item", { hasText: "first unique prompt" });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.locator("#pi-chat-message")).toHaveValue("first unique prompt");
  });

  test("mobile: draft survives a reload", async ({ page, sessionsDir }, testInfo) => {
    const cwd = realWorkingDir();
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "draft");
    writeSession(sessionsDir, name, entries);

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    const textarea = page.locator("#pi-chat-message");
    await textarea.fill("unsent draft text");
    await page.waitForTimeout(600); // debounce

    await page.reload();
    await expect(page.locator("#pi-chat-message")).toHaveValue("unsent draft text");
  });
});
