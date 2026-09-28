import { useTranslate } from "ra-core";

import { operationDeltas } from "./paymentMath";
import type { AccountOperationSummary } from "./types";
import { money } from "./usePayments";

/** The sign shown: money received (+), given back or taken (−) */
export const operationSign = (op: AccountOperationSummary) => {
  const { deposit, paid, till } = operationDeltas(op);
  if (till !== 0) return Math.sign(till);
  if (op.kind === "correction") return Math.sign(op.amount);
  if (op.kind === "deposit_payment") return 0;
  return Math.sign(paid || deposit);
};

/** The method of an operation in words: «Карта 40 000 ₸ + Kaspi QR …» */
export const useMethodLabel = () => {
  const translate = useTranslate();
  return (op: AccountOperationSummary) =>
    op.method === "mixed"
      ? (op.parts ?? [])
          .map(
            (part) =>
              `${translate(`payments.methods.${part.method}`)} ${money(part.amount)}`,
          )
          .join(" + ")
      : translate(`payments.methods.${op.method}`);
};
