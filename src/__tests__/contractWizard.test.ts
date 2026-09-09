import {
  buildWizardArgs,
  describeWizardArgs,
  getTemplate,
  validateWizardForm,
  WIZARD_TEMPLATES,
  type WizardFormValues,
} from "@/lib/contractWizard";

const WALLET = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const RECIPIENT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function values(overrides: Partial<WizardFormValues> = {}): WizardFormValues {
  return {
    address: RECIPIENT,
    amount: "10000000",
    proposalId: "3",
    choice: "1",
    method: "set_greeting",
    argsJson: '["hello"]',
    ...overrides,
  };
}

describe("contractWizard templates", () => {
  it("offers the four headline actions plus custom", () => {
    expect(WIZARD_TEMPLATES.map((t) => t.id)).toEqual([
      "mint",
      "transfer",
      "stake",
      "vote",
      "custom",
    ]);
  });

  it("getTemplate falls back to the first template for unknown ids", () => {
    expect(getTemplate("mint").method).toBe("mint");
    expect(getTemplate("mint").contract).toBe("DripToken");
  });
});

describe("validateWizardForm", () => {
  it("accepts a valid mint form", () => {
    expect(validateWizardForm(getTemplate("mint"), values())).toEqual({});
  });

  it("rejects a missing recipient", () => {
    const errs = validateWizardForm(getTemplate("transfer"), values({ address: "" }));
    expect(errs.address).toMatch(/required/i);
  });

  it("rejects a malformed address", () => {
    const errs = validateWizardForm(getTemplate("mint"), values({ address: "G123" }));
    expect(errs.address).toMatch(/not a valid/i);
  });

  it("rejects a non-positive amount", () => {
    const zero = validateWizardForm(getTemplate("stake"), values({ amount: "0" }));
    expect(zero.amount).toMatch(/positive/i);
    const negative = validateWizardForm(getTemplate("stake"), values({ amount: "-5" }));
    expect(negative.amount).toMatch(/positive/i);
  });

  it("rejects a missing or non-numeric proposal id", () => {
    const missing = validateWizardForm(getTemplate("vote"), values({ proposalId: "" }));
    expect(missing.proposalId).toMatch(/required/i);
    const bad = validateWizardForm(getTemplate("vote"), values({ proposalId: "abc" }));
    expect(bad.proposalId).toMatch(/positive integer/i);
  });

  it("validates the custom method and JSON args", () => {
    const missing = validateWizardForm(
      getTemplate("custom"),
      values({ method: "", argsJson: "[]" }),
    );
    expect(missing.method).toMatch(/required/i);
    const invalidJson = validateWizardForm(
      getTemplate("custom"),
      values({ method: "f", argsJson: "{" }),
    );
    expect(invalidJson.argsJson).toMatch(/invalid json/i);
    const notArray = validateWizardForm(
      getTemplate("custom"),
      values({ method: "f", argsJson: '{"a":1}' }),
    );
    expect(notArray.argsJson).toMatch(/array/i);
    const valid = validateWizardForm(
      getTemplate("custom"),
      values({ method: "f", argsJson: '["x"]' }),
    );
    expect(valid).toEqual({});
  });
});

describe("buildWizardArgs", () => {
  it("builds mint args: [wallet, recipient, amount]", () => {
    expect(buildWizardArgs(getTemplate("mint"), values(), WALLET)).toEqual([
      WALLET,
      RECIPIENT,
      "10000000",
    ]);
  });

  it("builds transfer args with the wallet as sender", () => {
    expect(buildWizardArgs(getTemplate("transfer"), values(), WALLET)[0]).toBe(WALLET);
    expect(buildWizardArgs(getTemplate("transfer"), values(), WALLET)[1]).toBe(RECIPIENT);
  });

  it("builds stake args: [wallet, amount]", () => {
    expect(buildWizardArgs(getTemplate("stake"), values(), WALLET)).toEqual([WALLET, "10000000"]);
  });

  it("builds vote args with a numeric proposal id and enum choice", () => {
    const args = buildWizardArgs(
      getTemplate("vote"),
      values({ proposalId: "7", choice: "2" }),
      WALLET,
    );
    expect(args).toEqual([WALLET, 7, 2]);
  });

  it("parses custom args from JSON", () => {
    expect(
      buildWizardArgs(getTemplate("custom"), values({ argsJson: '[1, "x"]' }), WALLET),
    ).toEqual([1, "x"]);
  });
});

describe("describeWizardArgs", () => {
  it("summarizes args with long strings truncated", () => {
    const summary = describeWizardArgs([WALLET, RECIPIENT, "100"]);
    expect(summary).not.toContain(WALLET);
    expect(summary).toContain("100");
  });
});
