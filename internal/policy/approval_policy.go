// Package policy classifies a requested action into an approval requirement.
// It is the single place that decides whether a shell command / file op / git
// op must pause for human approval before running. Classification is rule-
// based only — no AI/natural-language risk inference, and unknown mutation
// commands fail safe (require approval).
package policy

import (
	"regexp"
	"strings"
)

// Kind mirrors the approval action-kind enum in internal/server/approval.go.
type Kind string

const (
	KindShellCommand       Kind = "shell_command"
	KindFileWrite          Kind = "file_write"
	KindFileDelete         Kind = "file_delete"
	KindGitCommit          Kind = "git_commit"
	KindGitPush            Kind = "git_push"
	KindNetworkAction      Kind = "network_action"
	KindExternalSideEffect Kind = "external_side_effect"
	KindOther              Kind = "other"
)

// Decision is the outcome of evaluating an action.
type Decision struct {
	RequiresApproval bool
	Kind             Kind
	Title            string
	Reason           string
}

// allow reports the action may run without approval.
func allow(title string) Decision {
	return Decision{RequiresApproval: false, Title: title}
}

// require reports the action must pause for approval.
func require(kind Kind, title, reason string) Decision {
	return Decision{RequiresApproval: true, Kind: kind, Title: title, Reason: reason}
}

// Shell operators that mean "more than one command runs here" — a simple
// prefix allow is not sufficient, so these force a closer look.
var shellMeta = regexp.MustCompile(`(&&|\|\||;|\||\b(bash|sh|powershell|pwsh|cmd)\s+(-c|-Command|/c)\b)`)

// Read-only / verification allowlist. Each entry is a regexp matched against
// the *whole* command start so argument order can't sneak a mutation past it.
// Anything not matching fails safe to approval-required when it mutates, or
// "other" when it doesn't obviously mutate.
var readOnlyRules = []*regexp.Regexp{
	// git read-only subcommands (status/diff/log/show/rev-parse/ls-files/remote -v/branch --list/blame/describe).
	regexp.MustCompile(`^\s*git\s+(status|diff|log|show|rev-parse|ls-files|blame|describe|shortlog|remote\s+-v|branch\s+(--list|-l|-a|-r)?\s*$)`),
	// Go toolchain read-only/verification.
	regexp.MustCompile(`^\s*go\s+(test|vet|build|list|env|version|doc|fmt\b)`),
	// JS/TS verification.
	regexp.MustCompile(`^\s*(npm|pnpm|yarn)\s+(test|run\s+(test|lint|build|typecheck|format:check|check))\b`),
	regexp.MustCompile(`^\s*(npx|pnpm\s+exec|yarn)\s+(vitest|jest|eslint|tsc|vite\s+build|prettier\s+--check)\b`),
	regexp.MustCompile(`^\s*(vitest|jest|eslint|tsc\b|vite\s+build|prettier\s+--check)\b`),
	// Other ecosystems.
	regexp.MustCompile(`^\s*(pytest|cargo\s+(test|build|check|clippy|fmt)|mypy|pyright|ruff\s+check|svelte-check)\b`),
	// Plain inspection commands.
	regexp.MustCompile(`^\s*(ls|dir|pwd|cat|type|echo|rg|grep|find|fd|which|where|head|tail|wc|stat|file|tree)\b`),
}

// Mutation / destructive patterns that always require approval.
var mutationRules = []struct {
	kind   Kind
	re     *regexp.Regexp
	title  string
	reason string
}{
	{KindGitPush, regexp.MustCompile(`^\s*git\s+push\b`), "Git push", "remote mutation"},
	{KindGitCommit, regexp.MustCompile(`^\s*git\s+commit\b`), "Git commit", "history write"},
	{KindOther, regexp.MustCompile(`^\s*git\s+(reset|checkout|rebase|merge|cherry-pick|revert|clean|rm|mv|stash\s+(pop|drop)|branch\s+-[dD]|tag\s+-d)\b`), "Destructive git", "history/worktree mutation"},
	{KindFileDelete, regexp.MustCompile(`\b(rm|del|erase|rmdir|rd|Remove-Item|ri)\b`), "Delete file(s)", "destructive file deletion"},
	{KindExternalSideEffect, regexp.MustCompile(`^\s*(npm|pnpm|yarn|cargo|pip|pipx|gem|go)\s+(publish|push|deploy|release)\b`), "Publish/deploy", "external side effect"},
	{KindExternalSideEffect, regexp.MustCompile(`\b(kubectl|helm|terraform|ansible|docker\s+(push|run|rm)|systemctl|service)\b`), "Deployment/infra", "external side effect"},
	{KindNetworkAction, regexp.MustCompile(`^\s*(curl|wget|Invoke-WebRequest|iwr|ssh|scp|rsync|sftp)\b`), "Network action", "network side effect"},
	{KindOther, regexp.MustCompile(`\b(mv|move|Move-Item|cp|copy|Copy-Item|xcopy|robocopy)\b.*\b(force|/y|-f)\b`), "Overwrite/move", "destructive overwrite"},
	{KindOther, regexp.MustCompile(`\b(chmod|chown|icacls|attrib|mklink|ln\s+-s|sudo|runas|reg\s+add|setx)\b`), "System/config change", "system configuration mutation"},
	{KindOther, regexp.MustCompile(`\b(kill|taskkill|Stop-Process|pkill)\b`), "Kill process", "process termination"},
	{KindFileWrite, regexp.MustCompile(`(^|&&|\|\||;|\|)\s*(>|>>)`), "Write via redirect", "file write via shell redirection"},
}

// ClassifyCommand decides whether a shell command needs approval.
//
// Order: (1) mutation rules → require; (2) read-only allowlist → allow;
// (3) anything else. When a command contains shell operators (&&/;/|/wrapper),
// a single allowlist prefix is not trusted — every segment must be read-only
// for the whole thing to bypass approval.
func ClassifyCommand(command string) Decision {
	cmd := strings.TrimSpace(command)
	if cmd == "" {
		return allow("")
	}
	// Mutations always gate, even inside a compound command.
	for _, m := range mutationRules {
		if m.re.MatchString(cmd) {
			return require(m.kind, m.title, m.reason)
		}
	}
	// Compound / wrapped commands: split on operators and require every piece
	// to be read-only, else the whole command needs approval.
	if shellMeta.MatchString(cmd) {
		for _, seg := range splitCompound(cmd) {
			if !isReadOnly(seg) {
				return require(KindShellCommand, "Run command", "compound command contains a non-read-only segment")
			}
		}
		return allow("Run command")
	}
	if isReadOnly(cmd) {
		return allow("Run command")
	}
	// Unknown command: not obviously destructive, but not verified read-only.
	// Fail safe — require approval rather than guess.
	return require(KindShellCommand, "Run command", "unrecognized command")
}

// splitCompound breaks a command on shell operators into segments.
func splitCompound(cmd string) []string {
	parts := regexp.MustCompile(`&&|\|\||;|\|`).Split(cmd, -1)
	out := parts[:0]
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func isReadOnly(seg string) bool {
	seg = strings.TrimSpace(seg)
	if seg == "" {
		return true
	}
	for _, re := range readOnlyRules {
		if re.MatchString(seg) {
			return true
		}
	}
	return false
}

// ClassifyFileDelete reports that a file-delete action needs approval.
// File writes/edits are NOT gated in this phase (too common in dev); only
// deletes and out-of-workspace/credential writes are.
func ClassifyFileDelete() Decision {
	return require(KindFileDelete, "Delete file", "destructive file deletion")
}
