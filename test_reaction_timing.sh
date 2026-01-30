#!/bin/bash
# Test script to verify reaction timing for issue #2552 fix
# This script helps verify that reactions are added before config loading

set -e

echo "=== Issue #2552 Fix Verification Script ==="
echo ""
echo "This script analyzes the timing of comment reactions"
echo "to verify the fix is working correctly."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if reaction happens before config load
check_timing() {
    local log_file=$1
    
    echo "Checking log file: $log_file"
    echo ""
    
    # Extract relevant log lines with timestamps
    reaction_logs=$(grep -n "Added eyes reaction to comment" "$log_file" 2>/dev/null || echo "")
    config_logs=$(grep -n "Loading Digger config for PR" "$log_file" 2>/dev/null || echo "")
    
    if [ -z "$reaction_logs" ]; then
        echo -e "${YELLOW}⚠️  No reaction logs found${NC}"
        echo "This might mean no comments were processed during the log period."
        return 1
    fi
    
    if [ -z "$config_logs" ]; then
        echo -e "${YELLOW}⚠️  No config loading logs found${NC}"
        return 1
    fi
    
    # Compare line numbers
    reaction_line=$(echo "$reaction_logs" | head -1 | cut -d: -f1)
    config_line=$(echo "$config_logs" | head -1 | cut -d: -f1)
    
    echo "First reaction log at line: $reaction_line"
    echo "First config load log at line: $config_line"
    echo ""
    
    if [ "$reaction_line" -lt "$config_line" ]; then
        echo -e "${GREEN}✅ SUCCESS: Reaction happens BEFORE config loading${NC}"
        echo "   This confirms the fix is working correctly."
        return 0
    else
        echo -e "${RED}❌ FAIL: Reaction happens AFTER config loading${NC}"
        echo "   The fix may not be applied correctly."
        return 1
    fi
}

# Function to analyze reaction statistics
analyze_reactions() {
    local log_file=$1
    
    echo ""
    echo "=== Reaction Statistics ==="
    
    total_reactions=$(grep -c "Added eyes reaction to comment" "$log_file" 2>/dev/null || echo "0")
    failed_reactions=$(grep -c "Failed to create comment reaction" "$log_file" 2>/dev/null || echo "0")
    bot_ignored=$(grep -c "Ignoring bot comment from untrusted app" "$log_file" 2>/dev/null || echo "0")
    
    echo "Total reactions added: $total_reactions"
    echo "Failed reactions: $failed_reactions"
    echo "Untrusted bots ignored (but acknowledged): $bot_ignored"
    
    if [ "$total_reactions" -gt 0 ]; then
        success_rate=$(awk "BEGIN {printf \"%.1f\", ($total_reactions - $failed_reactions) * 100 / $total_reactions}")
        echo "Success rate: ${success_rate}%"
    fi
    
    echo ""
    
    # Check if bots are getting reactions
    if [ "$bot_ignored" -gt 0 ]; then
        echo -e "${GREEN}✅ Bot comments are being acknowledged with reactions${NC}"
        echo "   (This is the key improvement from issue #2552)"
    fi
}

# Function to show sample log entries
show_samples() {
    local log_file=$1
    
    echo ""
    echo "=== Sample Log Entries ==="
    echo ""
    
    echo "Example of reaction being added:"
    grep -A1 "Added eyes reaction to comment" "$log_file" 2>/dev/null | head -6 || echo "No samples found"
    
    echo ""
    echo "Example of bot being ignored (after reaction):"
    grep -B2 "Ignoring bot comment from untrusted app" "$log_file" 2>/dev/null | head -6 || echo "No samples found"
}

# Main execution
main() {
    if [ $# -eq 0 ]; then
        echo "Usage: $0 <log-file>"
        echo ""
        echo "Example:"
        echo "  $0 backend.log"
        echo "  $0 /var/log/digger/backend.log"
        echo ""
        echo "Or pipe logs directly:"
        echo "  docker logs digger-backend 2>&1 | grep -E 'reaction|config' > /tmp/digger.log"
        echo "  $0 /tmp/digger.log"
        exit 1
    fi
    
    log_file=$1
    
    if [ ! -f "$log_file" ]; then
        echo -e "${RED}Error: Log file not found: $log_file${NC}"
        exit 1
    fi
    
    echo "Analyzing: $log_file"
    echo "Size: $(du -h "$log_file" | cut -f1)"
    echo "Lines: $(wc -l < "$log_file")"
    echo ""
    
    check_timing "$log_file"
    timing_result=$?
    
    analyze_reactions "$log_file"
    show_samples "$log_file"
    
    echo ""
    echo "=== Summary ==="
    if [ $timing_result -eq 0 ]; then
        echo -e "${GREEN}✅ Issue #2552 fix is working correctly!${NC}"
        echo "   Reactions are added immediately, providing instant user feedback."
    else
        echo -e "${RED}❌ Issue #2552 fix may not be working as expected${NC}"
        echo "   Please review the logs and verify the deployment."
    fi
}

# Run main function
main "$@"
