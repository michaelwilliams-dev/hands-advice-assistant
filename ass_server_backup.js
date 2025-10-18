// server.js — Account Assistant PRO
// ISO Timestamp: 🕒 2025-10-10T10:35:00Z
// Changes:
// • Uses FAISS index (/mnt/data/vector.index) and chunks_metadata.final.jsonl
// • Accountant-style prompt and report layout
// • Keeps Mailjet + PDF/DOCX email logic
// • Debug + /vector-index routes retained

import express from "express";
import bodyParser from "body-parser";
import OpenAI from "openai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { Buffer } from "buffer";
import fs from "fs";
import faiss from "faiss-node";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

// ------------------------------------------------------------------
//  OPENAI + FAISS setup
// ------------------------------------------------------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const INDEX_PATH = process.env.INDEX_PATH || "/mnt/data/vector.index";
const META_PATH  = process.env.METADATA_PATH || "/mnt/data/chunks_metadata.final.jsonl";

if (!fs.existsSync(INDEX_PATH)) throw new Error(`❌ Missing ${INDEX_PATH}`);
if (!fs.existsSync(META_PATH))  throw new Error(`❌ Missing ${META_PATH}`);

console.log("📦 Loading FAISS index and metadata…");
const index = await faiss.readIndex(INDEX_PATH);
const metas = fs.readFileSync(META_PATH, "utf8").trim().split("\n").map(JSON.parse);
console.log(`✅ Loaded index (d=${index.d}) + ${metas.length} chunks.`);

async function embedText(t) {
  const e = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: t
  });
  const v = new Float32Array(e.data[0].embedding);
  faiss.normalize_L2(v);
  return v;
}

async function queryFaissIndex(question) {
  const v = await embedText(question);
  const res = index.search(v, 20);
  const ctx = [];
  for (const i of res.labels) {
    if (i < 0) continue;
    const m = metas[i];
    if (m?.text) ctx.push(m.text);
  }
  return ctx.join("\n\n");
}

// ------------------------------------------------------------------
//  /ask endpoint – Accountant Report
// ------------------------------------------------------------------
app.post("/ask", async (req, res) => {
  const { question, email } = req.body || {};
  console.log(`🧾 Account Assistant PRO /ask => ${question}`);

  if (!question) return res.status(400).json({ error: "Missing question" });

  try {
    const ts = new Date().toISOString();
    const context = await queryFaissIndex(question);

    const prompt = `
You are a qualified UK accountant writing an internal report.
Answer clearly and factually based on HMRC guidance.

Structure:
1. Headline
2. Who can reclaim / is affected
3. Step-by-step guidance (in-year vs year-end where relevant)
4. Evidence required
5. Common blockers or refusals
6. Key HMRC manual references (CISR, DMBM, SAM, PAYE etc.)
7. One-line practical wrap-up

Question: "${question}"

Context (from indexed material):
${context}
    `.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3
    });

    const answer = completion.choices[0].message.content;
    const combined = `📘 Account Assistant PRO Report
🕒 Generated: ${ts}

${answer}

------------------------------------------------------------
This report was generated from AIVS FAISS-indexed HMRC content for accountant use only.
Review before distribution. © AIVS Software Limited 2025.
------------------------------------------------------------`;

    //  Send PDF/DOCX email if address supplied
    if (email && email.includes("@")) {
      try {
        const pdf = new PDFDocument();
        let pdfBuf = Buffer.alloc(0);
        pdf.on("data", c => (pdfBuf = Buffer.concat([pdfBuf, c])));
        pdf.text(combined);
        pdf.end();

        const doc = new Document({
          sections: [
            {
              children: combined
                .split("\n")
                .map(l => new Paragraph({ children: [new TextRun(l)] }))
            }
          ]
        });
        const docBuf = await Packer.toBuffer(doc);

        const mailjet = await fetch("https://api.mailjet.com/v3.1/send", {
          method: "POST",
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(
                `${process.env.MJ_APIKEY_PUBLIC}:${process.env.MJ_APIKEY_PRIVATE}`
              ).toString("base64"),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            Messages: [
              {
                From: { Email: "noreply@securemaildrop.uk", Name: "Secure Maildrop" },
                To: [{ Email: email }],
                Subject: `Your AIVS Accountant Report`,
                TextPart: combined,
                HTMLPart: combined.split("\n").map(l => `<p>${l}</p>`).join(""),
                Attachments: [
                  {
                    ContentType: "application/pdf",
                    Filename: "report.pdf",
                    Base64Content: pdfBuf.toString("base64")
                  },
                  {
                    ContentType:
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    Filename: "report.docx",
                    Base64Content: docBuf.toString("base64")
                  }
                ]
              }
            ]
          })
        });
        console.log("📨 Mailjet status:", mailjet.status);
      } catch (err) {
        console.error("❌ Mailjet failed:", err.message);
      }
    }

    res.json({ question, answer: combined, timestamp: ts });
  } catch (err) {
    console.error("❌ Accountant report failed:", err);
    res.status(500).json({ error: "Accountant report failed" });
  }
});

// ------------------------------------------------------------------
//  /vector-index and debug routes
// ------------------------------------------------------------------
app.get("/vector-index", async (_req, res) => {
  try {
    res.json({ dimension: index.d, metaCount: metas.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/debug", (_req, res) =>
  res.send("✅ Account Assistant PRO server deployed and running.")
);

app.get("/", (_req, res) =>
  res.send("✅ Account Assistant PRO backend is live.")
);

// ------------------------------------------------------------------
app.listen(PORT, () =>
  console.log(`🟢 Account Assistant PRO running on port ${PORT}`)
);
