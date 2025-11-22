// vector_store.js
// ISO Timestamp: 🕒 2025-10-13T11:15:00Z

import fs from "fs";
import { OpenAI } from "openai";

const INDEX_PATH = "/mnt/data/vector.index";
const META_PATH  = "/mnt/data/chunks_metadata.jsonl";
const CHUNK_LIMIT = 50000;

console.log("🟢 vector_store.js (chunk-safe JSONL) using", INDEX_PATH);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_APIKEY || process.env.OPENAI_API_KEY,
});

/* ---------------------------------------------------------------------- */
/*  LOAD INDEX                                                            */
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
    buffer = parts.pop();

    for (const line of parts) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.embedding) {
          vectors.push(obj);
          processed++;
          if (processed % 1000 === 0) console.log(`  → ${processed} vectors`);
          if (vectors.length >= limit) {
            console.log(`🛑 Chunk limit reached (${limit})`);
            await fd.close();
            return vectors;
          }
        }
      } catch {}
    }
  }

  await fd.close();
  console.log(`✅ Loaded ${vectors.length} vectors (chunk-safe).`);
  return vectors;
}

/* ---------------------------------------------------------------------- */
/*  LOAD METADATA                                                         */
/* ---------------------------------------------------------------------- */
export async function loadMetadata(limit = 10) {
  try {
    const text = await fs.promises.readFile(META_PATH, "utf8");
    const lines = text.trim().split("\n");
    return lines.slice(0, limit).map((l) => JSON.parse(l));
  } catch (err) {
    console.warn("⚠️ Metadata file missing:", META_PATH);
    return [];
  }
}

/* ---------------------------------------------------------------------- */
/*  SEARCH INDEX                                                          */
/* ---------------------------------------------------------------------- */
export async function searchIndex(rawQuery, index) {
  const query = (typeof rawQuery === "string"
    ? rawQuery
    : String(rawQuery || "")
  ).trim();

  if (!query || query.length < 3) return [];

  console.log("🔍 Query:", query);

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

function dotProduct(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}
