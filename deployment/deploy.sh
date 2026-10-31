#!/usr/bin/env bash
#
# deployment/deploy.sh — Deploy Baddy Club Open (badminton scores)
# (https://baddyclub.playmotech.com) from a developer machine.
#
# Self-contained: builds this repo and rolls it onto the PlayMo prod ECS
# service `baddyclub`. Mirrors prod-setup's scripts/deploy-baddy-club.sh; if
# the task definition below changes, tell Suryakant so both stay in sync.
#
# WHEN TO RUN IT
#   Only for CODE changes. Scores, draws, photos and anything else edited in
#   the Google Sheet show up on the site by themselves within ~20 seconds
#   (or at once via the site's Refresh button). Never deploy for data.
#
# ONE-TIME SETUP
#   1. Docker Desktop running; AWS CLI v2; git; curl.
#   2. AWS credentials for account 381491921497 carrying the
#      `BaddyclubDeploy` policy (ask Suryakant). Either `aws configure`
#      or `export AWS_PROFILE=<profile>` before running.
#
# USAGE  (from anywhere; it builds the repo this script lives in)
#   ./deployment/deploy.sh              build HEAD, push, deploy
#   ./deployment/deploy.sh --build-only build only; touches nothing in AWS
#   ./deployment/deploy.sh --tag 9aff740
#                                                       redeploy an image already in ECR
#                                                       (rollback: pass the previous commit's tag)
#   ./deployment/deploy.sh --context ~/code/baddy-club-web
#
# Images are tagged with the short commit SHA, so commit before deploying;
# an uncommitted tree is deployed as <sha>-dirty. A deploy takes ~3 minutes
# and has no downtime (the new task is healthy before the old one stops).
#
set -euo pipefail

REGION="us-east-2"
ACCOUNT_ID="381491921497"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
CLUSTER="sportsrally-prod"
NAME="baddyclub"
DOMAIN="baddyclub.playmotech.com"

CONTEXT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" TAG="" BUILD_ONLY="false"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --context)    CONTEXT="${2:-}"; shift 2 ;;
    --tag)        TAG="${2:-}"; shift 2 ;;
    --build-only) BUILD_ONLY="true"; shift ;;
    -h|--help)    grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            echo "Unknown argument: $1 (run --help)" >&2; exit 1 ;;
  esac
done

step() { printf '\n== %s ==\n' "$*"; }
ok()   { printf '✓ %s\n' "$*"; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Required tool not found: $1"; }

need docker; need git; need curl
docker info >/dev/null 2>&1 || die "Docker is not running."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── Build ────────────────────────────────────────────────────────────────
build() {  # build <extra docker args...>
  grep -q '"@tanstack/react-start"' "$CONTEXT/package.json" 2>/dev/null \
    || die "$CONTEXT is not the baddy-club-web repo (run from its root, or pass --context)."

  # The repo carries no Dockerfile (it is Lovable-synced; keep it that way).
  # BuildKit picks up <Dockerfile>.dockerignore next to the Dockerfile.
  cat > "$WORK/Dockerfile" <<'EOF'
# Build on the machine's native arch — the output is plain JS, so only the
# runtime stage has to match Fargate (amd64).
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# node_server emits .output/server/index.mjs + .output/public
RUN NITRO_PRESET=node_server npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/.output ./.output
EXPOSE 3000
USER node
CMD ["node", ".output/server/index.mjs"]
EOF
  cat > "$WORK/Dockerfile.dockerignore" <<'EOF'
node_modules
.output
dist
.git
.env
.env.*
.wrangler
.vercel
.nitro
.tanstack
companyDetails
EOF
  # --provenance=false: push a plain image manifest, one image per tag in ECR.
  docker buildx build --platform linux/amd64 --provenance=false \
    -f "$WORK/Dockerfile" "$@" "$CONTEXT"
}

if [[ "$BUILD_ONLY" == "true" ]]; then
  step "Build only (nothing is pushed or deployed)"
  build -t "${NAME}:build-check" --load
  ok "Build succeeded. Try it: docker run --rm -p 3000:3000 ${NAME}:build-check  (no sheet data without credentials)"
  exit 0
fi

need aws
aws() { command aws --region "$REGION" "$@"; }

ACCT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
  || die "AWS CLI has no working credentials (aws configure, or export AWS_PROFILE=...)."
[[ "$ACCT" == "$ACCOUNT_ID" ]] || die "AWS CLI is on account $ACCT, expected $ACCOUNT_ID (Playmo prod)."

if [[ -n "$TAG" ]]; then
  step "Redeploying existing image  (tag: $TAG)"
  aws ecr describe-images --repository-name "$NAME" --image-ids "imageTag=$TAG" >/dev/null 2>&1 \
    || die "No image tagged '$TAG' in ECR repo $NAME. List them: aws ecr describe-images --region $REGION --repository-name $NAME --query 'imageDetails[].imageTags' --output text"
  IMAGE="${REGISTRY}/${NAME}:${TAG}"
else
  TAG="$(git -C "$CONTEXT" rev-parse --short=7 HEAD)" || die "$CONTEXT is not a git repository."
  if [[ -n "$(git -C "$CONTEXT" status --porcelain)" ]]; then
    TAG="${TAG}-dirty"
    echo "⚠ Uncommitted changes — deploying as $TAG. Commit first so the tag identifies what is live."
  fi
  IMAGE="${REGISTRY}/${NAME}:${TAG}"
  step "Deploying $NAME  (tag: $TAG)"

  step "1/4  Build + push image"
  aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
  build -t "$IMAGE" --push
  ok "Pushed $IMAGE"
fi

# ── Task definition ──────────────────────────────────────────────────────
step "2/4  Register task definition"
# The Google key is not here: ECS reads it at task start from SSM Parameter
# Store. Nobody deploying needs (or can read) the key itself.
cat > "$WORK/taskdef.json" <<EOF
{
  "family": "${NAME}",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::${ACCOUNT_ID}:role/ecsTaskExecutionRole",
  "runtimePlatform": { "cpuArchitecture": "X86_64", "operatingSystemFamily": "LINUX" },
  "containerDefinitions": [
    {
      "name": "${NAME}",
      "image": "${IMAGE}",
      "essential": true,
      "portMappings": [ { "containerPort": 3000, "hostPort": 3000, "protocol": "tcp" } ],
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "3000" },
        { "name": "GOOGLE_SHEETS_ID", "value": "1poSwrMEFak3I2PeyIwsy7TlHcViwXjN9oCtGt6giZ9U" },
        { "name": "GOOGLE_SA_EMAIL", "value": "sports-day-reader@inmobi-sports-day-2026-506913.iam.gserviceaccount.com" }
      ],
      "secrets": [
        {
          "name": "GOOGLE_SA_PRIVATE_KEY",
          "valueFrom": "arn:aws:ssm:${REGION}:${ACCOUNT_ID}:parameter/playmo/prod/${NAME}/google-sa-private-key"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/${NAME}",
          "awslogs-region": "${REGION}",
          "awslogs-stream-prefix": "ecs",
          "awslogs-create-group": "true"
        }
      }
    }
  ]
}
EOF
TASKDEF_ARN="$(aws ecs register-task-definition --cli-input-json "file://$WORK/taskdef.json" \
  --query 'taskDefinition.taskDefinitionArn' --output text)"
ok "Registered ${TASKDEF_ARN##*/}"

# ── Roll the service ─────────────────────────────────────────────────────
step "3/4  Update ECS service"
PREVIOUS="$(aws ecs describe-services --cluster "$CLUSTER" --services "$NAME" \
  --query 'services[0].taskDefinition' --output text)"
aws ecs update-service --cluster "$CLUSTER" --service "$NAME" \
  --task-definition "$TASKDEF_ARN" --desired-count 1 >/dev/null
echo "Waiting for the new task to go healthy (about 3 minutes)..."
aws ecs wait services-stable --cluster "$CLUSTER" --services "$NAME" \
  || die "Service did not stabilize — the new task is probably crashing. The old one keeps serving. Roll back with: aws ecs update-service --region $REGION --cluster $CLUSTER --service $NAME --task-definition ${PREVIOUS##*/}"
# "Stable" is also what a rolled-back deployment looks like — confirm the
# service is actually on the revision just registered.
LIVE="$(aws ecs describe-services --cluster "$CLUSTER" --services "$NAME" \
  --query 'services[0].deployments[?status==`PRIMARY`].taskDefinition | [0]' --output text)"
[[ "$LIVE" == "$TASKDEF_ARN" ]] || die "Service is on ${LIVE##*/}, not ${TASKDEF_ARN##*/} — the deployment rolled back."
ok "Service stable on ${TASKDEF_ARN##*/}  (was ${PREVIOUS##*/})"

# ── Verify ───────────────────────────────────────────────────────────────
step "4/4  Verify the site reads the sheet"
STATUS="$(curl -fsS --retry 5 --retry-delay 3 "https://${DOMAIN}/api/sheet-status")" \
  || die "https://${DOMAIN}/api/sheet-status did not answer."
case "$STATUS" in
  *'"source":"sheet"'*) ok "Site is live and reading the Google Sheet" ;;
  *) die "Site is up but NOT reading the sheet: $STATUS" ;;
esac

step "Deployed"
echo "  Image:    $IMAGE"
echo "  Site:     https://${DOMAIN}"
echo "  Rollback: $0 --tag <previous-commit-sha>"
