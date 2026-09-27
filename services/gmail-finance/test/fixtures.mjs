export function eml(subject, body, sender = 'receipts@shop.example', extra = '') {
  return Buffer.from(`From: ${sender}\r\nTo: owner@example.com\r\nDate: Sat, 26 Sep 2026 10:00:00 -0700\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n${extra}\r\n${body}`);
}
export const samples = [
  ['receipt', eml('Your purchase receipt', 'Order ID: SHOP-123\nPurchase date: 2026-09-20\nSubtotal: USD 100.00\nTax: USD 8.00\nOrder total: USD 108.00\nPaid with Klarna')],
  ['duplicate', eml('Order confirmation', 'Order ID: SHOP-123\nPurchase date: 2026-09-20\nOrder total: USD 108.00\nPaid with Klarna')],
  ['shipping', eml('Order shipped', 'Order ID: SHOP-123\nYour order has shipped. Order total: USD 108.00')],
  ['refund', eml('Refund issued', 'Order ID: SHOP-123\nRefund ID: REF-1\nRefund date: 2026-09-24\nAmount refunded: USD 20.00')],
  ['bill', eml('Your bill is ready', 'Invoice ID: INV-88\nAmount due: USD 75.00\nDue date: 2026-10-01', 'billing@utility.example')],
  ['bill-paid', eml('Payment received', 'Invoice ID: INV-88\nPayment ID: PAY-88\nPayment date: 2026-09-25\nAmount paid: USD 75.00\nVisa ending 4242', 'billing@utility.example')],
  ['subscription', eml('Subscription receipt', 'Invoice ID: MUSIC-09\nTransaction date: 2026-09-21\nTotal: USD 12.99', 'billing@music.example')],
  ['klarna-plan', eml('Klarna plan created', 'Plan ID: KL-123\nPlan total: USD 108.00\nFour installments of USD 27.00.\nFirst due date: 2026-10-01', 'payments@klarna.example')],
  ['klarna-paid', eml('Klarna payment received', 'Plan ID: KL-123\nPayment ID: KL-PAY-1\nPayment date: 2026-09-25\nAmount paid: USD 27.00', 'payments@klarna.example')],
  ['affirm-paid', eml('Affirm payment received', 'Plan ID: AF-456\nPayment ID: AF-PAY-1\nAmount paid: USD 40.00\nPayment date: 2026-09-26', 'payments@affirm.example')],
  ['statement', eml('Your credit card statement', 'Account ID: 4242\nStatement balance: USD 540.00\nMinimum payment due: USD 25.00\nDue date: 2026-10-15', 'statements@bank.example')],
  ['card-paid', eml('Credit card payment received', 'Payment ID: CARD-PAY-09\nAmount paid: USD 540.00\nPayment date: 2026-09-26', 'payments@bank.example')],
  ['promo', eml('A sale just for you', 'Shop now! Starting at USD 9.99. Save 20% this weekend.', 'offers@shop.example', 'List-Unsubscribe: <https://example.com/unsubscribe>\r\n')],
  ['failed', eml('Affirm payment failed', 'Plan ID: AF-456\nPayment amount: USD 40.00\nYour payment failed.', 'payments@affirm.example')],
  ['renewal', eml('Your subscription will renew', 'Your subscription will renew on October 1, 2026 for USD 12.99.', 'billing@music.example')],
  ['dues', eml('Annual dues notice', 'Invoice ID: DUES-26\nDues: USD 120.00\nDue date: 2026-10-15', 'billing@association.example')],
];
