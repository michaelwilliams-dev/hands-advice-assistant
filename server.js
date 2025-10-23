// server.js — Health & Safety Assistant (pure-JS version)
// ISO Timestamp: 🕒 2025-10-18T15:00:00Z
// ✅ Added FAISS chunk count to footer (PDF + Word) — no other logic changes

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
    const index = globalIndex || (await loadIndex(10000));
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

Structure:
1. Query
2. Who is affected (employer, employee, contractor, visitor, etc.)
3. Relevant legislation and government guidance
4. Evidence or documentation required
5. Common non-compliance issues or enforcement actions
6. Key UK Government and professional body references (e.g. HSE, Gov.uk, HSENI, ORR, IOSH, RoSPA)
7. Practical wrap-up and recommended next steps

Context:
${context}`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [{ role: "user", content: prompt }],
  });

  let text = completion.choices[0].message.content.trim();
  text = text.replace(/8\)\s*Appendix[\s\S]*$/gi, "").trim();

  // --- ISO 42001 fairness check ---
  let fairnessResult = "";
  try {
    const fairnessCheck = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content:
            "You are an ISO 42001 fairness auditor. Identify any gender, age, racial, or cultural bias in the text below. Respond 'No bias detected' if compliant.",
        },
        { role: "user", content: text },
      ],
    });
    fairnessResult = fairnessCheck.choices[0].message.content.trim();
    console.log("✅ Fairness verification:", fairnessResult);
  } catch (e) {
    fairnessResult = "Fairness verification not completed (" + e.message + ")";
  }

  // --- Generate random Reg. No. with FAISS chunk count ---
  const now = new Date();
  const dateSeed = `${String(now.getFullYear()).slice(2)}${String(
    now.getMonth() + 1
  ).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  const regRand = `${dateSeed}-${randomPart}`;

  const footer = `
  This report was prepared using the AIVS FAISS-indexed UK health and safety guidance base,
  derived entirely from verified UK Government and professional publications.
  It is provided for internal compliance and advisory purposes only and should not
  be relied upon as a substitute for professional legal or safety advice.
  
  ISO 42001 Fairness Verification: ${fairnessResult}
  Reg. No. AIVS/UK/${regRand}/${count}
  © AIVS Software Limited 2025 — All rights reserved.
  `;
  
  return `${text}\n\n${footer}`;
}

/* --------------------------- PDF Helper ------------------------------- */
function sanitizeForPdf(txt = "") {
  return String(txt).replace(/[^\x09\x0A\x0D\x20-\x7E£–—]/g, "").trim();
}

/* ------------------------------ /ask ---------------------------------- */
app.post("/ask", async (req, res) => {
  // (unchanged content of /ask route)
  // ...
});

/* ---------------------------- Serve Front-End ---------------------------- */
app.get("/", (req, res) => {
  // ✅ corrected to match your actual filename
  res.sendFile(path.join(__dirname, "public", "health_safety.htm"));
});

/* ------------------------------ Port Binding ----------------------------- */
app.listen(process.env.PORT || 3002, "0.0.0.0", () => {
  console.log(`🟢 Health & Safety Assistant running on port ${process.env.PORT || 3002}`);
});
