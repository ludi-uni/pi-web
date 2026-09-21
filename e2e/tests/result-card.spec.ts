import { test, expect, isMobileLayout, collapseScratchpad } from "../lib/test";
import {
  buildSession,
  bashExecutionEntry,
  realGitWorkingDir,
  uniqueSessionName,
  writeSession,
} from "../lib/sessions";

// Session Result Card + changed-files + per-file diff on mobile. The session
// cwd is a real temp git repo so /api/git/* returns live data.

test.describe("session result card", () => {
  test("mobile: result card shows status, files, diff and per-file view", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realGitWorkingDir();
    test.skip(!cwd, "git unavailable");
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "result");
    writeSession(sessionsDir, name, entries);

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    const card = page.locator('[data-testid="result-card"]');
    await expect(card).toBeVisible({ timeout: 15000 });
    // Branch + changed-file count + diffstat are visible.
    await expect(card.locator(".result-branch")).toContainText(/main|master/);
    await expect(card.locator(".result-grid")).toContainText("changed");

    // Expand the changed-files list.
    await card.locator('[data-testid="result-toggle-files"]').click();
    const list = page.locator('[data-testid="changed-files"]');
    await expect(list.locator(".cf-item").first()).toBeVisible();
    // tracked.txt (modified) + staged.txt (staged) + untracked.txt (??).
    await expect(list.locator(".cf-item")).toHaveCount(3);

    // Tap a file → lazy per-file diff renders with +/− lines.
    await list.locator('.cf-item[data-path="tracked.txt"]').click();
    const diff = page.locator('[data-testid="file-diff"]');
    await expect(diff.locator(".diff-add").first()).toBeVisible();
    await expect(diff.locator(".diff-del").first()).toBeVisible();
  });

  test("mobile: view-changes opens the full diff sheet", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realGitWorkingDir();
    test.skip(!cwd, "git unavailable");
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "result-diff");
    writeSession(sessionsDir, name, entries);

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    const card = page.locator('[data-testid="result-card"]');
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.locator('[data-testid="result-view-changes"]').click();
    // The existing DiffModal full-screen sheet opens.
    await expect(page.locator(".diff-sheet-panel")).toBeVisible({ timeout: 20000 });
  });

  test("mobile: copy report writes a summary to the clipboard", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realGitWorkingDir();
    test.skip(!cwd, "git unavailable");
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "result-copy");
    writeSession(sessionsDir, name, entries);

    // Stub the clipboard so we can assert the copied report text.
    await page.addInitScript(() => {
      // @ts-expect-error test stub
      window.__copied = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (t: string) => {
            // @ts-expect-error test stub
            window.__copied = t;
            return Promise.resolve();
          },
        },
      });
    });

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    const card = page.locator('[data-testid="result-card"]');
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.locator('[data-testid="result-copy"]').click();
    await expect
      .poll(async () => page.evaluate(() => (window as any).__copied))
      .toContain("Session result:");
  });

  test("mobile: copy session link via the command menu", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realGitWorkingDir();
    test.skip(!cwd, "git unavailable");
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "result-link");
    writeSession(sessionsDir, name, entries);

    await page.addInitScript(() => {
      // @ts-expect-error test stub
      window.__copied = "";
      // Force the copy fallback (no navigator.share in the test env).
      // @ts-expect-error test stub
      delete navigator.share;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (t: string) => {
            // @ts-expect-error test stub
            window.__copied = t;
            return Promise.resolve();
          },
        },
      });
    });

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    // Open the command menu and pick "Session link".
    await page.locator("#command-menu-btn").click();
    // Mobile panel + desktop popover both render the item; click the visible one.
    await page.locator('.mobile-command-item[data-action="copy-link"]').click();
    await expect
      .poll(async () => page.evaluate(() => (window as any).__copied))
      .toContain("/session?id=");
  });
});


test.describe("result card execution + diff modes + approval", () => {
  test("mobile: tests/build section and execution drawer", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realGitWorkingDir();
    test.skip(!cwd, "git unavailable");
    const { entries, lastId } = buildSession({ cwd });
    const b1 = bashExecutionEntry(lastId, "go test ./...", 0, "ok");
    const b2 = bashExecutionEntry(b1.id, "npm run build", 0, "built");
    const b3 = bashExecutionEntry(b2.id, "npm run lint", 0, "clean");
    const name = uniqueSessionName(testInfo, "exec");
    writeSession(sessionsDir, name, [...entries, b1.entry, b2.entry, b3.entry]);

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    const card = page.locator('[data-testid="result-card"]');
    await expect(card).toBeVisible({ timeout: 15000 });
    // Tests + Build + Checks sections render with Passed statuses.
    await expect(card.locator('[data-cat="test"]')).toContainText("go test");
    await expect(card.locator('[data-cat="build"]')).toContainText("npm run build");
    await expect(card.locator('[data-cat="lint"]')).toContainText("npm run lint");

    // Execution drawer lists all three commands.
    await card.locator('[data-testid="result-toggle-exec"]').click();
    const drawer = page.locator('[data-testid="exec-drawer"]');
    await expect(drawer.locator(".exec-item")).toHaveCount(3);
    // Expand one → detail shows exit code + source.
    await drawer.locator(".exec-item", { hasText: "go test" }).click();
    await expect(drawer.locator(".exec-detail")).toContainText("Exit code");
  });

  test("mobile: diff mode toggle switches staged/unstaged", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realGitWorkingDir();
    test.skip(!cwd, "git unavailable");
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "modes");
    writeSession(sessionsDir, name, entries);

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    const card = page.locator('[data-testid="result-card"]');
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.locator('[data-testid="result-toggle-files"]').click();

    const toggle = page.locator('[data-testid="diffmode-toggle"]');
    await expect(toggle).toBeVisible();
    // Working tree: tracked(unstaged) + staged + untracked = 3 rows.
    const list = page.locator('[data-testid="changed-files"]');
    await expect(list.locator(".cf-item")).toHaveCount(3);
    // Staged mode: only staged.txt.
    await toggle.locator('[data-mode="staged"]').click();
    await expect(list.locator(".cf-item")).toHaveCount(1);
    await expect(list.locator('.cf-item[data-path="staged.txt"]')).toBeVisible();
    // Unstaged mode: tracked.txt + untracked.txt.
    await toggle.locator('[data-mode="unstaged"]').click();
    await expect(list.locator(".cf-item")).toHaveCount(2);
  });

  test("mobile: approval event renders ApprovalCard then resolves", async ({
    page,
    sessionsDir,
  }, testInfo) => {
    const cwd = realGitWorkingDir();
    test.skip(!cwd, "git unavailable");
    const { entries } = buildSession({ cwd });
    const name = uniqueSessionName(testInfo, "approval");
    writeSession(sessionsDir, name, entries);

    await collapseScratchpad(page);
    await page.goto(`/session?id=${encodeURIComponent(name)}`);
    test.skip(!(await isMobileLayout(page)), "mobile-only behavior");

    // No approval card initially.
    await expect(page.locator('[data-testid="approval-card"]')).toHaveCount(0);

    // Inject a fixture approval_required event into the store.
    await page.evaluate(() => {
      // @ts-expect-error test hook
      const mod = window.__approvalStore;
      if (mod) mod.dispatchApprovalEvent({
        type: "approval_required",
        approval: {
          approval_id: "e2e-a1",
          session_id: new URLSearchParams(location.search).get("id"),
          action_kind: "shell_command",
          title: "Deploy",
          requested_action: "npm publish",
        },
      });
    });
    const card = page.locator('[data-testid="approval-card"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText("npm publish");
    // Buttons are enabled now that the decision endpoint is live.
    await expect(card.locator(".approval-btn--approve")).toBeEnabled();

    // Resolve → card disappears.
    await page.evaluate(() => {
      // @ts-expect-error test hook
      window.__approvalStore?.dispatchApprovalEvent({
        type: "approval_resolved",
        approvalId: "e2e-a1",
      });
    });
    await expect(page.locator('[data-testid="approval-card"]')).toHaveCount(0);
  });
});
