# SportsBrain — Edge-Native Sports Data & Prediction Platform

> A full-stack data platform that ingests live sports data, runs a Bayesian + machine-learning prediction engine **at the edge**, and serves calibrated, ranked predictions through a global low-latency API. This repository is the **engineering core** of the project: edge API, React frontend, ML service, training pipeline, and a high-performance Rust real-time gateway.

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![D1](https://img.shields.io/badge/DB-D1%20SQLite%20%2B%20Neon%20PG-003B57?logo=sqlite&logoColor=white)
![Python](https://img.shields.io/badge/ML-XGBoost%20%2F%20LightGBM-3776AB?logo=python&logoColor=white)
![Rust](https://img.shields.io/badge/Realtime-Rust%20%2F%20Axum-000000?logo=rust&logoColor=white)

---

## What it is

SportsBrain answers a hard data problem: **take noisy, real-time sports data, model it rigorously, and serve trustworthy probabilities fast and globally.**

It's the project where I went deep on production data engineering — edge compute, statistical calibration, ML in production, and a Rust real-time layer — rather than a notebook that runs once.

## Architecture

```
   DATA INGESTION              EDGE INTELLIGENCE                SERVING
┌──────────────────┐      ┌─────────────────────────┐    ┌──────────────────┐
│ Scheduled        │ HMAC │  Cloudflare Worker      │    │ React 18 SPA     │
│ collectors       │─POST▶│  (ESM, ~10ms global)    │───▶│ (Vercel CDN)     │
│ (REST + browser  │      │                         │    │ dashboards,      │
│  automation,     │      │  • xG / Poisson model   │    │ analytics        │
│  separate svc)   │      │  • Bayesian shrinkage   │    └──────────────────┘
└──────────────────┘      │  • Isotonic calibration │
                          │  • ML ensemble call     │    ┌──────────────────┐
   REAL-TIME              │                         │    │ Cloudflare D1    │
┌──────────────────┐      │  Cache API + Durable    │◀──▶│ (edge SQLite)    │
│ Rust gateway     │◀────▶│  Objects (WS broadcast) │    │ Neon Postgres    │
│ (Axum, WS, Redis)│      └───────────┬─────────────┘    │ (2-yr partitions)│
└──────────────────┘                  │ /predict/*       └──────────────────┘
                          ┌───────────▼─────────────┐
                          │ Python ML service       │
                          │ FastAPI + XGBoost/LGBM  │
                          └─────────────────────────┘
```

**Flow:** scheduled collectors ingest data → the Worker normalizes and enriches it → the intelligence engine produces calibrated probabilities → results are cached in D1 (edge) with long-term history in partitioned Neon Postgres → the React SPA consumes a versioned REST API, with a Rust gateway handling real-time fan-out.

## Engineering highlights

- **Edge-native backend** — the entire API runs on **Cloudflare Workers** (ESM) across ~200 data centers at ~10ms latency, backed by **D1** (edge-replicated SQLite). Real-time updates broadcast over WebSocket via **Durable Objects**; caching uses the native **Cache API**; rate limiting is built in.
- **Statistical rigor, hand-written** — **Beta-Binomial shrinkage** so low-sample estimates pull toward sane priors instead of overfitting, and **isotonic regression / Pool-Adjacent-Violators calibration** so a predicted 70% actually means a 70% empirical rate. Implemented from the math, not a black-box library.
- **ML in production with graceful degradation** — a Python **FastAPI** microservice serving **XGBoost + LightGBM** ensembles (NBA spreads/totals, soccer 1X2), with a **Poisson / Normal-CDF heuristic fallback** so the system keeps producing sensible output when no trained model is loaded.
- **Rust real-time gateway** — an **Axum** (Tokio) service with WebSocket fan-out, **sqlx**/Postgres and **Redis** streams, compiled with `lto = "fat"` for a lean, low-latency real-time layer.
- **Two-tier storage** — hot reads from edge D1; two years of history in **Neon Postgres** partitioned into 24 monthly tables for cheap analytical queries.
- **Tested** — Vitest suite across the backend, including **redaction regression locks** that fail the build if a secret or bearer token could leak into a rendered report.

## Tech stack

| Layer | Stack |
|---|---|
| **Frontend** | React 18 · Vite 5 · Zustand · Chart.js · React Router — deployed on **Vercel** |
| **Backend (API)** | **Cloudflare Workers** (ESM) · **D1** (SQLite) · Durable Objects · Cache API · Wrangler |
| **Long-term store** | **Neon Postgres** (HTTP driver, 24 monthly partitions, 2-yr retention) |
| **Real-time** | **Rust · Axum · Tokio · sqlx · Redis** |
| **ML service** | **Python · FastAPI · XGBoost · LightGBM · scikit-learn · pandas** |
| **Testing** | Vitest |

## Repository layout

```
sportsbrain-api/      Cloudflare Worker — routes, services, ml/, cron/, migrations, schemas
sportsbrain-react/    React 18 SPA (dashboards, analytics)
rust-gateway/         Axum (Rust) real-time WebSocket gateway — Postgres + Redis
ml-service/           Python FastAPI + XGBoost/LightGBM inference
ml-pipeline/          Node model-training pipeline
```

> **Note:** the data-ingestion collectors run as a separate private service and are intentionally **not** included in this repository. This repo is curated to showcase the platform's engineering — edge API, statistics, ML, real-time and frontend.

## Configuration

No secrets live in this repo. The Worker reads runtime secrets via `wrangler secret put` (e.g. data-provider API keys, the Neon connection URL, the internal auth token); the React app reads `VITE_*` env vars. The resource IDs in `wrangler.toml` (D1 database id, rate-limit namespace) are non-sensitive Cloudflare identifiers.

---

*Built by Caio — Data Analyst & Data Lead. A personal R&D project to push my data-engineering, statistics and ML-in-production skills end-to-end.*

---

## Usage & rights

This repository is **source-available for review** in a portfolio / hiring context — it is **not** open-source. No license is granted to use, copy, modify, or redistribute the code. The data-ingestion layer and the proprietary prediction / odds / signal logic are intentionally **withheld or reduced to stubs**; what remains is meant to demonstrate engineering, not to be run or reused.

© 2026 Caio. All rights reserved.
