# YÖK Tez Merkezi API

Standalone API server for fetching and searching academic theses from the YOK Tez Merkezi.

## Features

- **Search**: Search theses by title, author, and year.
- **Feed**: Get the latest theses in a paginated feed.
- **Random**: Fetch a random thesis for discovery.
- **Summary**: Generate AI summaries for theses (OpenAI required).
- **Categories/Disciplines**: Explore theses by topic or academic discipline.

## API Endpoints

All endpoints are available under the `/api` prefix (e.g., `http://localhost:3001/api/feed`).

### Core Endpoints

| Method | Path | Description | Query Parameters |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Check service health and cache status. | - |
| `GET` | `/feed` | Get a paginated feed of the latest theses. | `cursor` (number), `limit` (max 10), `year` |
| `GET` | `/search` | Search theses with specific criteria. | `q`, `title`, `author`, `year`, `source`, `limit` |
| `GET` | `/random-thesis` | Fetch a random thesis for discovery. | `seed` (number) |
| `GET` | `/thesis/:id` | Get full details for a specific thesis by ID. | - |
| `POST` | `/thesis/:id/summary` | Generate an AI summary for the thesis. | - |

### Discovery Endpoints

| Method | Path | Description | Query Parameters |
| :--- | :--- | :--- | :--- |
| `GET` | `/categories` | List all available academic categories. | - |
| `GET` | `/disciplines` | List all available academic disciplines. | - |
| `GET` | `/category-feed` | Get a feed filtered by category name. | `category` (string), `year` |
| `GET` | `/discipline-feed` | Get a feed filtered by discipline name. | `discipline` (string), `year` |

## Vercel Deployment

This project is ready to be deployed on Vercel as a Serverless Function.

1. Install Vercel CLI: `npm i -g vercel`
2. Link to your project: `vercel link`
3. Deploy: `vercel`

The `vercel.json` is configured to route all `/api/*` requests to the Express app.

## Local Development

```bash
npm install
npm run dev
```

The server will run on `http://localhost:3001`.

## Environment Variables

- `PORT`: Port for the main API (default: 3001)
- `SCRAPER_BASE_URL`: (Optional) URL of the Playwright scraper if using remote scraping.
- `OPENAI_API_KEY`: (Optional) Required for thesis summarization.
