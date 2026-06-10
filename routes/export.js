const express = require("express");
const router = express.Router();
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");

// Lazy-init Playwright browser singleton
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    const { chromium } = require("playwright");
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function extractTitle(markdown) {
  const h1 = markdown.match(/^#\s+(.+)/m);
  if (h1) return h1[1].trim().slice(0, 80);
  const firstLine = markdown.trim().split("\n")[0];
  return firstLine.slice(0, 80) || "document";
}

// ── Markdown → DOCX converter ───────────────────────────────────────────

function convertMarkdownToDocxChildren(markdown) {
  const lines = markdown.split("\n");
  const children = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      if (codeLines.length > 0) {
        children.push(new Paragraph({
          spacing: { before: 200, after: 200 },
          shading: { type: "solid", color: "F3F3F3" },
          children: [new TextRun({ text: codeLines.join("\n"), font: "Consolas", size: 18 })],
        }));
      }
      continue;
    }

    if (line.trim() === "") { i++; continue; }

    if (line.startsWith("# ")) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 },
        children: [new TextRun({ text: line.replace(/^#\s+/, ""), bold: true, size: 32 })],
      }));
      i++; continue;
    }
    if (line.startsWith("## ")) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 160 },
        children: [new TextRun({ text: line.replace(/^##\s+/, ""), bold: true, size: 28 })],
      }));
      i++; continue;
    }
    if (line.startsWith("### ")) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_3, spacing: { before: 240, after: 120 },
        children: [new TextRun({ text: line.replace(/^###\s+/, ""), bold: true, size: 24 })],
      }));
      i++; continue;
    }
    if (line.startsWith("#### ")) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_4, spacing: { before: 200, after: 100 },
        children: [new TextRun({ text: line.replace(/^####\s+/, ""), bold: true, size: 22 })],
      }));
      i++; continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      children.push(new Paragraph({
        spacing: { before: 200, after: 200 },
        border: { bottom: { style: "single", size: 1, color: "CCCCCC", space: 1 } },
        children: [],
      }));
      i++; continue;
    }

    if (line.startsWith("> ")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].replace(/^>\s?/, "")); i++;
      }
      children.push(new Paragraph({
        spacing: { before: 120, after: 120 }, indent: { left: 720 },
        border: { left: { style: "single", size: 4, color: "999999", space: 8 } },
        children: [new TextRun({ text: quoteLines.join(" "), italics: true, color: "666666" })],
      }));
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, "")); i++;
      }
      for (const item of items) {
        children.push(new Paragraph({
          spacing: { before: 40, after: 40 }, bullet: { level: 0 },
          children: parseInlineFormatting(item),
        }));
      }
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, "")); i++;
      }
      for (const item of items) {
        children.push(new Paragraph({
          spacing: { before: 40, after: 40 },
          children: parseInlineFormatting(item),
        }));
      }
      continue;
    }

    const parLines = [];
    while (i < lines.length && lines[i].trim() !== "" &&
           !lines[i].startsWith("#") && !lines[i].startsWith("> ") &&
           !/^[-*]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i]) &&
           !lines[i].trim().startsWith("```") &&
           !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())) {
      parLines.push(lines[i]); i++;
    }

    if (parLines.length > 0) {
      children.push(new Paragraph({
        spacing: { before: 80, after: 80 },
        children: parseInlineFormatting(parLines.join(" ")),
      }));
    }
  }

  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
  }
  return children;
}

function parseInlineFormatting(text) {
  const runs = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let lastIdx = 0, match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) runs.push(new TextRun({ text: text.slice(lastIdx, match.index) }));
    if (match[2] !== undefined) runs.push(new TextRun({ text: match[2], bold: true }));
    else if (match[3] !== undefined) runs.push(new TextRun({ text: match[3], italics: true }));
    else if (match[4] !== undefined) runs.push(new TextRun({ text: match[4], font: "Consolas", size: 18, shading: { type: "solid", color: "F0F0F0" } }));
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) runs.push(new TextRun({ text: text.slice(lastIdx) }));
  return runs.length > 0 ? runs : [new TextRun({ text })];
}

// ── Markdown → PPTX slide converter ─────────────────────────────────────

function convertMarkdownToPptxSlides(markdown) {
  // Split by H2 headings for slides
  const slides = [];
  const sections = markdown.split(/^##\s+/gm);

  // Title slide from first H1
  const h1Match = markdown.match(/^#\s+(.+)/m);
  const titleSlide = {
    title: h1Match ? h1Match[1].trim() : (sections[0]?.trim().split("\n")[0] || "Presentation"),
    content: "",
  };

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i].trim();
    if (!section) continue;
    const lines = section.split("\n");
    const title = (i === 0 && !h1Match) ? lines[0] : (i === 0 ? titleSlide.title : lines[0]);
    // Remove H1/H3/H4 headings from content, keep paragraphs and lists
    const bodyLines = (i === 0 && h1Match) ? lines : lines.slice(1);
    const content = bodyLines
      .filter(l => !l.startsWith("#") && l.trim())
      .map(l => l.replace(/^[-*]\s+/, "• ").replace(/^\d+\.\s+/, "→ "))
      .join("\n");
    if (title || content) {
      slides.push({ title: title || "", content: content || "" });
    }
  }

  // If no slides created, use the whole markdown as one slide
  if (slides.length === 0) {
    slides.push({ title: titleSlide.title, content: markdown.replace(/^#\s+.+\n?/m, "").trim() });
  }

  return slides;
}

// ── Routes ───────────────────────────────────────────────────────────────

// POST /api/export/pdf
router.post("/pdf", async (req, res) => {
  const { html, filename } = req.body;
  if (!html) return res.status(400).json({ error: "HTML content is required" });

  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "networkidle", timeout: 15000 });
      const pdfBuffer = await page.pdf({
        format: "A4", printBackground: true,
        margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      });
      res.json({ data: pdfBuffer.toString("base64"), filename: filename || "document.pdf", mime: "application/pdf" });
    } finally { await page.close(); }
  } catch (error) {
    console.error("[Export] PDF error:", error.message);
    res.status(500).json({ error: "Failed to generate PDF: " + error.message });
  }
});

// POST /api/export/docx
router.post("/docx", async (req, res) => {
  const { markdown, filename } = req.body;
  if (!markdown) return res.status(400).json({ error: "Markdown required" });
  try {
    const children = convertMarkdownToDocxChildren(markdown);
    const doc = new Document({ sections: [{ properties: {}, children }] });
    const buffer = await Packer.toBuffer(doc);
    res.json({ data: buffer.toString("base64"), filename: filename || "document.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  } catch (error) {
    console.error("[Export] DOCX error:", error.message);
    res.status(500).json({ error: "Failed to generate DOCX: " + error.message });
  }
});

// POST /api/export/pptx  —  Markdown → PPTX
router.post("/pptx", async (req, res) => {
  const { markdown, filename } = req.body;
  if (!markdown) return res.status(400).json({ error: "Markdown required" });
  try {
    const pptxgen = require("pptx");
    const slides = convertMarkdownToPptxSlides(markdown);
    const pres = new pptxgen();
    pres.layout = "LAYOUT_WIDE";
    pres.author = "Chelsea AI";
    pres.title = filename || "Presentation";

    for (const slide of slides) {
      const s = pres.addSlide();
      if (slide.title) {
        s.addText(slide.title, { x: 0.5, y: 0.3, w: "90%", h: 0.8, fontSize: 28, bold: true, color: "1a1a1a" });
      }
      if (slide.content) {
        s.addText(slide.content, { x: 0.5, y: 1.3, w: "90%", h: 5, fontSize: 16, color: "333333", breakLine: true });
      }
    }

    const buffer = await pres.writeBuffer();
    res.json({ data: buffer.toString("base64"), filename: filename || "presentation.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  } catch (error) {
    console.error("[Export] PPTX error:", error.message);
    res.status(500).json({ error: "Failed to generate PPTX: " + error.message });
  }
});

// POST /api/export/xlsx  —  Markdown tables → XLSX
router.post("/xlsx", async (req, res) => {
  const { markdown, filename } = req.body;
  if (!markdown) return res.status(400).json({ error: "Markdown required" });
  try {
    // Extract tables from markdown, or create a simple sheet from lists
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const rows = [];
    const lines = markdown.split("\n");

    let inTable = false;
    for (const line of lines) {
      if (line.startsWith("|") && line.endsWith("|")) {
        if (line.includes("---")) continue; // skip separator
        inTable = true;
        rows.push(line.split("|").slice(1, -1).map(c => c.trim()));
      } else if (inTable && !line.startsWith("|")) {
        inTable = false;
      } else if (!inTable && /^[-*]\s/.test(line)) {
        rows.push([line.replace(/^[-*]\s+/, "")]);
      }
    }

    // If no table found, put each line as a row
    if (rows.length === 0) {
      for (const line of lines) {
        if (line.trim()) rows.push([line.trim()]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.json({ data: buffer.toString("base64"), filename: filename || "spreadsheet.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  } catch (error) {
    console.error("[Export] XLSX error:", error.message);
    res.status(500).json({ error: "Failed to generate XLSX: " + error.message });
  }
});

// POST /api/export/file  —  Plain text formats (csv, txt, md, json, xml, html)
router.post("/file", async (req, res) => {
  const { content, filename, mime } = req.body;
  if (!content) return res.status(400).json({ error: "Content required" });
  const buf = Buffer.from(content, "utf-8");
  res.json({
    data: buf.toString("base64"),
    filename: filename || "document.txt",
    mime: mime || "text/plain",
  });
});

module.exports = router;
