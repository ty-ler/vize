/** Independent path and normalized Cargo archive qualification; never publishes. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { constants as osConstants } from "node:os";
import {
  parseJson,
  stringifyJson,
  jsonDuration,
  physicalPath,
  ALIASES,
  OWNED,
  REGISTRY,
  PROFILE,
  archiveMembers,
  digest,
  isolatedManifest,
  jsonLines,
  readToml,
  requireThat,
  toml,
  verifyConsumerBuild,
  verifyGraph,
  verifyPackagedSource,
  type Providers,
} from "./checked-corsa-contract.ts";
import { qualifySourceConsumers } from "./checked-corsa-source-consumers.ts";
export type CommandResult = {
  status: number | null;
  signal?: string | null;
  error?: { message: string };
};
export type Executor = (
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdout: number; stderr: number; timeout: number },
) => CommandResult;
const execute: Executor = (args, options) =>
  spawnSync(args[0], args.slice(1), {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", options.stdout, options.stderr],
    timeout: options.timeout,
    killSignal: "SIGKILL",
  });
export type CommandRecord = {
  label: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  elapsedSeconds: ReturnType<typeof jsonDuration>;
  signal?: string | null;
  error?: string;
};
export class Acceptance {
  root: string;
  output: string;
  sourceSha: string;
  commands: CommandRecord[] = [];
  consumerBuilds: unknown[] = [];
  environment: NodeJS.ProcessEnv;
  executor: Executor;
  constructor(
    root: string,
    output: string,
    sourceSha: string,
    environment = process.env,
    executor: Executor = execute,
  ) {
    this.root = root;
    this.output = output;
    this.sourceSha = sourceSha;
    this.environment = { ...environment };
    this.executor = executor;
    requireThat(
      path.isAbsolute(environment.CARGO_TARGET_DIR ?? ""),
      "set an absolute shared CARGO_TARGET_DIR to avoid duplicate native builds",
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.mkdirSync(output);
  }
  command(label: string, args: string[], cwd = this.root, status = 0): string {
    requireThat(/^[a-z0-9-]+$/u.test(label), "safe command evidence label required");
    const started = performance.now();
    console.log(`[${label}] ${args.join(" ")}`);
    const stdoutPath = path.join(this.output, `${label}.stdout`),
      stderrPath = path.join(this.output, `${label}.stderr`);
    const stdout = fs.openSync(stdoutPath, "wx"),
      stderr = fs.openSync(stderrPath, "wx");
    let result: CommandResult;
    try {
      result = this.executor(args, {
        cwd,
        env: this.environment,
        stdout,
        stderr,
        timeout: 30 * 60 * 1000,
      });
    } catch (error) {
      result = { status: null, error: { message: String(error) } };
    } finally {
      fs.closeSync(stdout);
      fs.closeSync(stderr);
    }
    const signalNumber = result.signal
      ? osConstants.signals[result.signal as NodeJS.Signals]
      : undefined;
    const exitCode = result.signal && signalNumber ? -signalNumber : result.status;
    const record: CommandRecord = {
      label,
      args: [...args],
      cwd,
      exitCode,
      elapsedSeconds: jsonDuration(Math.round(performance.now() - started) / 1000),
    };
    if (result.signal) record.signal = result.signal;
    if (result.error) record.error = result.error.message;
    this.commands.push(record);
    fs.writeFileSync(
      path.join(this.output, `${label}.command.json`),
      stringifyJson(record, 2) + "\n",
    );
    if (exitCode !== status || (result.signal && !signalNumber) || result.error) {
      process.stderr.write(fs.readFileSync(stderrPath).toString("utf8").slice(-12000));
      throw new Error(
        `${label}: expected ${status}, got ${exitCode}${result.signal ? ` (${result.signal})` : ""}${result.error ? `: ${result.error.message}` : ""}`,
      );
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      fs.readFileSync(stdoutPath),
    );
  }
  consumer(name: string, manifest: string, source: Buffer): string {
    const directory = path.join(this.output, name);
    fs.mkdirSync(path.join(directory, "src"), { recursive: true });
    fs.writeFileSync(path.join(directory, "Cargo.toml"), isolatedManifest(manifest, name));
    fs.writeFileSync(path.join(directory, "src/lib.rs"), source);
    fs.copyFileSync(path.join(this.root, "Cargo.lock"), path.join(directory, "Cargo.lock"));
    return directory;
  }
  metadata(label: string, directory: string, features: string[] = [], locked = false) {
    return parseJson(
      this.command(
        label,
        [
          "cargo",
          "metadata",
          "--offline",
          "--format-version",
          "1",
          ...(locked ? ["--locked"] : []),
          ...features,
        ],
        directory,
      ),
    );
  }
  cleanConsumer(label: string, directory: string) {
    const name = readToml(path.join(directory, "Cargo.toml")).package.name;
    this.command(
      `${label}-clean-root`,
      ["cargo", "clean", "--locked", "--offline", "--package", name, ...PROFILE],
      directory,
    );
  }
  buildOnce(label: string, mode: string, directory: string, features: string[] = []) {
    this.cleanConsumer(`${label}-${mode}`, directory);
    const stdout = this.command(
      `${label}-${mode}-build`,
      [
        "cargo",
        "build",
        "--locked",
        "--offline",
        "--lib",
        "--message-format=json",
        ...PROFILE,
        ...features,
      ],
      directory,
    );
    this.consumerBuilds.push({
      provider: label,
      mode,
      artifact: verifyConsumerBuild(stdout, directory),
    });
  }
  builds(label: string, directory: string) {
    for (const [mode, features] of MODES) {
      this.buildOnce(label, mode, directory, features);
      this.command(
        `${label}-${mode}-test`,
        ["cargo", "test", "--locked", "--offline", "--lib", ...PROFILE, ...features],
        directory,
      );
    }
  }
  run() {
    requireThat(
      this.command("source-head", ["git", "rev-parse", "HEAD"]).trim() === this.sourceSha,
      "SOURCE_SHA differs from checkout",
    );
    requireThat(
      !this.command("source-status", ["git", "status", "--porcelain", "--untracked-files=no"]),
      "tracked source must be clean",
    );
    this.command("cargo-version", ["cargo", "-Vv"]);
    this.command("rustc-version", ["rustc", "-Vv"]);
    const workspace = readToml(path.join(this.root, "Cargo.toml")).workspace,
      version = workspace.package.version;
    const providers: Providers = {};
    for (const alias of ALIASES) {
      const dependency = workspace.dependencies[alias];
      requireThat(
        dependency.package === `vize_${alias}` && dependency.version === `=${version}`,
        "workspace alias/version mismatch",
      );
      providers[`vize_${alias}`] = [path.join(this.root, dependency.path, "Cargo.toml"), null];
    }
    const fixture = path.join(this.root, "tests/_fixtures/ci/checked-corsa-consumer");
    let template = fs.readFileSync(path.join(fixture, "Cargo.toml"), "utf8");
    requireThat(
      template.split('version = "*"').length - 1 === OWNED.size,
      "fixture must define all six version slots",
    );
    template = template.replaceAll('version = "*"', `version = "=${version}"`);
    const source = fs.readFileSync(path.join(fixture, "src/lib.rs"));
    requireThat(
      !Object.hasOwn(toml(template), "patch"),
      "independent fixture must not patch dependencies",
    );
    let seed = template;
    for (const alias of ALIASES) {
      const before = `${alias} = { package = "vize_${alias}", version = "=${version}" }`;
      requireThat(
        seed.split(before).length === 2,
        "fixture dependency is not an exact owned alias",
      );
      seed = seed.replace(
        before,
        before.slice(0, -2) +
          `, path = ${stringifyJson(path.dirname(providers[`vize_${alias}`][0]))} }`,
      );
    }
    const pathConsumer = this.consumer("path-consumer", seed, source),
      graphs = [];
    for (const [mode, features] of MODES)
      graphs.push({
        provider: "path",
        mode,
        packages: verifyGraph(
          this.metadata(`path-${mode}-metadata`, pathConsumer, features),
          version,
          providers,
          features.length > 0,
        ),
      });
    this.builds("path", pathConsumer);
    const vendor = path.join(this.output, "archive-directory-source"),
      packageTarget = path.join(this.output, "package-target");
    this.command(
      "vendor-registry-dependencies",
      ["cargo", "vendor", "--locked", "--offline", "--versioned-dirs", vendor],
      pathConsumer,
    );
    this.command("generate-cargo-archives", [
      "cargo",
      "package",
      "--locked",
      "--offline",
      "--no-verify",
      "--exclude-lockfile",
      "--target-dir",
      packageTarget,
      ...ALIASES.flatMap((name) => ["-p", `vize_${name}`]),
    ]);
    const archives = [],
      archiveProviders: Providers = {};
    for (const alias of ALIASES) {
      const name = `vize_${alias}`,
        prefix = `${name}-${version}`,
        archive = path.join(packageTarget, "package", `${prefix}.crate`);
      const bodies = archiveMembers(archive, prefix),
        manifest = toml(bodies["Cargo.toml"].toString("utf8")),
        original = providers[name][0];
      const sourceMembers = verifyPackagedSource(path.dirname(original), bodies);
      requireThat(
        bodies["Cargo.toml.orig"].equals(fs.readFileSync(original)),
        "archive original manifest differs from source",
      );
      requireThat(
        manifest.package.name === name &&
          manifest.package.version === version &&
          manifest.lib.name === alias,
        "archive package/lib identity mismatch",
      );
      const vcs = parseJson(bodies[".cargo_vcs_info.json"].toString("utf8"));
      requireThat(
        vcs.git.sha1 === this.sourceSha && !vcs.git.dirty,
        "archive source identity mismatch",
      );
      requireThat(
        vcs.path_in_vcs ===
          path.relative(this.root, path.dirname(original)).split(path.sep).join("/"),
        "archive source directory mismatch",
      );
      requireThat(
        manifest.package.license === readToml(original).package.license,
        "package license changed",
      );
      for (const dependency of Object.values(manifest.dependencies ?? {}) as any[]) {
        requireThat(
          !Object.hasOwn(dependency, "path"),
          "archive retained a source path dependency",
        );
        if (OWNED.has(dependency.package))
          requireThat(dependency.version === `=${version}`, "archive internal version mismatch");
      }
      const destination = path.join(vendor, prefix);
      fs.mkdirSync(destination);
      for (const [relative, body] of Object.entries(bodies)) {
        const target = path.join(destination, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, body);
      }
      const checksum = {
        package: digest(fs.readFileSync(archive)),
        files: Object.fromEntries(
          Object.entries(bodies).map(([relative, body]) => [relative, digest(body)]),
        ),
      };
      fs.writeFileSync(
        path.join(destination, ".cargo-checksum.json"),
        stringifyJson(checksum) + "\n",
      );
      archives.push({
        name,
        version,
        sha256: checksum.package,
        sourceMembers,
        members: checksum.files,
      });
      archiveProviders[name] = [path.join(destination, "Cargo.toml"), REGISTRY];
    }
    const config =
      '[source.crates-io]\nreplace-with = "archive-consumer"\n[source.archive-consumer]\ndirectory = ' +
      stringifyJson(vendor) +
      "\n";
    const packaged = this.consumer("archive-consumer", template, source),
      negative = this.consumer(
        "default-feature-negative",
        template,
        Buffer.from("pub use corsa::orchestrator::RaftConfig;\n"),
      );
    for (const directory of [packaged, negative]) {
      fs.mkdirSync(path.join(directory, ".cargo"));
      fs.writeFileSync(path.join(directory, ".cargo/config.toml"), config);
    }
    for (const [mode, features] of MODES)
      graphs.push({
        provider: "normalized-archive",
        mode,
        packages: verifyGraph(
          this.metadata(`archive-${mode}-metadata`, packaged, features),
          version,
          archiveProviders,
          features.length > 0,
        ),
      });
    this.builds("archive", packaged);
    verifyGraph(
      this.metadata("negative-default-metadata", negative),
      version,
      archiveProviders,
      false,
    );
    this.cleanConsumer("negative-default", negative);
    const diagnostics = this.command(
      "default-experimental-import-refused",
      ["cargo", "build", "--locked", "--offline", "--lib", "--message-format=json", ...PROFILE],
      negative,
      101,
    );
    verifyDefaultRefusal(diagnostics, negative);
    const sourceConsumers = qualifySourceConsumers(this, version, providers, verifyGraph);
    requireThat(
      !this.command("final-source-status", [
        "git",
        "status",
        "--porcelain",
        "--untracked-files=no",
      ]),
      "acceptance mutated tracked source",
    );
    requireThat(
      this.command("final-source-head", ["git", "rev-parse", "HEAD"]).trim() === this.sourceSha,
      "source identity changed",
    );
    fs.writeFileSync(
      path.join(this.output, "receipt.json"),
      stringifyJson(
        {
          sourceSha: this.sourceSha,
          version,
          fixtureSha256: digest(source),
          commands: this.commands,
          graphs,
          cliMetadata: sourceConsumers.cli,
          canonDefaultNative: sourceConsumers.canon,
          archives,
          consumerBuilds: this.consumerBuilds,
          pathDefaultAndDistributedBuilt: true,
          archiveDefaultAndDistributedBuilt: true,
          consumerTestsPassed: true,
          defaultExperimentalImportRefused: true,
          consumerPatches: false,
          publicRegistryAcceptance: false,
          cliVariantsCompiled: true,
          canonDefaultNativeCompiled: true,
          minimalStoryCollectionTestPassed: sourceConsumers.minimalStoryCollectionTestPassed,
        },
        2,
      ) + "\n",
    );
  }
}
export const MODES: [string, string[]][] = [
  ["default", []],
  ["distributed", ["--features", "distributed"]],
];
export function verifyDefaultRefusal(diagnostics: string, directory: string) {
  const errors = jsonLines(diagnostics)
    .filter((row) => row.reason === "compiler-message" && row.message.level === "error")
    .map((row) => row.message);
  requireThat(
    errors.length === 1 &&
      errors[0].code?.code === "E0432" &&
      errors[0].message.includes("corsa::orchestrator::RaftConfig"),
    "default build failed for a reason other than gated RaftConfig",
  );
  requireThat(
    errors[0].spans.some(
      (span: any) =>
        span.is_primary &&
        path.resolve(directory, span.file_name) === path.resolve(directory, "src/lib.rs"),
    ),
    "negative diagnostic must originate in the independent refusal consumer",
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      root: { type: "string", default: "." },
      output: {
        type: "string",
        default: path.join(process.env.RUNNER_TEMP ?? "/tmp", "checked-corsa-package-consumer"),
      },
      "source-sha": { type: "string", default: process.env.SOURCE_SHA },
    },
  });
  requireThat(values["source-sha"], "--source-sha or SOURCE_SHA required");
  new Acceptance(
    physicalPath(values.root!),
    physicalPath(values.output!),
    values["source-sha"],
  ).run();
}
