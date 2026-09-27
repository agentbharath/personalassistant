import { z } from 'zod';

export const TYPES = ['purchase_receipt', 'order_update', 'refund', 'subscription_charge', 'renewal_notice',
  'trial_ending', 'subscription_cancelled', 'bill_issued', 'bill_reminder', 'payment_confirmation',
  'autopay_scheduled', 'payment_failed', 'card_statement', 'bank_statement', 'loan_statement', 'brokerage_statement',
  'transaction_alert', 'transfer_sent', 'transfer_received', 'income', 'installment_plan_created', 'installment_paid',
  'installment_due', 'installment_failed', 'installment_late_fee', 'installment_plan_adjusted', 'installment_plan_paid_off',
  'fee_or_interest', 'tax_document', 'insurance_premium', 'travel_booking', 'travel_change', 'promo', 'non_financial', 'unknown'];
export const ROLES = ['charged', 'paid', 'refunded', 'amount_due', 'plan_total', 'installment_amount', 'minimum_due',
  'fee', 'interest', 'subtotal', 'tax', 'shipping', 'discount', 'tip', 'offer_price', 'balance', 'future_renewal', 'received'];
const index = z.number().int().nonnegative();
export const QuoteSchema = z.object({ start: index, end: index, value: z.string().min(1).max(300) }).strict();
export const ExtractionSchema = z.object({
  type: z.enum(TYPES), confidence: z.number().min(0).max(1),
  merchant: QuoteSchema.nullable(),
  amounts: z.array(z.object({ role: z.enum(ROLES), moneyIndex: index }).strict()).max(1000),
  dateIndex: index.nullable(), dueDateIndex: index.nullable(),
  references: z.array(QuoteSchema.extend({ kind: z.enum(['order', 'invoice', 'plan', 'payment', 'refund', 'account', 'installment', 'period']) })).max(50),
  paymentRail: z.enum(['card', 'installment', 'loan', 'bank', 'other', 'unknown']),
  paymentRailEvidence: QuoteSchema.nullable(),
  schedule: z.array(z.object({ moneyIndex: index, dateIndex: index }).strict()).max(1000),
  reason: z.string().max(1000),
}).strict();

export const emptyExtraction = (type = 'unknown', reason = '') => ({ type, confidence: 0, merchant: null, amounts: [],
  dateIndex: null, dueDateIndex: null, references: [], paymentRail: 'unknown', paymentRailEvidence: null, schedule: [], reason });
