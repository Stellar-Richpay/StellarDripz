import { logger, setLogLevel } from "@/lib/logger";

describe("logger", () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleDebugSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleInfoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    consoleDebugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("passes an Error as the error payload", () => {
    const err = new Error("boom");
    logger.error("failed", err, { requestId: "r1" });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const out = consoleErrorSpy.mock.calls[0][0] as string;
    expect(out).toContain("[ERROR]");
    expect(out).toContain("failed");
    expect(out).toContain("error=boom");
    expect(out).toContain('"requestId":"r1"');
  });

  it("treats a plain-object second argument as context, not an error", () => {
    // The `(msg, ctx)` shape used by debug/info/warn must not silently land
    // in the error field when passed to error().
    logger.error("failed", { requestId: "r2" });
    const out = consoleErrorSpy.mock.calls[0][0] as string;
    expect(out).toContain("[ERROR]");
    expect(out).not.toContain("error=");
    expect(out).toContain('"requestId":"r2"');
  });

  it("respects the configured log level", () => {
    setLogLevel("error");
    logger.debug("nope");
    logger.info("nope");
    logger.warn("nope");
    logger.error("yes");
    expect(consoleDebugSpy).not.toHaveBeenCalled();
    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("yes");

    setLogLevel("debug");
    logger.debug("now yes");
    expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
    expect(consoleDebugSpy.mock.calls[0][0]).toContain("now yes");
  });
});
