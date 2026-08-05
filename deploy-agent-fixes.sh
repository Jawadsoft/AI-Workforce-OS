#!/bin/bash
set -e

echo "🚀 Deploying Agent Prompt Fixes to Server"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Run audit before fixes
echo -e "${YELLOW}📊 Step 1: Running audit BEFORE fixes...${NC}"
node scripts/audit-agent-prompts.js > audit-before.log 2>&1 || true
echo "Audit saved to: audit-before.log"
echo ""

# Step 2: Backup database (optional but recommended)
echo -e "${YELLOW}💾 Step 2: Creating database backup...${NC}"
BACKUP_FILE="agent-prompts-backup-$(date +%Y%m%d-%H%M%S).sql"
if command -v pg_dump &> /dev/null; then
    pg_dump $DATABASE_URL > $BACKUP_FILE
    echo -e "${GREEN}✅ Backup created: $BACKUP_FILE${NC}"
else
    echo -e "${YELLOW}⚠️  pg_dump not found, skipping backup${NC}"
fi
echo ""

# Step 3: Run the fix script
echo -e "${YELLOW}🔧 Step 3: Applying fixes to agent prompts...${NC}"
node fix-agent-prompts.js
echo ""

# Step 4: Run audit after fixes
echo -e "${YELLOW}📊 Step 4: Running audit AFTER fixes...${NC}"
node scripts/audit-agent-prompts.js > audit-after.log 2>&1 || true
echo "Audit saved to: audit-after.log"
echo ""

# Step 5: Compare results
echo -e "${YELLOW}📈 Step 5: Comparing results...${NC}"
BEFORE_ISSUES=$(grep "Total issues" audit-before.log | awk '{print $4}' || echo "?")
AFTER_ISSUES=$(grep "Total issues" audit-after.log | awk '{print $4}' || echo "?")

echo "Issues before: $BEFORE_ISSUES"
echo "Issues after:  $AFTER_ISSUES"
echo ""

if [ "$AFTER_ISSUES" != "?" ] && [ "$BEFORE_ISSUES" != "?" ]; then
    FIXED=$((BEFORE_ISSUES - AFTER_ISSUES))
    echo -e "${GREEN}✅ Fixed $FIXED issues!${NC}"
else
    echo -e "${YELLOW}⚠️  Could not calculate fixed issues${NC}"
fi
echo ""

# Step 6: Show remaining issues
echo -e "${YELLOW}📋 Step 6: Remaining issues:${NC}"
tail -20 audit-after.log
echo ""

echo "=========================================="
echo -e "${GREEN}✅ Agent Prompt Fixes Deployment Complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Review audit-after.log for remaining issues"
echo "2. Test a few agents to ensure they work correctly"
echo "3. Monitor production for any issues"
echo ""
echo "Backup file: $BACKUP_FILE (if created)"
echo "Before audit: audit-before.log"
echo "After audit:  audit-after.log"
