// A deliberately small, media-free renderer, not a general HTML/Markdown engine.
// All text is explicit RichText, so model output cannot cause implicit URL uploads.
export type RichBlock =
  | { type: "paragraph" | "pre" | "thinking"; text: string; language?: string }
  | { type: "mathematical_expression"; expression: string }
  | { type: "details"; summary: string; blocks: RichBlock[] }
  | { type: "table"; cells: { text: string; align: "left"; valign: "top"; is_header?: true }[][]; is_bordered: true };
export type RichMessage = { blocks: RichBlock[]; skip_entity_detection: true };
const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });

export function splitTelegramText(text: string, limit = 4000): string[] {
  if (!Number.isInteger(limit) || limit < 64 || limit > 4096) throw new Error("telegram_invalid_text_limit");
  const result: string[] = [];
  let part = "";
  for (const item of segmenter.segment(text)) {
    // UTF-16 is a conservative bound for Telegram's documented character limit.
    // Pathological combining clusters larger than the limit use code points.
    const segments = item.segment.length > limit ? Array.from(item.segment) : [item.segment];
    for (const value of segments) {
      if (part.length + value.length > limit && part) { result.push(part); part = ""; }
      part += value;
    }
  }
  if (part) result.push(part);
  return result;
}

function parse(text: string, report: { degraded: boolean }, depth = 0): RichBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n"), blocks: RichBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) { blocks.push({ type: "paragraph", text: paragraph.join("\n") }); paragraph = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(`{3,}|~{3,})([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flush(); const content: string[] = [], marker = fence[1]!, language = fence[2];
      while (++i < lines.length) { if (lines[i]!.trim() === marker) break; content.push(lines[i]!); }
      blocks.push({ type: "pre", text: content.join("\n"), ...(language ? { language } : {}) });
    } else if (line.trim() === "$$") {
      flush(); const content: string[] = [];
      while (++i < lines.length && lines[i]!.trim() !== "$$") content.push(lines[i]!);
      blocks.push({ type: "mathematical_expression", expression: content.join("\n") });
    } else if (/^\s*\$\$.+\$\$\s*$/.test(line)) {
      flush(); blocks.push({ type: "mathematical_expression", expression: line.trim().slice(2, -2) });
    } else if (line.trim() === "<details>" && depth < 7) {
      flush(); const content: string[] = []; let nesting = 1, summary = "展开详情";
      while (++i < lines.length) {
        const current = lines[i]!;
        if (current.trim() === "<details>") nesting++;
        if (current.trim() === "</details>" && --nesting === 0) break;
        const match = /^\s*<summary>(.*?)<\/summary>\s*$/.exec(current);
        if (match && nesting === 1) summary = match[1]!;
        else content.push(current);
      }
      blocks.push({ type: "details", summary, blocks: parse(content.join("\n"), report, depth + 1) });
    } else if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1]!)) {
      flush(); const rows = [line]; i++;
      while (i + 1 < lines.length && lines[i + 1]!.includes("|") && lines[i + 1]!.trim()) rows.push(lines[++i]!);
      const cells = rows.map((row, index) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|")
        .map(text => ({ text: text.trim(), align: "left" as const, valign: "top" as const, ...(index === 0 ? { is_header: true as const } : {}) })));
      if (cells.some(row => row.length > 20)) { report.degraded = true; blocks.push({ type: "paragraph", text: rows.join("\n") }); }
      else blocks.push({ type: "table", cells, is_bordered: true });
    } else if (!line.trim()) flush();
    else paragraph.push(line);
  }
  flush();
  return blocks;
}

function metrics(block: RichBlock): { bytes: number; count: number } {
  if (block.type === "details") {
    const inner = block.blocks.map(metrics);
    return { bytes: Buffer.byteLength(block.summary) + inner.reduce((sum, b) => sum + b.bytes, 0), count: 1 + inner.reduce((sum, b) => sum + b.count, 0) };
  }
  if (block.type === "table") return { bytes: block.cells.flat().reduce((n, c) => n + Buffer.byteLength(c.text), 0), count: 1 + block.cells.length };
  return { bytes: Buffer.byteLength(block.type === "mathematical_expression" ? block.expression : block.text), count: 1 };
}

function readable(block: RichBlock): string {
  if (block.type === "details") return block.summary + "\n" + block.blocks.map(readable).join("\n\n");
  if (block.type === "table") return block.cells.map(row => row.map(c => c.text).join(" | ")).join("\n");
  return block.type === "mathematical_expression" ? block.expression : block.text;
}
export function readableTelegramRich(message: RichMessage) { return message.blocks.map(readable).join("\n\n"); }

export function renderTelegramRich(text: string): { messages: RichMessage[]; degraded: boolean } {
  const report = { degraded: false }, parsed = parse(text, report), messages: RichMessage[] = [];
  let blocks: RichBlock[] = [], bytes = 0, count = 0, degraded = report.degraded;
  const push = (block: RichBlock) => {
    const size = metrics(block);
    if ((bytes + size.bytes > 31800 || count + size.count > 450) && blocks.length) {
      messages.push({ blocks, skip_entity_detection: true }); blocks = []; bytes = 0; count = 0;
    }
    blocks.push(block); bytes += size.bytes; count += size.count;
  };
  for (const block of parsed) {
    const size = metrics(block);
    if (size.bytes <= 31800 && size.count <= 450) push(block);
    else {
      // Oversized structured units are readable paragraphs, explicitly reported.
      // Paragraph/code units can be split without losing their original content.
      if (block.type !== "paragraph" && block.type !== "pre") degraded = true;
      for (const part of splitTelegramText(readable(block), 4000))
        push(block.type === "pre" ? { ...block, text: part } : { type: "paragraph", text: part });
    }
  }
  if (blocks.length) messages.push({ blocks, skip_entity_detection: true });
  return { messages, degraded };
}

export function telegramDraft(text: string, mode: "rich" | "plain") {
  if (mode === "plain") {
    const parts = splitTelegramText(text, 3900);
    return { text: (parts.length > 1 ? "（正在生成，以下为末段预览；完成后发送全文）\n" : "") + (parts.at(-1) ?? "") };
  }
  if (!text.trim()) return { rich_message: { blocks: [{ type: "thinking", text: "思考中…" }], skip_entity_detection: true } };
  const parts = renderTelegramRich(text).messages;
  if (parts.length > 1) return { rich_message: { ...parts.at(-1)!, blocks: [
    { type: "paragraph", text: "（正在生成，以下为末段预览；完成后发送全文）" }, ...parts.at(-1)!.blocks,
  ] } };
  return { rich_message: parts[0]! };
}
