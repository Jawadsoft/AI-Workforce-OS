export type HelpAudience = 'all' | 'member' | 'manager' | 'admin'

export interface HelpArticleImage {
  id: string
  url: string
  caption?: string | null
}

export interface HelpArticle {
  id: string
  title: string
  category: string
  audience: HelpAudience
  summary: string
  keywords: string[]
  steps?: string[]
  tips?: string[]
  hrefs?: { label: string; href: string }[]
  /** Super-admin-attached images (e.g. annotated CRM screenshots), rendered inline. */
  images?: HelpArticleImage[]
  /** True when this article's text has been edited by a super admin, or is entirely custom. */
  isEdited?: boolean
}

/** Shape returned by GET /help/content — matches the Prisma HelpArticleOverride row. */
export interface HelpArticleOverrideData {
  articleId: string
  title?: string | null
  category?: string | null
  audience?: string | null
  summary?: string | null
  steps?: string[] | null
  tips?: string[] | null
  isCustom?: boolean
}

export const HELP_CATEGORIES = [
  'Getting Started',
  'Daily Work',
  'Quotes & Documents',
  'Admin Setup',
  'Team & Roles',
  'Troubleshooting',
] as const

export const HELP_ARTICLES: HelpArticle[] = [
  // ── Getting Started ──────────────────────────────────────────────
  {
    id: 'welcome',
    title: 'Welcome to AI Workforce OS',
    category: 'Getting Started',
    audience: 'all',
    summary: 'Your CRM with an AI workforce — chat with agents, manage tickets, generate quotes, and connect your tools.',
    keywords: ['start', 'intro', 'overview', 'welcome'],
    steps: [
      'Sign in with your email and password (or the temp password from your invite).',
      'Open Dashboard to see your AI agents at a glance.',
      'Use Chat to talk to an agent about customers, quotes, or jobs.',
      'Use this Help Guide anytime — search or browse topics on the left.',
    ],
    hrefs: [
      { label: 'Open Dashboard', href: '/dashboard' },
      { label: 'Open Chat', href: '/chat' },
    ],
  },
  {
    id: 'first-login',
    title: 'First login checklist',
    category: 'Getting Started',
    audience: 'all',
    summary: 'What to do the first time you sign in.',
    keywords: ['login', 'password', 'invite', 'first'],
    steps: [
      'Open the login link from your invite email (or go to /login).',
      'Sign in with the email the invite was sent to (not your display name).',
      'Use the temporary password from the email.',
      'Change your password after first login if prompted.',
      'Explore Chat and Tickets — those are the main day-to-day screens.',
    ],
    tips: [
      'If the invite link shows a strange hostname (like aipaccess), use http://localhost:3000/login on this machine instead.',
    ],
    hrefs: [{ label: 'Go to Login', href: '/login' }],
  },
  {
    id: 'navigation',
    title: 'Finding your way around',
    category: 'Getting Started',
    audience: 'all',
    summary: 'How the sidebar works and what each area is for.',
    keywords: ['menu', 'sidebar', 'navigation', 'pages'],
    steps: [
      'Dashboard — overview of agents and recent activity.',
      'Chat — talk to AI employees about work, quotes, and customers.',
      'Tickets / Tasks / Approvals — track work and review agent actions.',
      'Documents — download generated estimates and PDFs.',
      'Help — this guide.',
    ],
    tips: [
      'What you see in the menu depends on your role. Members see day-to-day tools; Admins also see Team, Settings, and integrations.',
    ],
  },

  // ── Daily Work ───────────────────────────────────────────────────
  {
    id: 'chat-basics',
    title: 'Using Chat with AI agents',
    category: 'Daily Work',
    audience: 'member',
    summary: 'Chat is where you work with your AI workforce — ask questions, request quotes, and upload files.',
    keywords: ['chat', 'agent', 'ask', 'conversation'],
    steps: [
      'Go to Chat and pick an agent (or continue an existing conversation).',
      'Type what you need in plain language — e.g. “Verify this builders-clean quote for Kings Cross”.',
      'Upload PDFs or drawings when the agent needs source material.',
      'Follow the agent’s questions; confirm details before asking for a formal PDF.',
      'Use action cards (documents, tickets) that appear in the chat.',
    ],
    hrefs: [{ label: 'Open Chat', href: '/chat' }],
    tips: [
      'Be specific: include client name, site address, currency, and company header if they matter.',
    ],
  },
  {
    id: 'tickets',
    title: 'Working with Tickets',
    category: 'Daily Work',
    audience: 'member',
    summary: 'Tickets track customer work across your team and AI agents.',
    keywords: ['ticket', 'pipeline', 'status', 'customer'],
    steps: [
      'Open Tickets to see open, in-progress, and completed work.',
      'Select a ticket to view details, notes, and related messages.',
      'Update status as work moves forward.',
      'Ask an agent in Chat to create or update a ticket when needed.',
    ],
    hrefs: [{ label: 'Open Tickets', href: '/tickets' }],
  },
  {
    id: 'tasks-approvals',
    title: 'Tasks and Approvals',
    category: 'Daily Work',
    audience: 'member',
    summary: 'Agents create tasks and may need your approval before taking sensitive actions.',
    keywords: ['task', 'approval', 'approve', 'reject'],
    steps: [
      'Open Tasks to see items assigned to you or your agents.',
      'Open Approvals when an agent needs a yes/no before sending email, posting, or similar.',
      'Approve or reject with a short note when useful.',
    ],
    hrefs: [
      { label: 'Open Tasks', href: '/tasks' },
      { label: 'Open Approvals', href: '/approvals' },
    ],
  },
  {
    id: 'documents-view',
    title: 'Finding generated documents',
    category: 'Daily Work',
    audience: 'member',
    summary: 'Estimates and PDFs created in Chat also appear under Documents.',
    keywords: ['document', 'pdf', 'download', 'estimate'],
    steps: [
      'Go to Documents to see all generated files.',
      'Download a PDF from the list, or use the Download button on the chat card.',
      'Delete outdated drafts if your role allows.',
    ],
    hrefs: [{ label: 'Open Documents', href: '/documents' }],
  },

  // ── Quotes & Documents ───────────────────────────────────────────
  {
    id: 'quote-flow',
    title: 'How to create a quotation (best practice)',
    category: 'Quotes & Documents',
    audience: 'member',
    summary: 'Discuss and confirm details in chat first — generate the PDF only when everything is final.',
    keywords: ['quote', 'quotation', 'estimate', 'generate', 'pdf', 'builders clean'],
    steps: [
      'Paste or describe the job in Chat (site, rooms, pricing, inclusions).',
      'Ask the agent to verify numbers and show a full draft summary.',
      'Customize in chat: currency (e.g. GBP), header company name, phone, website, client name/email, property address.',
      'When the draft looks right, say clearly: “generate the formal quotation PDF”.',
      'Review the PDF, then ask to email it with attachment if needed.',
    ],
    tips: [
      'Do not expect a new PDF on every small tweak — confirm changes in chat, then ask to generate once.',
      'If regenerating, restate must-have fields or ask the agent to “show complete details” first.',
    ],
    hrefs: [{ label: 'Open Chat', href: '/chat' }],
  },
  {
    id: 'quote-currency-header',
    title: 'Currency and company header on quotes',
    category: 'Quotes & Documents',
    audience: 'member',
    summary: 'How to get £ / GBP and the correct letterhead company on a quote.',
    keywords: ['currency', 'gbp', 'pounds', 'header', 'company name', 'letterhead'],
    steps: [
      'In Chat, say e.g. “use pound sterling / currency: GBP”.',
      'For letterhead: “company name: Guardian FM Ltd”.',
      'Ask to show the full draft before generating.',
      'Only then: “go ahead and generate the PDF”.',
    ],
    tips: [
      'Phone and website on the letterhead may still come from company Brain settings unless you confirm them in the draft.',
    ],
  },
  {
    id: 'email-document',
    title: 'Email a quotation with attachment',
    category: 'Quotes & Documents',
    audience: 'member',
    summary: 'Send the latest generated PDF to a customer or colleague.',
    keywords: ['email', 'attach', 'attachment', 'send document'],
    steps: [
      'Generate the PDF first so a document card appears in Chat.',
      'Say: “email this document to name@company.com”.',
      'Confirm the agent reports the email was sent with the attachment.',
      'If needed: “resend this email with attachment”.',
    ],
    tips: [
      'Outbound email needs SMTP configured by an Admin under Settings.',
    ],
  },

  // ── Admin Setup ──────────────────────────────────────────────────
  {
    id: 'onboarding-admin',
    title: 'Initial setup (Admin)',
    category: 'Admin Setup',
    audience: 'admin',
    summary: 'Connect your business context so agents answer with your services and brand.',
    keywords: ['onboarding', 'setup', 'industry', 'brain'],
    steps: [
      'Complete onboarding: industry, CRM, services, locations.',
      'Review AI Workforce — activate the agents you need.',
      'Open an agent → Brain / Knowledge — add company info and pricing signals.',
      'Connect CRM under CRM if you use StormBuddi, HubSpot, etc.',
      'Configure SMTP under Settings so invites and customer emails send.',
    ],
    hrefs: [
      { label: 'AI Workforce', href: '/agents' },
      { label: 'CRM', href: '/crm' },
      { label: 'Settings', href: '/settings' },
    ],
  },
  {
    id: 'connect-crm',
    title: 'Connect your CRM',
    category: 'Admin Setup',
    audience: 'manager',
    summary: 'Link StormBuddi, HubSpot, Salesforce, Zoho, or another CRM so agents can use live customer data.',
    keywords: ['crm', 'hubspot', 'stormbuddi', 'salesforce', 'connect'],
    steps: [
      'Go to CRM and choose your provider.',
      'Follow the setup guide for API keys / OAuth.',
      'Test the connection.',
      'Open each agent → CRM Access — grant the tools that agent needs.',
    ],
    hrefs: [{ label: 'Open CRM', href: '/crm' }],
  },
  {
    id: 'configure-agents',
    title: 'Configure AI agents',
    category: 'Admin Setup',
    audience: 'manager',
    summary: 'Tune prompts, tools, voice, and CRM permissions per agent.',
    keywords: ['agent', 'prompt', 'tools', 'workforce'],
    steps: [
      'Go to AI Workforce and open an agent.',
      'Edit name, role, and system prompt to match your business.',
      'Enable tools (documents, email, CRM, scheduling) carefully.',
      'Set CRM Access permissions for that agent.',
      'Activate the agent when ready.',
    ],
    hrefs: [{ label: 'AI Workforce', href: '/agents' }],
  },
  {
    id: 'smtp-email',
    title: 'Email / SMTP setup',
    category: 'Admin Setup',
    audience: 'admin',
    summary: 'Required for team invites, password resets, and agent emails to customers.',
    keywords: ['smtp', 'email', 'invite', 'mail'],
    steps: [
      'Go to Settings → Email / SMTP.',
      'Enter host, port, user, password, and from name/address.',
      'Send a test email.',
      'Invite a teammate to confirm invite emails arrive.',
    ],
    hrefs: [{ label: 'Open Settings', href: '/settings' }],
  },
  {
    id: 'social-facebook',
    title: 'Connect Facebook / Instagram',
    category: 'Admin Setup',
    audience: 'manager',
    summary: 'Social posting and Instagram linking go through your Meta app.',
    keywords: ['facebook', 'instagram', 'social', 'oauth', 'meta'],
    steps: [
      'Go to Social Media → Connections.',
      'In Meta Developer settings, whitelist your OAuth redirect URL.',
      'Connect Facebook; Instagram Business accounts link via the Facebook Page.',
      'Approve required permissions when Meta prompts you.',
    ],
    tips: [
      'Local redirect is typically http://localhost:3001/api/v1/social/oauth/facebook/callback',
    ],
    hrefs: [{ label: 'Social Media', href: '/social' }],
  },

  // ── Team & Roles ─────────────────────────────────────────────────
  {
    id: 'invite-team',
    title: 'Invite a team member',
    category: 'Team & Roles',
    audience: 'admin',
    summary: 'Add colleagues and choose how much access they get.',
    keywords: ['invite', 'team', 'member', 'add user'],
    steps: [
      'Go to Team → Invite Member.',
      'Enter full name and a unique email (not already registered).',
      'Pick a role: Admin, Manager, Member, or Viewer.',
      'Share the temp password from the success screen (and the invite email).',
      'They sign in at the login URL and should change their password.',
    ],
    hrefs: [{ label: 'Open Team', href: '/team' }],
  },
  {
    id: 'roles-explained',
    title: 'Roles explained',
    category: 'Team & Roles',
    audience: 'all',
    summary: 'What each role can and cannot do.',
    keywords: ['role', 'permission', 'access', 'member', 'viewer', 'admin'],
    steps: [
      'Owner / Admin — full access including Team, Settings, and Webhooks.',
      'Manager — agents, CRM, social, emails; cannot change Team or Settings.',
      'Member — Chat, Tickets, Tasks, Approvals, Documents, Knowledge; no config screens.',
      'Viewer — read-only Dashboard, Documents, Analytics.',
    ],
    tips: [
      'Change a person’s role anytime from the Team list dropdown (except Owner).',
    ],
    hrefs: [{ label: 'Open Team', href: '/team' }],
  },

  // ── Troubleshooting ──────────────────────────────────────────────
  {
    id: 'member-missing-menus',
    title: 'I can’t see Team / Settings / Agents',
    category: 'Troubleshooting',
    audience: 'all',
    summary: 'Menus are hidden on purpose based on your role.',
    keywords: ['missing', 'menu', 'access', 'restricted', 'member'],
    steps: [
      'Check your role with an Admin (shown on Team for your user).',
      'Members and Viewers cannot open Team, Settings, Webhooks, or agent configuration.',
      'Ask an Admin to promote you to Manager or Admin if you need those tools.',
    ],
  },
  {
    id: 'invite-email-wrong',
    title: 'Invite email looks wrong',
    category: 'Troubleshooting',
    audience: 'admin',
    summary: 'Login email field or link in the invite message is incorrect.',
    keywords: ['invite', 'email', 'temp password', 'aipaccess'],
    steps: [
      'Login email in the message should be the address you invited — not the person’s name.',
      'If the link uses a LAN hostname, open http://localhost:3000/login (or your PUBLIC_APP_URL).',
      'Sign in with the invited email + temp password from the email.',
      'Re-invite after fixing SMTP / PUBLIC_APP_URL if needed.',
    ],
  },
  {
    id: 'pdf-html',
    title: 'Document downloaded as HTML not PDF',
    category: 'Troubleshooting',
    audience: 'admin',
    summary: 'PDF rendering needs Chromium for Puppeteer on the API server.',
    keywords: ['pdf', 'html', 'puppeteer', 'document failed'],
    steps: [
      'On the API machine, run: npx puppeteer browsers install chrome (inside apps/api).',
      'Restart the API server.',
      'Generate the document again.',
    ],
  },
  {
    id: 'quote-forgets-details',
    title: 'Agent forgot quote details when regenerating',
    category: 'Troubleshooting',
    audience: 'member',
    summary: 'Long chats can drop older context — keep a confirmed draft before generating.',
    keywords: ['forgot', 'context', 'regenerate', 'missing details'],
    steps: [
      'Ask: “show me the complete quotation details” and verify header, client, address, line items.',
      'Then say “generate the formal PDF” in the same turn or right after.',
      'For a new site, start a fresh Chat conversation to avoid mixing jobs.',
    ],
  },
  {
    id: 'email-no-attachment',
    title: 'Email sent but no PDF attached',
    category: 'Troubleshooting',
    audience: 'member',
    summary: 'Make sure a document was generated first, then ask to email “this document”.',
    keywords: ['attachment', 'no attachment', 'email failed'],
    steps: [
      'Confirm a Download PDF card exists in the conversation.',
      'Say: “email this document to …@… with attachment”.',
      'If it still fails, ask Admin to verify SMTP and that the document file is available.',
    ],
  },
]

/** Map app role → help audience visibility */
export function canSeeArticle(userRole: string | null | undefined, article: HelpArticle): boolean {
  const rank = ({ VIEWER: 1, USER: 2, MANAGER: 3, TENANT_ADMIN: 4, TENANT_OWNER: 5, SUPER_ADMIN: 6 } as Record<string, number>)[userRole ?? ''] ?? 0
  if (article.audience === 'all') return true
  if (article.audience === 'member') return rank >= 1
  if (article.audience === 'manager') return rank >= 3
  if (article.audience === 'admin') return rank >= 4
  return true
}

export interface QuickNavLink {
  label: string
  href: string
  keywords: string[]
  minRole: string
}

/** Pages people commonly jump to from the header quick-search. */
export const QUICK_NAV_LINKS: QuickNavLink[] = [
  { label: 'Dashboard', href: '/dashboard', keywords: ['dashboard', 'home', 'overview'], minRole: 'VIEWER' },
  { label: 'AI Workforce (Agents)', href: '/agents', keywords: ['agent', 'agents', 'ai workforce', 'author', 'bot'], minRole: 'MANAGER' },
  { label: 'Chat', href: '/chat', keywords: ['chat', 'message', 'conversation', 'talk'], minRole: 'USER' },
  { label: 'Tickets', href: '/tickets', keywords: ['ticket', 'pipeline'], minRole: 'USER' },
  { label: 'Tasks', href: '/tasks', keywords: ['task', 'todo'], minRole: 'USER' },
  { label: 'Approvals', href: '/approvals', keywords: ['approval', 'approve'], minRole: 'USER' },
  { label: 'Email Review', href: '/emails', keywords: ['email', 'email integration', 'inbox', 'mail'], minRole: 'MANAGER' },
  { label: 'Knowledge Base', href: '/knowledge', keywords: ['knowledge', 'docs', 'brain'], minRole: 'USER' },
  { label: 'Documents', href: '/documents', keywords: ['document', 'pdf', 'quote', 'estimate'], minRole: 'VIEWER' },
  { label: 'Social Media', href: '/social', keywords: ['social media', 'social', 'facebook', 'instagram', 'linkedin', 'twitter', 'post'], minRole: 'MANAGER' },
  { label: 'CRM', href: '/crm', keywords: ['crm', 'hubspot', 'stormbuddi', 'salesforce', 'zoho'], minRole: 'MANAGER' },
  { label: 'Communications', href: '/communications', keywords: ['communication', 'email integration', 'sms', 'call', 'phone'], minRole: 'MANAGER' },
  { label: 'Webhooks', href: '/webhooks', keywords: ['webhook', 'integration'], minRole: 'TENANT_ADMIN' },
  { label: 'Team', href: '/team', keywords: ['team', 'invite', 'member', 'user'], minRole: 'TENANT_ADMIN' },
  { label: 'Analytics', href: '/analytics', keywords: ['analytics', 'report', 'stats'], minRole: 'VIEWER' },
  { label: 'Settings', href: '/settings', keywords: ['settings', 'smtp', 'config'], minRole: 'TENANT_ADMIN' },
]

/**
 * Layers super-admin overrides + attached images (from GET /help/content) on
 * top of the static HELP_ARTICLES. Overrides only replace fields that were
 * actually set (empty/undefined falls back to the static default), so a
 * super admin can e.g. add images to an article without touching its text.
 * Overrides with isCustom=true and no static counterpart become brand new
 * articles, inserted into whichever category they were given.
 */
export function mergeHelpArticles(
  overrides: Record<string, HelpArticleOverrideData> = {},
  images: Record<string, HelpArticleImage[]> = {},
): HelpArticle[] {
  const merged: HelpArticle[] = HELP_ARTICLES.map((article) => {
    const o = overrides[article.id]
    const imgs = images[article.id]
    if (!o && !imgs) return article
    return {
      ...article,
      title: o?.title || article.title,
      category: o?.category || article.category,
      audience: (o?.audience as HelpAudience) || article.audience,
      summary: o?.summary || article.summary,
      steps: o?.steps && o.steps.length > 0 ? o.steps : article.steps,
      tips: o?.tips && o.tips.length > 0 ? o.tips : article.tips,
      images: imgs,
      isEdited: !!o,
    }
  })

  const staticIds = new Set(HELP_ARTICLES.map((a) => a.id))
  for (const [articleId, o] of Object.entries(overrides)) {
    if (staticIds.has(articleId) || !o.isCustom) continue
    merged.push({
      id: articleId,
      title: o.title || 'Untitled article',
      category: o.category || 'Getting Started',
      audience: (o.audience as HelpAudience) || 'all',
      summary: o.summary || '',
      keywords: [],
      steps: o.steps ?? undefined,
      tips: o.tips ?? undefined,
      images: images[articleId],
      isEdited: true,
    })
  }

  return merged
}

export function searchArticles(query: string, articles: HelpArticle[]): HelpArticle[] {
  const q = query.trim().toLowerCase()
  if (!q) return articles
  return articles.filter((a) => {
    const hay = [a.title, a.summary, a.category, ...a.keywords, ...(a.steps ?? []), ...(a.tips ?? [])]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}
