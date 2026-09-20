import { GoogleConnectionRequiredError, withGoogleCredential } from "./google-credential-broker";

export type ConnectionState = "connected" | "needs_reconnect" | "unavailable";

/**
 * Asks Google whether the saved permission still works, by using it the way the assistant would: the broker refreshes the token if it
 * has expired and confirms Google still grants the needed scope. A connection Google has revoked or that lacks the scope needs
 * reconnecting; a network problem or timeout is reported as unavailable rather than guessed at.
 */
export async function checkGoogleConnection(userId: string, capability: "calendar" | "email" | "email_drafts"): Promise<ConnectionState> {
  try {
    await withGoogleCredential(userId, capability, async () => true);
    return "connected";
  } catch (error) {
    return error instanceof GoogleConnectionRequiredError ? "needs_reconnect" : "unavailable";
  }
}
