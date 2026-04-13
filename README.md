# YOKTez API

Standalone API server for fetching and searching academic theses from the YOK Tez Merkezi.

## Features

- **Search**: Search theses by title, author, and year.
- **Feed**: Get the latest theses in a paginated feed.
- **Random**: Fetch a random thesis for discovery.
- **Summary**: Generate AI summaries for theses (OpenAI required).
- **Categories/Disciplines**: Explore theses by topic or academic discipline.

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
