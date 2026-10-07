import { parseArgs } from "node:util";
import { importMembers, lookupMember } from "./members.ts";

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "ingest": {
      const {
        values: { file },
      } = parseArgs({
        args,
        options: {
          file: { type: "string" },
        },
      });

      if (!file?.trim()) {
        throw new Error("Ingest requires a file. Usage: pnpm ingest --file <path>");
      }

      await importMembers(file);
      break;
    }
    case "lookup": {
      const {
        values: { id },
      } = parseArgs({
        args,
        options: {
          id: { type: "string" },
        },
      });

      const partnerMemberId = id?.trim();

      if (!partnerMemberId) {
        throw new Error("Lookup requires a partner member id. Usage: pnpm lookup --id <id>");
      }

      await lookupMember(partnerMemberId);
      break;
    }
    default:
      throw new Error(`Expected command "ingest" or "lookup", got "${command}"`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
