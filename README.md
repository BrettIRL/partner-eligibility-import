# Partner Eligibility Import

A TypeScript CLI for importing eligible members from CSV and looking them up by `partner_member_id`.

## Approach

I chose a small CLI using package-script commands and JSON storage to keep setup small. `csv-parse` handles CSV syntax, and Zod handles normalization and validation. A map keyed by `partner_member_id` lets valid rows insert or replace a member without creating duplicates when their details change.

Argument handling, member validation, and import/storage logic are kept separate. The importer parses the file and checks its headers before processing records. Invalid rows are reported without replacing existing members, and the resulting collection is saved once through a temporary file followed by a rename.

## Usage

This was tested on Node 24.18.0 and pnpm 12.9.1.

#### Install dependencies

```sh
pnpm install
```

#### Ingest a CSV file

Storage is created on the first import with valid rows. File paths containing spaces should be quoted.

```sh
pnpm ingest --file <path>
```

Two CSV files are provided in `samples/` containing both valid and invalid rows as well as duplicate `partner_member_id` values and various formatting errors.

```sh
pnpm ingest --file samples/members-initial.csv
pnpm ingest --file samples/members-update.csv
```

Starting with no store, running `members-initial.csv` first followed by `members-update.csv` should produce the following output:

| File | Accepted Rows | Rejected Rows | Stored Members |
| --- | --- | --- | --- |
| `members-initial.csv` | 17 | 19 | 16 |
| `members-update.csv` | 10 | 2 | 19 |

Accepted counts include repeated IDs. Stored members are unique by ID. Importing either file twice consecutively leaves the stored contents unchanged. Importing an older file again can restore older field values: there is no version or timestamp comparison.

Rejections are printed to stderr with the CSV record number, member ID when available, and reasons. Record numbers count parsed records, with the header as record 1 and empty lines skipped.

#### Lookup a member by ID

The `lookup` command prints a JSON representation of the member record if the `partner_member_id` is found in the store.

```sh
pnpm lookup --id <partner_member_id>
```

#### Testing

```sh
pnpm test
pnpm typecheck
```

## Storage

Member data is stored in `data/members.json`. `partner_member_id` is the identity key, stored as a case-sensitive string with leading zeros preserved.

## Assumptions

- All seven columns are required. For this exercise, `policy_end` must contain a date, and a blank value is treated as missing data. An alternative would be to allow null to represent open-ended coverage, but that is outside the chosen scope.
- Required headers must appear exactly once. Column order may vary. Additional columns are ignored.
- Field values are trimmed. Every required field must be nonempty. Email validation is a basic plausibility check, different members may share an email.
- Dates must be valid calendar dates in the ISO 8601 extended date format (YYYY-MM-DD). Other formats, including UK display formats and timestamps, are rejected.
- `date_of_birth` cannot be in the future. `policy_start` must be on or before `policy_end` date.
- A valid row replaces all stored fields for it's `partner_member_id`. Invalid rows are rejected without changing the existing stored record. Within a file, the last valid occurrence of `partner_member_id` wins.
- Members absent from a later file remain stored. The import is an upsert, not a full synchronization.
- Header-only files and imports with no accepted rows do not write storage. Other imports save once, using a temporary file followed by a rename.

## Verification

Both `pnpm test` and `pnpm typecheck` pass. The automated tests use isolated temporary storage and cover repeat imports, updates by ID, invalid replacements, rejection reporting, and corrupt storage remaining untouched. Separate validation tests cover trimming, required fields, real calendar dates, DOB boundaries, and policy date ordering.

The sample files were also imported into a fresh temporary store to check the counts shown above, member lookup, and changed records. Reimporting each file consecutively left the stored JSON unchanged. CLI smoke checks confirmed that missing arguments, missing members, and unreadable input files produce an error and exit with code 1.

## AI Usage

AI was used during the planning phase to better understand the edge cases and ran a code review on the completed exercise.

- 🖐️ All code in `cli.ts`, `members.ts`, and `member-validation.ts` was written by hand.
- Some tests were stubbed by hand 🖐️ and implemented by AI 🤖. Others were added by AI for coverage of edge cases.
- 🤖 Sample CSV files are AI-generated to cover as many error cases as possible.

All AI-generated code was reviewed by a human. 👨‍💻
