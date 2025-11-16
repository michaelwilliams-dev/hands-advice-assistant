// public/script.js — Health & Safety Assistant
// ISO Timestamp: 🕒 2025-10-18T14:45:00Z

console.log("CLIENT JS VERSION = v2025-10-18T14:45:00Z (Health & Safety Assistant)");

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const generateBtn = $("generate");
  const output = $("response");
  const emailInput = $("email");
  const managerInput = $("managerEmail");
  const clientInput = $("clientEmail");
  const clarificationInput = $("clarification") || $("topic") || $("question");
  const isoSpan = $("iso-timestamp");

  if (isoSpan) isoSpan.textContent = new Date().toISOString();

  if (!generateBtn) {
    console.error("❌ Missing #generate button");
    return;
  }

  generateBtn.addEventListener("click", async () => {

    // --- UI Preparing State (added) ---
    generateBtn.disabled = true;
    generateBtn.textContent = "Preparing report…";
    document.getElementById("clearResultsBtn").style.display = "none";

    const question = clarificationInput?.value?.trim() || "";
    const email = emailInput?.value?.trim() || "";
    const managerEmail = managerInput?.value?.trim() || "";
    const clientEmail = clientInput?.value?.trim() || "";

    if (!question) {
      output.textContent = "❌ Please enter a question or problem description.";
      generateBtn.disabled = false;
      generateBtn.textContent = "Generate Health & Safety Report";
      return;
    }

    const payload = {
      question,
      email,
      managerEmail,
      clientEmail,
      ts: new Date().toISOString(),
    };

    console.log("📤 [CLIENT /ask] Sending payload", payload);

    output.textContent =
      "⏳ Semantic search then generating Health & Safety Report – please wait.";

    try {
      const res = await fetch("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        output.textContent = `❌ Server error: ${data?.error || res.status}`;
        console.error("❌ Backend error:", data);
      } else if (data?.answer) {
        output.innerHTML = data.answer;
      } else if (data?.reportText) {
        output.innerHTML = data.reportText;
      } else {
        output.innerHTML = "⚠️ No report returned. Please check backend logs.";
        console.warn("⚠️ Unexpected response:", data);
      }

      // Show clear button after rendering
      document.getElementById("clearResultsBtn").style.display = "block";

    } catch (err) {
      console.error("❌ Network or fetch error:", err);
      output.textContent =
        "❌ Failed to contact backend: " + (err.message || String(err));
    }

    // --- Restore button after completion (added) ---
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate Health & Safety Report";
  });

  // --- Clear Results Button Logic (added) ---
  const clearBtn = document.getElementById("clearResultsBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      output.textContent = "";
      clarificationInput.value = "";
      clearBtn.style.display = "none";
    });
  }
});
