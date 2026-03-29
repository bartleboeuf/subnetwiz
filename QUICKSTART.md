# SubnetViz v1.0.0 - Quick Start Guide

Get SubnetViz running in **under 5 minutes** with Docker, or in **10 minutes** for local development.

## 30-Second Overview

SubnetViz visualizes AWS subnet IP allocation and fragmentation to help you:
- Identify how IPs are used (EC2, EKS pods, etc.)
- Spot fragmentation preventing large allocations
- Plan infrastructure for EKS deployments
- Optimize subnet usage

## Choose Your Path

### 🐳 Docker (Recommended - Production Ready)
- **Time**: 2-3 minutes
- **Best for**: Local testing, production deployment
- **Requires**: Docker, AWS credentials
- [Jump to Docker Setup](#docker-setup-recommended)

### 💻 Local Development
- **Time**: 5-10 minutes
- **Best for**: Development, customization
- **Requires**: Python 3.11+, Node.js 24+, AWS credentials
- [Jump to Local Development](#local-development-setup)

---

## Docker Setup (Recommended)

### Step 1: Configure AWS Credentials

**Option A: AWS CLI Profile** (Recommended)
```bash
# List available profiles
aws configure list-profiles

# Use default or specify profile when running container
export AWS_PROFILE=my-profile
```

**Option B: Environment Variables**
```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_DEFAULT_REGION=us-east-1
```

### Step 2: Build Docker Image

```bash
docker build -t subnetviz:1.0.0 .
```

This creates a production-ready image with:
- Frontend pre-built and optimized
- Backend with all dependencies
- Python 3.14-slim (security updates, minimal size)

### Step 3: Run the Container

**Using AWS Profile** (recommended):
```bash
docker run -it --rm \
  -p 5000:5000 \
  -e AWS_PROFILE=my-profile \
  -e AWS_DEFAULT_REGION=us-east-1 \
  -v ~/.aws:/root/.aws:ro \
  subnetviz:1.0.0
```

**Using Environment Variables**:
```bash
docker run -it --rm \
  -p 5000:5000 \
  -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
  -e AWS_DEFAULT_REGION=us-east-1 \
  subnetviz:1.0.0
```

### Step 4: Access the Application

Open your browser: **http://localhost:5000**

✅ You're done! Select a region and VPC to start.

### Troubleshooting

**"Failed to fetch VPCs"**
```bash
# Verify AWS credentials work
aws sts get-caller-identity
```

**"Permission denied"**
- Ensure your AWS credentials include EC2 describe permissions
- See [README.md](README.md#aws-permissions) for required IAM policy

**Docker won't start**
```bash
# Rebuild the image
docker build --no-cache -t subnetviz:1.0.0 .

# Or check Docker is running
docker ps
```

---

## Local Development Setup

### Step 1: Prerequisites

**Python 3.11+**:
```bash
python3 --version  # Should be 3.11+
```

**Node.js 24+**:
```bash
node --version     # Should be 24+
npm --version
```

**AWS Credentials** (same as Docker setup):
```bash
aws sts get-caller-identity
```

### Step 2: Install Dependencies

```bash
# Backend dependencies
pip install -r requirements.txt

# Frontend dependencies
cd frontend
npm install
cd ..
```

### Step 3: Start Backend

Terminal 1:
```bash
python app.py
```

You should see:
```
Running on http://127.0.0.1:5000
```

### Step 4: Start Frontend (New Terminal)

Terminal 2:
```bash
cd frontend
npm start
```

This opens your browser automatically to **http://localhost:3000**

The frontend connects to the backend at `http://localhost:5000`.

### Step 5: Start Using SubnetViz

Select region and VPC, then explore subnets!

### Development Tips

**Hot Reload**:
- Frontend: React dev server auto-reloads on code changes
- Backend: Add `FLASK_DEBUG=True` for Flask auto-reload

**Stop Services**:
- Frontend: `Ctrl+C` in npm terminal
- Backend: `Ctrl+C` in Flask terminal

**Debugging**:
```bash
# Backend logs
# Already printing to console

# Frontend: Open browser DevTools
# F12 → Console tab for React errors

# API testing
curl http://localhost:5000/api/vpcs
```

---

## First-Time Usage

### 1. Select Region
Top-left dropdown shows AWS account info and region selector.

### 2. Select VPC
Choose a VPC from the VPC dropdown (shows all VPCs in region).

### 3. Explore Subnets
**Left Panel** shows all subnets with:
- **Name**: Subnet identifier
- **Utilization %**: Used IPs / total IPs
- **Fragmentation Score**: 0-100 (color-coded)
- **IP Counts**: Primary, secondary, prefix delegation IPs

### 4. View IP Map
**Right Panel** shows:
- **IP Visualization**: Grid of blocks (each = 1 IP)
- **Statistics**: Usage breakdown, fragmentation details
- **First Free IP**: Next available IP with copy button

### 5. Advanced Filtering
Click ⚙️ button in subnet list for:
- **Search**: Filter by subnet name
- **Availability Zone**: Multi-select filter
- **Utilization Range**: 0-100% slider
- **Fragmentation Level**: Low/Moderate/High
- **Sort**: By utilization, fragmentation, or name

### 6. Copy Details
- **Click any IP block** to copy details (IP, status, ENI, etc.)
- **Click "First Free IP"** or 📋 icon to copy that IP
- **Green notification** confirms copy

---

## Understanding the Visualization

### Color Legend

| Block Color | Meaning | Example |
|------------|---------|---------|
| 🔵 **Blue** | Primary ENI IP | EC2 instance NIC |
| 🔷 **Cyan** | Secondary IP | EKS pod (shared ENI) |
| 🟣 **Purple** | Prefix delegation | EKS /28 block |
| ⚫ **Gray** | AWS reserved | .0, .1, .2, .3, broadcast |
| ⬜ **Light Gray** | Free/available | Can be allocated |

### Fragmentation Score Meaning

| Score | Level | Color | What it means |
|-------|-------|-------|---------------|
| 0-20 | Low | 🟢 Green | IPs mostly contiguous, good for large allocations |
| 21-50 | Moderate | 🟠 Orange | Some scattered IPs, fragmentation starting |
| 51-100 | High | 🔴 Red | Many small gaps, hard to allocate large blocks |

**Why it matters for EKS**: Prefix delegation requires contiguous /28 blocks (16 IPs). High fragmentation makes it impossible to allocate new blocks even if free IPs exist.

---

## Common Tasks

### Find Available IPs
1. Select subnet
2. Look for light gray blocks in IP map
3. Or check "First Free IP" in Statistics

### Check EKS Pod IPs
1. Look for cyan (secondary IPs) and purple (prefix IPs)
2. Statistics panel shows counts by type
3. Hover over blocks to see ENI details

### Monitor Fragmentation Trend
1. Regularly check same subnets
2. Track fragmentation score over time
3. High fragmentation = time to optimize

### Filter by Utilization
1. Click ⚙️ to open filters
2. Use Utilization Range slider
3. Find subnets with specific usage levels (e.g., 75-85%)

### Search Specific Subnet
1. Click ⚙️ to open filters
2. Type subnet name in Search box
3. Results filter in real-time

---

## API Examples

Want to use SubnetViz data in your own tools?

### Get All VPCs
```bash
curl http://localhost:5000/api/vpcs?region=us-east-1
```

### Get Subnets in a VPC
```bash
curl http://localhost:5000/api/vpc/vpc-12345678/subnets
```

### Get All IPs in a Subnet
```bash
curl http://localhost:5000/api/subnet/subnet-87654321/ips
```

### Get Paginated IPs (First 5000)
```bash
curl "http://localhost:5000/api/subnet/subnet-87654321/ips/paginated?offset=0&limit=5000"
```

### Health Check
```bash
curl http://localhost:5000/api/health
```

See [README.md](README.md#api-endpoints) for full API documentation.

---

## Deployment to Production

### Docker Image for ECS/Fargate

Build production image (same Docker build):
```bash
docker build -t subnetviz:1.0.0 .
```

Push to ECR:
```bash
# Get login token
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

# Tag image
docker tag subnetviz:1.0.0 YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/subnetviz:1.0.0

# Push to ECR
docker push YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/subnetviz:1.0.0
```

Then use image in ECS task definition with:
- IAM task role (for EC2 permissions)
- Port 5000 exposed to ALB
- Environment variables for region

See [README.md](README.md#deployment) for detailed deployment instructions.

---

## Performance Expectations

| Subnet Size | Time | Notes |
|-------------|------|-------|
| /24 (256 IPs) | <100ms | Instant load |
| /20 (4K IPs) | <500ms | Fast load |
| /18 (16K IPs) | 1-2s | First page loads, rest paginated |
| /16 (65K IPs) | 2-5s | First page instantly, full load ~60s |

Large subnets use pagination:
- First 5K IPs load immediately
- Remaining IPs load in background
- UI stays responsive during loading
- Use filters to narrow results if needed

---

## Tips & Tricks

1. **Bookmark your favorite VPC** - Easier to get back to frequently-viewed VPCs
2. **Use filters early** - Search narrows results before viewing large lists
3. **Check First Free IP** - Quickly see next available IP in subnet
4. **Monitor fragmentation** - Track over time to identify allocation patterns
5. **Export API data** - Use REST API to integrate with monitoring tools
6. **Collapse filters** - Use ⚙️ to save screen space on smaller displays
7. **Multi-region** - Use region dropdown to query different regions

---

## Troubleshooting

### Docker Issues

| Error | Solution |
|-------|----------|
| `docker: command not found` | Docker not installed; install from docker.com |
| `Cannot connect to Docker daemon` | Docker service not running; start Docker |
| `port 5000 already in use` | Change port: `-p 6000:5000` or stop other apps |
| `Frontend not built yet` | Rebuild image: `docker build --no-cache -t subnetviz:1.0.0 .` |

### AWS Credential Issues

| Error | Solution |
|-------|----------|
| `Failed to fetch VPCs` | Run `aws sts get-caller-identity` to verify credentials |
| `Permission denied` (403) | Check IAM policy includes EC2 describe permissions |
| `NoCredentialProviders` | Set AWS_ACCESS_KEY_ID/SECRET or use `~/.aws/credentials` |

### Frontend Issues

| Error | Solution |
|-------|----------|
| `Connection refused` | Backend not running; check Flask terminal |
| `Failed to fetch regions` | Check browser console (F12) for CORS issues |
| `Cannot read property 'map'` | Backend not responding; verify it's running |

### Local Development Issues

| Error | Solution |
|-------|----------|
| `ModuleNotFoundError: No module named 'flask'` | Run `pip install -r requirements.txt` |
| `npm: command not found` | Node.js not installed; install from nodejs.org |
| `React app won't start` | Run `cd frontend && npm install` |

---

## Next Steps

### Learn More
- Full documentation: [README.md](README.md)
- API details: [README.md#api-endpoints](README.md#api-endpoints)
- Deployment guide: [README.md#deployment](README.md#deployment)

### Deploy to Production
- Build Docker image
- Push to ECR
- Create ECS task definition
- Deploy to Fargate cluster

### Integrate with Your Tools
- Use REST API to fetch subnet data
- Build custom dashboards
- Automate fragmentation monitoring
- Integrate with IaC tools

---

## Support

Having trouble?

1. **Check logs**:
   - Docker: `docker logs <container-id>`
   - Local Flask: Check terminal output
   - Frontend: Browser DevTools (F12 → Console)

2. **Verify setup**:
   - AWS credentials: `aws sts get-caller-identity`
   - Backend running: `curl http://localhost:5000/api/health`
   - Frontend connection: Browser console (F12)

3. **Review documentation**:
   - [README.md](README.md) - Full documentation
   - [Troubleshooting section](README.md#troubleshooting) - Common issues

---

**Ready to visualize your subnets?** 🚀

Choose your path above and get started in under 5 minutes!
