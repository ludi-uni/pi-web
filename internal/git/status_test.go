package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func mustGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v (%s)", args, err, out)
	}
}

func TestWorkingTreeStatusClean(t *testing.T) {
	dir := initTestRepo(t)
	st, err := WorkingTreeStatus(dir)
	if err != nil {
		t.Fatalf("WorkingTreeStatus: %v", err)
	}
	if !st.IsRepo || !st.Clean || st.Changed != 0 || st.Branch != "main" {
		t.Fatalf("clean repo: got %+v", st)
	}
}

func TestWorkingTreeStatusDirty(t *testing.T) {
	dir := initTestRepo(t)
	write := func(name, content string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	// Tracked file, then modify + stage one, leave one unstaged, add untracked.
	write("a.txt", "one\ntwo\n")
	write("b.txt", "x\n")
	mustGit(t, dir, "add", ".")
	mustGit(t, dir, "commit", "-m", "base")

	write("a.txt", "one\nCHANGED\nthree\n") // unstaged modification
	write("b.txt", "x\ny\nz\n")             // will be staged
	mustGit(t, dir, "add", "b.txt")
	write("new.txt", "fresh\n") // untracked

	st, err := WorkingTreeStatus(dir)
	if err != nil {
		t.Fatalf("WorkingTreeStatus: %v", err)
	}
	if st.Clean {
		t.Fatalf("expected dirty repo: %+v", st)
	}
	if st.Staged != 1 || st.Untracked != 1 {
		t.Fatalf("staged/untracked counts: %+v", st)
	}
	if st.Unstaged < 1 {
		t.Fatalf("expected >=1 unstaged: %+v", st)
	}
	if st.Insertions == 0 && st.Deletions == 0 {
		t.Fatalf("expected non-zero diffstat: %+v", st)
	}
}

func TestWorkingTreeStatusNonRepo(t *testing.T) {
	st, err := WorkingTreeStatus(filepath.Join(t.TempDir(), "nope"))
	if err != nil {
		t.Fatalf("non-repo returned error: %v", err)
	}
	if st.IsRepo {
		t.Fatalf("expected IsRepo false")
	}
}

func TestChangedFiles(t *testing.T) {
	dir := initTestRepo(t)
	write := func(name, content string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("tracked.txt", "a\nb\n")
	mustGit(t, dir, "add", ".")
	mustGit(t, dir, "commit", "-m", "base")
	write("tracked.txt", "a\nb\nc\n")
	write("untracked.txt", "n\n")

	files, err := ChangedFiles(dir)
	if err != nil {
		t.Fatalf("ChangedFiles: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %+v", files)
	}
	var tracked, untracked *ChangedFile
	for i := range files {
		switch files[i].Path {
		case "tracked.txt":
			tracked = &files[i]
		case "untracked.txt":
			untracked = &files[i]
		}
	}
	if tracked == nil || untracked == nil {
		t.Fatalf("missing expected entries: %+v", files)
	}
	if tracked.Added != 1 {
		t.Fatalf("tracked added count: %+v", tracked)
	}
	if untracked.Status != "??" {
		t.Fatalf("untracked status: %+v", untracked)
	}
}

func TestFileDiffTracked(t *testing.T) {
	dir := initTestRepo(t)
	write := func(name, content string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("f.txt", "l1\nl2\n")
	mustGit(t, dir, "add", ".")
	mustGit(t, dir, "commit", "-m", "base")
	write("f.txt", "l1\nCHANGED\n")

	diff, err := FileDiff(dir, "f.txt")
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if !strings.Contains(diff, "+CHANGED") || !strings.Contains(diff, "-l2") {
		t.Fatalf("unexpected diff:\n%s", diff)
	}
}

func TestFileDiffUntracked(t *testing.T) {
	dir := initTestRepo(t)
	if err := os.WriteFile(filepath.Join(dir, "new.txt"), []byte("hello\n"), 0644); err != nil {
		t.Fatal(err)
	}
	diff, err := FileDiff(dir, "new.txt")
	if err != nil {
		t.Fatalf("FileDiff untracked: %v", err)
	}
	if !strings.Contains(diff, "new file mode") || !strings.Contains(diff, "+hello") {
		t.Fatalf("expected synthesized new-file patch:\n%s", diff)
	}
}

func TestFileDiffPathTraversal(t *testing.T) {
	dir := initTestRepo(t)
	for _, bad := range []string{"../outside.txt", "..\\x", "/abs/path", "a/../../b"} {
		if _, err := FileDiff(dir, bad); err != ErrPathOutsideRepo {
			t.Fatalf("FileDiff(%q): got %v, want ErrPathOutsideRepo", bad, err)
		}
	}
}

func TestValidateRepoPath(t *testing.T) {
	dir := initTestRepo(t)
	// A real file inside the tree validates.
	if err := os.WriteFile(filepath.Join(dir, "ok.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := ValidateRepoPath(dir, "ok.txt"); err != nil {
		t.Fatalf("valid path rejected: %v", err)
	}
	if err := ValidateRepoPath(dir, "sub/dir/file.go"); err != nil {
		t.Fatalf("nested non-existent path should still validate lexically: %v", err)
	}
	for _, bad := range []string{"../x", "..", "/abs", "a/../../b", ""} {
		if err := ValidateRepoPath(dir, bad); err != ErrPathOutsideRepo {
			t.Fatalf("ValidateRepoPath(%q): got %v, want ErrPathOutsideRepo", bad, err)
		}
	}
}

func TestValidateRepoPathSymlinkEscape(t *testing.T) {
	dir := initTestRepo(t)
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secret, []byte("top secret"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link.txt")
	if err := os.Symlink(secret, link); err != nil {
		t.Skipf("symlink not permitted: %v", err)
	}
	if err := ValidateRepoPath(dir, "link.txt"); err != ErrPathOutsideRepo {
		t.Fatalf("symlink escape: got %v, want ErrPathOutsideRepo", err)
	}
}

func TestParseDiffMode(t *testing.T) {
	for _, m := range []string{"", "working", "staged", "unstaged"} {
		if _, err := ParseDiffMode(m); err != nil {
			t.Fatalf("mode %q should be valid: %v", m, err)
		}
	}
	if _, err := ParseDiffMode("bogus"); err == nil {
		t.Fatal("invalid mode should error")
	}
	if _, err := ParseDiffMode("HEAD~1 --evil"); err == nil {
		t.Fatal("injection-like mode should error")
	}
}

func TestFileDiffModes(t *testing.T) {
	dir := initTestRepo(t)
	write := func(name, content string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("f.txt", "a\nb\n")
	mustGit(t, dir, "add", ".")
	mustGit(t, dir, "commit", "-m", "base")
	// Staged change + unstaged change on different files.
	write("f.txt", "a\nSTAGED\n")
	mustGit(t, dir, "add", "f.txt")
	write("f.txt", "a\nSTAGED\nUNSTAGED\n")

	staged, err := FileDiffMode(dir, "f.txt", DiffStaged)
	if err != nil {
		t.Fatalf("staged diff: %v", err)
	}
	if !strings.Contains(staged, "+STAGED") {
		t.Fatalf("staged diff should contain staged hunk:\n%s", staged)
	}
	unstaged, err := FileDiffMode(dir, "f.txt", DiffUnstaged)
	if err != nil {
		t.Fatalf("unstaged diff: %v", err)
	}
	if !strings.Contains(unstaged, "+UNSTAGED") {
		t.Fatalf("unstaged diff should contain unstaged hunk:\n%s", unstaged)
	}
	working, err := FileDiffMode(dir, "f.txt", DiffWorking)
	if err != nil {
		t.Fatalf("working diff: %v", err)
	}
	if !strings.Contains(working, "+UNSTAGED") {
		t.Fatalf("working diff should include all changes:\n%s", working)
	}
}

func TestHeadInfo(t *testing.T) {
	dir := initTestRepo(t)
	info, err := Head(dir)
	if err != nil {
		t.Fatalf("Head: %v", err)
	}
	if info.SHA == "" || info.Subject == "" {
		t.Fatalf("expected sha+subject, got %+v", info)
	}
	// No upstream configured → HasUpstream false, counts -1.
	if info.HasUpstream || info.Ahead != -1 {
		t.Fatalf("no upstream expected, got %+v", info)
	}
}

func TestHeadInfoNonRepo(t *testing.T) {
	info, err := Head(t.TempDir())
	if err != nil {
		t.Fatalf("non-repo Head: %v", err)
	}
	if info.SHA != "" {
		t.Fatalf("expected empty sha for non-repo, got %+v", info)
	}
}
