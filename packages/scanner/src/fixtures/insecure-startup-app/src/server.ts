import cors from "cors";
import express from "express";

const app = express();

app.use(cors({ origin: "*" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});
