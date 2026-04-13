# YOKTez API

Standalone Express API for TezTok's YOK Tez integration.

## What it does

- Serves thesis feed, search, discipline, and thesis detail endpoints
- Wraps the YOK Tez scraping/client logic
- Generates AI summaries when `OPENAI_API_KEY` is available

## Endpoints

- `GET /api/health`
- `GET /api/random-thesis`
- `GET /api/feed`
- `GET /api/search`
- `GET /api/categories`
- `GET /api/disciplines`
- `GET /api/category-feed`
- `GET /api/discipline-feed`
- `GET /api/thesis/:id`
- `POST /api/thesis/:id/summary`

## Environment

- `PORT` defaults to `3001`
- `OPENAI_API_KEY` enables AI summaries
- `SCRAPER_BASE_URL` points to an optional Playwright-backed scraper service

## Run locally

```bash
npm install
npm run build
npm run dev
```
