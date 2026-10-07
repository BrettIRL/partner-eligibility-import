import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parse } from "csv-parse/sync";
import { memberSchema, validateMember, type Member } from "./member-validation.ts";

const requiredColumns = Object.keys(memberSchema.shape);

const STORAGE_PATH = "data/members.json";

export async function importMembers(filepath: string, storagePath = STORAGE_PATH) {
  const contents = await readFile(filepath, "utf8");

  if (!contents.trim()) {
    throw new Error("Input file is empty");
  }

  const rows = parse<Partial<Member>>(contents, {
    skip_empty_lines: true,
    relax_column_count: true,
    columns: (headers: string[]) => {
      for (const column of requiredColumns) {
        const count = headers.filter((header) => header === column).length;

        if (count === 0) {
          throw new Error(`Missing required column: ${column}`);
        }

        if (count > 1) {
          throw new Error(`Duplicate required column: ${column}`);
        }
      }

      return headers.map((header) =>
        requiredColumns.some((column) => column === header) ? header : false,
      );
    },
  });

  const members = await loadMembers(storagePath);

  const rejected: {
    record: number;
    partner_member_id: string | undefined;
    errors: string[];
  }[] = [];

  for (const [index, row] of rows.entries()) {
    const { member, errors } = validateMember(row);

    if (!member) {
      rejected.push({
        record: index + 2,
        partner_member_id: row.partner_member_id?.trim() || undefined,
        errors,
      });
      continue;
    }

    members.set(member.partner_member_id, member);
  }

  const accepted = rows.length - rejected.length;
  if (accepted > 0) {
    await mkdir(dirname(storagePath), { recursive: true });
    const temporaryPath = `${storagePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify([...members.values()], null, 2)}\n`, "utf8");
    await rename(temporaryPath, storagePath);
  }

  return { accepted, rejected };
}

export async function lookupMember(partnerMemberId: string, storagePath = STORAGE_PATH) {
  const members = await loadMembers(storagePath);
  return members.get(partnerMemberId);
}

export async function loadMembers(storagePath = STORAGE_PATH) {
  let contents: string;

  try {
    contents = await readFile(storagePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Map<string, Member>();
    }

    throw error;
  }

  const records = memberSchema.array().parse(JSON.parse(contents));

  return new Map<string, Member>(
    records.map((record) => [record.partner_member_id, record as Member]),
  );
}
