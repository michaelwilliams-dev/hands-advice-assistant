// server.js — Health & Safety Assistant (pure-JS version)
// ISO Timestamp: 2025-11-22T10:44:00Z
// ✔ Copy from Accounting Assistant PRO
// ✔ xx
// ✔ xx
// ✔ xx
// ✔ xx
// ✔ xx

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

/* --------------------------- Origin Security ---------------------------- */
const allowedDomains = [
  "assistants.aivs.uk",
  "account-assistant-pro.onrender.com"
];

function verifyOrigin(req, res, next) {
  const origin = req.get("Origin");
  if (!origin)
    return res.status(403).json({ error: "Forbidden – no Origin header" });

  try {
    const { hostname } = new URL(origin);
    const allowed = allowedDomains.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    );
    if (!allowed)
      return res.status(403).json({
        error: "Forbidden – Origin not allowed",
        origin
      });

    next();
  } catch {
    return res.status(400).json({ error: "Invalid Origin header" });
  }
}

/* ----------------------------------------------------------------------- */

const PORT = process.env.PORT || 3002;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ------------------------- FAISS --------------------------- */
let globalIndex = null;
(async () => {
  try {
    console.log("📦 Preloading FAISS vector index (10000 chunks)...");
    globalIndex = await loadIndex(10000);
    console.log(`✅ Loaded ${globalIndex.length} vectors.`);
  } catch (e) {
    console.error("❌ FAISS preload failed:", e.message);
  }
})();

/* --------------------------- FAISS Search ----------------------------- */
async function queryFaissIndex(question) {
  try {
    const index = globalIndex || (await loadIndex(10000));
    const matches = await searchIndex(question, index);
    const filtered = matches.filter((m) => m.score >= 0.03);
    return { joined: filtered.map((m) => m.text).join("\n\n"), count: filtered.length };
  } catch {
    return { joined: "", count: 0 };
  }
}

/* ----------------------- Report Generator ----------------------------- */
async function generateAccountantReport(query) {
  const { joined, count } = await queryFaissIndex(query);
  let context = joined.slice(0, 50000);

  const prompt = `
You are a qualified UK accountant preparing a formal internal compliance report.
Write clearly in UK professional English.
Do NOT use Markdown (**text**, ### headings).
Do NOT use asterisks for emphasis.

Question: "${query}"

Structure:
1. Query
2. Who can reclaim or is affected
3. Guidance
4. Evidence required
5. Common blockers or refusals
6. Key HMRC manual references
7. Practical wrap-up

Context:
${context}`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }]
  });

  let text = completion.choices[0].message.content.trim();
  text = text.replace(/8\)\s*Appendix[\s\S]*$/gi, "").trim();

  /* Fairness Audit */
  let fairness = "";
  try {
    const chk = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "ISO 42001 fairness audit. Identify bias or reply 'No bias detected'." },
        { role: "user", content: text }
      ]
    });
    fairness = chk.choices[0].message.content.trim();
  } catch (e) {
    fairness = "Fairness audit not completed";
  }

  const now = new Date();
  const reg = `${String(now.getFullYear()).slice(2)}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${Math.floor(1000+Math.random()*9000)}`;

  const footer = `

This report was prepared using the AIVS FAISS-indexed HMRC knowledge base.
ISO 42001 Fairness: ${fairness}
Reg. No. AIVS/UK/${reg}/${count}
© AIVS Software Limited 2025`;

  return `${text}\n\n${footer}`;
}

/* --------------------------- PDF Helper ------------------------------- */
function sanitizeForPdf(txt="") {
  return String(txt).replace(/[^\x09\x0A\x0D\x20-\x7E£–—]/g,"").trim();
}

async function buildPdfBufferStructured({ fullName, ts, question, reportText }) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage();
  let { width, height } = page.getSize();

  const fontBody = await pdfDoc.embedStandardFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedStandardFont(StandardFonts.HelveticaBold);

  const fsTitle = 16, fsBody = 11, margin = 50, lh = fsBody*1.4;

  const draw = (txt,x,y,size,font)=>
    page.drawText(txt||"", { x,y,size,font });

  let y = height-margin;
  const ensure = (need=lh)=>{
    if (y-need<margin) {
      page = pdfDoc.addPage();
      ({ width,height } = page.getSize());
      y = height-margin;
    }
  };

  const wrap = (txt,x,max,size=fsBody,font=fontBody)=>{
    const words = String(txt||"").split(/\s+/);
    let cur="", rows=[];
    for (const w of words) {
      const test = cur?`${cur} ${w}`:w;
      if (font.widthOfTextAtSize(test,size)>max && cur) {
        rows.push(cur); cur=w;
      } else cur=test;
    }
    rows.push(cur||"");
    return rows;
  };

  const para=(txt,x,size=fsBody,font=fontBody)=>{
    const safe = sanitizeForPdf(txt);
    const rows = wrap(safe,x,width-x-margin,size,font);
    for (const r of rows) {
      ensure();
      draw(r,x,y,size,font);
      y -= lh;
    }
  };

  draw("Health & Safety Assistant Report",margin,y,fsTitle,fontBold);
  y -= fsTitle*1.4;

  para(`Prepared for: ${fullName||"N/A"}`,margin);
  para(`Timestamp (UK): ${ts}`,margin);
  y -= lh;
  para(question||"",margin);
  para(reportText,margin);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

/* ------------------------------ /ask ---------------------------------- */
app.post("/ask", verifyOrigin, async (req, res) => {
  const { question, email, managerEmail, clientEmail } = req.body || {};

  if (!question)
    return res.status(400).json({ error: "Missing question" });

  try {
    const ts = new Date().toISOString();
    const dateForDocx = ts.split("T")[0].split("-").reverse().join("-");

    const reportText = await generateAccountantReport(question);
    const pdfBuf = await buildPdfBufferStructured({
      fullName: email,
      ts,
      question,
      reportText
    });

    const docParagraphs = [];

    // Main Title
    docParagraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "HEALTH & SAFETY ASSISTANT REPORT",
            bold: true,
            size: 32
          })
        ],
        alignment: "center",
        spacing: { after: 100 }
      })
    );

    // Timestamp
    docParagraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Generated ${ts}`,
            bold: true,
            size: 24
          })
        ],
        alignment: "center",
        spacing: { after: 300 }
      })
    );

    /* ---------------------------------------------
       CLEAN MARKDOWN BEFORE LINE PROCESSING
       --------------------------------------------- */
    const cleanedText = (reportText || "")
      .replace(/\*+/g, "")         // remove *, **, ***
      .replace(/^#+\s*/gm, "");    // remove ### headers

    const lines = cleanedText
      .replace(/\n{2,}/g, "\n")
      .split(/\n| {2,}/);

    /* ---------------------------------------------
       BUILD DOCX PARAGRAPHS
       --------------------------------------------- */
    for (const raw of lines) {
      let t = raw.trim();
      if (!t) {
        docParagraphs.push(new Paragraph(""));
        continue;
      }

      // SECTION HEADINGS e.g. "1. Query"
      if (/^\d+\.\s+/.test(t)) {
        docParagraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: t,
                bold: true,
                size: 26   // ★ A3 STYLE SELECTED (professional, clean)
              })
            ],
            spacing: { before: 200, after: 120 }
          })
        );
        continue;
      }

      // Uppercase Subheadings (RARE)
      if (/^[A-Z][A-Za-z\s]+:$/.test(t)) {
        docParagraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: t.replace(/:$/, ""),
                bold: true,
                size: 24
              })
            ],
            spacing: { before: 120, after: 80 }
          })
        );
        continue;
      }

      // Bullets
      if (/^[-•]/.test(t)) {
        const bulletText = t.replace(/^[-•]\s*/, "• ");
        docParagraphs.push(
          new Paragraph({
            children: [new TextRun({ text: bulletText, size: 22 })],
            indent: { left: 680, hanging: 360 },
            spacing: { after: 60 }
          })
        );
        continue;
      }

      // Normal paragraph text
      docParagraphs.push(
        new Paragraph({
          children: [new TextRun({ text: t, size: 22 })],
          spacing: { after: 120 }
        })
      );
    }

    /* ---------------------------------------------
       FOOTER SECTION
       --------------------------------------------- */
    const now2 = new Date();
    const reg2 =
      `${String(now2.getFullYear()).slice(2)}${String(now2.getMonth() + 1).padStart(2, "0")}${String(now2.getDate()).padStart(2, "0")}` +
      `-${Math.floor(1000 + Math.random() * 9000)}`;

    const footerText = `
This report was prepared using the AIVS FAISS-indexed HMRC knowledge base.
Internal advisory use only.

Reg. No. AIVS/UK/${reg2}/${globalIndex ? globalIndex.length : 0}
© AIVS Software Limited 2025 — All rights reserved.`;

    docParagraphs.push(
      new Paragraph({
        children: [new TextRun({ text: footerText, italics: true, size: 20 })],
        spacing: { before: 240 },
        alignment: "left"
      })
    );

    /* ---------------------------------------------
       BUILD DOCX FILE
       --------------------------------------------- */
    const doc = new Document({ sections: [{ children: docParagraphs }] });
    const docBuf = await Packer.toBuffer(doc);

    /* ---------------------------------------------
       EMAIL SEND VIA MAILJET
       --------------------------------------------- */
    try {
      const mailjetRes = await fetch("https://api.mailjet.com/v3.1/send", {
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
              To: [
                { Email: email },
                { Email: managerEmail },
                { Email: clientEmail }
              ].filter((r) => r.Email),
              Subject: "Your AI Accountant Report",
              TextPart: reportText,
              HTMLPart: reportText.split("\n").map((l) => `<p>${l}</p>`).join(""),
              Attachments: [
                {
                  ContentType: "application/pdf",
                  Filename: `audit-${ts}.pdf`,
                  Base64Content: pdfBuf.toString("base64")
                },
                {
                  ContentType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  Filename: `accounting-assist-${dateForDocx}.docx`,
                  Base64Content: docBuf.toString("base64")
                }
              ]
            }
          ]
        })
      });

      console.log("📨 Mailjet status:", mailjetRes.status);
    } catch (mailErr) {
      console.error("❌ Mailjet failed:", mailErr.message);
    }

    res.json({ question, answer: reportText, timestamp: ts });
  } catch (err) {
    console.error("❌ Generation error:", err);
    res.status(500).json({ error: "Report generation failed" });
  }
});

/* ---------------------------------------------
   FRONTEND ROUTE + SERVER START
   --------------------------------------------- */
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "accountant.html"))
);

app.listen(Number(PORT), "0.0.0.0", () =>
  console.log(`🟢 Accountant Assistant PRO running on port ${PORT}`)
);
