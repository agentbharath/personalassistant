export type ContextTurn = { role: "user" | "assistant"; content: string; choices?: string[] };

/** Keep both the task at the beginning and the question/offer at the end of a long turn. */
export function clipTurn(text: string, limit: number) {
  if (limit <= 0) return "";
  if (limit < 30) return text.slice(-limit);
  if (text.length <= limit) return text;
  const marker = "\n[…middle omitted…]\n";
  const head = Math.floor((limit - marker.length) / 2);
  return text.slice(0, head) + marker + text.slice(-(limit - marker.length - head));
}

export function recentContext(context: ContextTurn[], limit = 12000) {
  const turns = context.filter(turn => !turn.content.startsWith("Earlier conversation summary")).slice(-12);
  const selected: ContextTurn[] = [];
  for (let i = turns.length - 1; i >= 0 && limit > 0; i--) {
    const content = clipTurn(turns[i].content, Math.min(limit, turns[i].role === "assistant" ? 1800 : 1200));
    selected.unshift({role: turns[i].role, content, ...(turns[i].choices?.length ? {choices: turns[i].choices} : {})});
    limit -= content.length;
  }
  return selected;
}
