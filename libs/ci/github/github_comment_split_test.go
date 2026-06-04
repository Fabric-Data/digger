package github

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSplitCommentBody_UnderLimitReturnedAsIs(t *testing.T) {
	body := "short plan output\nwith a couple lines"
	chunks := splitCommentBody(body, 60000)
	assert.Equal(t, []string{body}, chunks)
}

func TestSplitCommentBody_AtLimitNotSplit(t *testing.T) {
	body := strings.Repeat("a", 100)
	chunks := splitCommentBody(body, 100)
	assert.Len(t, chunks, 1)
	assert.Equal(t, body, chunks[0])
}

func TestSplitCommentBody_SplitsAndEveryChunkWithinBudget(t *testing.T) {
	// 5000 lines of 50 chars (~250k) forces multiple chunks.
	var sb strings.Builder
	for i := 0; i < 5000; i++ {
		sb.WriteString(strings.Repeat("x", 50))
		sb.WriteString("\n")
	}
	const budget = 60000
	chunks := splitCommentBody(sb.String(), budget)

	assert.Greater(t, len(chunks), 1, "expected the body to be split")
	for i, c := range chunks {
		assert.LessOrEqualf(t, len(c), budget+4, "chunk %d exceeded budget (+fence slack)", i)
	}
}

func TestSplitCommentBody_BreaksOnLineBoundaries(t *testing.T) {
	var sb strings.Builder
	for i := 0; i < 4000; i++ {
		sb.WriteString("0123456789012345678901234")
		sb.WriteString("\n")
	}
	chunks := splitCommentBody(sb.String(), 60000)
	// No chunk should start or end mid-line: each line is 25 chars, so every
	// line in every chunk must be exactly 25 chars (ignoring a reopened fence,
	// of which there are none here).
	for _, c := range chunks {
		for _, line := range strings.Split(c, "\n") {
			if line == "" {
				continue
			}
			assert.Len(t, line, 25)
		}
	}
}

func TestSplitCommentBody_ReopensCodeFenceAcrossChunks(t *testing.T) {
	var sb strings.Builder
	sb.WriteString("```diff\n")
	for i := 0; i < 5000; i++ {
		sb.WriteString("+ added a line of terraform plan diff output here\n")
	}
	sb.WriteString("```\n")

	chunks := splitCommentBody(sb.String(), 60000)
	assert.Greater(t, len(chunks), 1)

	for i, c := range chunks {
		// Even number of fence markers ⇒ balanced (each chunk opens & closes).
		count := strings.Count(c, "```")
		assert.Equalf(t, 0, count%2, "chunk %d has unbalanced code fences: %d markers", i, count)
		// Every chunk that contains diff content should itself open with a fence.
		if strings.Contains(c, "+ added a line") {
			assert.Truef(t, strings.HasPrefix(c, "```diff"), "chunk %d does not reopen the diff fence", i)
		}
	}
}
