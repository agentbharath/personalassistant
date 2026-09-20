"use client";

import { useState, useTransition } from "react";
import { deleteMyAccount, deleteSpendingRecords } from "@/app/settings/actions";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import styles from "./DataControls.module.css";

/** Download a copy, delete spending records, or delete the whole account. The two deletions each ask first. */
export function DataControls() {
  const { toast } = useToast();
  const [asking, setAsking] = useState<null | "spending" | "account">(null);
  const [pending, start] = useTransition();

  return <div className={styles.list}>
    <div className={styles.row}>
      <span><strong>Download my data</strong><br /><span className={styles.sub}>Your chats, spending records, bills, preferences and feedback as one JSON file.</span></span>
      <a className={styles.download} href="/api/account/export" download>Download</a>
    </div>
    <div className={styles.row}>
      <span><strong>Delete my spending records</strong><br /><span className={styles.sub}>Removes every expense, income entry and bill. Your chats stay.</span></span>
      <Button size="sm" variant="secondary" onClick={() => setAsking("spending")}>Delete…</Button>
    </div>
    <div className={styles.row}>
      <span><strong>Delete my account</strong><br /><span className={styles.sub}>Removes your account and everything in it, and disconnects Google. This can’t be undone.</span></span>
      <Button size="sm" variant="secondary" onClick={() => setAsking("account")}>Delete…</Button>
    </div>

    {asking === "spending" && <ConfirmDialog title="Delete all spending records?" confirmLabel="Delete records" busy={pending} onCancel={() => setAsking(null)}
      onConfirm={() => start(async () => { try { await deleteSpendingRecords(); toast({ message: "Spending records deleted." }); } catch { toast({ message: "Couldn’t delete them. Nothing was changed.", tone: "notice" }); } setAsking(null); })}>
      Every expense, income entry and bill Daylark has recorded will be permanently removed. Your chats and preferences stay. Download your data first if you want a copy.
    </ConfirmDialog>}

    {asking === "account" && <ConfirmDialog title="Delete your account?" confirmLabel="Delete everything" requireText="delete my account" busy={pending} onCancel={() => setAsking(null)}
      onConfirm={() => start(async () => { try { await deleteMyAccount("delete my account"); } catch (error) { if (error instanceof Error && error.message.includes("NEXT_REDIRECT")) throw error; toast({ message: "Couldn’t delete the account. Nothing more was removed than you can see. Try again, or email us.", tone: "notice" }); setAsking(null); } })}>
      Your chats, spending records, bills, preferences and feedback will be permanently removed, Daylark’s access to Google will be revoked, and you’ll be signed out. Download your data first if you want a copy.
    </ConfirmDialog>}
  </div>;
}
