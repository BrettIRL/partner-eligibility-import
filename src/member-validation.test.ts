import { afterEach, describe, expect, it, vi } from "vitest";
import { validateMember } from "./member-validation.ts";

const member = {
  partner_member_id: "abc",
  first_name: "Alice",
  last_name: "Smith",
  date_of_birth: "1990-10-07",
  email: "alice@example.com",
  policy_start: "2026-01-01",
  policy_end: "2026-12-31",
};
const dobFormatError = "date_of_birth must be a valid ISO Date. YYYY-MM-DD";
const policyOrderError = "policy_start Policy start date must be on or before policy end date";

afterEach(() => {
  vi.useRealTimers();
});

describe("validateMember", () => {
  it("trims every field before validation and removes unknown keys", () => {
    const row = Object.fromEntries(
      Object.entries(member).map(([field, value]) => [field, `  ${value}  `]),
    );
    row.notes = "ignored";

    expect(validateMember(row)).toEqual({ member, errors: [] });
  });

  it("reports every missing field with its path and required message", () => {
    expect(validateMember({})).toEqual({
      member: undefined,
      errors: [
        "partner_member_id is required",
        "first_name is required",
        "last_name is required",
        "date_of_birth is required",
        "email is required",
        "policy_start is required",
        "policy_end is required",
      ],
    });
  });

  it.each([
    { value: "", error: "date_of_birth is required" },
    { value: "07/10/1990", error: dobFormatError },
  ])("reports only one DOB error for '$value'", ({ value, error }) => {
    expect(validateMember({ ...member, date_of_birth: value }).errors).toEqual([error]);
  });

  it.each([
    { value: "2023-02-30", errors: [dobFormatError] },
    { value: "2023-02-29", errors: [dobFormatError] },
    { value: "2024-02-29", errors: [] },
    { value: "1990-1-5", errors: [dobFormatError] },
  ])("checks calendar validity and ISO formatting for $value", ({ value, errors }) => {
    expect(validateMember({ ...member, date_of_birth: value }).errors).toEqual(errors);
  });

  it("accepts today's UTC birth date and rejects tomorrow's", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));

    expect(validateMember({ ...member, date_of_birth: "2026-10-07" }).errors).toEqual([]);
    expect(validateMember({ ...member, date_of_birth: "2026-10-08" }).errors).toEqual([
      "date_of_birth Date of birth cannot be in the future",
    ]);
  });

  it("rejects a policy whose start date is after its end date", () => {
    expect(
      validateMember({ ...member, policy_start: "2026-12-31", policy_end: "2026-01-01" }),
    ).toEqual({ member: undefined, errors: [policyOrderError] });
  });

  it("accepts a same-day policy", () => {
    const sameDayMember = { ...member, policy_start: "2026-06-01", policy_end: "2026-06-01" };

    expect(validateMember(sameDayMember)).toEqual({ member: sameDayMember, errors: [] });
  });
});
