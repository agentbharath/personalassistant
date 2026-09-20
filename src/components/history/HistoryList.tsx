"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PinIcon, SearchIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Skeleton";
import { useConversationDeletion } from "@/components/layout/ConversationDeletion";
import { ConversationMenu, RenameField } from "@/components/layout/ConversationMenu";
import type { ConversationSummary } from "@/lib/conversations/store";
import { groupByRecency } from "@/lib/ui/grouping";
import styles from "./HistoryList.module.css";

const time = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function HistoryList({ initial, initialHasMore }: { initial: ConversationSummary[]; initialHasMore: boolean }) {
  const { hiddenConversationIds, applyChanges, renamingId } = useConversationDeletion();
  const [items, setItems] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<ConversationSummary[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Titles are encrypted, so the server decrypts and matches them across every conversation, not only the loaded ones.
  useEffect(() => {
    const text = query.trim();
    if (!text) { setFound(null); setSearching(false); return; }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/conversations?q=${encodeURIComponent(text)}&limit=50`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("failed");
        setFound(((await response.json()) as { conversations: ConversationSummary[] }).conversations);
        setSearching(false);
      } catch (error) {
        if ((error as Error).name !== "AbortError") { setFound([]); setSearching(false); }
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const visible = useMemo(() => applyChanges((found ?? items).filter((item) => !hiddenConversationIds.has(item.id))), [found, items, hiddenConversationIds, applyChanges]);
  const pinned = visible.filter((item) => item.pinned);
  const groups = useMemo(() => [...(pinned.length ? [{ label: "Pinned", items: pinned }] : []), ...groupByRecency(visible.filter((item) => !item.pinned))], [visible, pinned]);

  async function loadMore() {
    const last = items.filter((item) => !item.pinned).at(-1) ?? items.at(-1);
    if (!last || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/conversations?before=${encodeURIComponent(last.updatedAt)}&limit=30`, { cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      const body = await response.json() as { conversations: ConversationSummary[]; hasMore: boolean };
      setItems((current) => [...current, ...body.conversations]);
      setHasMore(body.hasMore);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return <div className={styles.wrap}>
    <label className={styles.search}>
      <SearchIcon width={18} height={18} />
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all conversations" aria-label="Search all conversations" />
    </label>
    {searching && found === null
      ? <div className={styles.skeletons} role="status" aria-label="Searching">{[0, 1, 2, 3].map((row) => <Skeleton key={row} height="2.5rem" />)}</div>
      : groups.length === 0
        ? <p className={styles.empty}>{query ? "No conversations match that." : "No saved conversations yet."}</p>
        : groups.map((group) => <section className={styles.group} key={group.label} aria-label={group.label}>
          <h2>{group.label}</h2>
          {group.items.map((item) => <div className={styles.row} key={item.id}>
            {renamingId === item.id
              ? <RenameField conversation={item} />
              : <>
                <Link className={styles.link} href={{ pathname: "/", query: { conversation: item.id } }}>
                  <span className={styles.title}>{item.pinned && <PinIcon width={12} height={12} role="img" aria-label="Pinned" />}{item.title}</span>
                  <time className={styles.when} dateTime={item.updatedAt}>{time.format(new Date(item.updatedAt))}</time>
                </Link>
                <ConversationMenu conversation={item} active={false} />
              </>}
          </div>)}
        </section>)}
    {!query && hasMore && <Button className={styles.more} disabled={loading} onClick={loadMore}>{loading ? "Loading…" : failed ? "Couldn’t load. Try again" : "Show older conversations"}</Button>}
  </div>;
}
