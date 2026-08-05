# StormBuddi SSO Integration Guide

This guide will help you integrate Single Sign-On (SSO) between StormBuddi CRM and the AI Workforce system.

## Overview

The SSO integration allows users to seamlessly navigate from StormBuddi to the AI Workforce system without having to log in again. Here's how it works:

1. User clicks a link in StormBuddi (e.g., "Open AI Workforce")
2. StormBuddi generates a secure SSO token by calling the AI Workforce API
3. StormBuddi redirects the user to AI Workforce with the token
4. AI Workforce validates the token and logs the user in automatically

## Part 1: Server Deployment Steps

### 1. Run Database Migrations

On your production server, run the following commands:

```bash
# Navigate to the project directory
cd /path/to/AI-Workforce-OS

# Run Prisma migrations
cd apps/api
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate

# Restart your API service (example using PM2)
pm2 restart api
```

### 2. Update Environment Variables

Add these new environment variables to your `.env` file:

```bash
# SSO Configuration
SSO_API_KEY="your-secure-random-api-key-here"  # Generate with: openssl rand -hex 32
STORMBUDDI_URL="https://your-stormbuddi-domain.com"

# Make sure your FRONTEND_URL is set correctly
FRONTEND_URL="https://your-ai-workforce-domain.com"
```

**Important Security Note:** 
- Generate a strong, unique API key for `SSO_API_KEY`
- Keep this key secure and never commit it to version control
- Use the same key in StormBuddi for authentication

### 3. Restart Services

```bash
# Stop all services
pm2 stop all

# Start API
cd apps/api
pm2 start "pnpm start" --name api

# Start Web
cd ../web
pm2 start "pnpm start" --name web

# Save PM2 configuration
pm2 save
```

## Part 2: StormBuddi Integration Code

### Option A: Server-Side Integration (Recommended)

This is the most secure approach. When a user clicks "Open AI Workforce" in StormBuddi, your backend generates an SSO token and redirects the user.

#### Step 1: Install Required Dependencies

```bash
npm install axios
# or
composer require guzzlehttp/guzzle  # For PHP
```

#### Step 2: Add SSO Token Generation Function

**Node.js Example:**

```javascript
const axios = require('axios');

async function generateAiWorkforceSsoToken(userEmail) {
  try {
    const response = await axios.post(
      'https://your-ai-workforce-domain.com/api/v1/auth/generate-sso-token',
      {
        email: userEmail,
        source: 'stormbuddi'
      },
      {
        headers: {
          'x-api-key': process.env.SSO_API_KEY,  // Your secure API key
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;  // { token, redirectUrl, expiresIn }
  } catch (error) {
    console.error('SSO token generation failed:', error.response?.data || error.message);
    throw error;
  }
}
```

**PHP Example:**

```php
<?php
use GuzzleHttp\Client;

function generateAiWorkforceSsoToken($userEmail) {
    $client = new Client();
    
    try {
        $response = $client->post('https://your-ai-workforce-domain.com/api/v1/auth/generate-sso-token', [
            'json' => [
                'email' => $userEmail,
                'source' => 'stormbuddi'
            ],
            'headers' => [
                'x-api-key' => getenv('SSO_API_KEY'),
                'Content-Type' => 'application/json'
            ]
        ]);
        
        return json_decode($response->getBody(), true);
    } catch (Exception $e) {
        error_log('SSO token generation failed: ' . $e->getMessage());
        throw $e;
    }
}
?>
```

**Python Example:**

```python
import requests
import os

def generate_ai_workforce_sso_token(user_email):
    try:
        response = requests.post(
            'https://your-ai-workforce-domain.com/api/v1/auth/generate-sso-token',
            json={
                'email': user_email,
                'source': 'stormbuddi'
            },
            headers={
                'x-api-key': os.environ.get('SSO_API_KEY'),
                'Content-Type': 'application/json'
            }
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f'SSO token generation failed: {str(e)}')
        raise
```

#### Step 3: Add SSO Redirect Handler

Create a route in StormBuddi that handles the SSO redirect:

**Node.js/Express Example:**

```javascript
app.get('/ai-workforce-sso', async (req, res) => {
  try {
    // Get the logged-in user's email from your session/auth system
    const userEmail = req.user.email;  // Adjust based on your auth system

    // Generate SSO token
    const ssoData = await generateAiWorkforceSsoToken(userEmail);

    // Redirect user to AI Workforce with the token
    res.redirect(ssoData.redirectUrl);
  } catch (error) {
    console.error('SSO redirect failed:', error);
    res.status(500).send('SSO login failed. Please try again.');
  }
});
```

**PHP Example:**

```php
<?php
// sso-redirect.php
session_start();

try {
    // Get the logged-in user's email from your session
    $userEmail = $_SESSION['user_email'];  // Adjust based on your auth system
    
    // Generate SSO token
    $ssoData = generateAiWorkforceSsoToken($userEmail);
    
    // Redirect user to AI Workforce with the token
    header('Location: ' . $ssoData['redirectUrl']);
    exit;
} catch (Exception $e) {
    echo 'SSO login failed. Please try again.';
}
?>
```

#### Step 4: Add SSO Link to StormBuddi UI

Add a link/button in StormBuddi that redirects to your SSO handler:

```html
<a href="/ai-workforce-sso" class="btn btn-primary">
  Open AI Workforce
</a>
```

### Option B: Client-Side Integration (Alternative)

If you prefer client-side integration, you can call the API from the browser:

```javascript
async function openAiWorkforce() {
  try {
    // Get user email from your frontend state/context
    const userEmail = getCurrentUserEmail();
    
    // Generate SSO token
    const response = await fetch('https://your-ai-workforce-domain.com/api/v1/auth/generate-sso-token', {
      method: 'POST',
      headers: {
        'x-api-key': 'your-api-key',  // ⚠️ SECURITY WARNING: Don't expose API key in frontend!
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: userEmail,
        source: 'stormbuddi'
      })
    });
    
    const data = await response.json();
    
    // Redirect to AI Workforce
    window.location.href = data.redirectUrl;
  } catch (error) {
    console.error('SSO failed:', error);
    alert('Failed to open AI Workforce. Please try again.');
  }
}
```

**⚠️ Security Warning:** The client-side approach exposes your API key in the browser, which is a security risk. We **strongly recommend** using the server-side approach (Option A).

## Part 3: User Mapping

### Prerequisites

Before a user can use SSO, they must:

1. **Have an account in the AI Workforce system**
2. **Use the same email address in both systems**

### Creating Users

If a user doesn't exist in AI Workforce yet, you have two options:

#### Option 1: Manual Creation (Super Admin)

1. Log in to AI Workforce as a Super Admin
2. Go to the "Tenants" tab in the Super Admin Dashboard
3. Click "Create Tenant"
4. Fill in the user's email (must match StormBuddi email)
5. The user will receive a verification email

#### Option 2: Automatic User Provisioning (Future Enhancement)

You can add a webhook in StormBuddi that calls a user provisioning API when new users are created. Contact your dev team to implement this.

## Part 4: Testing the Integration

### 1. Test SSO Token Generation

Use curl to test the token generation endpoint:

```bash
curl -X POST https://your-ai-workforce-domain.com/api/v1/auth/generate-sso-token \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","source":"stormbuddi"}'
```

Expected response:

```json
{
  "token": "a1b2c3d4e5f6...",
  "redirectUrl": "https://your-ai-workforce-domain.com/sso?token=a1b2c3d4e5f6...&source=stormbuddi",
  "expiresIn": 300
}
```

### 2. Test SSO Login Flow

1. Log in to StormBuddi with a test user
2. Click the "Open AI Workforce" link/button
3. Verify that you're automatically logged into AI Workforce
4. Check that you see the correct user dashboard

### 3. Test Token Expiry

Tokens expire after **5 minutes**. Test that expired tokens are rejected:

1. Generate a token
2. Wait 6 minutes
3. Try to use the token - should get "Invalid or expired SSO token" error

### 4. Test Single-Use Tokens

Tokens can only be used once. Test that reusing a token is rejected:

1. Generate a token
2. Use it to log in (should succeed)
3. Try to use the same token again - should get "Invalid or expired SSO token" error

## Part 5: Security Best Practices

### 1. API Key Security

- Generate a strong, random API key (min 32 characters)
- Store it securely in environment variables
- Never commit it to version control
- Rotate the key periodically (every 90 days)
- Use different keys for development and production

### 2. HTTPS Only

- Always use HTTPS for both StormBuddi and AI Workforce
- Never send API keys or tokens over HTTP
- Configure HSTS (HTTP Strict Transport Security) headers

### 3. Token Expiry

- Tokens expire after 5 minutes
- Tokens are single-use only
- Generate a new token for each SSO attempt

### 4. Rate Limiting

Consider adding rate limiting to the SSO token generation endpoint:

```javascript
// Example using express-rate-limit
const rateLimit = require('express-rate-limit');

const ssoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per IP
  message: 'Too many SSO attempts. Please try again later.'
});

app.use('/ai-workforce-sso', ssoLimiter);
```

### 5. Audit Logging

Log all SSO attempts for security monitoring:

```javascript
console.log(`[SSO] Token generated for ${userEmail} from ${req.ip} at ${new Date().toISOString()}`);
```

### 6. Error Handling

- Never expose sensitive error details to users
- Log detailed errors server-side
- Show generic error messages to users
- Monitor error rates and investigate spikes

## Part 6: Troubleshooting

### Common Issues

#### Issue 1: "Invalid API key" Error

**Solution:**
- Verify the API key is set correctly in `.env`
- Ensure you're using the same key in StormBuddi
- Check for extra spaces or newlines in the key

#### Issue 2: "User not found" Error

**Solution:**
- Verify the user exists in AI Workforce with the same email
- Check that the email is verified and active
- Ensure the tenant is approved (if not a super admin)

#### Issue 3: CORS Errors

**Solution:**
- Add StormBuddi domain to `STORMBUDDI_URL` in `.env`
- Restart the API service after changing `.env`
- Check browser console for specific CORS errors

#### Issue 4: Token Expired

**Solution:**
- Tokens expire after 5 minutes
- Generate a new token immediately before redirecting
- Don't cache or store tokens

#### Issue 5: "Account is pending approval"

**Solution:**
- Log in as Super Admin
- Go to Approvals tab
- Approve the tenant

## Part 7: Production Checklist

Before going live, ensure:

- [ ] Database migrations are run on production
- [ ] `SSO_API_KEY` is set with a strong, unique key
- [ ] `STORMBUDDI_URL` is set to the correct domain
- [ ] `FRONTEND_URL` is set to the correct domain
- [ ] HTTPS is enabled on both systems
- [ ] API services are restarted with new environment variables
- [ ] Test SSO flow with multiple users
- [ ] Rate limiting is configured
- [ ] Error logging is working
- [ ] Security monitoring is in place
- [ ] Documentation is shared with your team

## Part 8: Support

If you encounter any issues:

1. Check the API logs: `pm2 logs api`
2. Check the web logs: `pm2 logs web`
3. Review this documentation
4. Contact your development team

## API Reference

### Generate SSO Token

**Endpoint:** `POST /api/v1/auth/generate-sso-token`

**Headers:**
```
x-api-key: your-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "source": "stormbuddi"
}
```

**Response (200 OK):**
```json
{
  "token": "a1b2c3d4e5f6...",
  "redirectUrl": "https://your-domain.com/sso?token=...&source=stormbuddi",
  "expiresIn": 300
}
```

**Error Responses:**

- `401 Unauthorized`: Invalid API key
- `404 Not Found`: User not found
- `401 Unauthorized`: Account is deactivated or pending approval

### SSO Login

**Endpoint:** `POST /api/v1/auth/sso-login`

**Request Body:**
```json
{
  "token": "a1b2c3d4e5f6...",
  "source": "stormbuddi"
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses:**

- `401 Unauthorized`: Invalid or expired SSO token
- `401 Unauthorized`: Account is deactivated
- `401 Unauthorized`: Account is pending approval

---

**Last Updated:** August 5, 2026  
**Version:** 1.0.0
