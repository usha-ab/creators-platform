import { createBrowserClient } from "@supabase/ssr";
import { sharedCookieOptions } from "./cookie-options";
import { purgeAuthCookies } from "./auth-cookies";

function makeClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: sharedCookieOptions }
  );
}

// Inferred from makeClient() so the fully-typed client (auth.getSession() etc.)
// is preserved — annotating with ReturnType<typeof createBrowserClient> would
// widen it and lose the types.
let browserClient: ReturnType<typeof makeClient> | undefined;

// Singleton browser client: ONE instance (and thus one autoRefreshToken timer)
// shared across every "use client" component. Returning a fresh client per call
// spawned multiple concurrent auto-refreshers that raced each other and the
// server middleware's refresh; with refresh-token rotation, a lost race revokes
// the session, leaving the browser stuck retrying an invalid refresh token
// (the /token 429 loop that locked users out).
export function createClient() {
  if (!browserClient) {
    browserClient = makeClient();
    // När supabase-js ger upp en refresh (400 refresh_token_not_found) loggar
    // den ut och raderar cookien — men bara i den domänvariant den känner
    // till. En äldre host-only-kopia med samma namn överlever, läses först
    // nästa varv, och loopen börjar om. Rensa båda varianterna här, utan
    // nätverk, så att ett SIGNED_OUT faktiskt betyder utloggad.
    browserClient.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") purgeAuthCookies();
    });
  }
  return browserClient;
}
