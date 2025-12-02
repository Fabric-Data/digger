package github

import "time"

// Webhook event types from GitHub
// Reference: https://docs.github.com/en/webhooks/webhook-events-and-payloads

// IssueCommentEvent is triggered when a comment is created on an issue or PR
type IssueCommentEvent struct {
	Action  string  `json:"action"` // created, edited, deleted
	Issue   Issue   `json:"issue"`
	Comment Comment `json:"comment"`
	Repo    Repo    `json:"repository"`
	Sender  User    `json:"sender"`
}

// PullRequestEvent is triggered when a PR is opened, synchronized, etc.
type PullRequestEvent struct {
	Action      string      `json:"action"` // opened, synchronize, closed, reopened
	Number      int         `json:"number"`
	PullRequest PullRequest `json:"pull_request"`
	Repo        Repo        `json:"repository"`
	Sender      User        `json:"sender"`
}

// Issue represents a GitHub issue (PRs are also issues)
type Issue struct {
	ID        int64  `json:"id"`
	Number    int    `json:"number"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	State     string `json:"state"` // open, closed
	User      User   `json:"user"`
	Labels    []Label `json:"labels"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	// If this issue is a PR, pull_request will be non-nil
	PullRequest *IssuePR `json:"pull_request,omitempty"`
}

// IssuePR contains PR-specific fields when an issue is actually a PR
type IssuePR struct {
	URL      string `json:"url"`
	HTMLURL  string `json:"html_url"`
	DiffURL  string `json:"diff_url"`
	PatchURL string `json:"patch_url"`
}

// PullRequest represents a GitHub pull request
type PullRequest struct {
	ID        int64  `json:"id"`
	Number    int    `json:"number"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	State     string `json:"state"` // open, closed
	Draft     bool   `json:"draft"`
	Merged    bool   `json:"merged"`
	User      User   `json:"user"`
	Head      Branch `json:"head"`
	Base      Branch `json:"base"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// Branch represents a git branch reference
type Branch struct {
	Ref  string `json:"ref"`  // branch name
	SHA  string `json:"sha"`  // commit SHA
	Repo Repo   `json:"repo"` // repo containing the branch
}

// Comment represents a GitHub comment
type Comment struct {
	ID        int64  `json:"id"`
	Body      string `json:"body"`
	User      User   `json:"user"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// Repo represents a GitHub repository
type Repo struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	FullName      string `json:"full_name"` // owner/repo
	Owner         User   `json:"owner"`
	Private       bool   `json:"private"`
	HTMLURL       string `json:"html_url"`
	CloneURL      string `json:"clone_url"`
	SSHURL        string `json:"ssh_url"`
	DefaultBranch string `json:"default_branch"`
}

// User represents a GitHub user
type User struct {
	ID    int64  `json:"id"`
	Login string `json:"login"`
	Type  string `json:"type"` // User, Bot, Organization
	Email string `json:"email,omitempty"`
}

// Label represents a GitHub issue/PR label
type Label struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// Command represents a parsed /opentaco command
type Command struct {
	Action  string            // plan, apply, destroy
	Options map[string]string // additional flags
	Raw     string            // original comment text
}

// CommandResult holds the result of executing a command
type CommandResult struct {
	Command   Command
	Success   bool
	Error     string
	Timing    TimingBreakdown
	Output    string
	Summary   string
}

// TimingBreakdown holds timing for each phase
type TimingBreakdown struct {
	Clone   time.Duration `json:"clone"`
	Init    time.Duration `json:"init"`
	Execute time.Duration `json:"execute"` // plan, apply, or destroy time
	Total   time.Duration `json:"total"`
}

// WebhookConfig holds configuration for the GitHub webhook handler
type WebhookConfig struct {
	WebhookSecret  string // Secret for validating webhook signatures
	AppID          string // GitHub App ID (optional, for App auth)
	PrivateKeyPath string // Path to GitHub App private key (optional)
	Token          string // Personal access token (alternative to App auth)
}

