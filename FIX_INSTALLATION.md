# Fix Installation Issues

## Problem

TypeScript cannot find type definitions for 'jsonwebtoken', 'next', and 'node'.

## Root Cause

1. Corrupted node_modules (Next.js installation is invalid)
2. Missing type definition packages
3. Restrictive `types` array in tsconfig.json (FIXED)

## Fixes Applied

✅ Removed restrictive `types` array from tsconfig.json
✅ Moved @types packages to devDependencies
✅ Updated Next.js config to disable Turbopack
✅ CSRF utilities are TypeScript-only (`lib/csrf*.ts`)

## Manual Fix Required

Run these commands to fix the corrupted installation:

```powershell
# 1. Close all applications using node_modules (VS Code, terminals, dev servers)

# 2. Delete corrupted node_modules
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue

# 3. Delete package-lock.json
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue

# 4. Clean npm cache
npm cache clean --force

# 5. Reinstall all dependencies
npm install

# 6. Verify installation
npm list next @types/node @types/jsonwebtoken

# 7. Test build
npm run build
```

## If Permission Errors Persist

Run PowerShell as Administrator and retry the commands above.

## Alternative: Fresh Install

If the above doesn't work:

```powershell
# Backup your .env files first!
Copy-Item .env.local .env.local.backup -ErrorAction SilentlyContinue

# Remove everything
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json

# Fresh install
npm install --legacy-peer-deps
```
