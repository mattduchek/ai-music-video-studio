import type { Logger } from "./logger";

export interface ChargeMeta {
  tool: string;
  provider?: string;
  model?: string;
  kind: "estimate" | "actual" | "wasted";
  note?: string;
}

/**
 * Tracks spend against a hard cap. Enforcement rule (per the pilot spec): a paid
 * call is allowed only while `remainingUsd > 0`. A single call may push the
 * balance negative; the next paid call is then refused. Non-paid tools
 * (run_command, web_search, get_budget) are never gated here.
 */
export class BudgetMeter {
  spentUsd = 0;

  constructor(
    public readonly budgetUsd: number,
    private readonly logger: Logger
  ) {}

  get remainingUsd(): number {
    return round(this.budgetUsd - this.spentUsd);
  }

  canSpend(): boolean {
    return this.remainingUsd > 0;
  }

  /** Record a charge (never negative) and log it. Returns remaining budget. */
  charge(amount: number, meta: ChargeMeta): number {
    const applied = Math.max(0, round(amount));
    this.spentUsd = round(this.spentUsd + applied);
    this.logger.event("charge", {
      amount: applied,
      ...meta,
      spentUsd: this.spentUsd,
      remainingUsd: this.remainingUsd,
    });
    return this.remainingUsd;
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
