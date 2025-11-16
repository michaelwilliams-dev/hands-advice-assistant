// public/script.js — Health & Safety Assistant
// ISO Timestamp: 🕒 2025-10-18T14:45:00Z
// ✅ Connects to health-safety-assistant backend via same-origin /ask
// ✅ Sends all three email fields (user, manager, optional)
// ✅ Displays H&S report or clear error message

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
    const question = clarificationInput?.value?.trim() || "";
    const email = emailInput?.value?.trim() || "";
    const managerEmail = managerInput?.value?.trim() || "";
    const clientEmail = clientInput?.value?.trim() || "";

    if (!question) {
      output.textContent = "❌ Please enter a question or problem description.";
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
        return;
      }

      if (data?.answer) {
        output.innerHTML = data.answer;
        document.getElementById("clearResultsBtn").style.display = "block"; // ⭐ ADDED
      } else if (data?.reportText) {
        output.innerHTML = data.reportText;
        document.getElementById("clearResultsBtn").style.display = "block"; // ⭐ ADDED
      } else {
        output.innerHTML = "⚠️ No report returned. Please check backend logs.";
        document.getElementById("clearResultsBtn").style.display = "block"; // ⭐ ADDED
        console.warn("⚠️ Unexpected response:", data);
      }

    } catch (err) {
      console.error("❌ Network or fetch error:", err);
      output.textContent =
        "❌ Failed to contact backend: " + (err.message || String(err));
    }
  });
});
