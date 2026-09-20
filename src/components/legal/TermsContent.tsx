import { legal } from "@/lib/legal/config";
import { DocLink } from "./DocLink";


/** The terms text. Shown on its own page and inside the dialog, so it lives in one place. */
export function TermsContent() {
  const { product, operator, contactEmail, jurisdiction } = legal;
  return <>
    <p>These terms govern your use of {product}, operated by {operator} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By signing in or using {product} you agree to them. If you do not agree, do not use it. How we handle your data is described in the <DocLink doc="privacy">Privacy Policy</DocLink>.</p>

    <h2>1. What {product} is</h2>
    <p>{product} is an AI assistant. With your permission it reads your email and calendar, answers questions about them and your spending, searches public information, and can prepare changes for you to approve. It reads email. If you turn drafting on, it can also save a draft you approved in your Gmail Drafts folder, and you send it yourself. It cannot send, delete or change your email. It creates, edits or deletes calendar events and saves financial records only after you confirm.</p>

    <h3>Codes and links in your email</h3>
    <p>One-time passcodes, verification codes, password-reset links, sign-in links and similar items in your email belong to the services that sent them and are meant to be used by you, straight away. {product} does not show, read out or use them, and will not help you retrieve them. Open those emails in your own email. You are responsible for the security of your accounts with those services, and {product} is not responsible for anything that happens to an account because of a code or link you shared or used.</p>

    <h2>2. Who can use it</h2>
    <p>You must be at least 18 and able to enter a binding agreement. You need a Google account, and you must be entitled to give {product} access to the email and calendar you connect.</p>

    <h2>3. Your account</h2>
    <p>You are responsible for activity under your account and for keeping your Google account secure. Tell us promptly if you think someone else has access. You can stop at any time by disconnecting {product} in your Google Account and asking us to delete your data.</p>

    <h2>4. Answers can be wrong</h2>
    <p>{product} uses AI. It can misread an email, miss a message, get a date, amount or category wrong, or misunderstand a request. Spending figures come from emails and receipts you import and may be incomplete or duplicated. Travel and availability estimates are estimates.</p>
    <p><strong>Check anything important before you rely on it.</strong> {product} is not a financial, tax, legal or medical adviser, and nothing it says is professional advice. You decide whether to approve each change it proposes, and you are responsible for what you approve.</p>

    <h2>5. Acceptable use</h2>
    <p>You agree not to:</p>
    <ul>
      <li>break the law or infringe anyone&apos;s rights while using {product};</li>
      <li>connect an account or use data you have no right to use;</li>
      <li>try to gain unauthorized access, probe or disrupt the service, or get around security or usage limits;</li>
      <li>use it to harass, defraud or harm anyone, or to produce unlawful content;</li>
      <li>copy, resell or scrape the service, or use automated means to load it beyond normal personal use.</li>
    </ul>

    <h2>6. Usage limits</h2>
    <p>To keep the service reliable and affordable, {product} limits how much AI processing each account can use per day and per request. When you reach a limit, features that need the AI may pause until it resets. We may change limits.</p>

    <h2>7. Your content</h2>
    <p>You keep ownership of your emails, calendar data, messages and records. You give us permission to process them, and to share them with the providers in the Privacy Policy, only as needed to run {product} for you. We do not claim ownership of your content.</p>

    <h2>8. Third-party services</h2>
    <p>{product} works with services such as Google and AI and search providers. Your use of Google is subject to Google&apos;s own terms. We are not responsible for third-party services, and they can change or be unavailable.</p>

    <h2>9. Availability and changes</h2>
    <p>{product} is provided as it is, and we may change, limit or stop features at any time. We do not promise it will be uninterrupted or error-free. Keep your own copy of anything you cannot afford to lose.</p>

    <h2>10. Suspension and ending</h2>
    <p>We may suspend or end access if you break these terms, misuse the service, or if we must for legal or security reasons. You may stop using {product} at any time. Sections that by their nature should continue, such as disclaimers and limits on liability, will continue after that.</p>

    <h2>11. Disclaimers</h2>
    <p>To the fullest extent the law allows, {product} is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, express or implied, including fitness for a particular purpose, accuracy and non-infringement.</p>

    <h2>12. Limit of liability</h2>
    <p>To the fullest extent the law allows, we are not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, lost data, missed appointments, late payments or financial decisions arising from your use of {product}. Our total liability for any claim relating to the service is limited to the greater of the amount you paid us for it in the twelve months before the claim, or US$50. Some places do not allow these limits, so they may not fully apply to you, and nothing here limits liability that cannot be limited by law.</p>

    <h2>13. Governing law</h2>
    <p>These terms are governed by the laws of {jurisdiction}, without regard to conflict-of-law rules. Courts in {jurisdiction} have jurisdiction over disputes, unless your local consumer law gives you the right to use your own courts.</p>

    <h2>14. Changes to these terms</h2>
    <p>We may update these terms. If a change is significant, we will tell you in the app or by email before it takes effect. Continuing to use {product} after that means you accept the new terms.</p>

    <h2>15. Contact</h2>
    <p>Questions about these terms: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>
  </>;
}
