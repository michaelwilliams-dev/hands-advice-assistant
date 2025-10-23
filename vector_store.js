// vector_store.js — Health & Safety Assistant (FAISS-binary compatible)
// ISO Timestamp: 🕒 2025-10-23T13:45:00Z
// CHANGELOG:
// • Reads compiled FAISS binary index directly (via faiss-node)
// • Retains metadata + OpenAI semantic-search pipeline
// • Fully compatible with Health & Safety backend structure

import fs from "fs";
import faiss from "faiss-node";
import { OpenAI } from "openai";

const INDEX_PATH = "/mnt/data/data/vector.index";
const META_PATH  = "/mnt/data/data/chunks_metadata.jsonl";

console.log("🟢 vector_store.js (FAISS-binary) using", INDEX_PATH);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_APIKEY || process.env.OPENAI_API_KEY,
});

/* ---------------------------------------------------------------------- */
/*  LOAD FAISS INDEX                                                      */
/* ---------------------------------------------------------------------- */
export async function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error(`❌ Index file missing at ${INDEX_PATH}`);
  }
  console.log("📦 Reading FAISS index:", INDEX_PATH);
  const index = faiss.readIndex(INDEX_PATH);
  console.log(`✅ Loaded ${index.ntotal} vectors of dim ${index.d}`);
  return index;
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
/*  SEARCH INDEX (semantic retrieval using OpenAI + FAISS)                */
/* ---------------------------------------------------------------------- */
export async function searchIndex(rawQuery, index) {
  const query = (typeof rawQuery === "string" ? rawQuery : String(rawQuery || "")).trim();
  if (!query || query.length < 3) {
    console.warn("⚠️ Query too short or invalid:", query);
    return [];
  }

  console.log("🔍 [AIVS Search] Query:", query);
  const embeddingResponse = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: [query],
  });
  const q = embeddingResponse.data[0].embedding;

  // Convert FAISS results to a simple ranked array
  const k = Math.min(10, index.ntotal);
  const { distances, labels } = index.search(q, k);

  const results = [];
  for (let i = 0; i < labels.length; i++) {
    results.push({ id: labels[i], score: 1 - distances[i] });
  }

  console.log(`🔎 Retrieved ${results.length} nearest neighbours.`);
  return results;
}
