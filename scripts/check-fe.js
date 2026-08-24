const fs = require('fs');
const path = require('path');

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

// Settings tabs
const stabs = readSafe('apps/web/components/settings/settings-tabs.tsx');
console.log('=== SETTINGS TABS ===');
console.log('Length:', stabs.length);
console.log('Has email tab:', stabs.toLowerCase().includes('email'));
console.log('Has password:', stabs.toLowerCase().includes('password'));
const tabMatches = [...stabs.matchAll(/value=["']([^'"]+)["']/g)].map(m => m[1]);
console.log('Tab values:', tabMatches.join(', '));

// Social page component
const socialPage = readSafe('apps/web/components/social/social-page.tsx');
console.log('\n=== SOCIAL PAGE ===');
console.log('Length:', socialPage.length);
console.log('Has calendar:', socialPage.toLowerCase().includes('calendar'));
const socialTabs = [...socialPage.matchAll(/value=["']([^'"]+)["']/g)].map(m => m[1]);
console.log('Social tabs:', socialTabs.join(', '));

// Chat page component
const chatPage = readSafe('apps/web/components/chat/chat-page.tsx');
console.log('\n=== CHAT PAGE ===');
console.log('Length:', chatPage.length);
console.log('Has conversationId:', chatPage.toLowerCase().includes('conversationid'));

// Check all stores 
const storeFiles = fs.readdirSync('apps/web/stores').filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
console.log('\n=== STORES ===', storeFiles.join(', '));

// Check if there's a useFeatureFlag hook
const hooks = readSafe('apps/web/hooks/use-feature-flags.ts') || readSafe('apps/web/hooks/use-feature-flag.ts');
console.log('\n=== FEATURE FLAGS HOOK ===');
console.log('Length:', hooks.length);
console.log(hooks.substring(0, 500));

// Check middleware for reset-password route
const mw = readSafe('apps/web/middleware.ts');
console.log('\n=== MIDDLEWARE PUBLIC ROUTES ===');
const pr = [...mw.matchAll(/PUBLIC_ROUTES\s*=\s*\[([^\]]+)\]/g)].map(m => m[1]);
console.log(pr.join(''));

// Check if reset-password is in middleware
console.log('reset-password in public routes:', mw.includes('reset-password'));
