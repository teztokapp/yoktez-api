import express from "express";
import cors from "cors";
import {
  getCategories,
  getCategoryFeed,
  getCacheStats,
  getDisciplines,
  getDisciplineFeed,
  getFeed,
  getRandomThesis,
  getThesisById,
  searchTheses,
} from "./yoktezClient.js";
import { generateSummary } from "./summary.js";

export function createYoktezApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "yoktez",
      scraper: "adapter-ready",
      cache: getCacheStats(),
    });
  });

  app.get("/api/random-thesis", async (req, res, next) => {
    try {
      const seed = Number(req.query.seed ?? Math.random());
      const thesis = await getRandomThesis(seed);
      res.json(thesis);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/feed", async (req, res, next) => {
    try {
      const cursor = Number(req.query.cursor ?? 0);
      const limit = Math.min(Number(req.query.limit ?? 4), 10);
      const year = req.query.year;
      const feed = await getFeed(cursor, limit, year);
      res.json(feed);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/search", async (req, res, next) => {
    try {
      const criteria = {
        query: String(req.query.q ?? ""),
        title: String(req.query.title ?? ""),
        author: String(req.query.author ?? ""),
        source: String(req.query.source ?? ""),
        year: String(req.query.year ?? ""),
        limit: Number(req.query.limit ?? 20),
      };
      const results = await searchTheses(criteria);
      res.json({
        query: criteria.query,
        count: results.length,
        items: results,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/categories", async (_req, res, next) => {
    try {
      const items = await getCategories();
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/disciplines", async (_req, res, next) => {
    try {
      const items = await getDisciplines();
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/category-feed", async (req, res, next) => {
    try {
      const category = String(req.query.category ?? "");
      const year = req.query.year;
      const payload = await getCategoryFeed(category, year);
      res.json({
        category,
        ...payload,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/discipline-feed", async (req, res, next) => {
    try {
      const discipline = String(req.query.discipline ?? "");
      const year = req.query.year;
      const payload = await getDisciplineFeed(discipline, year);
      res.json({
        discipline,
        ...payload,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/thesis/:id", async (req, res, next) => {
    try {
      const thesis = await getThesisById(req.params.id);

      if (!thesis) {
        res.status(404).json({ error: "Thesis not found" });
        return;
      }

      res.json(thesis);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/thesis/:id/summary", async (req, res, next) => {
    try {
      const thesis = await getThesisById(req.params.id);

      if (!thesis) {
        res.status(404).json({ error: "Thesis not found" });
        return;
      }

      const summary = await generateSummary(thesis);
      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  });

  return app;
}
