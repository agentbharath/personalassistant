import { expect, it } from "vitest";
import { isUpiEmail, remitlyTransfer, transferLabel } from "./email-import-rules";

it("ignores UPI alerts and UPI payments identified in the body", () => {
  expect(isUpiEmail({subject:"UPI/IMPS/MB Transaction Alert"})).toBe(true);
  expect(isUpiEmail({subject:"Payment received",text:"Paid via UPI"})).toBe(true);
  expect(isUpiEmail({subject:"We've received your payment",from:"Discover"})).toBe(false);
});

it("uses only the sender amount from a two-currency remittance", () => {
  expect(remitlyTransfer({from:"Remitly <updates@email.remitly.com>",subject:"Transfer delivered",text:"Reference number: R123456789 You sent: 3,000.00 USD Recipient receives: 282,780.00 INR"})).toEqual({reference:"R123456789",amountMinor:300000,currency:"USD"});
});

it("accepts explicit currency before the amount and a short reference label", () => {
  expect(remitlyTransfer({from:"updates@remitly.com",subject:"Transfer delivered",text:"Reference: R123456789 Amount sent: USD 3,000.00 Recipient receives: INR 282,780.00"})).toEqual({reference:"R123456789",amountMinor:300000,currency:"USD"});
});

it("does not import a recipient-only amount or assume a bare dollar sign is USD", () => {
  for(const text of ["Recipient receives: INR 282,780.00", "You sent: $3,000.00"]){
    expect(remitlyTransfer({from:"updates@remitly.com",subject:"Transfer",text:`Reference: R123456789 ${text}`})).toHaveProperty("reason");
  }
});

it("does not conflate generic transfers with card repayments", () => {
  expect(transferLabel({note:"Remittance R123456789"})).toBe("transfer");
  expect(transferLabel({note:"Credit card payment"})).toBe("card payment");
});
