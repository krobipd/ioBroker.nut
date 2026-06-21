import type { NutClient } from "./nut-client";
import { coerceCommandTimeoutMs, coerceHost, coercePort, errText, localAddressOf } from "./coerce";
import type { AdapterConfig, NutClientOptions, NutLogger } from "./types";

/**
 * Dependencies the message router needs. Extracted as a pure interface
 * so `dispatchMessage` is testable without an adapter instance.
 */
export interface MessageRouterDeps {
  /** Adapter logger. */
  log: {
    debug(msg: string): void;
    warn(msg: string): void;
  };
  /** ioBroker sendTo bound against the adapter instance. */
  sendTo: (
    from: string,
    command: string,
    response: unknown,
    callback: ioBroker.MessageCallbackInfo | undefined,
  ) => void;
  /** Factory for throwaway NutClient used by checkConnection (options carry localAddress/timeout/TLS). */
  createTestClient: (host: string, port: number, options?: NutClientOptions) => NutClient;
  /** Called right after createTestClient returns. */
  onTestClientCreated?: (client: NutClient) => void;
  /** Called after checkConnection settles (success or fail). */
  onTestClientDone?: (client: NutClient) => void;
}

/** NutClient constructor shape for dependency injection. */
type NutClientConstructor = new (host: string, port: number, options?: NutClientOptions) => NutClient;

/**
 * Build the standard test-client factory used in production.
 *
 * @param NutClientClass NutClient constructor
 * @param logger Logger to forward into the NutClient
 */
export function makeTestClientFactory(
  NutClientClass: NutClientConstructor,
  logger: NutLogger,
): MessageRouterDeps["createTestClient"] {
  return (host, port, options) => new NutClientClass(host, port, { ...options, logger });
}

/**
 * Dispatch a single ioBroker message. Handles `checkConnection` from the
 * admin UI and provides the default-branch contract so unknown commands
 * get `{ error: "Unknown command" }` instead of leaving the callback hanging.
 *
 * @param obj The incoming message payload
 * @param deps Test-injectable dependencies
 */
export async function dispatchMessage(obj: ioBroker.Message, deps: MessageRouterDeps): Promise<void> {
  deps.log.debug(`onMessage: command='${obj?.command}' from='${obj?.from}' has-callback=${!!obj?.callback}`);
  if (!obj.callback) {
    return;
  }
  try {
    switch (obj.command) {
      case "checkConnection": {
        const raw = obj.message;
        const config =
          typeof raw === "object" && raw !== null && !Array.isArray(raw)
            ? (raw as Partial<AdapterConfig>)
            : ({} as Partial<AdapterConfig>);
        const host = coerceHost(config.host);

        if (!host) {
          deps.log.debug("checkConnection: missing host in message");
          deps.sendTo(obj.from, obj.command, { success: false, message: "Host is required" }, obj.callback);
          return;
        }

        const port = coercePort(config.port);
        const username = typeof config.username === "string" ? config.username : "";
        const password = typeof config.password === "string" ? config.password : "";

        // Mirror the production client so the test exercises the real path (multi-homed bind, TLS).
        const localAddress = localAddressOf(config.networkInterface);
        const options: NutClientOptions = {
          localAddress,
          commandTimeout: coerceCommandTimeoutMs(config.commandTimeout),
          useTls: !!config.useTls,
          tlsRejectUnauthorized: !!config.tlsRejectUnauthorized,
        };

        const testClient = deps.createTestClient(host, port, options);
        deps.onTestClientCreated?.(testClient);
        try {
          await testClient.connect();
          const upsList = await testClient.listUps();
          const names = upsList.map(u => u.name).join(", ");
          deps.log.debug(`checkConnection: found ${upsList.length} UPS(es): ${names}`);

          if (username && password) {
            // No per-UPS LOGIN (see onConnected in main.ts): NUT allows one LOGIN per connection
            // and it is upsmon-only; USERNAME/PASSWORD is the real credential check.
            await testClient.authenticate(username, password);
            deps.sendTo(
              obj.from,
              obj.command,
              { success: true, message: `Connected and authenticated — ${upsList.length} UPS(es): ${names}` },
              obj.callback,
            );
          } else {
            deps.sendTo(
              obj.from,
              obj.command,
              { success: true, message: `Connected — ${upsList.length} UPS(es): ${names}` },
              obj.callback,
            );
          }
        } finally {
          testClient.destroy();
          deps.onTestClientDone?.(testClient);
        }
        break;
      }
      default:
        deps.log.debug(`onMessage: unknown command '${obj.command}'`);
        deps.sendTo(obj.from, obj.command, { error: "Unknown command" }, obj.callback);
    }
  } catch (err) {
    deps.log.debug(`onMessage: '${obj.command}' failed: ${errText(err)}`);
    deps.sendTo(obj.from, obj.command, { success: false, message: errText(err) }, obj.callback);
  }
}
