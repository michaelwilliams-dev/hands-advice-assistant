/**
 * AIVS Health & Safety Assistant · Backend
 * ISO Timestamp: 2025-11-16T15:30:00Z
 * Author: AIVS Software Limited
 * Notes:
 * - Backend logic unchanged per client request
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
    // ❌ Never reload FAISS inside a request
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
You are a qualified UK Health & Safety consultant.
Use HSWA 1974, MHSWR 1999, CDM 2015, COSHH, RIDDOR 2013, and Workplace (Health, Safety and Welfare) Regulations 1992 where relevant.
Write clearly in UK professional English.
Do NOT use Markdown (**text**, ### headings).
Do NOT use asterisks for emphasis.

Question: "${query}"

Structure:
1. Summary of incident or issue
2. Relevant legal duties (HSWA, MHSWR, CDM, etc.)
3. Hazard identification
4. Risk evaluation (likelihood + severity)
5. Immediate actions required
6. Longer-term control measures
7. Reporting duties (e.g., RIDDOR)
8. Practical wrap-up

Context:
${context}
`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are the Health & Safety Manager. Only provide factual guidance drawn from UK HSE, CDM, COSHH, and RIDDOR sources.",
      },
      { role: "user", content: prompt },
    ],
  });

  let text = completion.choices[0].message.content.trim();

  /* ----------- Structured Formatting Cleanup ---------------- */
  text = text.replace(/8\)\s*Appendix[\s\S]*$/gi, "").trim();

  return text;
}

  // --- ISO 42001 fairness check ---
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
  
  It is provided for internal compliance and advisory purposes only.
  ISO 42001 Fairness Verification: ${fairnessResult}
  Reg. No. AIVS/UK/${regRand}/${count}
  © AIVS Software Limited 2025 — All rights reserved.
  `;
  
  return `${text}\n\n${footer}`;
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

  const wrap = (txt, x, maxWidth, size = fsBody, font = fontBody) => {
    const words = String(txt || "").split(/\s+/);
    let cur = "",
      rows = [];
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
        rows.push(cur);
        cur = w;
      } else cur = test;
    }
    rows.push(cur || "");
    return rows;
  };
  const para = (txt, x, size = fsBody, font = fontBody) => {
    const safe = sanitizeForPdf(txt);
    const rows = wrap(safe, x, width - x - margin, size, font);
    for (const r of rows) {
      ensure();
      draw(r, x, y, size, font);
      y -= lh;
    }
  };
  draw("Health & Safety Assistant Report", margin, y, fsTitle, fontBold);
  y -= fsTitle * 1.4;
  para(`Prepared for: ${fullName || "N/A"}`, margin);
  para(`Timestamp (UK): ${ts}`, margin);
  draw(`Prepared for: ${fullName || "N/A"}`, margin, y, fsBody, fontBody);
  y -= lh;
  para(question || "", margin);
  para(reportText, margin);
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
  console.log(`📦 Created structured PDF (${bytes.length} bytes)`);
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

    const docParagraphs = [];
    docParagraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "HEALTH & SAFETY ASSISTANT REPORT",
            bold: true,
            size: 32,
          }),
        ],
        alignment: "center",
        spacing: { after: 100 },
      })
    );
    docParagraphs.push(
      new Paragraph({
        children: [
          new TextRun({ text: `Generated ${ts}`, bold: true, size: 24 }),
        ],
        alignment: "center",
        spacing: { after: 300 },
      })
    );
    const lines = String(reportText || "")
      .replace(/\n{2,}/g, "\n")
      .split(/\n| {2,}/);
    for (const raw of lines) {
      const t = raw.trim();
      if (!t) {
        docParagraphs.push(new Paragraph(""));
        continue;
      }
      if (t.startsWith("This report was prepared using")) break;
      if (/^\d+[\).\s]/.test(t)) {
        docParagraphs.push(
          new Paragraph({
            children: [new TextRun({ text: t, bold: true, size: 28 })],
            spacing: { before: 200, after: 120 },
          })
        );
        continue;
      }
      if (/^[A-Z][\).\s]/.test(t)) {
        const cleaned = t.replace(/^[A-Z][\).\s]+/, "").trim();
        docParagraphs.push(
          new Paragraph({
            children: [new TextRun({ text: cleaned, bold: true, size: 24 })],
            spacing: { before: 120, after: 80 },
          })
        );
        continue;
      }
      if (/^[-•]?\s*[A-Z].*:\s*$/.test(t)) {
        const labelText = t.replace(/^[-•]\s*/, "").trim();
        docParagraphs.push(
          new Paragraph({
            children: [new TextRun({ text: labelText, bold: true, size: 24 })],
            spacing: { before: 120, after: 80 },
          })
        );
        continue;
      }
      if (/^[-•]/.test(t)) {
        const bulletText = t.replace(/^[-•]\s*/, "• ").trim();
        docParagraphs.push(
          new Paragraph({
            children: [new TextRun({ text: bulletText, size: 22 })],
            indent: { left: 680, hanging: 360 },
            spacing: { after: 60 },
          })
        );
        continue;
      }
      docParagraphs.push(
        new Paragraph({
          children: [new TextRun({ text: t, size: 22 })],
          spacing: { after: 120 },
        })
      );
    }
    const now = new Date();
    const dateSeed = `${String(now.getFullYear()).slice(2)}${String(
      now.getMonth() + 1
    ).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    const regRand = `${dateSeed}-${randomPart}`;
    const footerText = `
    This report was prepared using the AIVS FAISS-indexed UK health and safety guidance base,
    derived entirely from verified UK Government and professional publications.
    It is provided for internal compliance and advisory purposes only and should not
    be relied upon as a substitute for professional legal or safety advice.
Reg. No. AIVS/UK/${regRand}/${globalIndex ? globalIndex.length : 0}
© AIVS Software Limited 2025 — All rights reserved.`;
    docParagraphs.push(
      new Paragraph({
        children: [new TextRun({ text: footerText, italics: true, size: 20 })],
        spacing: { before: 240 },
        alignment: "left",
      })
    );
    const doc = new Document({ sections: [{ children: docParagraphs }] });
    const docBuf = await Packer.toBuffer(doc);
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
      const mailjetRes = await fetch("https://api.mailjet.com/v3.1/send", {
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
        body: JSON.stringify({
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
                },
                {
                  ContentType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  Filename: "report.docx",
                  Base64Content: docBuf.toString("base64"),
                },
              ],
            },
          ],
        }),
        body: JSON.stringify(mailPayload),
      });
      const mailResponse = await mailjetRes.json();
      console.log("📨 Mailjet response:", mailjetRes.status, mailResponse);
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
app.listen(process.env.PORT || 3002, "0.0.0.0", () => {
  console.log(`🟢 Health & Safety Assistant running on port ${process.env.PORT || 3002}`);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🟢 Health & Safety Assistant running on port ${PORT}`);
});
0 commit comments
Comments
0
 (0)
Comment
You're not receiving notifications from this thread.
Refactor report generation and email logic · michaelwilliams-dev/hands-advice-assistant@8731e2e
