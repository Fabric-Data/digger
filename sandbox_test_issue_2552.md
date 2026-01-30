# Sandbox Test Plan for Issue #2552 Fix

## Overview
This document describes how to test the fix for issue #2552 in a sandbox environment.

## Prerequisites
- A test GitHub repository with Digger installed
- Access to the GitHub App installation
- Ability to create test PR comments
- Optional: A bot account for testing untrusted bot scenarios

## Test Setup

### 1. Environment Variables
```bash
export DIGGER_REPORT_BEFORE_LOADING_CONFIG=1  # For verbose feedback
export GITHUB_APP_ID=<your-app-id>
export GITHUB_INSTALLATION_ID=<installation-id>
```

### 2. Create Test Repository
```bash
# In a test repo, create digger.yml
cat > digger.yml << EOF
projects:
  - name: test-project
    dir: .
    
trusted_appIDs: []  # Empty to test untrusted bot behavior
EOF
```

## Test Scenarios

### Scenario 1: Untrusted Bot Comment (PRIMARY TEST)
**Purpose**: Verify that untrusted bot comments get reactions even though they're ignored

**Steps**:
1. Create a test PR in your repository
2. Use a bot account (or simulate one) to post: `digger plan`
3. Observe the comment

**Expected Behavior**:
- ✅ Comment should receive 👀 reaction immediately (within 1-2 seconds)
- ✅ No actual plan should be triggered (bot is not trusted)
- ✅ Logs should show:
  ```
  Added eyes reaction to comment commentId=<id>
  Ignoring bot comment from untrusted app
  ```

**Before Fix**:
- ❌ No reaction would be added
- ❌ User gets no feedback that Digger saw the comment

**After Fix**:
- ✅ Reaction is added immediately
- ✅ User knows Digger is working, even if ignoring the command

### Scenario 2: Normal User Comment
**Purpose**: Verify normal workflow still works

**Steps**:
1. As a normal user, comment: `digger plan`
2. Observe the reaction timing

**Expected Behavior**:
- ✅ Comment gets 👀 reaction immediately
- ✅ Then "🚧 Digger starting...." message appears
- ✅ Plan proceeds normally

**Timing Check**:
The reaction should appear BEFORE the "Digger starting" message.

### Scenario 3: Invalid Config
**Purpose**: Verify reaction is added even when config loading fails

**Steps**:
1. Temporarily corrupt digger.yml:
   ```bash
   echo "invalid: yaml: content:" > digger.yml
   git add digger.yml
   git commit -m "test: corrupt config"
   git push
   ```
2. Create a PR with this change
3. Comment: `digger plan`

**Expected Behavior**:
- ✅ Comment gets 👀 reaction
- ✅ Error message about config loading appears
- ✅ Reaction appears BEFORE error message

### Scenario 4: Draft PR with AllowDraftPRs=false
**Purpose**: Verify reaction on draft PRs that are skipped

**Steps**:
1. Update digger.yml:
   ```yaml
   allow_draft_prs: false
   ```
2. Create a DRAFT PR
3. Comment: `digger plan`

**Expected Behavior**:
- ✅ Comment gets 👀 reaction
- ✅ PR is skipped (due to draft status)
- ✅ Logs show: "AllowDraftPRs is disabled, skipping PR"
- ✅ Reaction appears before skip message

### Scenario 5: DisableDiggerApplyComment
**Purpose**: Verify reaction on disabled apply commands

**Steps**:
1. Update digger.yml:
   ```yaml
   disable_digger_apply_comment: true
   ```
2. Comment: `digger apply`

**Expected Behavior**:
- ✅ Comment gets 👀 reaction
- ✅ Apply is blocked by config
- ✅ Message: "Digger configured to disable apply comment in PRs"
- ✅ Reaction appears before block message

## Verification Commands

### Check Reaction Timing in Logs
```bash
# Filter backend logs to see reaction timing
grep -A2 "Added eyes reaction" backend.log
grep -B2 "Loading Digger config" backend.log

# The reaction log should appear BEFORE config loading
```

### Check GitHub API
```bash
# Using GitHub CLI to check reactions on a comment
gh api repos/{owner}/{repo}/issues/comments/{comment_id}/reactions

# Should see a 👀 (eyes) reaction from the Digger bot
```

## Success Criteria

✅ **Fix is working correctly if**:
1. All digger commands receive 👀 reaction within 1-2 seconds
2. Reactions appear even for:
   - Untrusted bot comments
   - Invalid configs
   - Draft PRs (when disabled)
   - Disabled commands
3. Reaction timing in logs shows it happens BEFORE config loading
4. Normal workflow continues to function correctly

❌ **Fix has issues if**:
1. Some commands don't get reactions
2. Reactions appear AFTER config loading (check logs)
3. Normal user workflows are broken
4. Performance degradation is noticeable

## Monitoring

### Key Metrics to Watch
- **Reaction Latency**: Time from comment posted to reaction added (should be <2 seconds)
- **Config Load Latency**: Should not be affected by this change
- **Error Rate**: Should not increase
- **User Satisfaction**: Users should report better feedback

### Log Analysis
```bash
# Count reactions added
grep "Added eyes reaction" backend.log | wc -l

# Count reactions that failed
grep "Failed to create comment reaction" backend.log | wc -l

# Check for any new errors
grep -i error backend.log | tail -20
```

## Rollback Plan
If issues are detected:

1. **Immediate**: Revert the commit
   ```bash
   git revert <commit-hash>
   git push origin develop
   ```

2. **Quick Fix**: Cherry-pick the revert
   ```bash
   git cherry-pick <revert-commit>
   ```

3. **Redeploy**: Deploy previous version
   ```bash
   git checkout v0.6.136  # or previous stable version
   ./deploy.sh
   ```

## Notes
- This fix is isolated to the comment reaction timing
- No changes to core Digger functionality
- Safe to deploy to production after sandbox validation
- Consider applying same fix to EE controllers (Bitbucket, GitLab) in future PR
