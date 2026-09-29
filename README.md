# gcp-devops-pipeline

A mid-level DevOps project: a containerized Node.js API (tiny URL shortener) with a
full **CI/CD pipeline**, **Infrastructure as Code (Terraform)** on **Google Cloud**,
and **monitoring** — built to stay inside GCP's free tier.

```
                  ┌──────────────────────────────────────────────────┐
                  │                  GitHub                          │
                  │  push to main                                    │
                  │   1. npm test (unit tests)                       │
                  │   2. docker build + Trivy vulnerability scan     │
                  │   3. push image ─┐                               │
                  │   4. terraform apply (WIF auth, no keys)         │
                  └──────────────────┼───────────────────────────────┘
                                     ▼
                  ┌──────────────────────────────────────────────────┐
                  │              Google Cloud (asia-south1)          │
                  │                                                  │
                  │  Artifact Registry ──► Cloud Run (scales to 0)   │
                  │        │                       │                 │
                  │        │              ┌────────┴────────┐        │
                  │        │              │  /healthz       │        │
                  │        │              │  /metrics       │        │
                  └────────┼──────────────┴─────────────────┘        │
                           │                                         │
                  Cloud Monitoring: uptime check (5 min) + alert     │
                  when the check fails                               │
                  └──────────────────────────────────────────────────┘
```

## What's inside

| Area | Implementation |
|---|---|
| App | `app/` — zero-dependency Node.js URL shortener with `/healthz` and Prometheus `/metrics` |
| Containers | Multi-stage `Dockerfile` (reproducible builds, non-root user, healthcheck), `.dockerignore` |
| Local dev | `docker-compose.yml` — API + Prometheus scraping `/metrics` |
| CI/CD | `.github/workflows/ci-cd.yml` — test → build → Trivy scan → push → Terraform deploy |
| IaC | `terraform/` — Artifact Registry, Cloud Run (scale-to-zero), uptime check, alert policy |
| Monitoring | Cloud Monitoring uptime check + alert (Terraform); Prometheus locally via compose |
| Auth | Workload Identity Federation — no long-lived GCP keys in GitHub secrets |

## Run it locally

```bash
# unit tests
cd app && npm ci && npm test

# full stack with monitoring
docker compose up --build
# API:      http://localhost:8080
# Prometheus: http://localhost:9090
```

Try it:

```bash
curl -X POST localhost:8080/shorten \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
# → {"code":"aB3xYz","short_url":"https://localhost:8080/aB3xYz"}
curl -i localhost:8080/aB3xYz   # → 302 redirect
curl localhost:8080/metrics     # → Prometheus exposition format
```

## Deploy to GCP (one-time setup, ~15 min)

1. **GCP project** — create one at [console.cloud.google.com](https://console.cloud.google.com),
   enable billing (required even for free tier), and enable these APIs:
   `run.googleapis.com`, `artifactregistry.googleapis.com`, `monitoring.googleapis.com`,
   `iamcredentials.googleapis.com`.
2. **Workload Identity Federation** — in GCP Console: *IAM → Workload Identity Pools*,
   create a pool + OIDC provider for GitHub (`https://token.actions.githubusercontent.com`,
   attribute `assertion.repository == "<you>/gcp-devops-pipeline"`), then grant your
   service account `roles/run.admin`, `roles/artifactregistry.admin`,
   `roles/monitoring.admin`, `roles/iam.serviceAccountUser`.
3. **GitHub secrets** — in the repo: `GCP_WIF_PROVIDER` (full provider resource name),
   `GCP_SERVICE_ACCOUNT` (email), `GCP_PROJECT_ID`.
4. **Push to `main`** — the workflow tests, scans, pushes the image tagged with the
   commit SHA, and runs `terraform apply`. The service URL is printed by Terraform outputs.

Manual Terraform run (same thing the pipeline does):

```bash
cd terraform
terraform init
terraform apply -var="project_id=YOUR_PROJECT_ID" -var="image_tag=<sha>"
```

## Cost

Designed for GCP's free tier at demo traffic:

| Resource | Free tier | This project |
|---|---|---|
| Cloud Run | 2M requests/mo, 360k GB-seconds | scales to **0** — idle costs nothing |
| Artifact Registry | 0.5 GB storage | one small Node image (~120 MB) |
| Monitoring | 150 MB logs, basic checks | 1 uptime check / 5 min |

**Tear down when done:** `terraform destroy -var="project_id=YOUR_PROJECT_ID"` —
Cloud Run scale-to-zero means you can also just leave it; it costs nothing idle.

## Interview talking points

- **Why Cloud Run over GKE?** Serverless containers = no cluster to babysit, scale-to-zero
  for cost, still real production traffic handling. Right tool for a stateless API.
- **Why Workload Identity Federation?** Short-lived OIDC tokens instead of JSON keys —
  no secret rotation, nothing to leak.
- **Why Trivy in the pipeline?** Shift-left security: fail the build on CVEs before the
  image ever reaches the registry.
- **Why Terraform, not click-ops?** Reproducible, reviewable, destroyable. The pipeline
  applies the exact same code I tested locally.
- **Observability:** `/metrics` for Prometheus locally, uptime checks + alerts in prod —
  you know it's down before users tell you.

## Repo layout

```
app/                    # Node.js API + tests + Dockerfile
terraform/              # versions.tf, variables.tf, main.tf, outputs.tf
.github/workflows/     # ci-cd.yml
monitoring/             # prometheus.yml (local)
docker-compose.yml
```

## License

MIT
