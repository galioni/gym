# Sign in with Apple

The iPhone app offers "Continue with Apple" next to "Continue with Google". App Store guideline 4.8 requires an equivalent
privacy-focused login whenever a third-party login is offered, and guideline 5.1.1(v) requires the app to **revoke the person's Apple
token when they delete their account**. Both are built. The button, the API and the revocation are ready; they need your Apple
developer account and three settings before they work for real.

## How it works

```
 iPhone app                              Supabase                      our API (Vercel)            Apple
  | 1. native sheet, with sha256(nonce) ---------------------------------------------------------->|
  |<-- identity token (carries the hash), authorization code ------------------------------------- |
  | 2. signInWithIdToken(token, nonce) -->| checks the token with Apple's keys, and the nonce       |
  |<-- session -----------------------------|                                                        |
  | 3. first sign-in only: save the name Apple gave (it is sent once)                               |
  | 4. POST /api/apple-token {authorizationCode} -------------------->| trades the code for a refresh |
  |                                                                  | token (signed client secret)->|
  |                                                                  | keeps it (server-only table)  |
  ...later, the person deletes their account...
  | Apple's sheet again (a fresh authorization code) --------------------------------------------->|
  | DELETE /api/delete-account {appleAuthorizationCode} ---------->| trades the fresh code, revokes |
  |                                                                 | the token ------------------->|
  |                                                                 | deletes the account (and token)|
```

- **The nonce** is random per attempt. Apple receives its hash and puts it in the identity token; Supabase receives the nonce itself
  and checks they match, so a stolen identity token cannot be replayed.
- **Signing in never depends on step 4.** If the server is not set up for it, or is unreachable, the person is signed in anyway.
- **Revocation does not depend on the stored token either.** When someone deletes an account that signed in with Apple, the app shows
  Apple's sheet once more to confirm and sends the fresh code with the delete request; the server trades it for a token and revokes
  it. That works for accounts created before the server was set up. If the person closes the sheet, or it cannot be shown, the token
  stored at sign-in (step 4) is used instead, and the app tells them they can also remove Daily Grind under Settings → Apple ID →
  Sign in with Apple. A fresh code is used only if it belongs to the Apple account this user signed in with, so one account's deletion
  can never revoke someone else's access. Deleting an account never fails because Apple does.
- **The stored token** (`apple_auth_tokens`, migration `20261004100000`) can be read and written only by the server: there is no
  policy and no grant for users, and the database tests check that. It disappears with the account.
- **Name and email.** Apple sends the name only the first time a person authorises the app. If they choose "Hide My Email" the
  account's email is a `…@privaterelay.appleid.com` address.

## What you need to set up

1. **App ID.** Apple developer account → Certificates, Identifiers & Profiles → Identifiers → the iOS app's App ID
   (`com.dailygrind.dailyGrind`) → turn on the **Sign In with Apple** capability. The app already carries the entitlement
   (`mobile/ios/Runner/Runner.entitlements`, referenced by all three Runner build configurations).
2. **A key for revocation.** Keys → "+" → tick **Sign in with Apple** → Configure → choose the App ID → Register → download the
   `.p8` (once only) and note the **Key ID**. This is a different key from the in-app-purchase key. Your **Team ID** is under
   Membership details.
3. **Supabase.** Dashboard → Authentication → Sign In / Providers → Apple → enable it and put the iOS bundle id
   `com.dailygrind.dailyGrind` in **Client IDs**. For the native flow no secret key is needed there. (The Supabase connector
   cannot edit hosted Auth settings; this is a dashboard step.)
4. **Vercel environment variables** (Production), marked sensitive:

   | Variable | Value |
   | --- | --- |
   | `APPLE_SIGNIN_TEAM_ID` | Team ID |
   | `APPLE_SIGNIN_KEY_ID` | Key ID of the Sign in with Apple key |
   | `APPLE_SIGNIN_PRIVATE_KEY` | contents of the `.p8` (literal `\n` between lines is accepted) |
   | `APPLE_BUNDLE_ID` | `com.dailygrind.dailyGrind` (the same variable the in-app purchase setup uses) |

   Without these, `POST /api/apple-token` answers 503 and account deletion skips the revocation.
5. **Migration.** `20261004100000_apple_signin_tokens.sql` is applied to the hosted project when the PR merges (additive).

## Testing

- Unit and widget tests cover the nonce, the requests sent to Supabase (real `GoTrueClient` over a mock HTTP client), the name saving,
  the code hand-over, the button, the API endpoint, the Apple client (generated keys), and revocation on deletion:
  `npx vitest run api` and `cd mobile && flutter test test/auth test/ui/auth_flow_test.dart`. The database tests
  (`npm run gym:test-db`) check the token table is server-only.
- **Nothing has run against Apple.** Apple's sheet and tokens cannot be produced on this machine or in a simulator without a signed
  build. First real test, on a device with the app signed by your team (TestFlight is fine): sign in with Apple, check a row appears in
  `apple_auth_tokens`, delete the account, and confirm the app no longer shows under Settings → Apple ID → Sign in with Apple.

## Using an Apple account on the website

Sign in with Apple is in the iPhone app only. Someone who creates their account with Apple and hides their email has a relay address
and no password, and a password-reset email to a relay address is only delivered if the sending domain is registered with Apple. So
the app lets them set a password themselves: Settings → Account shows the address the account signs in with and, for an Apple
account without a password, a **Set a password** button. They then sign in on the website with that address and password. Someone
who shares their real email gets the same Supabase account as their email or Google sign-in (same email) and is not affected.

If you later want a "Continue with Apple" button on the website too, that needs a Services ID and return URL in the Apple account,
a client secret JWT in Supabase's Apple provider (it expires every 6 months), and the OAuth call in the web app. It is not needed for
the above to work.

## Known limit: the date on the device (not Apple)

Unrelated to Apple, the same clean-up covered a database refusal (`PT424`, a workout day older than the Free plan keeps). Both apps now
explain it as a probable wrong device date.
