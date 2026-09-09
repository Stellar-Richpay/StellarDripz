/**
 * Contract interaction wizard — pure definitions and validation.
 *
 * The wizard guides users through the four headline Soroban flows
 * (mint / transfer / stake / vote) by turning simple form fields into the
 * exact `args` array the contract function expects. Keeping the templates
 * and validation here (outside the component) makes the arg shapes
 * unit-testable and lets the component stay purely presentational.
 */

export type WizardActionId = "mint" | "transfer" | "stake" | "vote" | "custom";

export interface WizardTemplate {
  id: WizardActionId;
  label: string;
  description: string;
  /** Contract the action targets (matched against the configured env IDs). */
  contract: "DripToken" | "DripPool" | "DripGovernance" | "DripBadge" | "custom";
  method: string;
  /** Field descriptors rendered by the form. */
  fields: WizardField[];
  /** Hint shown under the form (e.g. prerequisite steps). */
  hint?: string;
}

export type WizardField =
  | { name: "amount"; label: string; type: "amount" }
  | { name: "address"; label: string; type: "address" }
  | { name: "proposalId"; label: string; type: "proposalId" }
  | { name: "choice"; label: string; type: "choice" }
  | { name: "method"; label: string; type: "method" }
  | { name: "argsJson"; label: string; type: "argsJson" };

export const WIZARD_TEMPLATES: WizardTemplate[] = [
  {
    id: "mint",
    label: "Mint",
    description: "DripToken — mint new tokens to an address (admin or authorized minter).",
    contract: "DripToken",
    method: "mint",
    fields: [
      { name: "address", label: "Recipient", type: "address" },
      { name: "amount", label: "Amount", type: "amount" },
    ],
  },
  {
    id: "transfer",
    label: "Transfer",
    description: "DripToken — transfer tokens from your wallet to another address.",
    contract: "DripToken",
    method: "transfer",
    fields: [
      { name: "address", label: "Recipient", type: "address" },
      { name: "amount", label: "Amount", type: "amount" },
    ],
  },
  {
    id: "stake",
    label: "Stake",
    description: "DripPool — stake tokens and start accruing rewards.",
    contract: "DripPool",
    method: "stake",
    fields: [{ name: "amount", label: "Amount", type: "amount" }],
    hint: "Requires the pool to be your token's spender: approve an allowance first (e.g. approve(pool, amount, expiration)).",
  },
  {
    id: "vote",
    label: "Vote",
    description: "DripGovernance — cast a vote on a proposal (power = your token balance).",
    contract: "DripGovernance",
    method: "vote",
    fields: [
      { name: "proposalId", label: "Proposal ID", type: "proposalId" },
      { name: "choice", label: "Choice", type: "choice" },
    ],
  },
  {
    id: "custom",
    label: "Custom",
    description: "Any contract function — method name + JSON argument array.",
    contract: "custom",
    method: "",
    fields: [
      { name: "method", label: "Function name", type: "method" },
      { name: "argsJson", label: "Arguments (JSON array)", type: "argsJson" },
    ],
  },
];

export function getTemplate(id: WizardActionId): WizardTemplate {
  return WIZARD_TEMPLATES.find((t) => t.id === id) ?? WIZARD_TEMPLATES[0];
}

/** Form values keyed by field name; address fields hold the wallet by default. */
export interface WizardFormValues {
  address: string;
  amount: string;
  proposalId: string;
  choice: string;
  method: string;
  argsJson: string;
}

export const EMPTY_FORM: WizardFormValues = {
  address: "",
  amount: "",
  proposalId: "",
  choice: "0",
  method: "",
  argsJson: "[]",
};

const G_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const POSITIVE_INT_RE = /^[1-9]\d*$/;

/** Validate a wizard form for the given template. Returns field → message. */
export function validateWizardForm(
  template: WizardTemplate,
  values: WizardFormValues,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of template.fields) {
    if (field.type === "address") {
      const v = values.address.trim();
      if (!v) errors.address = "Recipient address is required.";
      else if (!G_ADDRESS_RE.test(v)) errors.address = "Not a valid Stellar G… address.";
    } else if (field.type === "amount") {
      const v = values.amount.trim();
      if (!v) errors.amount = "Amount is required.";
      else if (!POSITIVE_INT_RE.test(v))
        errors.amount = "Amount must be a positive integer (smallest token unit).";
    } else if (field.type === "proposalId") {
      const v = values.proposalId.trim();
      if (!v) errors.proposalId = "Proposal ID is required.";
      else if (!POSITIVE_INT_RE.test(v))
        errors.proposalId = "Proposal ID must be a positive integer.";
    } else if (field.type === "method") {
      const v = values.method.trim();
      if (!v) errors.method = "Function name is required.";
      else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v)) errors.method = "Invalid function name.";
    } else if (field.type === "argsJson") {
      const v = values.argsJson.trim();
      if (!v) {
        errors.argsJson = "Arguments are required (use [] for none).";
      } else {
        try {
          const parsed = JSON.parse(v);
          if (!Array.isArray(parsed)) errors.argsJson = "Arguments must be a JSON array.";
        } catch {
          errors.argsJson = "Invalid JSON.";
        }
      }
    }
  }
  return errors;
}

/**
 * Build the exact args array a contract function expects from the form
 * values, given the signer's wallet address.
 *
 * The arg shapes match what /api/contract/invoke's argToScVal accepts:
 * G-address strings → Address ScVal, positive-int strings → i128, numbers →
 * narrowest int type. The caller's address is injected as the first
 * parameter for mint/transfer/stake (the contract's auth-carrying arg).
 */
export function buildWizardArgs(
  template: WizardTemplate,
  values: WizardFormValues,
  walletAddress: string,
): unknown[] {
  switch (template.id) {
    case "mint":
      // mint(admin, to, amount)
      return [walletAddress, values.address.trim(), values.amount.trim()];
    case "transfer":
      // transfer(from, to, amount)
      return [walletAddress, values.address.trim(), values.amount.trim()];
    case "stake":
      // stake(user, amount)
      return [walletAddress, values.amount.trim()];
    case "vote": {
      // vote(voter, proposal_id: u64, choice: enum → u32)
      const choiceMap: Record<string, number> = { "0": 0, "1": 1, "2": 2 }; // For / Against / Abstain
      const choice = choiceMap[values.choice] ?? 0;
      return [walletAddress, Number(values.proposalId.trim()), choice];
    }
    case "custom": {
      const parsed = JSON.parse(values.argsJson.trim() || "[]") as unknown[];
      return Array.isArray(parsed) ? parsed : [];
    }
  }
}

/** Human-readable summary of the args shown on the review step. */
export function describeWizardArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string" && a.length > 20) return `${a.slice(0, 8)}…${a.slice(-4)}`;
      return String(a);
    })
    .join(", ");
}
