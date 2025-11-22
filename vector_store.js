// vector_store.jsonl
// ISO Timestamp: 🕒 2025-10-13T11:15:00Z
// CHANGELOG:
// • Loads vector.index incrementally in small chunks (avoids RangeError)
// • Fully compatible with Accountant / H&S Assistant backend
// • Uses OpenAI embeddings + dot-product semantic search (no faiss-node)
// vector_store.jsonl
// ISO Timestamp: 🕒 2025-10-13T11:15:00Z
// CHANGELOG:
// • Loads vector.index incrementally in small chunks (avoids RangeError)
// • Fully compatible with Accountant / H&S Assistant backend
// • Uses OpenAI embeddings + dot-product semantic search (no faiss-node)

import fs from "fs";
import { OpenAI } from "openai";

const INDEX_PATH = "/mnt/data/vector.index";   // ← use your text-based JSONL file
const META_PATH  = "/mnt/data/chunks_metadata.jsonl";
const CHUNK_LIMIT = 50000;

console.log("🟢 vector_store.js (chunk-safe JSONL) using", INDEX_PATH);


console.log("🟢 vector_store.js (chunk-safe JSONL) using", INDEX_PATH);

const openai = new OpenAI({
apiKey: process.env.OPENAI_APIKEY || process.env.OPENAI_API_KEY,
});

/* ---------------------------------------------------------------------- */
/*  LOAD INDEX (reads JSONL embeddings)                                   */
/* ---------------------------------------------------------------------- */
export async function loadIndex(limit = CHUNK_LIMIT) {
console.log(`📦 Loading vector index in chunks (limit ${limit})...`);
const fd = await fs.promises.open(INDEX_PATH, "r");
const stream = fd.createReadStream({ encoding: "utf8" });

let buffer = "";
const vectors = [];
let processed = 0;

for await (const chunk of stream) {
buffer += chunk;
const parts = buffer.split("\n");
buffer = parts.pop(); // carry over incomplete line
for (const line of parts) {
if (!line.trim()) continue;
try {
const obj = JSON.parse(line);
if (obj.embedding) {
vectors.push(obj);
processed++;
if (processed % 1000 === 0)
console.log(`  → ${processed} vectors`);
if (vectors.length >= limit) {
console.log(`🛑 Chunk limit reached (${limit})`);
await fd.close();
console.log(`✅ Loaded ${vectors.length} vectors (chunk-safe).`);
return vectors;
}
}
} catch {
/* ignore malformed line */
}
}
}

await fd.close();
console.log(`✅ Loaded ${vectors.length} vectors (chunk-safe).`);
return vectors;
}

/* ---------------------------------------------------------------------- */
/*  LOAD METADATA (OPTIONAL)                                              */
/* ---------------------------------------------------------------------- */
export async function loadMetadata(limit = 10) {
try {
const text = await fs.promises.readFile(META_PATH, "utf8");
const lines = text.trim().split("\n");
const sample = lines.slice(0, limit).map((l) => JSON.parse(l));
console.log(`📘 Metadata sample loaded (${sample.length}/${lines.length})`);
return sample;
} catch (err) {
console.warn("⚠️ Metadata file missing:", META_PATH, err.message);
return [];
}
}

/* ---------------------------------------------------------------------- */
/*  SEARCH INDEX (semantic retrieval)                                     */
/* ---------------------------------------------------------------------- */
export async function searchIndex(rawQuery, index) {
const query = (typeof rawQuery === "string" ? rawQuery : String(rawQuery || "")).trim();
if (!query || query.length < 3) {
console.warn("⚠️ Query too short or invalid:", query);
return [];
}

console.log("🔍 [AIVS Search] Query:", query);
const response = await openai.embeddings.create({
model: "text-embedding-3-small",
input: [query],
});

const q = response.data[0].embedding;
const scores = index.map((v) => ({
...v,
score: dotProduct(q, v.embedding),
}));

return scores.sort((a, b) => b.score - a.score).slice(0, 10);
}

/* ---------------------------------------------------------------------- */
/*  DOT PRODUCT                                                           */
/* ---------------------------------------------------------------------- */
function dotProduct(a, b) {
if (!a || !b || a.length !== b.length) return 0;
return a.reduce((sum, val, i) => sum + val * b[i], 0);
}/**
 * AIVS Health & Safety Assistant · Backend
 * ISO Timestamp: 2025-11-16T15:30:00Z
 * Author: AIVS Software Limited
 */

import express from "express";
import bodyParser from "body-parser";
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

/* ------------------------- Cached FAISS Index --------------------------- */
let globalIndex = null;
(async () => {
  try {
    console.log("📦 Preloading FAISS vector index (10 000 chunks)...");
    globalIndex = await loadIndex(10000);
    console.log(`✅ Preloaded ${globalIndex.length.toLocaleString()} vectors.`);
  } catch (e) {
    console.error("❌ Preload failed:", e.message);
  }
})();

/* --------------------------- FAISS Search ----------------------------- */
async function queryFaissIndex(question) {
  try {
    // Prevent reloads inside the /ask route
    const index = globalIndex;

    if (!index) {
      console.error("❌ Global FAISS index not loaded at startup.");
      return { joined: "", count: 0 };
    }

    const matches = await searchIndex(question, index);
    const filtered = matches.filter((m) => m.score >= 0.03);
    const texts = filtered.map((m) => m.text);

    console.log(`🔎 Found ${texts.length} chunks for “${question}”`);
    return { joined: texts.join("\n\n"), count: filtered.length };

  } catch (err) {
    console.error("❌ FAISS query failed:", err.message);
    return { joined: "", count: 0 };
  }
}

/* ----------------------- Report Generator ----------------------------- */
async function generateHSReport(query) {
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
    model: "gpt-4.1",
    messages: [
      {
        role: "system",
        content:
          "You are the Health & Safety Manager. Only provide factual guidance drawn from UK HSE, CDM, COSHH, and RIDDOR sources.",
      },
      { role: "user", content: prompt },
    ],
  });

  /* ----------- Structured Accounting-Style Formatting ---------------- */
  let raw = completion.choices[0].message.content.trim();

  let text = raw
    .replace(/^#{1,6}\s*/gm, "")                      // remove markdown headers
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") // bold
    .replace(/\n-{3,}\n/g, "<hr>")                    // horizontal rules
    .replace(/\n{2,}/g, "\n<br><br>")                 // spacing
    .replace(/^\s*[-•]\s+/gm, "• ")                   // bullet cleanup
    .replace(/^(\d+)\.\s+/gm, "<strong>$1.</strong> "); // numbered steps bold

  /* ----------------------- ISO 42001 Fairness Check --------------------- */
  let fairnessResult = "";
  try {
    const fairnessCheck = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content:
            "You are an ISO 42001 fairness auditor. Identify any bias. Respond 'No bias detected' if compliant.",
        },
        { role: "user", content: text },
      ],
    });
    fairnessResult = fairnessCheck.choices[0].message.content.trim();
    console.log("✅ Fairness verification:", fairnessResult);
  } catch (e) {
    fairnessResult = "Fairness verification not completed (" + e.message + ")";
  }

  const now = new Date();
  const dateSeed = `${String(now.getFullYear()).slice(2)}${String(
    now.getMonth() + 1
  ).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  const regRand = `${dateSeed}-${randomPart}`;

  const footer = `
  This report was prepared using the AIVS FAISS-indexed UK health and safety guidance base,
  derived entirely from verified UK Government and professional publications.
  It is provided for internal compliance and advisory purposes only.

  ISO 42001 Fairness Verification: ${fairnessResult}
  Reg. No. AIVS/UK/${regRand}/${count}
  © AIVS Software Limited 2025 — All rights reserved.
  `;

  return `${text}\n<br><br>${footer}`;
}

/* --------------------------- PDF Helper ------------------------------- */
function sanitizeForPdf(txt = "") {
  return String(txt).replace(/[^\x09\x0A\x0D\x20-\x7E£–—]/g, "").trim();
}

async function buildPdfBufferStructured({ fullName, ts, question, reportText }) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage();
  let { width, height } = page.getSize();
  const fontBody = await pdfDoc.embedStandardFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedStandardFont(StandardFonts.HelveticaBold);

  const fsTitle = 16,
    fsBody = 11,
    margin = 50,
    lh = fsBody * 1.4;

  const draw = (txt, x, y, size, font) =>
    page.drawText(txt || "", { x, y, size, font });

  let y = height - margin;

  const ensure = (need = lh) => {
    if (y - need < margin) {
      page = pdfDoc.addPage();
      ({ width, height } = page.getSize());
      y = height - margin;
    }
  };

  draw("Health & Safety Assistant Report", margin, y, fsTitle, fontBold);
  y -= fsTitle * 1.4;

  draw(`Prepared for: ${fullName || "N/A"}`, margin, y, fsBody, fontBody);
  y -= lh;

  draw(`Timestamp (UK): ${ts}`, margin, y, fsBody, fontBody);
  y -= lh * 2;

  const safe = sanitizeForPdf(reportText);
  const lines = safe.split(/\n+/);

  for (const line of lines) {
    ensure();
    draw(line, margin, y, fsBody, fontBody);
    y -= lh;
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

/* ------------------------------ /ask ---------------------------------- */
app.post("/ask", async (req, res) => {
  const { question, email, managerEmail, clientEmail } = req.body || {};
  console.log("🧾 /ask", { question, email, managerEmail, clientEmail });

  if (!question) return res.status(400).json({ error: "Missing question" });

  try {
    const ts = new Date().toISOString();
    const reportText = await generateHSReport(question);
    const pdfBuf = await buildPdfBufferStructured({
      fullName: email,
      ts,
      question,
      reportText,
    });

    const mailPayload = {
      Messages: [
        {
          From: {
            Email: "noreply@securemaildrop.uk",
            Name: "Secure Maildrop",
          },
          To: [
            { Email: email },
            { Email: managerEmail },
            { Email: clientEmail },
          ].filter((r) => r.Email),
          Subject: "Your AI Health & Safety Report",
          TextPart: reportText,
          HTMLPart: reportText
            .split("\n")
            .map((l) => `<p>${l}</p>`)
            .join(""),
          Attachments: [
            {
              ContentType: "application/pdf",
              Filename: `audit-${ts}.pdf`,
              Base64Content: pdfBuf.toString("base64"),
            }
          ],
        },
      ],
    };

    try {
      const mailRes = await fetch("https://api.mailjet.com/v3.1/send", {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.MJ_APIKEY_PUBLIC}:${process.env.MJ_APIKEY_PRIVATE}`
            ).toString("base64"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(mailPayload),
      });

      const mailJson = await mailRes.json();
      console.log("📨 Mailjet response:", mailRes.status, mailJson);
    } catch (e) {
      console.error("❌ Mailjet send failed:", e.message);
    }

    res.json({ question, answer: reportText, timestamp: ts });

  } catch (err) {
    console.error("❌ Report failed:", err);
    res.status(500).json({ error: "Report generation failed" });
  }
});

/* ---------------------------- Serve Front-End ---------------------------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "health_safety.html"));
});

/* ------------------------------ Port Binding ----------------------------- */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🟢 Health & Safety Assistant running on port ${PORT}`);
});
