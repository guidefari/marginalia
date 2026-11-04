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
    expect(registrationFailure({ code: "PASSWORD_TOO_LONG" }, mode)).toEqual({
      field: "password",
      message:
        "This password is too long. Choose a shorter password and try again.",
    });
    expect(registrationFailure({ code: "INVALID_EMAIL" }, mode)).toEqual({
      field: "email",
      message: "Enter a valid email address.",
    });
  });

  it("keeps invitation and owner recovery instructions distinct", () => {
    expect(registrationFailure({ status: 403 }, "invite").message).toContain(
      "invited email",
    );
    expect(
      registrationFailure({ code: "FORBIDDEN" }, "owner").message,
    ).toContain("deployment administrator");
  });

  it.each([
    {
      mode: "invite",
      message:
        "Couldn't create your account. Try again, or ask the owner for a new invitation.",
    },
    {
      mode: "owner",
      message:
        "Couldn't claim the reader. Try again, or ask the deployment administrator for a new setup link.",
    },
  ] satisfies readonly {
    mode: "invite" | "owner";
    message: string;
  }[])("does not disclose whether an account exists in $mode mode", ({
    mode,
    message,
  }) => {
    expect(registrationFailure({ code: "USER_ALREADY_EXISTS" }, mode)).toEqual({
      field: null,
      message,
    });
    expect(registrationFailure({ code: "UNKNOWN" }, mode)).toEqual({
      field: null,
      message,
    });
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
