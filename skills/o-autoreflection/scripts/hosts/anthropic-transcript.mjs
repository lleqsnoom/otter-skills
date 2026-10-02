// The turn shape Claude Code, Cursor and Cline store. It lives apart from session discovery because
// it changes when one vendor changes its transcript, not when a session file is found or read.

import { textOf } from "./session-logs.mjs";

/**
 * Anthropic-shaped turns, the shape Claude Code, Cursor and Cline all store. Each host wraps it
 * differently — Claude Code writes `{type, message:{role, content}}` lines, Cursor writes
 * `{role, message:{content}}` lines, Cline writes bare `{role, content}` entries — so `pick` says which
 * of an entry's fields are the turn, and returns null for an entry that is not one.
 */
export function anthropicMessages(entries, pick) {
  const callNames = new Map();
  const messages = [];
  for (const entry of entries) {
    const turn = pick(entry);
    if (!turn) continue;
    const parts = anthropicParts(turn.content, callNames);
    if (parts.length) {
      messages.push({ role: turn.role ?? "assistant", created: turn.created ?? null, ...(turn.model ? { model: turn.model } : {}), parts });
    }
  }
  return messages;
}

/**
 * Anthropic-shaped content blocks, which Claude Code, Cursor and Cline all store: a string, or a list
 * of `text`, `thinking`, `tool_use` and `tool_result` blocks. The tool name is remembered so a result
 * can be attributed to the tool that produced it.
 */
export function anthropicParts(content, callNames = new Map()) {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  const parts = [];
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type === "text") {
      if (block.text) parts.push({ type: "text", text: String(block.text) });
    } else if (block?.type === "thinking") {
      parts.push({ type: "reasoning", thinking: String(block.thinking ?? "") });
    } else if (block?.type === "tool_use") {
      callNames.set(block.id, block.name ?? null);
      parts.push({ type: "tool_call", tool_call_id: block.id ?? null, name: block.name ?? "?", input: JSON.stringify(block.input ?? {}) });
    } else if (block?.type === "tool_result") {
      parts.push({
        type: "tool_result",
        tool_call_id: block.tool_use_id ?? null,
        name: callNames.get(block.tool_use_id) ?? null,
        content: textOf(block.content),
      });
    }
  }
  return parts;
}
