# AegisGate — Distributed API Gateway & Intelligent Rate Limiter

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/Fastify-v5.2-black.svg)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-blue.svg)](https://www.postgresql.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python-green.svg)](https://fastapi.tiangolo.com/)

> **Portfolio Project 01** in the Backend Engineer / SDE Distributed Systems Portfolio.  
> **Author**: Nishit Bhardwaj — Systems Architect & Software Development Engineer.

---

## Overview

**AegisGate** is a production-grade, distributed API Gateway and rate limiting system built to safeguard downstream microservices against traffic spikes, cascading failures, and unauthorized access.

### Core Features & Architecture

- **Multi-Upstream Dynamic Reverse Proxying**: Routes traffic across heterogeneous microservices:
  - **Catalog Service**: Node.js & Fastify microservice (`/api/catalog/*`)
  - **Orders Service**: Python FastAPI microservice (`/api/orders/*`)
- **Resilient Timeout & Failure Isolation**:
  - Automatically isolates upstream service outages, returning bounded `HTTP 502 Bad Gateway` and `HTTP 504 Gateway Timeout` responses within 1500ms, preventing connection pool exhaustion.
- **Persistent Database Foundation**:
  - PostgreSQL backing store for client management, API keys, and audit logging.
  - Validated runtime configuration with Zod.
  - Dual-mode health check endpoints (`/health/live` for process liveness, `/health/ready` for database dependency verification).
- **SCRAM-SHA-256 Authentication**: Secure local and remote database credential validation.

---

## Project Structure

```text
AegisGate/
├── apps/
│   ├── gateway/                  # Core API Gateway (Fastify, TypeScript)
│   │   ├── src/
│   │   │   ├── config/           # Zod validated runtime configuration
│   │   │   ├── db/               # PostgreSQL connection pooling
│   │   │   ├── app.ts            # Fastify application factory & reverse proxy routes
│   │   │   └── main.ts           # Gateway entrypoint & listener
│   ├── catalog-service/          # Catalog microservice (Fastify, TypeScript)
│   └── orders-service/           # Orders microservice (FastAPI, Python)
├── database/
│   └── migrations/               # SQL database migrations
│       └── 001_initial.sql       # Clients, API keys, and audit logs schema
├── scripts/                      # Automated smoke & integration test scripts
├── compose.postgres.yml          # Container configuration for PostgreSQL
└── package.json                  # Monorepo workspaces manifest
```

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start PostgreSQL
```bash
docker compose --env-file .env.postgres -f compose.postgres.yml up -d
```

### 3. Start Microservices
```bash
# Terminal 1 - Catalog Service
node apps/catalog-service/dist/main.js

# Terminal 2 - Orders Service
cd apps/orders-service
.venv\Scripts\uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 3 - AegisGate Gateway
npm run dev
```

### 4. Health Checks
- Gateway Liveness: `curl http://127.0.0.1:8080/health/live`
- Gateway Readiness: `curl http://127.0.0.1:8080/health/ready`
