import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Redacted, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { ContentstackCli } from "./contentstack-cli";
import { contentstackCliLayer } from "./contentstack-cli-live";

const commandLayer = (
  run: (command: ChildProcess.Command) => {
    exitCode: number;
    stdout: string;
    stderr?: string;
  }
) => {
  const encoder = new TextEncoder();
  return contentstackCliLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodePath.layer,
        NodeFileSystem.layer,
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make((command) =>
            Effect.sync(() => {
              const { exitCode, stdout, stderr = "" } = run(command);
              return ChildProcessSpawner.makeHandle({
                all: Stream.empty,
                exitCode: Effect.succeed(
                  ChildProcessSpawner.ExitCode(exitCode)
                ),
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
                isRunning: Effect.succeed(false),
                kill: () => Effect.void,
                pid: ChildProcessSpawner.ProcessId(1),
                stderr: Stream.make(encoder.encode(stderr)),
                stdin: Sink.drain,
                stdout: Stream.make(encoder.encode(stdout)),
                unref: Effect.succeed(Effect.void),
              });
            })
          )
        )
      )
    )
  );
};

describe("Contentstack CLI diagnostics", () => {
  it.effect(
    "reports the subprocess exit status without including its raw diagnostics",
    () =>
      Effect.gen(function* () {
        const cli = yield* ContentstackCli;
        const error = yield* Effect.flip(
          cli.runMigration({
            file: "migration.js",
            managementTokenAlias: "management-token",
          })
        );
        expect(error.operation).toBe("migrate");
        expect(error.cause).toEqual(
          new Error("Contentstack CLI exited with code 1")
        );
      }).pipe(
        Effect.provide(
          commandLayer(() => ({
            exitCode: 1,
            stdout: "migration stdout\n",
            stderr: "migration stderr\n",
          }))
        )
      )
  );

  it.effect(
    "uses the supplied private token after CSDX confirms registration",
    () => {
      const token = "test-management-token";
      const commands: string[] = [];
      const layer = commandLayer((command) => {
        if (command._tag !== "StandardCommand")
          throw new Error("Expected a CSDX command");
        const name = command.args[1] ?? "";
        commands.push(name);
        if (name === "auth:tokens:add") {
          expect(command.args).not.toContain(token);
          expect(command.options.env?.TOKEN).toBe(token);
          return { exitCode: 0, stdout: "Successfully added the token\n" };
        }
        return { exitCode: 0, stdout: "No tokens found\n" };
      });
      return Effect.gen(function* () {
        const cli = yield* ContentstackCli;
        const stack = yield* cli.resolveStack("stack-bltExample");
        expect(stack.apiKey).toBe("bltExample");
        expect(Redacted.value(stack.managementToken)).toBe(token);
        expect(commands).toEqual(["config:set:region", "auth:tokens:add"]);
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({
            CONTENTSTACK_MANAGEMENT_TOKEN: token,
            CONTENTSTACK_REGION: "NA",
            CONTENTSTACK_STACK_API_KEY: "bltExample",
          })
        )
      );
    }
  );

  it.effect("reports an absent alias when CSDX has no tokens", () =>
    Effect.gen(function* () {
      const cli = yield* ContentstackCli;
      const error = yield* Effect.flip(cli.resolveStack("stack-bltExample"));
      expect(error.cause).toEqual(new Error("The alias did not resolve to the expected Management Token"));
    }).pipe(
      Effect.provide(commandLayer(() => ({ exitCode: 0, stdout: "Startup notice\nNo tokens are added. Use auth:tokens:add command to add tokens.\n" }))),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({}))
    )
  );

  it.effect("reads JSON aliases after CSDX startup notices", () =>
    Effect.gen(function* () {
      const cli = yield* ContentstackCli;
      const stack = yield* cli.resolveStack("stack-bltExample");
      expect(stack.apiKey).toBe("bltExample");
      expect(Redacted.value(stack.managementToken)).toBe("test-token");
    }).pipe(
      Effect.provide(commandLayer(() => ({ exitCode: 0, stdout: 'Startup notice\n[{"alias":"stack-bltExample","type":"management","apiKey":"bltExample","token":"test-token"}]\n' }))),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({}))
    )
  );

  it.effect("rejects unrecognized alias output without exposing it", () =>
    Effect.gen(function* () {
      const cli = yield* ContentstackCli;
      const error = yield* Effect.flip(cli.resolveStack("stack-bltExample"));
      expect(error.cause).toEqual(new Error("Unrecognized alias response"));
    }).pipe(
      Effect.provide(commandLayer(() => ({ exitCode: 0, stdout: "unexpected sensitive output" }))),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({}))
    )
  );


  it.effect("uses the provider captured when the CLI layer is built", () => {
    const commands: string[] = [];
    const provider = ConfigProvider.fromUnknown({
      CONTENTSTACK_MANAGEMENT_TOKEN: "private-test-token",
      CONTENTSTACK_REGION: "NA",
      CONTENTSTACK_STACK_API_KEY: "bltExample",
    });
    const layer = commandLayer((command) => {
      if (command._tag !== "StandardCommand") throw new Error("Expected a CSDX command");
      const name = command.args[1] ?? "";
      commands.push(name);
      return { exitCode: 0, stdout: name === "auth:tokens:add" ? "Successfully added the token\n" : "" };
    }).pipe(Layer.provide(ConfigProvider.layer(Effect.succeed(provider))));
    return Effect.gen(function* () {
      const cli = yield* ContentstackCli;
      const stack = yield* cli.resolveStack("stack-bltExample");
      expect(Redacted.value(stack.managementToken)).toBe("private-test-token");
      expect(commands).toEqual(["config:set:region", "auth:tokens:add"]);
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({}))
    );
  });

});
