export interface CRMSetupStep {
  title: string
  instructions: string
  url?: string
  code?: string
}

export interface CRMSetupGuide {
  name: string
  logoColor: string
  description: string
  steps: CRMSetupStep[]
  requiredScopes?: string[]
  requiredEndpoints?: string[]
  webhookEndpoints?: { event: string; path: string; description: string }[]
  apiDocsUrl?: string
  estimatedSetupMinutes: number
}

export const CRM_SETUP_GUIDES: Record<string, CRMSetupGuide> = {
  HUBSPOT: {
    name: 'HubSpot',
    logoColor: '#FF7A59',
    description: 'Connect via a HubSpot Private App token for secure CRM access.',
    estimatedSetupMinutes: 5,
    apiDocsUrl: 'https://developers.hubspot.com/docs/api/private-apps',
    steps: [
      {
        title: 'Open your HubSpot account',
        url: 'https://app.hubspot.com/private-apps',
        instructions: 'Go to Settings (gear icon) → Integrations → Private Apps → click "Create a private app".',
      },
      {
        title: 'Set the app name & description',
        instructions: 'Name it "AI Workforce OS" so you can identify it later.',
      },
      {
        title: 'Enable required scopes (Scopes tab)',
        instructions: 'Under the Scopes tab, enable the following permissions:',
        code: [
          'crm.objects.contacts.read',
          'crm.objects.contacts.write',
          'crm.objects.deals.read',
          'crm.objects.deals.write',
          'crm.objects.notes.write',
          'crm.objects.tasks.write',
          'timeline.events.write',
        ].join('\n'),
      },
      {
        title: 'Create & copy the Access Token',
        instructions: 'Click "Create app" → confirm → copy the token that starts with pat-na1-... or pat-eu1-...',
      },
      {
        title: 'Paste into AI Workforce',
        instructions: 'Go to CRM → Add Connection → select HubSpot → paste the token → click Connect.',
      },
    ],
    requiredScopes: [
      'crm.objects.contacts.read',
      'crm.objects.contacts.write',
      'crm.objects.deals.read',
      'crm.objects.deals.write',
      'crm.objects.notes.write',
      'crm.objects.tasks.write',
      'timeline.events.write',
    ],
    webhookEndpoints: [],
  },

  LARAVEL: {
    name: 'Laravel CRM',
    logoColor: '#FF2D20',
    description: 'Connect to your custom Laravel CRM via bearer token and REST endpoints.',
    estimatedSetupMinutes: 10,
    steps: [
      {
        title: 'Generate an API token',
        instructions: 'In your Laravel CRM admin panel, go to Settings → API → Generate new token with full access. Copy the token.',
      },
      {
        title: 'Note your CRM base URL',
        instructions: 'Find the root URL of your CRM, e.g. https://crm.yourcompany.com (no trailing slash).',
      },
      {
        title: 'Ensure these REST endpoints exist',
        instructions: 'Your Laravel CRM must expose the following API routes:',
        code: [
          'GET  /api/customers/:id',
          'GET  /api/customers?search=:query',
          'POST /api/notes      { content, customerId?, jobId? }',
          'POST /api/tasks      { title, description, jobId? }',
          'POST /api/documents  { name, url, jobId? }',
          'PATCH /api/contacts/:id',
          'PATCH /api/jobs/:id',
        ].join('\n'),
      },
      {
        title: 'Whitelist server IP (if needed)',
        instructions: 'If your CRM uses IP whitelisting, add the AI Workforce server IP to the allowed list.',
      },
      {
        title: 'Register webhooks (optional but recommended)',
        instructions: 'In your Laravel CRM, register these webhook URLs so agents get notified in real-time:',
        code: [
          'POST /webhooks/crm/lead-created   → fires when a new lead is added',
          'POST /webhooks/crm/job-updated    → fires when a job status changes',
          'POST /webhooks/crm/contact-updated → fires when contact info changes',
        ].join('\n'),
      },
      {
        title: 'Paste credentials into AI Workforce',
        instructions: 'Go to CRM → Add Connection → select Laravel CRM → enter Base URL and API Key → Connect.',
      },
    ],
    requiredEndpoints: [
      'GET  /api/customers/:id',
      'GET  /api/customers?search=:query',
      'POST /api/notes',
      'POST /api/tasks',
      'PATCH /api/contacts/:id',
    ],
    webhookEndpoints: [
      { event: 'lead.created', path: '/api/v1/webhooks/crm/lead-created', description: 'New lead notification' },
      { event: 'job.updated', path: '/api/v1/webhooks/crm/job-updated', description: 'Job status change' },
    ],
  },

  JOBNIMBUS: {
    name: 'JobNimbus',
    logoColor: '#2E86AB',
    description: 'Field-service CRM popular in roofing and construction.',
    estimatedSetupMinutes: 5,
    apiDocsUrl: 'https://www.jobnimbus.com/developers/',
    steps: [
      {
        title: 'Open JobNimbus API settings',
        url: 'https://app.jobnimbus.com/settings/api',
        instructions: 'Log in → Settings (gear) → Integrations → API → click "Generate New Key".',
      },
      {
        title: 'Copy the API Key',
        instructions: 'Copy the generated key — it looks like a long alphanumeric string.',
      },
      {
        title: 'Enable webhook events (optional)',
        instructions: 'In Settings → Integrations → Webhooks, add your webhook URL and enable:',
        code: ['contact.created', 'contact.updated', 'job.created', 'job.status_changed'].join('\n'),
      },
      {
        title: 'Paste into AI Workforce',
        instructions: 'Go to CRM → Add Connection → select JobNimbus → paste the API key → Connect.',
      },
    ],
    requiredScopes: ['contacts:read', 'contacts:write', 'jobs:read', 'jobs:write', 'notes:write'],
    webhookEndpoints: [
      { event: 'contact.created', path: '/api/v1/webhooks/crm/contact-created', description: 'New contact' },
      { event: 'job.status_changed', path: '/api/v1/webhooks/crm/job-updated', description: 'Job status changed' },
    ],
  },

  SALESFORCE: {
    name: 'Salesforce',
    logoColor: '#00A1E0',
    description: 'Enterprise CRM — connect via OAuth Connected App.',
    estimatedSetupMinutes: 15,
    apiDocsUrl: 'https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm',
    steps: [
      {
        title: 'Create a Connected App',
        url: 'https://login.salesforce.com',
        instructions: 'Setup → App Manager → New Connected App → fill in name "AI Workforce OS" → enable OAuth Settings.',
      },
      {
        title: 'Set Callback URL',
        instructions: 'Set Callback URL to: https://login.salesforce.com/services/oauth2/success',
      },
      {
        title: 'Select OAuth Scopes',
        instructions: 'Add these scopes:',
        code: ['api', 'refresh_token', 'offline_access', 'chatter_api'].join('\n'),
      },
      {
        title: 'Get Consumer Key & Secret',
        instructions: 'After saving, click "Manage Consumer Details" → copy Consumer Key and Consumer Secret.',
      },
      {
        title: 'Generate Access Token',
        instructions: 'Use Username-Password OAuth flow or generate a session token from your Salesforce instance.',
        code: 'curl -X POST https://login.salesforce.com/services/oauth2/token \\\n  -d "grant_type=password" \\\n  -d "client_id=YOUR_CONSUMER_KEY" \\\n  -d "client_secret=YOUR_CONSUMER_SECRET" \\\n  -d "username=YOUR_EMAIL" \\\n  -d "password=YOUR_PASSWORD+SECURITY_TOKEN"',
      },
      {
        title: 'Paste into AI Workforce',
        instructions: 'Go to CRM → Add Connection → select Salesforce → enter your instance URL (e.g. https://yourorg.my.salesforce.com) + access token.',
      },
    ],
    requiredScopes: ['api', 'refresh_token', 'offline_access'],
  },

  ZOHO: {
    name: 'Zoho CRM',
    logoColor: '#E42527',
    description: 'Connect Zoho CRM via self-client OAuth token.',
    estimatedSetupMinutes: 10,
    apiDocsUrl: 'https://www.zoho.com/crm/developer/docs/api/v6/',
    steps: [
      {
        title: 'Create a Self Client',
        url: 'https://api-console.zoho.com/',
        instructions: 'Go to Zoho API Console → Self Client → Create → scope = ZohoCRM.modules.ALL,ZohoCRM.settings.ALL',
      },
      {
        title: 'Generate grant token',
        instructions: 'Click "Generate Code" → copy the one-time grant token (valid for 3 minutes).',
      },
      {
        title: 'Exchange for access + refresh tokens',
        instructions: 'Run this curl command:',
        code: 'curl -X POST https://accounts.zoho.com/oauth/v2/token \\\n  -d "grant_type=authorization_code" \\\n  -d "client_id=YOUR_CLIENT_ID" \\\n  -d "client_secret=YOUR_CLIENT_SECRET" \\\n  -d "redirect_uri=https://www.zoho.com/crm" \\\n  -d "code=YOUR_GRANT_TOKEN"',
      },
      {
        title: 'Paste refresh token into AI Workforce',
        instructions: 'Go to CRM → Add Connection → select Zoho CRM → paste the refresh token + client ID + client secret.',
      },
    ],
    requiredScopes: ['ZohoCRM.modules.ALL', 'ZohoCRM.settings.ALL', 'ZohoCRM.users.READ'],
  },

  CUSTOM: {
    name: 'Custom API',
    logoColor: '#6366F1',
    description: 'Connect any REST API with bearer token authentication.',
    estimatedSetupMinutes: 10,
    steps: [
      {
        title: 'Identify your CRM base URL',
        instructions: 'Find the root API URL, e.g. https://api.yourcrm.com/v2 (no trailing slash).',
      },
      {
        title: 'Generate a bearer token',
        instructions: 'In your CRM, generate an API key or OAuth bearer token with read/write access to contacts, notes, and tasks.',
      },
      {
        title: 'Ensure standard endpoints',
        instructions: 'Your API should expose these standard endpoints (AI agents will call them):',
        code: [
          'GET  /customers/:id         → fetch a contact',
          'GET  /customers?search=:q   → search contacts',
          'POST /notes                 → create a note',
          'POST /tasks                 → create a task',
          'PATCH /contacts/:id         → update contact',
        ].join('\n'),
      },
      {
        title: 'Paste into AI Workforce',
        instructions: 'Go to CRM → Add Connection → select Custom API → enter Base URL + bearer token → Test → Connect.',
      },
    ],
  },
}
