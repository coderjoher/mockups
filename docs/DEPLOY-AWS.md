# Deploy on AWS

One EC2 instance runs every service with Docker Compose. Images and exports go to an S3 bucket, and Caddy serves HTTPS with a free Let's Encrypt certificate.

```
Internet ──443──▶ Caddy ──▶ web (Next.js) ──/api──▶ api (Fastify)
                                                   │
                     Postgres · Redis ◀────────────┤
                     capture-worker (Chromium) ◀───┤ jobs
                     render-worker (OpenCV) ◀──────┘
                                   │
                                   ▼
                               S3 bucket (via instance role, no keys stored)
```

Rough cost: about $60–75 a month for a t3.large running all month, plus storage and data transfer. A t3.medium (4 GB) works for light use and costs about half that.

## 1. S3 bucket

1. Open **S3 → Create bucket**. Use a name such as `mockups-yourcompany` and pick a region such as `eu-central-1`.
2. Keep **Block all public access** turned on. The app shares files through signed links, so the bucket stays private.
3. Under **Permissions → CORS**, paste:
   ```json
   [{ "AllowedMethods": ["GET"], "AllowedOrigins": ["https://YOUR-DOMAIN"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
   ```

## 2. IAM role for the server

1. Open **IAM → Roles → Create role → AWS service → EC2**.
2. Add an inline policy, putting your bucket name in place of `BUCKET`:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
       "Resource": "arn:aws:s3:::BUCKET/*"
     }, {
       "Effect": "Allow",
       "Action": ["s3:ListBucket"],
       "Resource": "arn:aws:s3:::BUCKET"
     }]
   }
   ```
3. Name the role `mockups-ec2`.

## 3. EC2 instance

1. Open **EC2 → Launch instance**.
2. Choose these settings:
   - **AMI**: Ubuntu Server 24.04 LTS.
   - **Type**: `t3.large`.
   - **Storage**: 40 GB gp3.
   - **IAM instance profile**: `mockups-ec2`.
3. In the security group, allow inbound **22** (from your IP only), **80** and **443** (from anywhere).
4. Attach an **Elastic IP**, so the address doesn't change after a restart.
5. At your domain registrar (or Route 53), add an **A record**. Point `mockups.yourdomain.com` at that IP.

## 4. Install and start

SSH in (`ssh ubuntu@YOUR-IP`), then run:

```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker

# Code
git clone https://github.com/coderjoher/mockups.git && cd mockups

# Settings
cat > .env <<EOF
DOMAIN=mockups.yourdomain.com
APP_SECRET=$(openssl rand -hex 32)
S3_BUCKET=mockups-yourcompany
S3_REGION=eu-central-1
EOF

# Build and start (first build: 10–20 minutes)
docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d --build
```

Open `https://mockups.yourdomain.com`. The certificate is issued on the first request, which can take up to a minute.

## 5. First login

1. Sign in as `admin@example.com` / `admin12345`, then **change the password right away**.
2. Add your own mockup photos in **Admin → Mockup photos**. The 12 placeholder photos aren't installed on AWS.
3. Optional: to turn off public sign-up, add `SIGNUP_DISABLED=1` to `.env` and run the `up -d` command again.

## Day-to-day

| Task | Command (inside `~/mockups`) |
|---|---|
| Update to the latest code | `git pull && docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d --build` |
| See logs | `docker compose -f docker-compose.yml -f docker-compose.aws.yml logs -f api capture-worker render-worker` |
| More capture capacity | add `--scale capture-worker=2` to the `up` command (needs more RAM) |
| Back up the database | `docker compose exec postgres pg_dump -U mockups mockups > backup.sql` |

Tip: put `alias dc='docker compose -f docker-compose.yml -f docker-compose.aws.yml'` in `~/.bashrc`.

## Optional: managed database (RDS)

For automatic backups, create an **RDS PostgreSQL 16** instance in the same VPC, and allow port 5432 from the EC2 security group. Then add this to `.env`:

```
DATABASE_URL=postgres://USER:PASSWORD@your-db.xxxxx.eu-central-1.rds.amazonaws.com:5432/mockups
```

The local `postgres` container then sits idle. Redis can stay on the instance, because it only holds the job queue.

## Why not Lambda or Amplify

The capture worker runs a full Chromium for up to a minute per page, and the render worker is a long-running Python process. Neither fits serverless time and size limits, so a regular server (EC2, or ECS later) is the right shape.
