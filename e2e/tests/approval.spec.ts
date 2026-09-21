import { test, expect, isMobileLayout, collapseScratchpad } from "../lib/test";
import {
  buildSession,
  realGitWorkingDir,
  uniqueSessionName,
  writeSession,
} from "../lib/sessions";

// End-to-end approval pipeline via the stub pi. A prompt containing
// [[gate:<kind>:<command>]] makes the stub emit approval_required over the RPC
// stream, hold the action, and wait for an approval_response — exercising the
// real worker→server→SSE→Inbox→ApprovalCard→decision→resume path.

async function sendChat(page, text) {
  const textarea = page.locator("#pi-chat-message");
  await textarea.fill(text);
  await page.locator("#pi-chat-send").click();
}

test.describe("approval pipeline", () => {
  test("mobile: approve resumes the gated action", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realGitWorkingDir();
    test.skip(!cwd, "git unavailable");
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "appr-ok");
    writeSession(sessionsDir, name, entries);

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    // Trigger a gated git_push action.
    await sendChat(page, "push it [[gate:git_push:git push origin main]]");

    // ApprovalCard appears with the gated command.
    const card = page.locator('[data-testid="approval-card"]');
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card).toContainText("git push origin main");

    // Approve → decision goes to the worker → stub resumes → resolved → card gone.
    await card.locator('[data-testid="approval-approve"]').click();
    await expect(card).toHaveCount(0, { timeout: 15000 });
  });

  test("mobile: reject leaves the action unexecuted", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realGitWorkingDir();
    test.skip(!cwd, "git unavailable");
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "appr-no");
    writeSession(sessionsDir, name, entries);

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    await sendChat(page, "delete stuff [[gate:file_delete:rm -rf build]]");

    const card = page.locator('[data-testid="approval-card"]');
    await expect(card).toBeVisible({ timeout: 15000 });
    const decideResp = page.waitForResponse(
      (r) => r.url().includes("/api/approval/decide"),
      { timeout: 15000 },
    );
    await card.locator('[data-testid="approval-reject"]').click();
    const resp = await decideResp;
    expect(resp.status()).toBe(200);
    await expect(card).toHaveCount(0, { timeout: 15000 });
  });

  test("mobile: approval appears in the Inbox", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realGitWorkingDir();
    test.skip(!cwd, "git unavailable");
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "appr-inbox");
    writeSession(sessionsDir, name, entries);

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    await sendChat(page, "commit [[gate:git_commit:git commit -m wip]]");
    // Wait for the approval to register on the server.
    await expect(page.locator('[data-testid="approval-card"]')).toBeVisible({
      timeout: 15000,
    });

    // The index Inbox should show an approval group.
    await page.goto("/");
    const inbox = page.locator('[data-testid="inbox"]');
    await expect(inbox.locator('[data-inbox-group="approval"]')).toBeVisible({
      timeout: 15000,
    });
  });
});
