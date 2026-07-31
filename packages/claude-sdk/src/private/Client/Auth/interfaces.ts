import type { AuthCredentials, ProfileData } from './types';

/** Where the OAuth credentials live between runs. */
export abstract class ICredentialStore {
  /** The stored credentials, or null when nothing is stored or what is stored is unreadable. */
  public abstract read(): Promise<AuthCredentials | null>;
  public abstract write(credentials: AuthCredentials): Promise<void>;
}

/** The OAuth token endpoint: the two ways credentials are minted. */
export abstract class ITokenEndpoint {
  public abstract exchangeCode(code: string, state: string, codeVerifier: string, redirectUri: string): Promise<AuthCredentials>;
  public abstract refresh(credentials: AuthCredentials): Promise<AuthCredentials>;
}

/** The account profile, read once after a first login to stamp the subscription onto the credentials. */
export abstract class IProfileEndpoint {
  public abstract fetch(accessToken: string): Promise<ProfileData>;
}

/** Opens a URL in the operator's browser. */
export abstract class IBrowserLauncher {
  public abstract open(url: string): void;
}

export type CallbackListener = {
  /** The port that was bound, for building the redirect URL the browser is sent to. */
  readonly port: number;
  readonly code: Promise<{ code: string; state: string }>;
};

/** Receives the OAuth redirect the browser is sent to after the operator authorises. */
export abstract class ICallbackListener {
  /** Binds and returns once listening, so the redirect URL can carry the bound port. */
  public abstract start(): Promise<CallbackListener>;
}

/** The browser login. The one place a browser may open, run at startup and nowhere else. */
export abstract class ILoginFlow {
  /** Logs in and stores the resulting credentials. */
  public abstract run(): Promise<AuthCredentials>;
}

/**
 * The credentials a request runs on. Deliberately cannot log in: a per-request caller that hit a
 * browser login would park the turn in a wait no abort signal reaches, so the only outcome here for
 * an unauthenticated machine is `NotAuthenticatedError`. Logging in is `ILoginFlow`, at startup.
 */
export abstract class ICredentialProvider {
  /** Valid credentials, refreshed if expired. Throws `NotAuthenticatedError` when none are stored. */
  public abstract get(): Promise<AuthCredentials>;
}
