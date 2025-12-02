package github

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Client provides GitHub API operations for the webhook handler
type Client struct {
	token      string
	httpClient *http.Client
	baseURL    string
}

// NewClient creates a new GitHub API client
func NewClient(token string) *Client {
	return &Client{
		token: token,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		baseURL: "https://api.github.com",
	}
}

// NewClientFromEnv creates a client from environment variables
func NewClientFromEnv() (*Client, error) {
	token := os.Getenv("OPENTACO_GITHUB_TOKEN")
	if token == "" {
		return nil, fmt.Errorf("OPENTACO_GITHUB_TOKEN is required")
	}
	return NewClient(token), nil
}

// PostComment posts a comment on an issue or PR
func (c *Client) PostComment(ctx context.Context, owner, repo string, issueNumber int, body string) error {
	url := fmt.Sprintf("%s/repos/%s/%s/issues/%d/comments", c.baseURL, owner, repo, issueNumber)

	payload := map[string]string{"body": body}
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal comment: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to post comment: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GitHub API returned %d: %s", resp.StatusCode, string(body))
	}

	slog.Info("Posted comment to GitHub",
		slog.String("repo", fmt.Sprintf("%s/%s", owner, repo)),
		slog.Int("issue", issueNumber))

	return nil
}

// UpdateComment updates an existing comment
func (c *Client) UpdateComment(ctx context.Context, owner, repo string, commentID int64, body string) error {
	url := fmt.Sprintf("%s/repos/%s/%s/issues/comments/%d", c.baseURL, owner, repo, commentID)

	payload := map[string]string{"body": body}
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal comment: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to update comment: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GitHub API returned %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// GetPullRequest fetches PR details
func (c *Client) GetPullRequest(ctx context.Context, owner, repo string, number int) (*PullRequest, error) {
	url := fmt.Sprintf("%s/repos/%s/%s/pulls/%d", c.baseURL, owner, repo, number)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to get PR: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub API returned %d: %s", resp.StatusCode, string(body))
	}

	var pr PullRequest
	if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil {
		return nil, fmt.Errorf("failed to decode PR: %w", err)
	}

	return &pr, nil
}

// DownloadRepoArchive downloads the repository at a specific ref as a tar.gz archive
func (c *Client) DownloadRepoArchive(ctx context.Context, owner, repo, ref string) ([]byte, error) {
	// GitHub provides tarball downloads at /repos/{owner}/{repo}/tarball/{ref}
	url := fmt.Sprintf("%s/repos/%s/%s/tarball/%s", c.baseURL, owner, repo, ref)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to download tarball: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub API returned %d: %s", resp.StatusCode, string(body))
	}

	// Read the tarball
	tarball, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read tarball: %w", err)
	}

	slog.Info("Downloaded repo archive",
		slog.String("repo", fmt.Sprintf("%s/%s", owner, repo)),
		slog.String("ref", ref),
		slog.Int("size", len(tarball)))

	return tarball, nil
}

// DownloadAndRepackage downloads the repo and repackages it without the GitHub wrapper directory
// GitHub tarballs have a root directory like "owner-repo-sha/", this removes it
func (c *Client) DownloadAndRepackage(ctx context.Context, owner, repo, ref string) ([]byte, error) {
	tarball, err := c.DownloadRepoArchive(ctx, owner, repo, ref)
	if err != nil {
		return nil, err
	}

	// Repackage to remove the GitHub wrapper directory
	return repackageTarball(tarball)
}

// repackageTarball removes the root directory wrapper from a GitHub tarball
func repackageTarball(input []byte) ([]byte, error) {
	// Open the gzipped input
	gzr, err := gzip.NewReader(bytes.NewReader(input))
	if err != nil {
		return nil, fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)

	// Create output buffer
	var buf bytes.Buffer
	gzw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gzw)

	// Find the prefix (first directory) to strip
	var prefix string
	var fileCount int
	var tfFileCount int

	slog.Info("Starting tarball repackage", slog.Int("input_size", len(input)))

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to read tar: %w", err)
		}

		// Skip PAX extended headers (GitHub tarballs use PAX format)
		// These have Typeflag 'x' (PAX header) or 'g' (global PAX header)
		// or names like "pax_global_header" or "PaxHeader/"
		if hdr.Typeflag == tar.TypeXHeader || hdr.Typeflag == tar.TypeXGlobalHeader {
			continue
		}
		if strings.HasPrefix(hdr.Name, "pax_global_header") || strings.HasPrefix(hdr.Name, "PaxHeader") {
			continue
		}

		// Detect and strip the prefix directory (the GitHub wrapper like "owner-repo-sha/")
		if prefix == "" {
			parts := strings.SplitN(hdr.Name, "/", 2)
			if len(parts) > 0 && parts[0] != "" {
				prefix = parts[0] + "/"
				slog.Info("Detected GitHub tarball prefix to strip", slog.String("prefix", prefix))
			}
		}

		// Skip the root directory entry itself
		if hdr.Name == prefix || hdr.Name == strings.TrimSuffix(prefix, "/") {
			continue
		}

		// Strip the prefix from the path
		newName := strings.TrimPrefix(hdr.Name, prefix)
		if newName == "" {
			continue
		}

		fileCount++
		if strings.HasSuffix(newName, ".tf") {
			tfFileCount++
		}

		// Create new header with stripped path
		newHdr := &tar.Header{
			Name:     newName,
			Mode:     hdr.Mode,
			Size:     hdr.Size,
			ModTime:  hdr.ModTime,
			Typeflag: hdr.Typeflag,
		}

		if err := tw.WriteHeader(newHdr); err != nil {
			return nil, fmt.Errorf("failed to write header: %w", err)
		}

		if hdr.Size > 0 {
			if _, err := io.Copy(tw, tr); err != nil {
				return nil, fmt.Errorf("failed to copy file: %w", err)
			}
		}
	}

	slog.Info("Repackaged tarball completed",
		slog.String("stripped_prefix", prefix),
		slog.Int("total_files", fileCount),
		slog.Int("tf_files", tfFileCount))

	if tfFileCount == 0 {
		slog.Warn("No .tf files found in archive after repackaging!")
	}

	if err := tw.Close(); err != nil {
		return nil, fmt.Errorf("failed to close tar writer: %w", err)
	}
	if err := gzw.Close(); err != nil {
		return nil, fmt.Errorf("failed to close gzip writer: %w", err)
	}

	return buf.Bytes(), nil
}

// CreateRepoArchiveFromDir creates a tar.gz archive from a local directory
// This is useful for testing or when the repo is already cloned
func CreateRepoArchiveFromDir(dir string) ([]byte, error) {
	var buf bytes.Buffer
	gzw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gzw)

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Get relative path
		relPath, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}

		// Skip the root
		if relPath == "." {
			return nil
		}

		// Skip .git directory
		if strings.HasPrefix(relPath, ".git") {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		hdr.Name = relPath

		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}

		if !info.IsDir() {
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			if _, err := io.Copy(tw, f); err != nil {
				return err
			}
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to create archive: %w", err)
	}

	if err := tw.Close(); err != nil {
		return nil, fmt.Errorf("failed to close tar: %w", err)
	}
	if err := gzw.Close(); err != nil {
		return nil, fmt.Errorf("failed to close gzip: %w", err)
	}

	return buf.Bytes(), nil
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Content-Type", "application/json")
}

