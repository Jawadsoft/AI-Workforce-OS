# StormBuddi Integration Guide
## Agentic AI Plan & SSO Integration

This comprehensive guide explains how to integrate StormBuddi with the AI Workforce system, including tenant provisioning, plan-based access control, and Single Sign-On (SSO).

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Part 1: Database Schema Changes](#part-1-database-schema-changes)
5. [Part 2: Tenant Provisioning](#part-2-tenant-provisioning)
6. [Part 3: Plan-Based Access Control](#part-3-plan-based-access-control)
7. [Part 4: SSO Integration](#part-4-sso-integration)
8. [Part 5: Lifecycle Management](#part-5-lifecycle-management)
9. [Part 6: Testing](#part-6-testing)
10. [Part 7: Troubleshooting](#part-7-troubleshooting)
11. [API Reference](#api-reference)

---

## Overview

The integration allows StormBuddi tenants with the **"Agentic AI Plan"** to seamlessly access the AI Workforce system. Here's the high-level flow:

```
┌─────────────────────────────────────────────────────────────┐
│  StormBuddi Tenant Signs Up                                  │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  Admin Assigns "Agentic AI Plan" to Tenant                   │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  StormBuddi calls AI Workforce API to provision tenant       │
│  • Creates tenant account                                    │
│  • Creates owner user                                        │
│  • Sends verification email                                  │
│  • Returns tenant ID                                         │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  StormBuddi stores AI Workforce tenant ID                    │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  User clicks "Open AI Workforce" in StormBuddi               │
│  • StormBuddi generates SSO token                            │
│  • User is redirected with token                             │
│  • AI Workforce logs user in automatically                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Architecture

### Key Components:

1. **Tenant Provisioning API** - Creates AI Workforce tenants from StormBuddi
2. **SSO Token Generation API** - Generates secure tokens for seamless login
3. **SSO Login Endpoint** - Validates tokens and logs users in
4. **Lifecycle Management APIs** - Suspend, activate, or delete tenants based on plan changes

### Security:

- **API Key Authentication** - All external API calls require `x-api-key` header
- **Single-use Tokens** - SSO tokens can only be used once
- **Token Expiry** - Tokens expire after 5 minutes
- **HTTPS Only** - All communications must use HTTPS in production

---

## Prerequisites

Before integrating, ensure you have:

1. ✅ Access to StormBuddi database
2. ✅ Ability to modify StormBuddi backend code
3. ✅ API key from AI Workforce team
4. ✅ AI Workforce production URL
5. ✅ HTTPS enabled on both systems

---

## Part 1: Database Schema Changes

Add the following fields to your StormBuddi database to track AI Workforce integration:

### SQL Migration (PostgreSQL):

```sql
-- Add AI Workforce integration fields to tenants table
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS has_agentic_ai_plan BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ai_workforce_tenant_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS ai_workforce_provisioned_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS ai_workforce_status VARCHAR(50) DEFAULT 'inactive';
-- Status values: 'inactive', 'provisioning', 'active', 'suspended', 'deleted'

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_tenants_agentic_plan ON tenants(has_agentic_ai_plan);
CREATE INDEX IF NOT EXISTS idx_tenants_ai_workforce_id ON tenants(ai_workforce_tenant_id);

-- Add audit log table for AI Workforce operations
CREATE TABLE IF NOT EXISTS ai_workforce_operations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  operation VARCHAR(50) NOT NULL, -- 'provision', 'suspend', 'activate', 'delete', 'sso_login'
  status VARCHAR(20) NOT NULL, -- 'success', 'failed'
  request_data JSONB,
  response_data JSONB,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_ops_tenant ON ai_workforce_operations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_ops_created ON ai_workforce_operations(created_at);
```

### MySQL Version:

```sql
-- Add AI Workforce integration fields to tenants table
ALTER TABLE tenants 
ADD COLUMN has_agentic_ai_plan BOOLEAN DEFAULT FALSE,
ADD COLUMN ai_workforce_tenant_id VARCHAR(255),
ADD COLUMN ai_workforce_provisioned_at TIMESTAMP NULL,
ADD COLUMN ai_workforce_status VARCHAR(50) DEFAULT 'inactive';

-- Create indexes
CREATE INDEX idx_tenants_agentic_plan ON tenants(has_agentic_ai_plan);
CREATE INDEX idx_tenants_ai_workforce_id ON tenants(ai_workforce_tenant_id);

-- Add audit log table
CREATE TABLE ai_workforce_operations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  operation VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  request_data JSON,
  response_data JSON,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_ai_ops_tenant ON ai_workforce_operations(tenant_id);
CREATE INDEX idx_ai_ops_created ON ai_workforce_operations(created_at);
```

---

## Part 2: Tenant Provisioning

### Step 1: Configure Environment Variables

Add these to your StormBuddi `.env` file:

```bash
# AI Workforce Integration
AI_WORKFORCE_API_URL="https://your-ai-workforce-domain.com/api/v1"
AI_WORKFORCE_API_KEY="your-secure-api-key-here"
AI_WORKFORCE_INTEGRATION_API_KEY="your-integration-api-key-here"
```

### Step 2: Create Provisioning Service

Create a service to handle AI Workforce API calls:

#### Node.js/TypeScript Example:

```typescript
// services/ai-workforce.service.ts
import axios from 'axios';

interface ProvisionTenantData {
  companyName: string;
  ownerName: string;
  ownerEmail: string;
  industry?: string;
  externalTenantId: string; // StormBuddi tenant ID
}

interface ProvisionResponse {
  success: boolean;
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  user: {
    id: string;
    email: string;
    name: string;
  };
  verificationUrl: string;
  message: string;
}

class AIWorkforceService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = process.env.AI_WORKFORCE_API_URL!;
    this.apiKey = process.env.AI_WORKFORCE_INTEGRATION_API_KEY!;
  }

  async provisionTenant(data: ProvisionTenantData): Promise<ProvisionResponse> {
    try {
      const response = await axios.post(
        `${this.apiUrl}/integrations/provision-tenant`,
        data,
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 second timeout
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `AI Workforce provisioning failed: ${error.response?.data?.message || error.message}`
        );
      }
      throw error;
    }
  }

  async suspendTenant(aiWorkforceTenantId: string): Promise<void> {
    await axios.post(
      `${this.apiUrl}/integrations/suspend-tenant`,
      { tenantId: aiWorkforceTenantId },
      {
        headers: { 'x-api-key': this.apiKey },
      }
    );
  }

  async activateTenant(aiWorkforceTenantId: string): Promise<void> {
    await axios.post(
      `${this.apiUrl}/integrations/activate-tenant`,
      { tenantId: aiWorkforceTenantId },
      {
        headers: { 'x-api-key': this.apiKey },
      }
    );
  }

  async deleteTenant(aiWorkforceTenantId: string): Promise<void> {
    await axios.delete(
      `${this.apiUrl}/integrations/tenant/${aiWorkforceTenantId}`,
      {
        headers: { 'x-api-key': this.apiKey },
      }
    );
  }

  async generateSsoToken(userEmail: string): Promise<{
    token: string;
    redirectUrl: string;
    expiresIn: number;
  }> {
    const response = await axios.post(
      `${this.apiUrl}/auth/generate-sso-token`,
      {
        email: userEmail,
        source: 'stormbuddi',
      },
      {
        headers: { 'x-api-key': process.env.AI_WORKFORCE_API_KEY! },
      }
    );

    return response.data;
  }
}

export default new AIWorkforceService();
```

#### PHP Example:

```php
<?php
// services/AIWorkforceService.php

use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;

class AIWorkforceService {
    private $client;
    private $apiUrl;
    private $apiKey;

    public function __construct() {
        $this->apiUrl = getenv('AI_WORKFORCE_API_URL');
        $this->apiKey = getenv('AI_WORKFORCE_INTEGRATION_API_KEY');
        $this->client = new Client(['timeout' => 30]);
    }

    public function provisionTenant($data) {
        try {
            $response = $this->client->post(
                $this->apiUrl . '/integrations/provision-tenant',
                [
                    'json' => $data,
                    'headers' => [
                        'x-api-key' => $this->apiKey,
                        'Content-Type' => 'application/json'
                    ]
                ]
            );

            return json_decode($response->getBody(), true);
        } catch (GuzzleException $e) {
            throw new Exception('AI Workforce provisioning failed: ' . $e->getMessage());
        }
    }

    public function suspendTenant($aiWorkforceTenantId) {
        $this->client->post(
            $this->apiUrl . '/integrations/suspend-tenant',
            [
                'json' => ['tenantId' => $aiWorkforceTenantId],
                'headers' => ['x-api-key' => $this->apiKey]
            ]
        );
    }

    public function activateTenant($aiWorkforceTenantId) {
        $this->client->post(
            $this->apiUrl . '/integrations/activate-tenant',
            [
                'json' => ['tenantId' => $aiWorkforceTenantId],
                'headers' => ['x-api-key' => $this->apiKey]
            ]
        );
    }

    public function deleteTenant($aiWorkforceTenantId) {
        $this->client->delete(
            $this->apiUrl . '/integrations/tenant/' . $aiWorkforceTenantId,
            ['headers' => ['x-api-key' => $this->apiKey]]
        );
    }

    public function generateSsoToken($userEmail) {
        $response = $this->client->post(
            $this->apiUrl . '/auth/generate-sso-token',
            [
                'json' => [
                    'email' => $userEmail,
                    'source' => 'stormbuddi'
                ],
                'headers' => ['x-api-key' => getenv('AI_WORKFORCE_API_KEY')]
            ]
        );

        return json_decode($response->getBody(), true);
    }
}
```

### Step 3: Log Operations for Debugging

Create a helper function to log all AI Workforce operations:

```typescript
// utils/ai-workforce-logger.ts
async function logAIWorkforceOperation(
  tenantId: number,
  operation: string,
  status: 'success' | 'failed',
  requestData: any,
  responseData: any = null,
  errorMessage: string = null
) {
  await db.ai_workforce_operations.create({
    tenant_id: tenantId,
    operation,
    status,
    request_data: requestData,
    response_data: responseData,
    error_message: errorMessage,
  });
}
```

---

## Part 3: Plan-Based Access Control

### When a Tenant Gets the Agentic AI Plan

Create a function that runs when an admin assigns the plan:

#### Node.js/Express Example:

```typescript
// controllers/plan.controller.ts
import AIWorkforceService from '../services/ai-workforce.service';
import { logAIWorkforceOperation } from '../utils/ai-workforce-logger';

export async function assignAgenticAIPlan(req, res) {
  const { tenantId } = req.params;

  try {
    // 1. Get tenant details
    const tenant = await db.tenants.findOne({ where: { id: tenantId } });
    
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // 2. Check if already provisioned
    if (tenant.ai_workforce_tenant_id) {
      // Already provisioned, just activate
      await AIWorkforceService.activateTenant(tenant.ai_workforce_tenant_id);
      
      await db.tenants.update({
        where: { id: tenantId },
        data: {
          has_agentic_ai_plan: true,
          ai_workforce_status: 'active',
        }
      });

      return res.json({ 
        message: 'Agentic AI Plan activated',
        aiWorkforceUrl: `${process.env.AI_WORKFORCE_FRONTEND_URL}/dashboard`
      });
    }

    // 3. Update status to provisioning
    await db.tenants.update({
      where: { id: tenantId },
      data: { ai_workforce_status: 'provisioning' }
    });

    // 4. Provision tenant in AI Workforce
    const provisionData = {
      companyName: tenant.company_name,
      ownerName: tenant.owner_name,
      ownerEmail: tenant.owner_email,
      industry: tenant.industry || 'roofing',
      externalTenantId: tenant.id.toString(),
    };

    const result = await AIWorkforceService.provisionTenant(provisionData);

    // 5. Update StormBuddi database
    await db.tenants.update({
      where: { id: tenantId },
      data: {
        has_agentic_ai_plan: true,
        ai_workforce_tenant_id: result.tenant.id,
        ai_workforce_provisioned_at: new Date(),
        ai_workforce_status: 'active',
      }
    });

    // 6. Log the operation
    await logAIWorkforceOperation(
      tenantId,
      'provision',
      'success',
      provisionData,
      result
    );

    // 7. Optional: Send notification email to tenant
    await sendEmail({
      to: tenant.owner_email,
      subject: 'Welcome to AI Workforce!',
      body: `Your Agentic AI plan is ready. Check your email for verification link.`
    });

    res.json({
      message: 'Agentic AI Plan assigned successfully',
      aiWorkforceTenantId: result.tenant.id,
      verificationUrl: result.verificationUrl,
    });

  } catch (error) {
    console.error('Failed to assign Agentic AI Plan:', error);

    // Update status to failed
    await db.tenants.update({
      where: { id: tenantId },
      data: { ai_workforce_status: 'inactive' }
    });

    // Log the failure
    await logAIWorkforceOperation(
      tenantId,
      'provision',
      'failed',
      { tenantId },
      null,
      error.message
    );

    res.status(500).json({ 
      error: 'Failed to assign plan',
      details: error.message 
    });
  }
}
```

#### PHP Example:

```php
<?php
// controllers/PlanController.php

public function assignAgenticAIPlan($tenantId) {
    try {
        // 1. Get tenant details
        $tenant = Tenant::findOrFail($tenantId);

        // 2. Check if already provisioned
        if ($tenant->ai_workforce_tenant_id) {
            $aiWorkforceService->activateTenant($tenant->ai_workforce_tenant_id);
            
            $tenant->update([
                'has_agentic_ai_plan' => true,
                'ai_workforce_status' => 'active'
            ]);

            return response()->json([
                'message' => 'Agentic AI Plan activated'
            ]);
        }

        // 3. Update status to provisioning
        $tenant->update(['ai_workforce_status' => 'provisioning']);

        // 4. Provision tenant
        $provisionData = [
            'companyName' => $tenant->company_name,
            'ownerName' => $tenant->owner_name,
            'ownerEmail' => $tenant->owner_email,
            'industry' => $tenant->industry ?? 'roofing',
            'externalTenantId' => (string)$tenant->id
        ];

        $aiWorkforceService = new AIWorkforceService();
        $result = $aiWorkforceService->provisionTenant($provisionData);

        // 5. Update database
        $tenant->update([
            'has_agentic_ai_plan' => true,
            'ai_workforce_tenant_id' => $result['tenant']['id'],
            'ai_workforce_provisioned_at' => now(),
            'ai_workforce_status' => 'active'
        ]);

        // 6. Log operation
        AIWorkforceOperation::create([
            'tenant_id' => $tenantId,
            'operation' => 'provision',
            'status' => 'success',
            'request_data' => json_encode($provisionData),
            'response_data' => json_encode($result)
        ]);

        return response()->json([
            'message' => 'Agentic AI Plan assigned successfully',
            'aiWorkforceTenantId' => $result['tenant']['id']
        ]);

    } catch (Exception $e) {
        $tenant->update(['ai_workforce_status' => 'inactive']);

        AIWorkforceOperation::create([
            'tenant_id' => $tenantId,
            'operation' => 'provision',
            'status' => 'failed',
            'error_message' => $e->getMessage()
        ]);

        return response()->json([
            'error' => 'Failed to assign plan',
            'details' => $e->getMessage()
        ], 500);
    }
}
?>
```

### When a Tenant Loses the Agentic AI Plan

```typescript
export async function removeAgenticAIPlan(req, res) {
  const { tenantId } = req.params;
  const { deleteData = false } = req.body; // Option to delete vs suspend

  try {
    const tenant = await db.tenants.findOne({ where: { id: tenantId } });

    if (!tenant || !tenant.ai_workforce_tenant_id) {
      return res.status(404).json({ error: 'Tenant not found or not provisioned' });
    }

    if (deleteData) {
      // Permanently delete AI Workforce tenant and all data
      await AIWorkforceService.deleteTenant(tenant.ai_workforce_tenant_id);
      
      await db.tenants.update({
        where: { id: tenantId },
        data: {
          has_agentic_ai_plan: false,
          ai_workforce_status: 'deleted',
        }
      });

      await logAIWorkforceOperation(tenantId, 'delete', 'success', { tenantId });
    } else {
      // Suspend access but keep data (recommended)
      await AIWorkforceService.suspendTenant(tenant.ai_workforce_tenant_id);
      
      await db.tenants.update({
        where: { id: tenantId },
        data: {
          has_agentic_ai_plan: false,
          ai_workforce_status: 'suspended',
        }
      });

      await logAIWorkforceOperation(tenantId, 'suspend', 'success', { tenantId });
    }

    res.json({ message: 'Agentic AI Plan removed' });

  } catch (error) {
    console.error('Failed to remove plan:', error);
    await logAIWorkforceOperation(tenantId, deleteData ? 'delete' : 'suspend', 'failed', { tenantId }, null, error.message);
    res.status(500).json({ error: 'Failed to remove plan' });
  }
}
```

---

## Part 4: SSO Integration

### Step 1: Add SSO Route Handler

Create a route that generates SSO tokens and redirects users:

```typescript
// controllers/sso.controller.ts
export async function openAIWorkforce(req, res) {
  try {
    // 1. Get authenticated user and tenant
    const userId = req.user.id;
    const user = await db.users.findOne({ 
      where: { id: userId },
      include: { tenant: true }
    });

    if (!user || !user.tenant) {
      return res.status(404).json({ error: 'User or tenant not found' });
    }

    // 2. Check if tenant has Agentic AI Plan
    if (!user.tenant.has_agentic_ai_plan) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'Upgrade to Agentic AI Plan to access this feature',
        upgradeLinkUrl: '/plans/upgrade'
      });
    }

    // 3. Check if tenant is active
    if (user.tenant.ai_workforce_status !== 'active') {
      return res.status(403).json({ 
        error: 'AI Workforce access is not active',
        status: user.tenant.ai_workforce_status
      });
    }

    // 4. Generate SSO token
    const ssoData = await AIWorkforceService.generateSsoToken(user.email);

    // 5. Log SSO login
    await logAIWorkforceOperation(
      user.tenant.id,
      'sso_login',
      'success',
      { userEmail: user.email }
    );

    // 6. Redirect to AI Workforce with token
    res.redirect(ssoData.redirectUrl);

  } catch (error) {
    console.error('SSO login failed:', error);
    
    if (req.user?.tenant?.id) {
      await logAIWorkforceOperation(
        req.user.tenant.id,
        'sso_login',
        'failed',
        { userEmail: req.user.email },
        null,
        error.message
      );
    }

    res.status(500).json({ 
      error: 'SSO login failed',
      message: 'Please try again or contact support'
    });
  }
}
```

### Step 2: Add Route

```typescript
// routes/sso.routes.ts
import express from 'express';
import { openAIWorkforce } from '../controllers/sso.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// Requires authentication
router.get('/ai-workforce-sso', authMiddleware, openAIWorkforce);

export default router;
```

### Step 3: Add UI Button

Add a button in your StormBuddi dashboard:

```jsx
// components/Dashboard.tsx
export function Dashboard() {
  const { tenant } = useAuth();

  return (
    <div className="dashboard">
      <h1>Welcome, {tenant.company_name}</h1>
      
      {tenant.has_agentic_ai_plan ? (
        <a 
          href="/ai-workforce-sso" 
          className="btn btn-primary"
          target="_blank"
        >
          🤖 Open AI Workforce
        </a>
      ) : (
        <div className="upgrade-prompt">
          <p>Unlock AI-powered automation with our Agentic AI Plan</p>
          <a href="/plans/upgrade" className="btn btn-secondary">
            Upgrade Now
          </a>
        </div>
      )}
    </div>
  );
}
```

---

## Part 5: Lifecycle Management

### Handling Plan Upgrades/Downgrades

Create webhook or event handlers for plan changes:

```typescript
// events/plan-changed.handler.ts
export async function handlePlanChanged(event: {
  tenantId: number;
  oldPlan: string;
  newPlan: string;
}) {
  const { tenantId, oldPlan, newPlan } = event;

  // Check if Agentic AI Plan was added
  if (newPlan === 'agentic_ai' && oldPlan !== 'agentic_ai') {
    await assignAgenticAIPlan({ params: { tenantId } }, mockRes);
  }

  // Check if Agentic AI Plan was removed
  if (oldPlan === 'agentic_ai' && newPlan !== 'agentic_ai') {
    await removeAgenticAIPlan(
      { params: { tenantId }, body: { deleteData: false } },
      mockRes
    );
  }
}
```

### Automatic Suspension for Failed Payments

```typescript
// events/payment-failed.handler.ts
export async function handlePaymentFailed(event: { tenantId: number }) {
  const tenant = await db.tenants.findOne({ 
    where: { id: event.tenantId } 
  });

  if (tenant?.ai_workforce_tenant_id && tenant.has_agentic_ai_plan) {
    // Grace period: suspend after 3 failed payment attempts
    const failedAttempts = await getFailedPaymentCount(event.tenantId);
    
    if (failedAttempts >= 3) {
      await AIWorkforceService.suspendTenant(tenant.ai_workforce_tenant_id);
      
      await db.tenants.update({
        where: { id: event.tenantId },
        data: { ai_workforce_status: 'suspended' }
      });

      // Send notification email
      await sendEmail({
        to: tenant.owner_email,
        subject: 'AI Workforce Access Suspended',
        body: 'Your access has been suspended due to payment issues...'
      });
    }
  }
}
```

---

## Part 6: Testing

### Test Tenant Provisioning

```bash
# Using curl
curl -X POST https://your-ai-workforce-domain.com/api/v1/integrations/provision-tenant \
  -H "x-api-key: your-integration-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Test Roofing Co",
    "ownerName": "John Doe",
    "ownerEmail": "john@testroof.com",
    "industry": "roofing",
    "externalTenantId": "123"
  }'
```

Expected response:
```json
{
  "success": true,
  "tenant": {
    "id": "cm1234567890",
    "name": "Test Roofing Co",
    "slug": "test-roofing-co-1234567890"
  },
  "user": {
    "id": "cm0987654321",
    "email": "john@testroof.com",
    "name": "John Doe"
  },
  "verificationUrl": "https://ai-workforce.com/verify-account?token=...",
  "message": "Tenant provisioned successfully. User must verify email to activate account."
}
```

### Test SSO Flow

1. Log in to StormBuddi with a test account that has the Agentic AI Plan
2. Click the "Open AI Workforce" button
3. Verify you're automatically logged into AI Workforce
4. Check that you see the correct tenant dashboard

### Test Plan Downgrade

1. Provision a test tenant
2. Remove the Agentic AI Plan
3. Try to use SSO - should be denied
4. Verify tenant status is "suspended" in database

---

## Part 7: Troubleshooting

### Common Issues

#### Issue 1: "User with this email already exists"

**Cause:** Trying to provision a tenant when user already exists in AI Workforce

**Solutions:**
- Check if user was provisioned previously
- Use SSO for existing users instead of provisioning again
- If needed, use a different email or delete the old account first

#### Issue 2: SSO Token "Invalid or expired"

**Causes:**
- Token was already used (single-use only)
- Token expired (5 minute limit)
- User doesn't exist in AI Workforce

**Solutions:**
- Generate a new token for each SSO attempt
- Don't cache or reuse tokens
- Ensure tenant was provisioned before attempting SSO

#### Issue 3: "Access denied" during SSO

**Cause:** Tenant doesn't have `has_agentic_ai_plan` flag set

**Solution:**
```sql
-- Check tenant status
SELECT id, has_agentic_ai_plan, ai_workforce_status, ai_workforce_tenant_id 
FROM tenants 
WHERE id = 123;

-- Fix if needed
UPDATE tenants 
SET has_agentic_ai_plan = true, ai_workforce_status = 'active'
WHERE id = 123;
```

#### Issue 4: Provisioning hangs or times out

**Causes:**
- Network issues
- AI Workforce API is down
- Database connection issues

**Solutions:**
- Implement retry logic with exponential backoff
- Add timeout to API calls (30 seconds recommended)
- Log all requests for debugging
- Show user-friendly error messages

### Debugging Tips

1. **Check AI Workforce Operations Log:**
```sql
SELECT * FROM ai_workforce_operations 
WHERE tenant_id = 123 
ORDER BY created_at DESC 
LIMIT 10;
```

2. **Enable Verbose Logging:**
```typescript
// Add to your AI Workforce service
axios.interceptors.request.use(request => {
  console.log('AI Workforce Request:', request.method, request.url, request.data);
  return request;
});

axios.interceptors.response.use(
  response => {
    console.log('AI Workforce Response:', response.status, response.data);
    return response;
  },
  error => {
    console.error('AI Workforce Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);
```

3. **Test API Connectivity:**
```bash
# Test API is reachable
curl -I https://your-ai-workforce-domain.com/api/v1

# Test authentication
curl -X POST https://your-ai-workforce-domain.com/api/v1/integrations/provision-tenant \
  -H "x-api-key: wrong-key" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
# Should return 401 Unauthorized
```

---

## API Reference

### Provision Tenant

**Endpoint:** `POST /api/v1/integrations/provision-tenant`

**Headers:**
```
x-api-key: your-integration-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyName": "ABC Roofing Inc",
  "ownerName": "Jane Smith",
  "ownerEmail": "jane@abcroofing.com",
  "industry": "roofing",
  "externalTenantId": "stormbuddi-123"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "tenant": {
    "id": "cm1234567890",
    "name": "ABC Roofing Inc",
    "slug": "abc-roofing-inc-1234567890"
  },
  "user": {
    "id": "cm0987654321",
    "email": "jane@abcroofing.com",
    "name": "Jane Smith"
  },
  "verificationUrl": "https://ai-workforce.com/verify-account?token=abc123...",
  "message": "Tenant provisioned successfully. User must verify email to activate account."
}
```

**Error Responses:**
- `401 Unauthorized`: Invalid API key
- `409 Conflict`: User already exists
- `500 Internal Server Error`: Server error

---

### Suspend Tenant

**Endpoint:** `POST /api/v1/integrations/suspend-tenant`

**Headers:**
```
x-api-key: your-integration-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "tenantId": "cm1234567890"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Tenant suspended successfully. Users cannot access the system."
}
```

---

### Activate Tenant

**Endpoint:** `POST /api/v1/integrations/activate-tenant`

**Headers:**
```
x-api-key: your-integration-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "tenantId": "cm1234567890"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Tenant activated successfully. Users can now access the system."
}
```

---

### Delete Tenant

**Endpoint:** `DELETE /api/v1/integrations/tenant/:tenantId`

**Headers:**
```
x-api-key: your-integration-api-key
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Tenant and all associated data deleted permanently."
}
```

⚠️ **WARNING:** This action is irreversible. All tenant data will be permanently deleted.

---

### Generate SSO Token

**Endpoint:** `POST /api/v1/auth/generate-sso-token`

**Headers:**
```
x-api-key: your-sso-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "jane@abcroofing.com",
  "source": "stormbuddi"
}
```

**Response (200 OK):**
```json
{
  "token": "a1b2c3d4e5f6...",
  "redirectUrl": "https://ai-workforce.com/sso?token=a1b2c3d4e5f6...&source=stormbuddi",
  "expiresIn": 300
}
```

**Error Responses:**
- `401 Unauthorized`: Invalid API key
- `404 Not Found`: User not found
- `401 Unauthorized`: Account is deactivated or pending approval

---

## Security Checklist

Before going live, ensure:

- [ ] API keys are strong (min 32 characters) and stored securely
- [ ] Different API keys for development and production
- [ ] HTTPS enabled on both StormBuddi and AI Workforce
- [ ] API key rotation policy in place (every 90 days)
- [ ] Error messages don't expose sensitive information
- [ ] Rate limiting implemented on SSO endpoint
- [ ] All AI Workforce operations are logged
- [ ] Failed provisioning attempts are monitored
- [ ] User data privacy compliance (GDPR, CCPA)
- [ ] Backup strategy for tenant data

---

## Production Checklist

- [ ] Database migrations completed
- [ ] AI Workforce service integration tested end-to-end
- [ ] SSO flow tested with multiple users
- [ ] Plan upgrade/downgrade flow tested
- [ ] Suspension and reactivation tested
- [ ] Error handling and user feedback implemented
- [ ] Audit logging enabled
- [ ] Monitoring and alerting configured
- [ ] Documentation shared with support team
- [ ] Rollback plan prepared

---

## Support

For integration support:

1. Check the operation logs in `ai_workforce_operations` table
2. Review this documentation
3. Contact AI Workforce team with:
   - Operation logs
   - Error messages
   - Tenant ID
   - Timeline of events

---

**Last Updated:** August 5, 2026  
**Version:** 1.0.0  
**Maintained by:** AI Workforce Integration Team
