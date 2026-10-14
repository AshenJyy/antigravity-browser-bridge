// Clean up any old overlay elements
(function () {
  document.getElementById("__gemini_badge")?.remove();
  document.getElementById("__gemini_virtual_pointer")?.remove();
  document.getElementById("__gemini_overlay_styles")?.remove();
  document.querySelectorAll(".__gemini_ripple").forEach((r) => r.remove());
  if (document.title.startsWith("✨ [Gemini] ")) {
    document.title = document.title.replace(/^✨\s*\[Gemini\]\s*/, "");
  }
})();
