// tbl-chart CLI entry point. Subcommands land in cmd-*.ts (engine step 6+):
//   new | validate | render | snapshot | build | catalog | serve
// Scaffolding: dispatch + usage only.

const COMMANDS = [
  "new",
  "validate",
  "render",
  "snapshot",
  "build",
  "catalog",
  "serve",
] as const;

type Command = (typeof COMMANDS)[number];

function usage(): void {
  console.log(
    [
      "tbl-chart — Budget Lab chart engine CLI",
      "",
      "Usage: tbl-chart <command> [options]",
      "",
      "Commands:",
      "  new <id>        scaffold a new chart spec + data file",
      "  validate <id>   schema + cross-reference + CSV validation",
      "  render <id>     render the chart to a deterministic SVG",
      "  snapshot <id>   render headless to PNG and diff vs. baseline",
      "  build <id>      build embed artifacts (iframe, web component, standalone, PNG/SVG)",
      "  catalog         regenerate the chart catalog/index.json",
      "  serve [--changed]  launch the local interactive review gallery",
      "",
      "(scaffolding — subcommands not yet implemented)",
    ].join("\n"),
  );
}

function main(argv: string[]): number {
  const cmd = argv[2];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    usage();
    return 0;
  }
  if (!(COMMANDS as readonly string[]).includes(cmd)) {
    console.error(`tbl-chart: unknown command '${cmd}'\n`);
    usage();
    return 1;
  }
  console.error(`tbl-chart: '${cmd as Command}' is not implemented yet (scaffolding).`);
  return 1;
}

process.exit(main(process.argv));
