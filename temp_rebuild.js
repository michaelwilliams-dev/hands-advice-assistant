// ISO Timestamp: new temporary accounting rebuild
// Purpose: test new FAISS index and accountant report layout (10 Oct 2025)

import fs from "fs";
import path from "path";
import OpenAI from "openai";
import faiss from "faiss-node"; // ensure faiss-node is installed

const INDEX_PATH = process.env.INDEX_PATH || "/mnt/data/vector.index";
const META_PATH  = process.env.METADATA_PATH || "/mnt/data/chunks_metadata.final.jsonl";
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const client = new OpenAI({ apiKey: OPENAI_KEY });

// --- load index + metadata ---
const index = await faiss.readIndex(INDEX_PATH);
const metas = fs.readFileSync(META_PATH, "utf-8").trim().split("\n").map(JSON.parse);

// --- quick search & summary ---
async function accountantReport(query) {
  const emb = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  const v = new Float32Array(emb.data[0].embedding);
  const results = index.search(v, 8);
  const ctx = results.labels.map(i => metas[i]?.title).filter(Boolean).join("\n");

  const prompt = `
  You are an accountant summariser. Summarise clearly and briefly for: ${query}.
  Include 'Who can reclaim', 'Steps', 'Evidence required', 'Blockers', and
  'Key references'. Use this context:
  ${ctx}`;

  const reply = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You write concise, professional UK accounting guidance." },
      { role: "user", content: prompt }
    ],
    temperature: 0.2
  });

  console.log("\n=== Accountant Report ===\n");
  console.log(reply.choices[0].message.content);
}

accountantReport(process.argv.slice(2).join(" ") || "CIS repayment");
