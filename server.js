// server.js — Health & Safety Assistant (pure-JS version)
// ISO Timestamp: 🕒 2025-10-18T15:00:00Z

import express from "express";
import bodyParser from "body-parser";
import OpenAI from "openai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { Buffer } from "buffer";
import { loadIndex, searchIndex } from "./vector_store.js";
import cors from "cors";

dotenv.config();
const app = express();
app.use(cors());
app.options("*", cors());

const PORT = process.env.PORT || 3002;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ------------------------------------------------------------------ */
/*                       FIXED INDEX PRELOAD                          */
/* ------------------------------------------------------------------ */

let globalIndex = null;
let indexReady = false;

(async () => {
  try {
    console.log("📦 Preloading FAISS vector index (10 000 chunks)...");
    globalIndex = await loadIndex(10000);
    indexReady = true;
    console.log(`✅ Preloaded ${globalIndex.length.toLocaleString()} vectors.`);
  } catch (e) {
    console.error("❌ Index preload failed:", e.message);
  }
})();

/* ------------------------------------------------------------------ */
/*                    FIXED FAISS QUERY FUNCTION                      */
/* ------------------------------------------------------------------ */

async function queryFaissIndex(question) {
  if (!indexReady || !globalIndex) {
    console.log("⏳ Index still loading…");
    return { joined: "", count: 0 };
  }

  try {
    const matches = await searchIndex(question, globalIndex);
    const filtered = matches.filter((m) => m.score >= 0.03);
    const texts = filtered.map((m) => m.text);
    console.log(`🔎 Found ${texts.length} chunks for “${question}”`);
    return { joined: texts.join("\n\n"), count: filtered.length };
  } catch (err) {
    console.error("❌ FAISS query failed:", err.message);
    return { joined: "", count: 0 };
  }
}

/* ------------------------------------------------------------------ */
/*                        REPORT GENERATION                           */
/* ------------------------------------------------------------------ */

async function generateHSReport(query) {
  if (!indexReady) {
    return "⏳ The Health & Safety knowledge base is still loading. Please wait a few seconds and try again.";
  }

  const { joined, count } = await queryFaissIndex(query);
  let context = joined;

  if (context.length > 50000) context = context.slice(0, 50000);

  const prompt = `
You are a qualified UK health and safety consultant preparing a formal internal compliance report.
Use HM Government workplace safety, risk management, and regulatory guidance to produce a structured, professional summary.

Question: "${query}"

Context:
${context}`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content:
          "You are the Health & Safety Manager. You must never offer, suggest, or mention producing a report, template, or document. \
Only provide factual Health & Safety guidance drawn from UK HSE, CDM, COSHH, and RIDDOR sources.",
      },
      { role: "user", content: prompt },
    ],
  });

  let text = completion.choices[0].message.content.trim();

  // fairness audit cut for brevity in this explanation, but kept in your original
  // (the rest unchanged)
  return text;
}

/* ------------------------------------------------------------------ */
/*                                /ask                                */
/* ------------------------------------------------------------------ */

app.post("/ask", async (req, res) => {
  const { question, email, managerEmail, clientEmail } = req.body || {};
  console.log("🧾 /ask", { question, email, managerEmail, clientEmail });

  if (!question) return res.status(400).json({ error: "Missing question" });

  if (!indexReady) {
    return res.json({
      answer: "⏳ The Health & Safety knowledge base is still loading. Please try again in a few seconds.",
      question,
    });
  }

  try {
    const ts = new Date().toISOString();
    const reportText = await generateHSReport(question);

    res.json({ question, answer: reportText, timestamp: ts });
  } catch (err) {
    console.error("❌ Report failed:", err);
    res.status(500).json({ error: "Report generation failed" });
  }
});

/* ------------------------------------------------------------------ */
/*                             FRONTEND                               */
/* ------------------------------------------------------------------ */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "health_safety.html"));
});

/* ------------------------------------------------------------------ */
/*                            PORT BINDING                            */
/* ------------------------------------------------------------------ */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🟢 Health & Safety Assistant running on port ${PORT}`);
});
