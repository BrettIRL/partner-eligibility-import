import { z } from "zod";

const requiredString = z.string().trim().min(1, "is required").prefault("");
const dateString = requiredString.pipe(
  z.iso.date({ error: "must be a valid ISO Date. YYYY-MM-DD" }),
);

const policyDates = z.object({
  policy_start: dateString,
  policy_end: dateString,
});

export const memberSchema = z
  .object({
    partner_member_id: requiredString,
    first_name: requiredString,
    last_name: requiredString,
    date_of_birth: dateString.pipe(
      z.string().refine((date) => date <= new Date().toISOString().slice(0, 10), {
        error: "Date of birth cannot be in the future",
      }),
    ),
    email: requiredString.pipe(z.email()),
    ...policyDates.shape,
  })
  .refine(({ policy_start, policy_end }) => policy_start <= policy_end, {
    path: ["policy_start"],
    error: "Policy start date must be on or before policy end date",
    when: ({ value }) => policyDates.safeParse(value).success,
  });

export type Member = z.infer<typeof memberSchema>;

export function validateMember(row: Partial<Member>) {
  const result = memberSchema.safeParse(row);

  if (result.success) {
    return { member: result.data, errors: [] };
  }

  return {
    member: undefined,
    errors: result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`),
  };
}
