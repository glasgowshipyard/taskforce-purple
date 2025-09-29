# Cloudflare Workers Deployment Instructions

## Method 1: Wrangler CLI (Recommended)

### Install Wrangler
```bash
npm install -g wrangler
```

### Login to Cloudflare
```bash
wrangler login
```
This opens browser to authenticate with your Cloudflare account.

### Create KV Namespace
```bash
wrangler kv:namespace create "MEMBER_DATA"
wrangler kv:namespace create "MEMBER_DATA" --preview
```
Copy the namespace IDs and update `wrangler.toml`:

```toml
kv_namespaces = [
  { binding = "MEMBER_DATA", id = "your-actual-namespace-id", preview_id = "your-preview-namespace-id" }
]
```

### Set Environment Variables
```bash
wrangler secret put CONGRESS_API_KEY
wrangler secret put FEC_API_KEY
```
Enter your API keys when prompted.

### Deploy Worker
```bash
wrangler deploy
```

### Set up Routes (Optional)
In Cloudflare Dashboard:
- Go to Workers & Pages
- Click your worker
- Go to Settings → Triggers
- Add route: `yoursite.com/api/*`

## Method 2: Cloudflare Dashboard (Web UI)

### Navigate to Workers
1. Go to https://dash.cloudflare.com
2. Click **Workers & Pages**
3. Click **Create Application**
4. Choose **Create Worker**

### Upload Code
1. Delete default code
2. Copy contents of `workers/data-pipeline.js`
3. Paste into editor
4. Click **Save and Deploy**

### Create KV Namespace
1. Go to **Workers & Pages** → **KV**
2. Click **Create namespace**
3. Name it `MEMBER_DATA`
4. Note the namespace ID

### Bind KV to Worker
1. Go to your worker
2. Click **Settings** → **Variables**
3. Add KV namespace binding:
   - Variable name: `MEMBER_DATA`
   - KV namespace: Select the one you created

### Add Environment Variables
1. In **Settings** → **Variables**
2. Add encrypted variables:
   - `CONGRESS_API_KEY`: Your Congress.gov API key
   - `FEC_API_KEY`: Your OpenFEC API key

### Set up Cron Trigger
1. Go to **Settings** → **Triggers**
2. Add cron trigger: `0 6 * * *` (daily at 6 AM UTC)

## Method 3: GitHub Actions (Advanced)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

## Quick Start (Method 1)

```bash
# 1. Install and login
npm install -g wrangler
wrangler login

# 2. Create KV namespace
wrangler kv:namespace create "MEMBER_DATA"
# Update the ID in wrangler.toml

# 3. Add your API keys
wrangler secret put CONGRESS_API_KEY
wrangler secret put FEC_API_KEY

# 4. Deploy
wrangler deploy

# 5. Test
curl https://your-worker.your-subdomain.workers.dev/api/members
```

## After Deployment

### Test the API
```bash
# Check if worker is running
curl https://your-worker-name.your-subdomain.workers.dev/api/members

# Trigger data update
curl -X POST https://your-worker-name.your-subdomain.workers.dev/api/update-data
```

### Configure Frontend Routing
Update your Pages project to route `/api/*` to your Worker:
1. Go to **Workers & Pages** → Your Pages project
2. **Functions** → Add route `/api/*` → Your worker

## Troubleshooting

### Common Issues
- **"KV namespace not found"**: Update namespace ID in `wrangler.toml`
- **"API key invalid"**: Check environment variables are set correctly
- **"Route conflicts"**: Ensure `/api/*` routes to worker, not Pages

### Logs
```bash
wrangler tail  # View real-time logs
```

### Test Locally
```bash
wrangler dev  # Test worker locally before deploying
```