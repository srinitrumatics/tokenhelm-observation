/**
 * ObservationEmitter — validates every event against the protocol, then transports it.
 *
 * This is the gate ADR 0002 requires: an invalid event never leaves the producer. The emitter
 * knows nothing about analytics or storage — only the protocol and a transport.
 */

import type { ObservationEvent } from "./protocol.js";
import type { Transport } from "./transport.js";
import { validate } from "./protocol.js";

/** Protocol-validate-then-transport pipeline. */
export class ObservationEmitter {
  private readonly transport: Transport;
  private readonly validateEvents: boolean;

  constructor(transport: Transport, validateEvents = true) {
    this.transport = transport;
    this.validateEvents = validateEvents;
  }

  emit(event: ObservationEvent): ObservationEvent {
    if (this.validateEvents) {
      validate(event as unknown as Record<string, unknown>); // throws ProtocolValidationError on a bad event
    }
    this.transport.emit(event);
    return event;
  }

  flush(): void | Promise<void> {
    return this.transport.flush?.();
  }

  close(): void | Promise<void> {
    return this.transport.close?.();
  }
}
