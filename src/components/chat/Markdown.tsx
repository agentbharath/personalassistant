import { Children, isValidElement, type ReactNode } from "react";
import type { Element, ElementContent } from "hast";
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

type Card = { name: string; note: string; cite: string; address: string; href: string };

const textOf = (node: ElementContent): string => (node.type === "text" ? node.value : node.type === "element" ? node.children.map(textOf).join("") : "");
const MAPS = /^https:\/\/www\.google\.com\/maps\/search\//;

/**
 * Daylark's place answers are lists shaped "**Name** — note [n]", a line break, then "address · [Open in Maps](link)". Those are shown as cards.
 * The shape comes from our own code (agents/search-answer.ts), and anything that does not match it stays an ordinary list.
 */
function placeCard(item: Element): Card | null {
  const kids = item.children;
  const strong = kids.find((child): child is Element => child.type === "element" && child.tagName === "strong");
  const breakIndex = kids.findIndex((child) => child.type === "element" && child.tagName === "br");
  const link = kids.find((child): child is Element => child.type === "element" && child.tagName === "a" && MAPS.test(String(child.properties?.href ?? "")));
  if (!strong || breakIndex < 0 || !link) return null;
  const strongIndex = kids.indexOf(strong);
  const before = kids.slice(strongIndex + 1, breakIndex).map(textOf).join("");
  const cite = before.match(/\[(\d)\]\s*$/)?.[1] ?? "";
  const after = kids.slice(breakIndex + 1).filter((child) => child !== link).map(textOf).join("");
  return {
    name: textOf(strong),
    note: before.replace(/\s*\[\d\]\s*$/, "").replace(/^\s*[—–-]\s*/, "").trim(),
    cite,
    address: after.replace(/[\s·]+$/, "").trim(),
    href: String(link.properties?.href),
  };
}

function placeCards(list: Element): Card[] | null {
  const items = list.children.filter((child): child is Element => child.type === "element" && child.tagName === "li");
  const cards = items.map(placeCard);
  return items.length >= 2 && cards.every(Boolean) ? (cards as Card[]) : null;
}

export function Markdown({ children }: { children: string }) {
  return <div className={styles.prose}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children: label, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener">{label}</a>,
        p: ({ children: content }) => <p className={isFootnote(content) ? styles.meta : undefined}>{content}</p>,
        ul: ({ node, children: content }) => {
          const cards = node ? placeCards(node) : null;
          if (!cards) return <ul>{content}</ul>;
          return <div className={styles.cards}>{cards.map((card) => <article className={styles.card} key={`${card.name}-${card.href}`}>
            <div className={styles.cardHead}><strong className={styles.cardName}>{card.name}</strong>{card.cite && <span className={styles.cite} title={`Source ${card.cite}`}>{card.cite}</span>}</div>
            {card.note && <p className={styles.cardNote}>{card.note}</p>}
            {card.address && <p className={styles.cardAddress}>{card.address}</p>}
            <a className={styles.cardLink} href={card.href} target="_blank" rel="noreferrer noopener">Open in Maps<span className={styles.sr}> for {card.name}</span></a>
          </article>)}</div>;
        },
        li: ({ children: content }) => { const row = receiptRow(content); return <li className={row ? styles.receipt : undefined}>{row ?? content}</li>; },
        // The chat page's own heading is level 1, so headings inside an answer start at level 2 however the answer wrote them.
        h1: ({ children: content }) => <h1 aria-level={2}>{content}</h1>,
        h3: ({ children: content }) => <h3 aria-level={2}>{content}</h3>,
        table: ({ children: content }) => <div className={styles.tableWrap}><table>{content}</table></div>,
      }}
    >{children.replace(/^•\s+/gm, "- ")}</ReactMarkdown>
  </div>;
}
