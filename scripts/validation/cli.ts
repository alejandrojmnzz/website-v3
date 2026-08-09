#!/usr/bin/env tsx
/**
 * Validation CLI
 * 
 * Command-line interface for running content validators.
 * 
 * Usage:
 *   npx tsx scripts/validation/cli.ts              # Run all validators
 *   npx tsx scripts/validation/cli.ts --list       # List available validators
 *   npx tsx scripts/validation/cli.ts -v redirects,meta  # Run specific validators
 *   npx tsx scripts/validation/cli.ts --json       # Output as JSON
 *   npx tsx scripts/validation/cli.ts --artifacts  # Include artifacts in output
 */

import { ValidationService } from "./service";
import { printResults, printValidatorList } from "./reporting/console";
import { printJsonResults, getExitCode } from "./reporting/json";

interface CliOptions {
  validators?: string[];
  json: boolean;
  list: boolean;
  artifacts: boolean;
  help: boolean;
  slow: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    list: false,
    artifacts: false,
    help: false,
    slow: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--list" || arg === "-l") {
      options.list = true;
    } else if (arg === "--json" || arg === "-j") {
      options.json = true;
    } else if (arg === "--artifacts" || arg === "-a") {
      options.artifacts = true;
    } else if (arg === "--validators" || arg === "-v") {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        options.validators = next.split(",").map((s) => s.trim());
        i++;
      }
    } else if (arg.startsWith("-v=") || arg.startsWith("--validators=")) {
      const value = arg.split("=")[1];
      options.validators = value.split(",").map((s) => s.trim());
    } else if (arg === "--slow" || arg === "-s") {
      options.slow = true;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Content Validation CLI

Usage:
  npx tsx scripts/validation/cli.ts [options]

Options:
  -h, --help                Show this help message
  -l, --list                List available validators
  -v, --validators <names>  Run specific validators (comma-separated)
  -j, --json                Output results as JSON
  -a, --artifacts           Include artifacts in output
  -s, --slow                Include slow validators (none registered currently)

Examples:
  npx tsx scripts/validation/cli.ts                    # Run all fast validators
  npx tsx scripts/validation/cli.ts --list             # List validators
  npx tsx scripts/validation/cli.ts -v redirects,meta  # Run specific validators
  npx tsx scripts/validation/cli.ts --json             # JSON output for CI
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const service = new ValidationService();

  if (options.list) {
    const validators = service.getAvailableValidators();
    printValidatorList(validators);
    process.exit(0);
  }

  console.log("Building validation context...");
  await service.buildContext();

  console.log("Running validators...\n");
  const result = await service.runValidators({
    validators: options.validators,
    includeArtifacts: options.artifacts,
    includeSlow: options.slow,
  });

  if (options.json) {
    printJsonResults(result, { includeTimestamp: true });
  } else {
    printResults(result);
  }

  process.exit(getExitCode(result));
}

main().catch((err) => {
  console.error("Validation failed with error:", err);
  process.exit(1);
});
