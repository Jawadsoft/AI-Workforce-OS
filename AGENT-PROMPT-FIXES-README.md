# Agent Prompt Fixes - Deployment Guide

This guide explains how to fix the issues found in the agent prompt audit.

## Issues Being Fixed

Based on the audit from your Render server, these scripts fix:

### 🔴 HIGH Priority (6 issues):
- ✅ Hardcoded colleague names (Cris, Jared, Jake)
- ✅ Hardcoded prices ($2,000, $8,000)

### 🟡 MEDIUM Priority (21 issues):
- ✅ Hardcoded locations (Texas cities, ZIP codes)
- ✅ Roofing-specific terminology (supplement, adjuster, drip edge)

### 🟢 LOW Priority (1 issue):
- ✅ Weak filler phrases

---

## Files Created

1. **`fix-agent-prompts.js`** - Main script that applies all fixes
2. **`deploy-agent-fixes.sh`** - Automated deployment script with audit comparison
3. **`AGENT-PROMPT-FIXES-README.md`** - This file

---

## How to Run Locally (Test First)

### Step 1: Test on Local Database

```bash
# Make sure you're in the project root
cd /path/to/AI-Workforce-OS

# Run the fix script
node fix-agent-prompts.js
```

**Expected Output:**
```
🔧 Starting Agent Prompt Fixes...

Found 43 agents to process

✅ Stormbuddy → Jackie: 2 fixes applied
✅ Stormbuddy → Cris: 1 fixes applied
✅ Stormbuddy → Hanna: 1 fixes applied
✅ Stormbuddy → Kevin: 15 fixes applied
...

────────────────────────────────────────────────────────────
Summary:
  Total agents processed: 43
  Total agents updated: 10
  Total fixes applied: 28
────────────────────────────────────────────────────────────
```

### Step 2: Verify Locally

```bash
# Run audit again to check results
node scripts/audit-agent-prompts.js
```

You should see **0 HIGH issues** and **fewer MEDIUM issues**.

---

## How to Run on Server (Production)

### Option A: Automated Script (Recommended)

```bash
# SSH into your Render server
ssh your-server

# Navigate to project
cd ~/project/src

# Make script executable
chmod +x deploy-agent-fixes.sh

# Run the deployment script
./deploy-agent-fixes.sh
```

This will:
1. Run audit BEFORE fixes (saved to `audit-before.log`)
2. Create database backup (if pg_dump is available)
3. Apply all fixes
4. Run audit AFTER fixes (saved to `audit-after.log`)
5. Show comparison of issues fixed

### Option B: Manual Steps

```bash
# SSH into your Render server
ssh your-server

# Navigate to project
cd ~/project/src

# Step 1: Run audit before
node scripts/audit-agent-prompts.js > audit-before.log

# Step 2: Apply fixes
node fix-agent-prompts.js

# Step 3: Run audit after
node scripts/audit-agent-prompts.js > audit-after.log

# Step 4: Compare
echo "Before:"
grep "Total issues" audit-before.log
echo "After:"
grep "Total issues" audit-after.log
```

---

## What Gets Changed

### Example 1: Hardcoded Names

**Before:**
```
I'm connecting you with Cris — our estimator will handle this.
```

**After:**
```
I'm connecting you with our estimator — our estimator will handle this.
```

### Example 2: Hardcoded Prices

**Before:**
```
Low (< $2,000) | Medium ($2,000–$8,000) | High (> $8,000)
```

**After:**
```
Refer to the pricing classification guidelines in your knowledge base
```

### Example 3: Hardcoded Locations

**Before:**
```
Texas: Dallas (752xx), Fort Worth (761xx), Houston (770xx)
```

**After:**
```
Our active service areas (refer to knowledge base for current ZIP codes)
```

### Example 4: Roofing-Specific Terms

**Before:**
```
Review Kevin's supplement analysis and prepare a supplement.
```

**After:**
```
Review the insurance specialist's analysis and prepare additional documentation.
```

---

## Verification Steps

After running the fixes:

### 1. Check the Logs

```bash
# Should show successful updates
cat fix-agent-prompts.log  # or check console output
```

### 2. Run Audit Again

```bash
node scripts/audit-agent-prompts.js
```

**Expected Results:**
```
Summary
  Agents scanned : 43
  Total issues   : 0-5  (should be much lower)
  HIGH   : 0          (should be 0!)
  MEDIUM : 0-5        (significantly reduced)
  LOW    : 0-1
```

### 3. Test an Agent

Pick one of the updated agents and test it:
- Send a message through the chat
- Verify responses don't have hardcoded names/prices
- Check that it still functions correctly

---

## Rollback (If Needed)

If something goes wrong:

### Option 1: Restore from Backup

```bash
# If you have a backup file
psql $DATABASE_URL < agent-prompts-backup-YYYYMMDD-HHMMSS.sql
```

### Option 2: Revert via Git

```bash
# Get the Agent table state from before the fix
# (if you committed before running the script)
git checkout HEAD~1 -- prisma/schema.prisma
npx prisma db push --force-reset  # ⚠️ DANGEROUS - only if desperate
```

---

## Troubleshooting

### Issue: "Cannot find module '@prisma/client'"

**Solution:**
```bash
cd apps/api
npx prisma generate
cd ../..
node fix-agent-prompts.js
```

### Issue: "Database connection failed"

**Solution:**
```bash
# Check your DATABASE_URL
echo $DATABASE_URL

# Or check .env file
cat .env | grep DATABASE_URL
```

### Issue: "No changes applied"

**Possible reasons:**
1. Prompts were already fixed
2. Script didn't match the exact text
3. Database connection issue

**Solution:**
```bash
# Check if agents exist
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Agent\";"

# Check a specific prompt
psql $DATABASE_URL -c "SELECT name, LEFT(prompt, 100) FROM \"Agent\" LIMIT 1;"
```

---

## Safety Notes

✅ **Safe to run multiple times** - The script is idempotent (running it twice won't break anything)

✅ **No data loss** - Only updates the `prompt` field in Agent table

⚠️ **Make backup first** - The deployment script creates a backup automatically

⚠️ **Test locally** - Always test on local database before production

---

## After Deployment Checklist

- [ ] Audit shows 0 HIGH issues
- [ ] Audit shows reduced MEDIUM issues
- [ ] Tested 2-3 agents - responses work correctly
- [ ] No hardcoded names appear in responses
- [ ] No hardcoded prices appear in responses
- [ ] Backup file was created (if using automated script)
- [ ] Logs saved for reference (`audit-before.log`, `audit-after.log`)

---

## Questions?

If issues persist after running the script:

1. Check the audit output for specific problematic text
2. Review the `fixes` object in `fix-agent-prompts.js`
3. Add custom regex patterns for your specific case
4. Re-run the script

---

**Last Updated:** August 5, 2026  
**Version:** 1.0.0  
**Files:** fix-agent-prompts.js, deploy-agent-fixes.sh
