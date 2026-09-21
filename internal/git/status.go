// Read-only git status / diff helpers backing the session Result Card and the
// per-file diff viewer. Everything here shells out to the fixed git CLI with an
// explicit working directory and a separated argv (never a shell string), so a
// session cwd or a client-supplied path can never inject extra commands.
package git

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
)

// Status is the working-tree summary surfaced by the Result Card.
type Status struct {
	IsRepo    bool   `json:"isRepo"`
	Branch    string `json:"branch"`
	Clean     bool   `json:"clean"`
	Staged    int    `json:"staged"`
	Unstaged  int    `json:"unstaged"`
	Untracked int    `json:"untracked"`
	// Total tracked + untracked files with any change.
	Changed    int `json:"changed"`
	Insertions int `json:"insertions"`
	Deletions  int `json:"deletions"`
}

// ChangedFile is one entry in the per-file list behind the Result Card.
type ChangedFile struct {
	Path    string `json:"path"`
	Status  string `json:"status"` // "M","A","D","R","??",…
	Staged  bool   `json:"staged"`
	Added   int    `json:"added"`   // -1 when unknown/binary
	Deleted int    `json:"deleted"` // -1 when unknown/binary
	// X and Y are the raw porcelain status columns (index / worktree). They
	// let the diff-mode filter keep a file in staged, unstaged, or both lists.
	X byte `json:"-"`
	Y byte `json:"-"`
}

// maxStatusFiles caps the per-file list so a tree with thousands of changes
// can't produce an unbounded payload for the mobile UI.
const maxStatusFiles = 200

// parseStatusPorcelain parses `git status --porcelain=v1 -z` output into
// changed-file entries. The -z form is unambiguous: each record is
// "XY <path>\0" and renames emit the destination after the source.
func parseStatusPorcelain(out string) []ChangedFile {
	var files []ChangedFile
	records := strings.Split(out, "\x00")
	for i := 0; i < len(records); i++ {
		rec := records[i]
		if len(rec) < 4 {
			continue
		}
		x, y := rec[0], rec[1]
		path := rec[3:]
		// Rename/copy records carry "orig -> new"; keep the new path and skip
		// the following record (the original) which -z emits separately.
		if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
			if j := strings.Index(path, " -> "); j >= 0 {
				path = path[j+4:]
			} else if i+1 < len(records) {
				i++ // consume the separate original-path record
			}
		}
		f := ChangedFile{Path: path, Added: -1, Deleted: -1, X: x, Y: y}
		switch {
		case x == '?' && y == '?':
			f.Status = "??"
		case x != ' ' && x != '?':
			f.Status = string(x)
			f.Staged = true
		default:
			f.Status = string(y)
		}
		files = append(files, f)
	}
	return files
}

// Status gathers the Result-Card summary for dir. A non-repo dir returns
// Status{IsRepo:false} with a nil error so callers can simply hide the card.
func WorkingTreeStatus(dir string) (Status, error) {
	if dir == "" {
		return Status{IsRepo: false}, nil
	}
	if _, err := run(dir, "rev-parse", "--is-inside-work-tree"); err != nil {
		return Status{IsRepo: false}, nil
	}
	st := Status{IsRepo: true}
	st.Branch, _ = CurrentBranch(dir)

	// diffRun (not run) because it preserves the leading space of the first
	// record's XY status — run() trims it, which would corrupt the parse.
	porcelain, err := diffRun(dir, "-c", "core.quotepath=false", "status", "--porcelain=v1", "-z")
	if err == nil {
		files := parseStatusPorcelain(porcelain)
		st.Changed = len(files)
		for _, f := range files {
			switch {
			case f.Status == "??":
				st.Untracked++
			case f.Staged:
				st.Staged++
			default:
				st.Unstaged++
			}
		}
	}
	st.Clean = st.Changed == 0

	// Diffstat of tracked changes vs HEAD (insertions/deletions). Empty output
	// means a clean tree or a repo with no commits yet — both leave 0/0.
	if numstat, err := diffRun(dir, "diff", "--numstat", "HEAD"); err == nil {
		for _, line := range strings.Split(numstat, "\n") {
			fields := strings.Fields(line)
			if len(fields) < 3 {
				continue
			}
			if a, err := strconv.Atoi(fields[0]); err == nil {
				st.Insertions += a
			}
			if d, err := strconv.Atoi(fields[1]); err == nil {
				st.Deletions += d
			}
		}
	}
	return st, nil
}

// HeadInfo is the small git-metadata block on the Result Card: the checked
// out commit and the upstream relationship. All values come from local refs
// only — no fetch/network access ever happens here.
type HeadInfo struct {
	IsRepo      bool   `json:"isRepo"`
	SHA         string `json:"sha"`     // short HEAD sha, "" when unborn
	Subject     string `json:"subject"` // latest commit subject line
	Ahead       int    `json:"ahead"`   // commits ahead of upstream (-1 = no upstream)
	Behind      int    `json:"behind"`  // commits behind upstream (-1 = no upstream)
	HasUpstream bool   `json:"hasUpstream"`
}

// Head gathers HEAD + upstream metadata for dir. Non-repo or unborn HEAD
// yields a zero struct with no error.
func Head(dir string) (HeadInfo, error) {
	info := HeadInfo{Ahead: -1, Behind: -1}
	if dir == "" {
		return info, nil
	}
	if _, err := run(dir, "rev-parse", "--is-inside-work-tree"); err != nil {
		return info, nil
	}
	if sha, err := run(dir, "rev-parse", "--short", "HEAD"); err == nil {
		info.SHA = sha
	}
	if subj, err := run(dir, "log", "-1", "--pretty=%s"); err == nil {
		info.Subject = subj
	}
	// Upstream ahead/behind from local tracking refs only. `@{upstream}` fails
	// (non-zero exit) when no upstream is configured — we leave HasUpstream
	// false and the counts at -1 so the UI hides the row.
	if out, err := run(dir, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"); err == nil {
		fields := strings.Fields(out)
		if len(fields) == 2 {
			info.HasUpstream = true
			info.Ahead, _ = strconv.Atoi(fields[0])
			info.Behind, _ = strconv.Atoi(fields[1])
		}
	}
	return info, nil
}

// ChangedFiles returns the per-file working-tree list (capped at
// maxStatusFiles). Tracked files get added/deleted line counts from
// `git diff --numstat HEAD`; untracked files report -1/-1 (unknown).
func ChangedFiles(dir string) ([]ChangedFile, error) {
	return ChangedFilesMode(dir, DiffWorking)
}

// ChangedFilesMode returns the per-file list under a diff mode. For staged and
// unstaged modes the porcelain status is the same (it reports both columns);
// we filter to the relevant column. Untracked files only appear in working/
// unstaged mode.
func ChangedFilesMode(dir string, mode DiffMode) ([]ChangedFile, error) {
	if dir == "" {
		return nil, ErrNotRepo
	}
	if _, err := run(dir, "rev-parse", "--is-inside-work-tree"); err != nil {
		return nil, ErrNotRepo
	}
	porcelain, err := diffRun(dir, "-c", "core.quotepath=false", "status", "--porcelain=v1", "-z")
	if err != nil {
		return nil, err
	}
	files := parseStatusPorcelain(porcelain)
	// Filter to the column the mode cares about. Staged → X column (index vs
	// HEAD); unstaged → Y column (worktree vs index) plus untracked; working →
	// everything (the union, which is what the porcelain already reports).
	filtered := files[:0]
	for _, f := range files {
		keep := true
		switch mode {
		case DiffStaged:
			keep = f.X != ' ' && f.X != '?'
		case DiffUnstaged:
			keep = f.Status == "??" || (f.Y != ' ' && f.Y != '?')
		}
		if keep {
			filtered = append(filtered, f)
		}
	}
	files = filtered
	if len(files) > maxStatusFiles {
		files = files[:maxStatusFiles]
	}

	// Line counts per tracked path, under the same comparison as the mode.
	counts := map[string][2]int{}
	numstatArgs := append([]string{}, mode.diffArgs()...)
	numstatArgs = append(numstatArgs, "--numstat")
	if numstat, err := diffRun(dir, numstatArgs...); err == nil {
		for _, line := range strings.Split(numstat, "\n") {
			fields := strings.SplitN(line, "\t", 3)
			if len(fields) < 3 {
				continue
			}
			a, _ := strconv.Atoi(fields[0])
			d, _ := strconv.Atoi(fields[1])
			counts[fields[2]] = [2]int{a, d}
		}
	}
	for i := range files {
		if c, ok := counts[files[i].Path]; ok {
			files[i].Added = c[0]
			files[i].Deleted = c[1]
		}
	}
	return files, nil
}

// DiffMode selects which comparison a file/status diff reports. The set is a
// fixed enum — clients pass the mode name, never a raw git argument.
type DiffMode string

const (
	// DiffWorking compares HEAD vs the working tree (staged + unstaged).
	DiffWorking DiffMode = "working"
	// DiffStaged compares HEAD vs the index (`git diff --cached`).
	DiffStaged DiffMode = "staged"
	// DiffUnstaged compares the index vs the working tree (`git diff`).
	DiffUnstaged DiffMode = "unstaged"
)

// ParseDiffMode validates a client-supplied mode string. Empty defaults to
// working tree; anything else is rejected so no arbitrary ref reaches git.
func ParseDiffMode(s string) (DiffMode, error) {
	switch DiffMode(s) {
	case "", DiffWorking:
		return DiffWorking, nil
	case DiffStaged, DiffUnstaged:
		return DiffMode(s), nil
	default:
		return "", fmt.Errorf("invalid diff mode %q", s)
	}
}

// diffArgs returns the git diff argv for a mode (the base comparison only).
func (m DiffMode) diffArgs() []string {
	switch m {
	case DiffStaged:
		return []string{"diff", "--cached"}
	case DiffUnstaged:
		return []string{"diff"}
	default: // DiffWorking
		return []string{"diff", "HEAD"}
	}
}

// FileDiffMode returns the unified patch for a single repo-relative path under
// the given diff mode. Untracked files only appear in working/unstaged mode
// (they are never in the index), where a synthesized new-file patch is used.
func FileDiffMode(dir, rel string, mode DiffMode) (string, error) {
	if err := ValidateRepoPath(dir, rel); err != nil {
		return "", err
	}
	tracked, err := run(dir, "ls-files", "--error-unmatch", "--", rel)
	untracked := err != nil || tracked == ""
	if untracked {
		// Staged mode never reports untracked files.
		if mode == DiffStaged {
			return "", nil
		}
		var b strings.Builder
		appendUntrackedPatch(&b, dir, filepath.ToSlash(rel))
		return b.String(), nil
	}
	args := append([]string{"-c", "core.quotepath=false"}, mode.diffArgs()...)
	args = append(args, "--", rel)
	return diffRun(dir, args...)
}

// FileDiff returns the unified patch for a single repo-relative path, covering
// staged + unstaged tracked changes (vs HEAD). For an untracked file it
// synthesizes an all-additions patch (same shape as WorkingTreeDiff). Returns
// ErrNotRepo for a non-repo dir and "" (no error) when the path has no changes.
//
// The path is always passed to git via `--` as a single argv element and is
// additionally validated to stay inside the work tree, so `..`, absolute paths
// and symlink escapes are rejected before git ever sees them.
func FileDiff(dir, rel string) (string, error) {
	return FileDiffMode(dir, rel, DiffWorking)
}

// ErrPathOutsideRepo is returned when a client-supplied relative path resolves
// outside the repository work tree (traversal, absolute path, symlink escape).
var ErrPathOutsideRepo = fmt.Errorf("path escapes repository root")

// ValidateRepoPath resolves a repo-relative path to an absolute path inside the
// work tree, rejecting traversal and symlink escapes. Returns the cleaned
// repo-relative path (forward slashes) for use in git argv.
func ValidateRepoPath(dir, rel string) error {
	if dir == "" || rel == "" {
		return ErrPathOutsideRepo
	}
	// Reject absolute paths in every form: OS-native (C:\, \\unc), and a
	// leading / or \ which filepath.IsAbs misses on the other OS.
	if filepath.IsAbs(rel) || strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, "\\") {
		return ErrPathOutsideRepo
	}
	// A drive-letter prefix (C:, D:) is absolute on Windows even mid-string.
	if len(rel) >= 2 && rel[1] == ':' {
		return ErrPathOutsideRepo
	}
	root, err := filepath.Abs(dir)
	if err != nil {
		return ErrPathOutsideRepo
	}
	// Resolve the repo root through symlinks once (e.g. /tmp on macOS) so the
	// containment check compares canonical paths on both sides.
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}
	// The target may not exist yet; clean lexically then verify containment.
	target := filepath.Join(root, filepath.FromSlash(rel))
	// Reject obvious traversal before touching the filesystem.
	cleaned := filepath.Clean(target)
	if cleaned != root && !strings.HasPrefix(cleaned, root+string(filepath.Separator)) {
		return ErrPathOutsideRepo
	}
	// When the path exists, canonicalize it (resolving any symlinks inside the
	// tree) and re-check containment so a symlink can't point outside.
	if resolved, err := filepath.EvalSymlinks(cleaned); err == nil {
		if resolved != root && !strings.HasPrefix(resolved, root+string(filepath.Separator)) {
			return ErrPathOutsideRepo
		}
	}
	return nil
}
