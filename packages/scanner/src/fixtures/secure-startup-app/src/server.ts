import cors from "cors";
import express from "express";

const app = express();
const allowedOrigins = ["https://app.example.test"];

app.use(cors({ origin: allowedOrigins }));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});
