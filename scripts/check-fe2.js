const fs = require('fs');
const path = require('path');

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; }
}

// List all hooks
console.log('=== HOOKS ===');
try {
  const hooks = fs.readdirSync('apps/web/hooks');
  console.log(hooks.join('\n'));
} catch { console.log('hooks dir not found'); }

// List all providers
console.log('\n=== PROVIDERS ===');
try {
  const providers = fs.readdirSync('apps/web/providers');
  console.log(providers.join('\n'));
} catch { console.log('providers dir not found'); }

// List all components
console.log('\n=== COMPONENT DIRS ===');
try {
  const comps = fs.readdirSync('apps/web/components');
  console.log(comps.join('\n'));
} catch { console.log('components dir not found'); }

// Check settings tabs for available tab labels
const stabs = readSafe('apps/web/components/settings/settings-tabs.tsx');
// Find section/tab names
const tabLabels = [...stabs.matchAll(/label:\s*["']([^'"]+)["']/g)].map(m => m[1]);
const tabValues = [...stabs.matchAll(/value:\s*["']([^'"]+)["']/g)].map(m => m[1]);
console.log('\n=== SETTINGS TAB LABELS ===', tabLabels.join(', '));
console.log('=== SETTINGS TAB VALUES ===', tabValues.join(', '));

// Check auth store for what's stored  
const authStore = readSafe('apps/web/stores/auth.store.ts');
console.log('\n=== AUTH STORE ===');
console.log('length:', authStore.length);
const storeFields = [...authStore.matchAll(/(\w+)\s*:/g)].map(m => m[1]).filter(f => f.length > 2);
console.log('Fields:', [...new Set(storeFields)].slice(0, 30).join(', '));

// Check for role-based access control in components
const layoutDash = readSafe('apps/web/app/(dashboard)/layout.tsx');
console.log('\n=== DASHBOARD LAYOUT ===');
console.log(layoutDash.substring(0, 1000));

// Check if social page has a dedicated calendar section
const socialContent = readSafe('apps/web/components/social/social-page.tsx');
const calSection = socialContent.indexOf('calendar');
if (calSection >= 0) {
  console.log('\n=== SOCIAL CALENDAR CONTEXT ===');
  console.log(socialContent.substring(Math.max(0, calSection - 200), calSection + 400));
}

// Check chat for conversationId handling
const chatContent = readSafe('apps/web/components/chat/chat-page.tsx');
const convIdx = chatContent.toLowerCase().indexOf('conversationid');
if (convIdx >= 0) {
  console.log('\n=== CHAT CONVERSATIONID CONTEXT ===');
  console.log(chatContent.substring(Math.max(0, convIdx - 100), convIdx + 300));
}
