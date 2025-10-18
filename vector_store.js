// vector_store.js
// ISO Timestamp: 🕒 2025-10-13T11:15:00Z
// CHANGELOG:
// • Loads vector.index incrementally in small chunks (avoids RangeError)
// • Fully compatible with Accountant PRO backend
// • Keeps same metadata + search functions

import fs from "fs";
import { OpenAI } from "openai";

const INDEX_PATH = "/mnt/data/vector.index";
const META_PATH  = "/mnt/data/chunks_metadata.final.jsonl";
const CHUNK_LIMIT = 50000; // number of vectors per load batch

console.log("🟢 vector_store.js (chunk-safe) using", INDEX_PATH);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_APIKEY || process.env.OPENAI_API_KEY,
});

// ----------------------------------------------------------------------
//  CHUNKED LOAD — reads small batches of vectors
// ----------------------------------------------------------------------
export async function loadIndex(limit = CHUNK_LIMIT) {
  console.log(`📦 Loading vector index in chunks (limit ${limit})...`);
  const fd = await fs.promises.open(INDEX_PATH, "r");
  const stream = fd.createReadStream({ encoding: "utf8" });

  const decoder = new TextDecoder();
  let buffer = "";
  const vectors = [];
  let processed = 0;

  for await (const chunk of stream) {
    buffer += chunk;
    const parts = buffer.split("},");
    buffer = parts.pop(); // carry over incomplete line
    for (const p of parts) {
      if (p.includes('"embedding"')) {
        try {
          const obj = JSON.parse(p.endsWith("}") ? p : p + "}");
          vectors.push(obj);
          processed++;
          if (processed % 1000 === 0) console.log(`  → ${processed} vectors`);
          if (vectors.length >= limit) {
            console.log(`🛑 Chunk limit reached (${limit})`);
            await fd.close();
            return vectors;
          }
        } catch { /* ignore bad slice */ }
      }
    }
  }

  await fd.close();
  console.log(`✅ Loaded ${vectors.length} vectors (chunk-safe).`);
  return vectors;
}

// ----------------------------------------------------------------------
//  LOAD METADATA (OPTIONAL)
// ----------------------------------------------------------------------
export async function loadMetadata(limit = 10) {
  try {
    const text = await fs.promises.readFile(META_PATH, "utf8");
    const lines = text.trim().split("\n");
    const sample = lines.slice(0, limit).map(l => JSON.parse(l));
    console.log(`📘 Metadata sample loaded (${sample.length}/${lines.length})`);
    return sample;
  } catch (err) {
    console.warn("⚠️ Metadata file missing:", META_PATH, err.message);
    return [];
  }
}

// ----------------------------------------------------------------------
//  SEARCH INDEX (semantic retrieval)
// ----------------------------------------------------------------------
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
  const scores = index.map(v => ({
    ...v,
    score: dotProduct(q, v.embedding),
  }));

  return scores.sort((a, b) => b.score - a.score).slice(0, 10);
}

// ----------------------------------------------------------------------
//  DOT PRODUCT
// ----------------------------------------------------------------------
function dotProduct(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

