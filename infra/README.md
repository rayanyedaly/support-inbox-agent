# infra — AWS CDK stack

A **separate, cuttable infrastructure artifact**, not the demo host. The app runs
locally (and in CI) against Docker Postgres; this stack exists to show the same
container standing up on AWS as real, account-agnostic IaC. The intended lifecycle is
**deploy → screenshot → destroy** — nothing is meant to stay running.

## What it provisions

```
internet ──► ALB ──► Fargate task (Next.js standalone + Prisma) ──► RDS Postgres
```

- **VPC** — 2 AZs, public + isolated subnets, **no NAT gateway**. The task runs in a
  public subnet with a public IP and egresses via the internet gateway (pulls its image,
  reaches the Anthropic API). RDS sits in isolated subnets.
- **RDS Postgres 16** — `t4g.micro`, single-AZ, not publicly accessible, password
  generated into Secrets Manager. Disposable: `RemovalPolicy.DESTROY`, no deletion
  protection, no backups.
- **Fargate service** — 0.25 vCPU / 0.5 GB behind a public ALB. The container entrypoint
  runs `prisma migrate deploy` (and, with `-c seed=true`, `prisma db seed`) before the
  server listens. Health check hits `/api/health`.
- **Secrets** — DB credentials (RDS-generated) and an empty `AnthropicApiKey` secret you
  populate after deploy.

## Account-agnostic

`bin/infra.ts` reads `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`, so it deploys to
whichever account the executing credentials point at — nothing is hardcoded. With no
credentials those are undefined, which makes the stack environment-agnostic and lets
`cdk synth` run fully offline.

## Image is decoupled from synth

The stack takes the container image as input (`-c imageUri=…` or `IMAGE_URI`) and uses a
public placeholder otherwise. That keeps `cdk synth` **Docker-free and credential-free** —
build and push happen as an explicit step before deploy, not implicitly during synthesis.

## Usage

```bash
cd infra
npm install
npm run synth          # offline, no AWS creds, no Docker — the bar for "done"

# --- to actually deploy (incurs cost while running) ---
cdk bootstrap                                   # once per account/region

# build + push the app image to ECR
aws ecr create-repository --repository-name inbox-agent
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region)
ECR=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR
# build context = repo root; pin amd64 to match the task's runtimePlatform
# (required on Apple Silicon — a mismatched arch ships an unloadable Prisma engine)
docker buildx build --platform linux/amd64 -t $ECR/inbox-agent:latest ..
docker push $ECR/inbox-agent:latest

# deploy (seed the demo data on first boot)
npm run deploy -- -c imageUri=$ECR/inbox-agent:latest -c seed=true

# set the Anthropic key into the secret printed as AnthropicSecretArn, then
# force a new deployment so the task picks it up:
aws secretsmanager put-secret-value --secret-id <AnthropicSecretArn> --secret-string 'sk-ant-...'
aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment

# --- when done ---
npm run destroy
```

`cdk synth` clean is the definition of done here; a live deploy is optional and torn down
immediately. There is no persistent hosted environment and no ongoing cost.
