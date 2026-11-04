import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_LENGTH_HINT,
  registrationFailure,
  registrationPasswordIssue,
} from "./auth-registration";

describe("registration feedback", () => {
  it("rejects a short password even when browser validation misses autofill", () => {
    expect(registrationPasswordIssue("short-demo")).toEqual({
      field: "password",
      message: PASSWORD_LENGTH_HINT,
    });
    expect(
      registrationPasswordIssue("a".repeat(MIN_PASSWORD_LENGTH)),
    ).toBeNull();
    expect(registrationPasswordIssue("  a long password  ")).toBeNull();
  });

  it.each<{ mode: "owner" | "invite" }>([
    { mode: "owner" },
    { mode: "invite" },
  ])("identifies password errors for $mode registration", ({ mode }) => {
    expect(registrationFailure({ code: "PASSWORD_TOO_SHORT" }, mode)).toEqual({
      field: "password",
      message: PASSWORD_LENGTH_HINT,
    });
    expect(registrationFailure({ code: "PASSWORD_TOO_LONG" }, mode).field).toBe(
      "password",
    );
    expect(registrationFailure({ code: "INVALID_EMAIL" }, mode).field).toBe(
      "email",
    );
  });

  it("keeps invitation and owner recovery instructions distinct", () => {
    expect(registrationFailure({ status: 403 }, "invite").message).toContain(
      "invited email",
    );
    expect(
      registrationFailure({ code: "FORBIDDEN" }, "owner").message,
    ).toContain("deployment administrator");
  });

  it("does not disclose whether an account exists", () => {
    expect(
      registrationFailure({ code: "USER_ALREADY_EXISTS" }, "invite"),
    ).toEqual(registrationFailure({ code: "UNKNOWN" }, "invite"));
  });

  it("gives rate limits their own retry guidance", () => {
    expect(registrationFailure({ status: 429 }, "owner").message).toContain(
      "Wait a minute",
    );
    expect(
      registrationFailure({ code: "TOO_MANY_REQUESTS" }, "invite").message,
    ).toContain("Wait a minute");
  });
});
