import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Markdown.module.css";

/** True when a paragraph contains nothing but one italic run: Daylark's footnotes ("Searched: …", hints). */
function isFootnote(children: ReactNode) {
  const parts = Children.toArray(children).filter((child) => !(typeof child === "string" && child.trim() === ""));
  return parts.length === 1 && isValidElement(parts[0]) && parts[0].type === "em";
}

const AMOUNT_LINE = /^\s*((?:[A-Z]{3}\s)?[$€£]\s?[\d,]+(?:\.\d{2})?)\s*·\s*(.+?)\s*$/;

/**
 * Daylark's own receipt rows are "**Merchant**, line break, `$48.20 · Sep 15`". Show those as a title on the left and the
 * amount and date on the right. Anything that doesn't have that exact shape renders as a normal list item.
 */
function receiptRow(children: ReactNode) {
  const parts = Children.toArray(children);
  const breakIndex = parts.findIndex((part) => isValidElement(part) && part.type === "br");
  const after = breakIndex >= 0 ? parts.slice(breakIndex + 1) : [];
  // Everything after the line break must be plain text (the parser also leaves a bare newline before it).
  const match = after.length > 0 && after.every((part) => typeof part === "string") ? after.join("").match(AMOUNT_LINE) : null;
  if (!match) return null;
  return <><span className={styles.rowTitle}>{parts.slice(0, breakIndex)}</span><span className={styles.rowAmount}>{match[1]}<small>{match[2]}</small></span></>;
}

export function Markdown({ children }: { children: string }) {
  return <div className={styles.prose}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children: label, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener">{label}</a>,
        p: ({ children: content }) => <p className={isFootnote(content) ? styles.meta : undefined}>{content}</p>,
        li: ({ children: content }) => { const row = receiptRow(content); return <li className={row ? styles.receipt : undefined}>{row ?? content}</li>; },
        // The chat page's own heading is level 1, so headings inside an answer start at level 2 however the answer wrote them.
        h1: ({ children: content }) => <h1 aria-level={2}>{content}</h1>,
        h3: ({ children: content }) => <h3 aria-level={2}>{content}</h3>,
        table: ({ children: content }) => <div className={styles.tableWrap}><table>{content}</table></div>,
      }}
    >{children.replace(/^•\s+/gm, "- ")}</ReactMarkdown>
  </div>;
}
