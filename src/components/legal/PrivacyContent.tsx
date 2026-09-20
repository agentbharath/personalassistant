import { legal } from "@/lib/legal/config";
import { DocLink } from "./DocLink";
import styles from "./LegalPage.module.css";

/** The privacy text. Shown on its own page and inside the dialog, so it lives in one place. */
export function PrivacyContent() {
  const { product, operator, contactEmail } = legal;
  return <>
    <p>{product} is a personal assistant that helps you with your calendar, your email and your spending. This policy explains what {product} collects, why, who else sees it, and what you can do about it. {operator} operates {product} and is responsible for your data.</p>

    <div className={styles.callout}>
      <strong>The short version.</strong> {product} reads your email and calendar only to answer what you ask. It cannot send, delete or change email. It changes your calendar or your records only after you approve. Your conversations and financial details are encrypted before they are stored. We do not sell your data or use it for advertising.
    </div>

    <h2>1. What we collect</h2>
    <h3>From your Google account</h3>
    <p>When you sign in with Google you give {product} permission to:</p>
    <ul>
      <li><strong>Read your email</strong> (the read-only Gmail permission). {product} searches and reads messages when you ask about them, for example to find a receipt. It never sends, drafts, deletes, labels or changes email.</li>
      <li><strong>View and manage your calendar events</strong>. {product} reads your events to answer questions, and creates, changes or deletes an event only after you confirm it in the chat.</li>
      <li>Your name, email address and profile basics, which identify your account.</li>
    </ul>
    <p>We keep the sign-in tokens Google gives us so you stay connected. They are stored encrypted.</p>

    <h3>What you give us</h3>
    <ul>
      <li><strong>Conversations</strong>: your messages and {product}&apos;s replies, and each conversation&apos;s title.</li>
      <li><strong>Financial records you approve</strong>: an expense or bill that you import from an email or a receipt and confirm, such as merchant, amount, date and category, plus notes you add.</li>
      <li><strong>Preferences {product} learns</strong> when you correct it, such as &ldquo;always search 90 days&rdquo; or which category a merchant belongs to. You can see and remove these in Settings.</li>
      <li><strong>A home location</strong>, if you save one in Settings: a city or ZIP code. You can change or remove it at any time. If you choose “Use my current location”, your browser shares your position once; it is sent to Google to look up the city name, and only that city name is saved. The coordinates are not stored.</li>
      <li><strong>Feedback</strong>: good or bad ratings on answers, and the optional note you write with a bad rating.</li>
      <li><strong>Receipts you upload</strong> (PDF or image): read to extract the details. The file itself is not kept; only the details you confirm are saved.</li>
    </ul>

    <h3>Technical and usage data</h3>
    <ul>
      <li>For each request: which parts of {product} handled it, whether it succeeded, how long it took, how much AI processing it used and any error code. This does not include the text of your messages.</li>
      <li>Daily AI usage counts, so we can enforce limits and control cost.</li>
      <li>Error reports. We remove request bodies, cookies and message text from these before they are stored.</li>
      <li>In your own browser: your theme choice and any half-written message drafts. These stay on your device.</li>
    </ul>

    <h2>2. How we use it</h2>
    <p>Only to run {product} for you: to understand your request, look things up in your email and calendar, work out answers, save what you ask us to save, keep your account secure, prevent abuse, fix errors and keep costs within limits. We do not use your data for advertising, we do not sell it, and we do not use it to build profiles for anyone else.</p>

    <h2>3. Google user data</h2>
    <p>{product}&apos;s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer noopener">Google API Services User Data Policy</a>, including the Limited Use requirements. In particular:</p>
    <ul>
      <li>We use Google data only to provide and improve the features you see in {product}.</li>
      <li>We do not transfer it to others except as needed to provide those features (to the service providers in section 4), to follow the law, or as part of a merger or sale with notice to you.</li>
      <li>We do not use it for advertising, and we do not use it to train general AI models.</li>
      <li>People do not read your Google data, unless you ask us to look at something specific, it is needed to investigate abuse or a security problem, or the law requires it.</li>
    </ul>

    <h2>4. Who else handles your data</h2>
    <p>{product} relies on service providers. They process data for us to run the service, under their own terms and privacy policies.</p>
    <table>
      <thead><tr><th>Provider</th><th>What it does</th><th>What it can receive</th></tr></thead>
      <tbody>
        <tr><td>Supabase</td><td>Sign-in and the database</td><td>Your account details and everything stored above. Conversation text, titles, learned preferences, financial details and sign-in tokens are encrypted by {product} before they reach the database.</td></tr>
        <tr><td>Anthropic</td><td>The AI models that interpret requests and write some replies</td><td>Your message, recent conversation for context, receipts you upload, and where needed for a request, text taken from the emails or events involved.</td></tr>
        <tr><td>Google</td><td>Gmail and Calendar access, and route and travel-time estimates</td><td>Your requests to those services. For travel time, the start and end addresses, which can include your saved home location.</td></tr>
        <tr><td>Tavily</td><td>Public web search</td><td>A search query about public information, such as a place or event. It can include the area around your saved home location.</td></tr>
        <tr><td>Upstash</td><td>Short-lived cache that speeds up repeat requests</td><td>Encrypted cache entries.</td></tr>
        <tr><td>Sentry</td><td>Error reporting</td><td>Error details with request bodies, cookies and message text removed.</td></tr>
        <tr><td>Grafana Cloud (where enabled)</td><td>Performance monitoring</td><td>Timing and status data, not message content.</td></tr>
        <tr><td>Our hosting provider</td><td>Runs the application</td><td>Requests as they pass through the service.</td></tr>
      </tbody>
    </table>
    <p>We may also disclose information if the law requires it, or to protect the safety and rights of users or the service.</p>

    <h2>5. How we protect it</h2>
    <p>Conversation text and titles, learned preferences, financial merchant names and details, and Google sign-in tokens are encrypted with AES-256-GCM before they are stored. Access to your rows is limited to your own account. Connections use HTTPS. Certain identifiers are stored only as one-way hashes so records can be matched without exposing them.</p>
    <p>No system is perfectly secure, and we cannot guarantee absolute security. If we learn of a breach that affects you, we will tell you as the law requires.</p>

    <h2>6. How long we keep it</h2>
    <ul>
      <li><strong>Conversations</strong> are kept until you delete them. Deleting a conversation permanently removes its messages and its pending approvals.</li>
      <li><strong>Learned preferences</strong> are kept until you forget them in Settings.</li>
      <li><strong>Financial records and bills</strong> are kept until you delete them in Settings, under Your data.</li>
      <li><strong>Feedback ratings and notes, and request statistics</strong> are kept so we can measure and improve quality. Ask us if you want yours removed.</li>
      <li><strong>Google sign-in tokens</strong> are kept while you are connected. Removing {product}&apos;s access in your Google Account stops them working.</li>
      <li><strong>Cache entries</strong> expire on their own after a short time.</li>
    </ul>
    <p>When you delete your account, your data is removed from our database straight away. Our providers may keep short-lived copies, such as backups, for a limited time under their own policies. We do not currently delete inactive accounts automatically.</p>

    <h2>7. Your choices</h2>
    <ul>
      <li><strong>Delete a conversation</strong> from the chat list or History.</li>
      <li><strong>See or forget what {product} learned</strong> in Settings.</li>
      <li><strong>Disconnect Google</strong> at any time in your Google Account under Security, then Third-party access. {product} can then no longer read your email or calendar.</li>
      <li><strong>Download a copy of your data</strong>, <strong>delete your spending records</strong>, or <strong>delete your account and everything in it</strong>, all in Settings under Your data. Deleting the account also revokes {product}&apos;s access to your Google account. To correct something, or if you cannot use Settings, email us (section 8). Depending on where you live, you may have legal rights to access, correct, delete, restrict or move your data, and to object to how it is used. We will respond within the time the law requires.</li>
    </ul>

    <h2>8. Contact</h2>
    <p>Questions, requests to access or delete your data, and privacy concerns: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>. {operator}.</p>

    <h2>9. Children</h2>
    <p>{product} is for adults. It is not directed to children under 13, and we do not knowingly collect their information. If you believe a child has used it, contact us and we will delete the account.</p>

    <h2>10. Where data is processed</h2>
    <p>Our providers may process data in the United States and other countries. Where the law requires safeguards for such transfers, we rely on the mechanisms our providers offer.</p>

    <h2>11. Changes</h2>
    <p>We may update this policy. If a change is significant, we will tell you in the app or by email before it takes effect. The date at the top shows when it was last updated. See also our <DocLink doc="terms">Terms of Service</DocLink>.</p>
  </>;
}
