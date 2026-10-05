# Store listing: legal pages and privacy declarations

What to put in App Store Connect and Google Play Console so the listing matches what the app does. The Terms and Privacy pages
are static files in `public/` (`terms.html`, `privacy.html`), served at `/terms` and `/privacy`. This is guidance for
filling in the forms, not legal advice: have the two pages read by someone qualified before you publish.

## 1. Before you submit

1. **Fill in the three placeholders** in both pages: `[OPERATOR NAME]`, `[OPERATOR ADDRESS]`, `[CONTACT EMAIL]` (search and replace).
   `npm run check:legal` fails until none are left. The address is published, so use one you are happy to show.
2. Check the things the pages assume and change them if they are not true: England and Wales law and the UK ICO (terms section 12,
   privacy section 7), minimum age 16, a £50 liability floor, 14-day cancellation wording, "backups follow the database
   provider's normal schedule" (confirm with Supabase), and the provider list (privacy section 4).
3. Deploy, then open `https://<your-domain>/terms` and `/privacy` in a private window (they must load without signing in, and
   without the installed web app taking over: the service worker has an exemption for them).
4. Give the mobile build the links: `--dart-define=TERMS_URL=https://<your-domain>/terms --dart-define=PRIVACY_URL=https://<your-domain>/privacy`.

## 2. URLs the stores ask for

| Field | Value |
|---|---|
| Privacy Policy URL (Apple, Google) | `https://<your-domain>/privacy` |
| Terms of Use / EULA (Apple: License Agreement, or the in-description link) | `https://<your-domain>/terms` (it carries the clauses Apple requires of a custom EULA; otherwise Apple's standard EULA applies) |
| Support URL (Apple), website (Google) | `https://<your-domain>/` |
| Account deletion URL (Google, "Data deletion" section) | `https://<your-domain>/privacy#delete-data` |
| Marketing URL (Apple, optional) | `https://<your-domain>/` |

## 3. Apple: App Privacy ("nutrition label")

**Tracking: No.** The app has no advertising SDK, no analytics SDK and uses no advertising identifier. Every item below is
**linked to the user** (it belongs to their account) and used for **App Functionality** only. Nothing is used for tracking,
advertising, or third-party marketing.

| Apple category | Data type | What it is |
|---|---|---|
| Contact Info | Email Address | sign-in and account emails |
| Contact Info | Name | only if Google sign-in supplies one (shown as the account name) |
| Health & Fitness | Health | body weight the person chooses to enter |
| Health & Fitness | Fitness | workout days, sets, timers |
| User Content | Other User Content | notes, templates, plans |
| Identifiers | User ID | the account id |
| Purchases | Purchase History | plan, status and end date; the App Store transaction id |
| Diagnostics | Other Diagnostic Data | our server logs each request (endpoint, status, time taken, a one-way hash of the account id). Declare it unless you remove those logs; it is not used for tracking |

Not collected: location, contacts, photos, browsing history, search history, financial info (the App Store handles payment), usage
data, advertising data. Health data is not used for advertising or sold.

## 4. Google Play: Data safety

- **Does the app collect or share data?** Collects: yes. Shares: **no**. Service providers that process data for us (Supabase,
  Vercel, the AI model providers, Resend) are not "sharing" under Google's definition; the AI providers receive only the plan
  questionnaire answers, with no identifiers.
- **Encrypted in transit:** yes. **Users can request deletion:** yes (in the app, *Settings → Data → Delete account and all data*,
  and the web link above).

| Google category | Data type | Collected | Purpose | Optional? |
|---|---|---|---|---|
| Personal info | Email address | yes | Account management, App functionality | no |
| Personal info | Name | yes | Account management | yes (Google sign-in only) |
| Personal info | User IDs | yes | Account management, App functionality | no |
| Health and fitness | Health info (body weight) | yes | App functionality | yes |
| Health and fitness | Fitness info (workouts) | yes | App functionality | no |
| App activity | Other user-generated content (notes, templates, plans) | yes | App functionality | no |
| Financial info | Purchase history | yes | App functionality | no |
| App info and performance | Diagnostics (server logs) | yes | App functionality, Analytics | no |

Also complete, if Play asks for them: the **Health apps declaration** (the app tracks fitness, uses no Health Connect and gives no
medical advice), **Target audience** (select 16 and over; not directed at children), **Ads** (no ads), and the **Financial
features** declaration (none other than the Play subscription).

## 5. Review risks to check before submitting

- **Sign in with Apple (Apple guideline 4.8).** The app offers "Continue with Google", so it must also offer Sign in with Apple. It
  does (the iPhone app only), and it revokes Apple's token when the account is deleted (guideline 5.1.1(v)). It needs the setup in
  [`SIGN_IN_WITH_APPLE.md`](SIGN_IN_WITH_APPLE.md) before it works for real, and has not run against Apple yet. Declare the same
  data as for email sign-in (Apple gives the same email and name).
- **In-app account deletion (Apple 5.1.1(v), Google).** Present: *Settings → Data → Delete account and all data*. It does not cancel a
  store subscription, and the app says so before deleting.
- **Subscription disclosures (Apple 3.1.2).** The paywall shows the price, the period, the renewal wording, "Restore purchases" and
  links to the Terms and Privacy pages. Set `STORE_PRO_PERIOD` to match the product, and `TERMS_URL` / `PRIVACY_URL`.
- **No pointers to buying elsewhere.** When in-app purchase is available the app does not tell people to upgrade on the website
  (the free-tier wording on the website itself is unaffected).
- **A review account.** Give the stores a test login (a Free account and, if possible, a Pro one through a sandbox purchase), and
  explain in the review notes that the plan generator needs the network.
- **Health disclaimer.** The Terms say the app is not medical advice. Keep that wording consistent with the store description
  (no medical claims such as treating or diagnosing).
