package policy

import "testing"

func TestClassifyReadOnly(t *testing.T) {
	for _, c := range []string{
		"git status", "git diff HEAD", "git log --oneline", "git show abc",
		"go test ./...", "go vet ./...", "go build ./...",
		"npm test", "npm run lint", "npm run build", "npm run format:check",
		"npx vitest run", "eslint src/", "pytest", "cargo test", "cargo build",
		"ls -la", "rg foo", "cat file.txt",
	} {
		d := ClassifyCommand(c)
		if d.RequiresApproval {
			t.Errorf("%q should be allowed, got %+v", c, d)
		}
	}
}

func TestClassifyMutations(t *testing.T) {
	cases := []struct {
		cmd  string
		kind Kind
	}{
		{"git push origin main", KindGitPush},
		{"git commit -m 'x'", KindGitCommit},
		{"git reset --hard", KindOther},
		{"git checkout -b x", KindOther},
		{"rm -rf build", KindFileDelete},
		{"del file.txt", KindFileDelete},
		{"Remove-Item x", KindFileDelete},
		{"npm publish", KindExternalSideEffect},
		{"kubectl apply -f x.yaml", KindExternalSideEffect},
		{"curl https://x", KindNetworkAction},
		{"taskkill /f /im x", KindOther},
	}
	for _, c := range cases {
		d := ClassifyCommand(c.cmd)
		if !d.RequiresApproval {
			t.Errorf("%q should require approval", c.cmd)
			continue
		}
		if d.Kind != c.kind {
			t.Errorf("%q: kind %v, want %v", c.cmd, d.Kind, c.kind)
		}
	}
}

func TestClassifyCompound(t *testing.T) {
	// Read-only compound → allow.
	if d := ClassifyCommand("go test ./... && go build ./..."); d.RequiresApproval {
		t.Errorf("read-only compound should be allowed: %+v", d)
	}
	// Compound hiding a mutation → require.
	if d := ClassifyCommand("go test && rm -rf /tmp/x"); !d.RequiresApproval {
		t.Error("compound with rm should require approval")
	}
	if d := ClassifyCommand("git status && git push"); !d.RequiresApproval {
		t.Error("compound with git push should require approval")
	}
	// Wrapper forms.
	if d := ClassifyCommand("bash -c 'rm -rf x'"); !d.RequiresApproval {
		t.Error("bash -c rm should require approval")
	}
	if d := ClassifyCommand("powershell -Command Remove-Item x"); !d.RequiresApproval {
		t.Error("powershell Remove-Item should require approval")
	}
}

func TestClassifyUnknownFailsSafe(t *testing.T) {
	// Unrecognized command → require approval (fail safe), not a silent allow.
	if d := ClassifyCommand("frobnicate --all"); !d.RequiresApproval {
		t.Error("unknown command should require approval")
	}
}
