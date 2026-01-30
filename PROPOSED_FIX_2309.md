# Proposed fix for diggerhq/digger#2309

Unable to access the issue body from this environment (requires GitHub auth), so this proposal is based on the most likely failing path around GitHub Actions context parsing.

## Hypothesis
The CLI parses the GitHub Actions context JSON into `cli/pkg/github/models.GithubAction`. The `UnmarshalJSON` method hard-fails with `unknown GitHub event: <event_name>` for any event name not explicitly listed.

As GitHub adds/changes event payloads (or if a workflow runs on an event not covered, e.g. `pull_request_target`, `workflow_call`, `repository_dispatch`, `check_suite`, etc.), Digger fails early even if the event payload isn’t required for the requested operation.

## Fix proposal
1. **Make `GithubAction.UnmarshalJSON` forward-compatible**:
   - Keep current strong-typing for known events.
   - For unknown events, **do not return an error**; store the raw JSON (or decode into `map[string]any`) so the rest of Digger can proceed.

2. **Optionally log a warning** (where logging is available) indicating an unknown event type was encountered.

## Suggested code change
In `cli/pkg/github/models/models.go`:

- Replace:

```go
default:
    return errors.New("unknown GitHub event: " + g.EventName)
```

- With something tolerant:

```go
default:
    // Forward compatible: keep raw payload so other code can still use
    // common top-level fields (repository, actor, etc.) even when the
    // event is not explicitly supported.
    var event map[string]any
    if err := json.Unmarshal(rawEvent, &event); err != nil {
        // If even generic unmarshal fails, return the error.
        return err
    }
    g.Event = event
```

Also remove the unused `errors` import.

## Why this helps
- Avoids breaking Digger when a workflow is triggered by a newer/less common GitHub event.
- Keeps backward compatibility for existing supported events.
- Provides a safe fallback for cases where only top-level GitHub context fields are needed.

## Follow-up
If the issue specifically involves a particular event (e.g. `pull_request_target`), we can also add an explicit case mapping it to `github.PullRequestEvent`.
