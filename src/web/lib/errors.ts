export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The request never reached the server: Tailscale off, no network, server down. */
export class OfflineError extends Error {}
