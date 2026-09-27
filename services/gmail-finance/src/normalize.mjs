import { simpleParser } from 'mailparser';
import { convert } from 'html-to-text';
import { hash } from './store.mjs';
import { extractPdf } from './pdf.mjs';

export const NORMALIZER_VERSION = '1.0.0';
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
const symbols = { '€': 'EUR', '£': 'GBP', '₹': 'INR', 'US$': 'USD', 'CA$': 'CAD', 'AU$': 'AUD' };
const currencyPattern = [...CURRENCIES].join('|');
const numberPattern = '(?:\\d{1,3}(?:[ ,.]\\d{3})+|\\d+)(?:[.,]\\d{1,3})?';

export function minorUnits(raw, currency) {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  let value = raw.replace(/ /g, '');
  if (value.includes(',') && value.includes('.')) {
    const decimal = value.lastIndexOf(',') > value.lastIndexOf('.') ? ',' : '.';
    value = value.replace(decimal === ',' ? /\./g : /,/g, '').replace(',', '.');
  } else if (value.includes(',')) {
    if (/^\d{1,3}(,\d{3})+$/.test(value)) value = value.replace(/,/g, '');
    else if (value.split(',').length === 2 && value.split(',')[1].length === digits) value = value.replace(',', '.');
    else return null;
  }
  // A lone dot with three trailing digits is ambiguous (decimal vs grouping).
  if (/\.\d{3}$/.test(value) && digits !== 3) return null;
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > digits) return null;
  const units = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
  return units <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(units) : null;
}

export function moneyMentions(text, homeCurrency) {
  const prefix = `(?:US\\$|CA\\$|AU\\$|${currencyPattern}|[$€£₹¥])`;
  const pattern = new RegExp(`(?<![\\w])(${prefix})\\s*(${numberPattern})(?!\\d|[.,]\\d)|(?<![\\d.,])(${numberPattern})\\s+(${currencyPattern})(?![A-Z])`, 'g');
  const found = [...text.matchAll(pattern)];
  const explicit = new Set(found.map(m => symbols[m[1]] || (CURRENCIES.has(m[1]) ? m[1] : m[4])).filter(Boolean));
  return found.map((match, index) => {
    const token = match[1] || match[4];
    const currency = symbols[token] || (CURRENCIES.has(token) ? token : token === '$' && (explicit.size === 0 || (explicit.size === 1 && explicit.has(homeCurrency))) ? homeCurrency : null);
    return { index, start: match.index, end: match.index + match[0].length, text: match[0],
      amountMinor: currency ? minorUnits(match[2] || match[3], currency) : null, currency,
      currencyBasis: token === '$' ? 'configured_home_currency' : currency ? 'explicit' : 'ambiguous',
      context: text.slice(Math.max(0, match.index - 90), match.index + match[0].length + 70) };
  });
}

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function dateMentions(text) {
  const pattern = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
  return [...text.matchAll(pattern)].flatMap(match => {
    const iso = match[1] ? `${match[1]}-${match[2]}-${match[3]}` : `${match[6]}-${String(months.indexOf(match[4].slice(0, 3).toLowerCase()) + 1).padStart(2, '0')}-${match[5].padStart(2, '0')}`;
    const date = new Date(`${iso}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso
      ? [{ start: match.index, end: match.index + match[0].length, text: match[0], date: iso }] : [];
  }).map((item, index) => ({ ...item, index }));
}

export function localDate(milliseconds, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(milliseconds));
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
}

export async function normalize(raw, metadata, options) {
  if (raw.length > 35 * 1024 * 1024) throw new Error('message_size_limit');
  const mail = await simpleParser(raw, { skipHtmlToText: true, skipTextToHtml: true, maxHtmlLengthToParse: 2_000_000 });
  let body = mail.text;
  if (!body && mail.html) body = convert(mail.html, { wordwrap: false, selectors: [
    { selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' },
    { selector: 'style', format: 'skip' }, { selector: 'script', format: 'skip' },
    { selector: '[hidden]', format: 'skip' }, { selector: '[aria-hidden="true"]', format: 'skip' },
  ] });
  const originalBody = (body || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\r\n/g, '\n');
  const issues = [];
  // Keep quotes for review, but exclude them from extraction. Never silently import forwards.
  if (/^> |^-+\s*Forwarded message|^Begin forwarded message:|^On .+wrote:/mi.test(originalBody)) issues.push('quoted_or_forwarded_message');
  body = originalBody.split(/\n(?:On .+wrote:|> |-{2,}\s*(?:Original|Forwarded) message)/i)[0];
  let text = `Subject: ${mail.subject || ''}\nFrom: ${mail.from?.text || ''}\n\n${body}`;
  const sources = [{ kind: 'email', start: 0, end: text.length }];
  const attachments = [];
  for (const attachment of mail.attachments) {
    const item = { filename: attachment.filename || 'attachment', contentType: attachment.contentType, size: attachment.size, sha256: hash(attachment.content), status: 'unsupported' };
    let content = '';
    if (attachment.size > 15 * 1024 * 1024) item.status = 'size_limit';
    else if (attachment.contentType === 'application/pdf') {
      const pdf = await extractPdf(attachment.content);
      content = pdf.text; item.status = pdf.status;
    } else if (['text/plain', 'text/csv'].includes(attachment.contentType)) {
      content = attachment.content.toString('utf8'); item.status = 'extracted';
    } else if (attachment.contentDisposition === 'inline' && attachment.contentType.startsWith('image/') && attachment.size < 20000) {
      item.status = 'inline_image_unread';
    }
    if (item.status !== 'extracted') issues.push(`attachment_${item.status}`);
    if (content) {
      text += `\n\n[Attachment: ${item.filename}]\n`;
      const start = text.length;
      text += content;
      sources.push({ kind: 'attachment', filename: item.filename, sha256: item.sha256, start, end: text.length });
    }
    attachments.push(item);
  }
  if (text.length > 150000) issues.push('text_size_limit');
  return { version: NORMALIZER_VERSION, text, sources, attachments, issues: [...new Set(issues)],
    sender: mail.from?.value?.[0]?.address?.toLowerCase() || '', subject: mail.subject || '',
    receivedDate: metadata.received ? localDate(metadata.received, options.timeZone) : null,
    money: moneyMentions(text, options.homeCurrency), dates: dateMentions(text),
    promotionalHeaders: Boolean(mail.headers.get('list-unsubscribe') || mail.headers.get('list-id')) };
}
