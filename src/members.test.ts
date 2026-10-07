import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importMembers, loadMembers, lookupMember } from "./members.ts";

const headers =
  "partner_member_id,first_name,last_name,date_of_birth,email,policy_start,policy_end";
const memberA = {
  partner_member_id: "00123",
  first_name: "Alice",
  last_name: "Smith",
  date_of_birth: "1985-06-15",
  email: "alice@example.com",
  policy_start: "2026-01-01",
  policy_end: "2026-12-31",
};
const memberB = { ...memberA, partner_member_id: "B", first_name: "Bob", email: "bob@example.com" };
const memberC = {
  ...memberA,
  partner_member_id: "C",
  first_name: "Carol",
  email: "carol@example.com",
};
const corruptStores = [
  { name: "invalid JSON", contents: "not JSON" },
  {
    name: "a schema violation",
    contents: JSON.stringify([{ ...memberA, email: "not-an-email" }]),
  },
];

let directory: string;
let storagePath: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "members-test-"));
  storagePath = join(directory, "data", "nested", "members.json");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function csv(...members: (typeof memberA)[]) {
  return `${headers}\n${members.map((member) => Object.values(member).join(",")).join("\n")}\n`;
}

async function writeInput(contents: string) {
  const filepath = join(directory, "members.csv");
  await writeFile(filepath, contents, "utf8");
  return filepath;
}

async function seedStorage(contents: string) {
  await mkdir(dirname(storagePath), { recursive: true });
  await writeFile(storagePath, contents, "utf8");
}

describe("importMembers: input and header checks", () => {
  it.each([
    { name: "empty", contents: "" },
    { name: "whitespace-only", contents: "  \n\n " },
  ])("rejects $name input", async ({ contents }) => {
    const filepath = await writeInput(contents);

    await expect(importMembers(filepath, storagePath)).rejects.toThrow("Input file is empty");
  });

  it("rejects a missing required column without touching storage", async () => {
    const original = JSON.stringify([memberA]);
    await seedStorage(original);
    const incompleteHeaders = headers.split(",").filter((column) => column !== "email");
    const filepath = await writeInput(`${incompleteHeaders.join(",")}\n`);

    await expect(importMembers(filepath, storagePath)).rejects.toThrow(
      "Missing required column: email",
    );
    expect(await readFile(storagePath, "utf8")).toBe(original);
  });

  it("rejects a duplicate required column", async () => {
    const filepath = await writeInput(`${headers},email\n`);

    await expect(importMembers(filepath, storagePath)).rejects.toThrow(
      "Duplicate required column: email",
    );
  });
});

describe("importMembers: main logic", () => {
  it("creates nested storage and saves valid members as pretty JSON with a trailing newline", async () => {
    const members = [memberA, memberB, memberC];
    const filepath = await writeInput(
      [
        `notes,${headers}`,
        ...members.map((member) => `Internal note,${Object.values(member).join(",")}`),
        "",
      ].join("\n"),
    );

    await expect(importMembers(filepath, storagePath)).resolves.toEqual({
      accepted: 3,
      rejected: [],
    });
    expect(await readFile(storagePath, "utf8")).toBe(`${JSON.stringify(members, null, 2)}\n`);
    await expect(readFile(`${storagePath}.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stores only valid rows and reports record numbers, normalized IDs, and reasons", async () => {
    const filepath = await writeInput(
      [
        headers,
        "  abc  ,Alice,Smith,1985-06-15,not-an-email,2026-01-01,2026-12-31",
        Object.values(memberA).join(","),
        "   ,Carol,Smith,1985-06-15,carol@example.com,2026-01-01,2026-12-31",
        Object.values(memberB).join(","),
        "",
      ].join("\n"),
    );

    const result = await importMembers(filepath, storagePath);

    expect(result.accepted).toBe(2);
    expect(result.rejected).toMatchObject([
      { record: 2, partner_member_id: "abc" },
      { record: 4, partner_member_id: undefined },
    ]);
    for (const { errors } of result.rejected) {
      expect(Array.isArray(errors)).toBe(true);
      expect(errors.length).toBeGreaterThan(0);
      for (const message of errors) {
        expect(message).toEqual(expect.stringMatching(/\S/));
      }
    }
    expect(JSON.parse(await readFile(storagePath, "utf8"))).toEqual([memberA, memberB]);
  });

  it("overwrites a matching ID while keeping existing members and adding new ones", async () => {
    await seedStorage(JSON.stringify([memberA, memberB]));
    const changedA = { ...memberA, first_name: "Alicia", email: "alice.new@example.com" };
    const filepath = await writeInput(
      csv({ ...changedA, partner_member_id: `  ${memberA.partner_member_id}  ` }, memberC),
    );

    await expect(importMembers(filepath, storagePath)).resolves.toEqual({
      accepted: 2,
      rejected: [],
    });
    expect(JSON.parse(await readFile(storagePath, "utf8"))).toEqual([changedA, memberB, memberC]);
  });

  it("leaves stored contents unchanged when the same file is imported twice", async () => {
    const filepath = await writeInput(csv(memberA, memberB));
    await importMembers(filepath, storagePath);
    const original = await readFile(storagePath, "utf8");

    await expect(importMembers(filepath, storagePath)).resolves.toEqual({
      accepted: 2,
      rejected: [],
    });
    expect(await readFile(storagePath, "utf8")).toBe(original);
    expect(JSON.parse(await readFile(storagePath, "utf8"))).toEqual([memberA, memberB]);
  });

  it("keeps the last valid occurrence of a duplicate ID within a file", async () => {
    const changedA = { ...memberA, email: "alice.final@example.com", policy_end: "2027-12-31" };
    const filepath = await writeInput(csv(memberA, memberB, changedA));

    await expect(importMembers(filepath, storagePath)).resolves.toEqual({
      accepted: 3,
      rejected: [],
    });
    expect(JSON.parse(await readFile(storagePath, "utf8"))).toEqual([changedA, memberB]);
  });

  it("preserves the last valid duplicate when a later occurrence is invalid", async () => {
    await seedStorage(JSON.stringify([memberA, memberB]));
    const changedA = { ...memberA, email: "alice.final@example.com", policy_end: "2027-12-31" };
    const invalidA = { ...changedA, first_name: "Changed", email: "not-an-email" };
    const filepath = await writeInput(csv(memberA, changedA, invalidA, memberC));

    const result = await importMembers(filepath, storagePath);

    expect(result.accepted).toBe(3);
    expect(result.rejected).toEqual([
      {
        record: 4,
        partner_member_id: memberA.partner_member_id,
        errors: [expect.stringMatching(/^email /)],
      },
    ]);
    expect(JSON.parse(await readFile(storagePath, "utf8"))).toEqual([changedA, memberB, memberC]);
  });

  it.each([
    { name: "missing", contents: undefined },
    { name: "seeded", contents: JSON.stringify([memberA]) },
  ])("leaves $name storage untouched when every row is invalid", async ({ contents }) => {
    if (contents !== undefined) {
      await seedStorage(contents);
    }
    const filepath = await writeInput(
      `${headers}\nabc,Alice,Smith,1985-06-15,not-an-email,2026-01-01,2026-12-31\n`,
    );

    const result = await importMembers(filepath, storagePath);

    expect(result.accepted).toBe(0);
    expect(result.rejected).toHaveLength(1);
    if (contents === undefined) {
      await expect(readFile(storagePath)).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      expect(await readFile(storagePath, "utf8")).toBe(contents);
    }
  });

  it("accepts a header-only CSV without creating storage", async () => {
    const filepath = await writeInput(`${headers}\n`);

    await expect(importMembers(filepath, storagePath)).resolves.toEqual({
      accepted: 0,
      rejected: [],
    });
    await expect(readFile(storagePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a short row without failing parsing or stopping valid rows", async () => {
    const filepath = await writeInput(
      `${headers}\nSHORT-001,Alice\n${Object.values(memberB).join(",")}\n`,
    );

    const result = await importMembers(filepath, storagePath);

    expect(result.accepted).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      record: 2,
      partner_member_id: "SHORT-001",
      errors: expect.arrayContaining(["email is required"]),
    });
    expect(JSON.parse(await readFile(storagePath, "utf8"))).toEqual([memberB]);
  });

  it.each(corruptStores)(
    "stops without overwriting storage containing $name",
    async ({ contents }) => {
      await seedStorage(contents);
      const filepath = await writeInput(csv(memberA));

      await expect(importMembers(filepath, storagePath)).rejects.toThrow();
      expect(await readFile(storagePath, "utf8")).toBe(contents);
    },
  );
});

describe("loadMembers", () => {
  it("returns an empty map when the store is missing", async () => {
    await expect(loadMembers(storagePath)).resolves.toEqual(new Map());
  });

  it("returns a map keyed by partner member IDs", async () => {
    await seedStorage(JSON.stringify([memberA, memberB]));

    await expect(loadMembers(storagePath)).resolves.toEqual(
      new Map([
        [memberA.partner_member_id, memberA],
        [memberB.partner_member_id, memberB],
      ]),
    );
  });

  it.each(corruptStores)("rejects $name", async ({ contents }) => {
    await seedStorage(contents);

    await expect(loadMembers(storagePath)).rejects.toThrow();
  });

  it("rethrows read errors other than file not found", async () => {
    await expect(loadMembers(directory)).rejects.toMatchObject({ code: "EISDIR" });
  });
});

describe("lookupMember", () => {
  it.each([
    { name: "an existing member", id: memberA.partner_member_id, seeded: true, expected: memberA },
    { name: "an unknown ID", id: "123", seeded: true, expected: undefined },
    { name: "a missing store", id: memberA.partner_member_id, seeded: false, expected: undefined },
  ])("handles $name", async ({ id, seeded, expected }) => {
    if (seeded) {
      await seedStorage(JSON.stringify([memberA]));
    }

    await expect(lookupMember(id, storagePath)).resolves.toEqual(expected);
  });
});
