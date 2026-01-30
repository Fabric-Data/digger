# Fix for Issue #2552: Early Comment Reaction Acknowledgment

## Problem
Previously, Digger only added a reaction (👀) to comments AFTER:
1. Loading the digger config
2. Checking if the comment was from a bot
3. Checking other configuration options

This meant that if a comment was from an untrusted bot or if other checks caused early returns, no reaction was added. Users wouldn't get immediate feedback that Digger had seen their command.

## Solution
Move the `CreateCommentReaction` call to happen immediately after:
1. Verifying the comment is on a pull request
2. Verifying the comment action is "created"
3. Verifying the comment starts with "digger"
4. Getting the GitHub/Bitbucket/GitLab service

This ensures users get immediate visual feedback (👀 reaction) that Digger has acknowledged their command, even if the command is later ignored due to:
- Being from an untrusted bot
- Configuration restrictions (e.g., DisableDiggerApplyComment)
- AllowDraftPRs settings
- Other validation failures

## Code Changes

### Community Edition (CE)
**File: `backend/controllers/github_comment.go`**
- Moved the reaction code block from line 224 to line 138
- Now placed right after GitHub service is obtained and before any config loading or validation checks

### Enterprise Edition (EE)
Similar changes should be applied to:
- **`ee/backend/controllers/bitbucket.go`** (line 187 → move to after line 178)
- **`ee/backend/controllers/gitlab.go`** (line 370 → move to after line 367 for comment event handler)
- **`ee/backend/hooks/github.go`** (line 81 → move to after line 76 for drift reconciliation)

Note: EE controllers follow the same pattern and would benefit from the same fix.

## Benefits
1. **Immediate feedback**: Users see the reaction within seconds of posting their comment
2. **Better UX**: Even ignored commands are acknowledged, reducing confusion
3. **Debugging**: Makes it easier to see that Digger is running and processing comments
4. **Transparency**: Shows that the comment was received, even if not acted upon
5. **Consistency**: Aligns with PR #2554's approach to trusted bot handling

## Testing Scenarios

### Test 1: Untrusted Bot Comment
1. Set up a test PR with digger.yml configured
2. Post a "digger plan" comment from an untrusted bot account (not in trusted_appIDs list)
3. **Expected**: Comment should get 👀 reaction immediately, but no action should be taken
4. **Verify**: Check logs confirm bot was detected and ignored after reaction was added

### Test 2: Normal User Comment
1. Post a "digger plan" comment from a normal user account
2. **Expected**: Comment should get 👀 reaction immediately, and Digger should proceed with plan
3. **Verify**: Reaction appears before "Digger starting...." message

### Test 3: Draft PR with AllowDraftPRs=false
1. Create a draft PR
2. Post a "digger plan" comment
3. **Expected**: Comment should get 👀 reaction, then Digger should skip due to draft PR policy
4. **Verify**: Reaction appears even though action is skipped

### Test 4: DisableDiggerApplyComment Setting
1. Set `disable_digger_apply_comment: true` in digger.yml
2. Post a "digger apply" comment
3. **Expected**: Comment should get 👀 reaction, but apply should be blocked
4. **Verify**: User sees acknowledgment before seeing the "disabled" message

### Test 5: Invalid/Missing Config
1. Remove or corrupt digger.yml
2. Post a "digger plan" comment
3. **Expected**: Comment gets 👀 reaction before config error is reported
4. **Verify**: Reaction is added before error message appears

## Sandbox Testing
To test this fix in a local sandbox:

```bash
# 1. Build the backend with changes
cd backend
go build -o digger-backend

# 2. Set up test environment with:
#    - A test GitHub App installation
#    - A test repository with digger.yml
#    - DIGGER_REPORT_BEFORE_LOADING_CONFIG=1 for verbose feedback

# 3. Post test comments and verify reactions appear immediately

# 4. Check logs to confirm reaction happens before config loading:
#    - Look for "Added eyes reaction to comment" log entry
#    - Verify it appears before "Loading Digger config for PR" entry
```

## Related Issues
- **Issue #2553**: Allow trusted bot comments via trusted_appIDs (fixed in PR #2554)
- **Issue #2552**: This fix ensures that even untrusted bot comments get acknowledgment, while still being properly ignored as per security policy

## Rollback Plan
If this causes issues, the change can be easily reverted by moving the reaction code block back to its original position after config loading.

## Performance Impact
**Minimal to None**: The reaction API call is non-blocking and happens at the same frequency as before, just earlier in the flow. The actual API call latency is unchanged.
