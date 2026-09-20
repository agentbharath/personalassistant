import { notFound } from "next/navigation";
import { AssistantMessage, PendingMessage, UserMessage } from "@/components/chat/Message";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import * as icons from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Skeleton";
import { Demos } from "./Demos";
import styles from "./design.module.css";

const SWATCHES = ["bg", "bg-sunken", "surface", "ink", "muted", "faint", "line", "accent", "accent-soft", "blue", "green", "amber", "violet", "danger"];

/** Development-only style guide. Not served in production, and not linked from anywhere. */
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <main id="main" className={styles.page}>
    <h1>Daylark design system</h1>
    <p className={styles.note}>Tokens live in <code>src/styles/tokens.css</code>. Toggle dark mode with the theme switch in the app.</p>

    <section><h2>Colour</h2><div className={styles.swatches}>{SWATCHES.map((name) => <div key={name}><i style={{ background: `var(--${name})` }} /><span>--{name}</span></div>)}</div></section>

    <section><h2>Type</h2>
      <p style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", letterSpacing: "-0.04em", fontWeight: 600 }}>Geist display</p>
      <p style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-xl)" }}>Geist heading</p>
      <p>Geist body text for reading answers and interface copy.</p>
      <p style={{ fontFamily: "var(--font-mono)" }}>Geist Mono · $1,234.56</p>
    </section>

    <section><h2>Buttons</h2><div className={styles.row}>
      <Button variant="primary">Primary</Button><Button>Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button disabled>Disabled</Button>
      <Button size="sm">Small</Button><IconButton label="Search"><icons.SearchIcon /></IconButton>
    </div></section>

    <section><h2>Icons</h2><div className={styles.row}>{Object.entries(icons).map(([name, Icon]) => <span key={name} title={name}><Icon /></span>)}</div></section>

    <section><h2>Avatar and loading</h2><div className={styles.row}><Avatar name="daylark@example.com" /><div style={{ width: 200 }}><Skeleton /></div></div></section>

    <section><h2>Interactive components</h2><Demos /></section>

    <section><h2>Messages</h2><div className={styles.thread}>
      <UserMessage>Show my latest receipts with the amounts.</UserMessage>
      <AssistantMessage>{"I found **2 receipts**.\n\n1. **iHerb order #947**  \n   $48.20 · Sep 15\n2. **Amazon order #112**  \n   $12.99 · Sep 3\n\n| Store | Total |\n| --- | --- |\n| iHerb | $48.20 |\n\n*Searched the last 30 days.*"}</AssistantMessage>
      <AssistantMessage approval>{"I'll record this expense. Reply **Confirm** to save it."}</AssistantMessage>
      <AssistantMessage notice>{"This is taking longer than expected, so I stopped safely. Nothing was changed."}</AssistantMessage>
      <PendingMessage label="Checking your email…" takingLonger={false} />
    </div></section>
  </main>;
}
