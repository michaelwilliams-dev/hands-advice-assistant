/**
 * AIVS Health & Safety Assistant · Backend (Pure JS)
 * ISO Timestamp: 2025-11-23T12:00:00Z
 * Clean headings, clean bullets, FAISS, PDF, Word, Email
 * Fairness audit REMOVED exactly as requested
 */

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

/* --------------------------------------------------------------------- */
/* ORIGIN SECURITY – includes your Render domain only                    */
/* --------------------------------------------------------------------- */

const allowedDomains = [
  "assistants.aivs.uk",
  "hands-advice-assistant-1.onrender.com"
];

function verifyOrigin(req, res, next) {
  const origin = req.get("Origin");
  if (!origin)
    return res.status(403).json({ error: "Forbidden – no Origin header" });

  try {
    const { hostname } = new URL(origin);
    const allowed = allowedDomains.some(
      (d) => hostname === d || hostname.endsWith("." + d)
    );
    if (!allowed)
      return res.status(403).json({ error: "Forbidden – Origin not allowed", origin });

    next();
  } catch {
    return res.status(400).json({ error: "Invalid Origin header" });
  }
}

/* --------------------------------------------------------------------- */
/* PATHS                                                                 */
/* --------------------------------------------------------------------- */

const PORT = process.env.PORT || 10000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* --------------------------------------------------------------------- */
/* PRELOAD FAISS INDEX                                                   */
/* --------------------------------------------------------------------- */

let globalIndex = null;

(async () => {
  try {
    console.log("📦 Preloading H&S FAISS index...");
    globalIndex = await loadIndex(10000);
    console.log(`✅ Loaded ${globalIndex.length} chunks.`);
  } catch (e) {
    console.error("❌ FAISS preload failed:", e.message);
  }
})();

/* --------------------------------------------------------------------- */
/* FAISS SEARCH                                                          */
/* --------------------------------------------------------------------- */

async function queryFaissIndex(question) {
  try {
    const index = globalIndex || [];
    if (!index.length) {
      console.error("❌ GlobalIndex not ready — still loading or empty");
      return { joined: "", count: 0 };
    }

    const matches = await searchIndex(question, index);
    const filtered = matches.filter((m) => m.score >= 0.03);

    return {
      joined: filtered.map((m) => m.text).join("\n\n"),
      count: filtered.length,
    };
  } catch (err) {
    console.error("❌ FAISS query error:", err.message);
    return { joined: "", count: 0 };
  }
}

/* --------------------------------------------------------------------- */
/* REPORT GENERATOR (Fairness REMOVED)                                  */
/* --------------------------------------------------------------------- */

async function generateHSReport(question) {
  const { joined, count } = await queryFaissIndex(question);
  const context = joined.slice(0, 50000);

  const prompt = `
You are a qualified UK health & safety consultant preparing a structured compliance report.
Use HSE guidance, RIDDOR 2013, CDM 2015, COSHH, Workplace Regulations 1992.
Write in formal UK English. No markdown (**text**).

Question: "${question}"

Context:
${context}`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [{ role: "user", content: prompt }],
  });

  let text = completion.choices[0].message.content.trim();

  /* ---------------------------------------------------------------- */
  /*  FAIRNESS BLOCK REMOVED COMPLETELY AS REQUESTED                  */
  /* ---------------------------------------------------------------- */

  const now = new Date();
  const seed = `${String(now.getFullYear()).slice(2)}${String(
    now.getMonth() + 1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}`;
  const rand = Math.floor(1000 + Math.random() * 9000);

  const footer = `
This report was prepared using the AIVS FAISS-indexed UK Health & Safety knowledge base.
Reg. No. AIVS/UK/${seed}-${rand}/${count}
© AIVS Software Limited 2025`;

  return `${text}\n\n${footer}`;
}

/* --------------------------------------------------------------------- */
/* PDF BUILDER                                                           */
/* --------------------------------------------------------------------- */

function sanitizeForPdf(txt = "") {
  return String(txt).replace(/[^\x09\x0A\x0D\x20-\x7E£–—]/g, "");
}

async function buildPdf({ fullName, ts, question, reportText }) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage();
  let { width, height } = page.getSize();

  const fontBody = await pdfDoc.embedStandardFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedStandardFont(StandardFonts.HelveticaBold);

  let y = height - 50;

  const draw = (txt, x, y, size, font) =>
    page.drawText(String(txt || ""), { x, y, size, font });

  draw("Health & Safety Assistant Report", 50, y, 16, fontBold);
  y -= 20;
  draw(`Prepared for: ${fullName || "N/A"}`, 50, y, 11, fontBody);
  y -= 14;
  draw(`Timestamp: ${ts}`, 50, y, 11, fontBody);
  y -= 20;

  for (const line of sanitizeForPdf(reportText).split("\n")) {
    if (y < 60) {
      page = pdfDoc.addPage();
      ({ width, height } = page.getSize());
      y = height - 50;
    }
    draw(line, 50, y, 11, fontBody);
    y -= 14;
  }

  return Buffer.from(await pdfDoc.save());
}

/* --------------------------------------------------------------------- */
/* /ASK ROUTE                                                            */
/* --------------------------------------------------------------------- */

app.post("/ask", verifyOrigin, async (req, res) => {
  const { question, email, managerEmail, clientEmail } = req.body;

  if (!question)
    return res.status(400).json({ error: "Missing question" });

  try {
    const ts = new Date().toISOString();
    const reportText = await generateHSReport(question);
    const pdfBuf = await buildPdf({ fullName: email, ts, question, reportText });

    /* ---------------- CLEAN MARKDOWN ---------------- */
    const cleanedText = (reportText || "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/^#+\s*/gm, "");

    const lines = cleanedText.split("\n");

    const docParagraphs = [];

    /* TITLE */
    docParagraphs.push(
      new Paragraph({
        alignment: "center",
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: "HEALTH & SAFETY ASSISTANT REPORT",
            bold: true,
            size: 32,
          }),
        ],
      })
    );

    /* TIMESTAMP */
    docParagraphs.push(
      new Paragraph({
        alignment: "center",
        spacing: { after: 300 },
        children: [
          new TextRun({
            text: `Generated ${ts}`,
            bold: true,
            size: 24,
          }),
        ],
      })
    );

    /* BODY PARSING */
    for (const raw of lines) {
      const t = raw.trim();
      if (!t) {
        docParagraphs.push(new Paragraph(""));
        continue;
      }

      /* MAIN HEADINGS (1., 2., 3.) */
      if (/^\d+\.\s+/.test(t)) {
        docParagraphs.push(
          new Paragraph({
            spacing: { before: 200, after: 120 },
            children: [
              new TextRun({
                text: t,
                bold: true,
                size: 36,
                color: "4e65ac",
              }),
            ],
          })
        );
        continue;
      }

      /* SUBHEADINGS (e.g. Immediate Actions:) */
      if (/^[A-Z][A-Za-z\s]+:/.test(t)) {
        docParagraphs.push(
          new Paragraph({
            spacing: { before: 120, after: 80 },
            children: [
              new TextRun({
                text: t.replace(/:$/, ""),
                bold: true,
                size: 28,
                color: "4e65ac"
              }),
            ],
          })
        );
        continue;
      }

      /* BULLETS */
      if (/^[-•]/.test(t)) {
        const bullet = t.replace(/^[-•]\s*/, "• ");
        docParagraphs.push(
          new Paragraph({
            spacing: { after: 60 },
            indent: { left: 720, hanging: 360 },
            children: [new TextRun({ text: bullet, size: 22 })],
          })
        );
        continue;
      }

      /* NORMAL PARAGRAPH */
      docParagraphs.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: t, size: 22 })],
        })
      );
    }

    /* FOOTER */
    docParagraphs.push(
      new Paragraph({
        spacing: { before: 240 },
        children: [
          new TextRun({
            text: reportText.split("\n").slice(-5).join("\n"),
            italics: true,
            size: 20,
          }),
        ],
      })
    );

    const doc = new Document({ sections: [{ children: docParagraphs }] });
    const docBuf = await Packer.toBuffer(doc);

    /* ---------------- EMAIL SEND ---------------- */
    await fetch("https://api.mailjet.com/v3.1/send", {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.MJ_APIKEY_PUBLIC}:${process.env.MJ_APIKEY_PRIVATE}`
          ).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Messages: [
          {
            From: { Email: "noreply@securemaildrop.uk", Name: "Secure Maildrop" },
            To: [
              email && { Email: email },
              managerEmail && { Email: managerEmail },
              clientEmail && { Email: clientEmail },
            ].filter(Boolean),
            Subject: "Your Health & Safety Report",
            TextPart: reportText,
            Attachments: [
              {
                ContentType: "application/pdf",
                Filename: `hs-${ts}.pdf`,
                Base64Content: pdfBuf.toString("base64"),
              },
              {
                ContentType:
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                Filename: `hs-${ts}.docx`,
                Base64Content: docBuf.toString("base64"),
              },
            ],
          },
        ],
      }),
    });

    res.json({ question, answer: reportText, timestamp: ts });
  } catch (err) {
    console.error("❌ Report failed:", err);
    res.status(500).json({ error: "Report generation failed" });
  }
});

/* --------------------------------------------------------------------- */
/* FRONTEND ROUTE                                                        */
/* --------------------------------------------------------------------- */

app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "health_safety.html"))
);

/* --------------------------------------------------------------------- */
/* SERVER START                                                          */
/* --------------------------------------------------------------------- */

app.listen(PORT, "0.0.0.0", () =>
  console.log(`🟢 Health & Safety Assistant running on port ${PORT}`)
);
