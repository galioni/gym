# Auth email templates

Branded HTML for the emails Supabase Auth sends. Supabase reads them from the hosted project's settings, so after
changing a file here, paste it in **Authentication → Emails → Templates** (subject + body) of the project, or wire
it through `supabase/config.toml` once that exists (Phase 17).

| Supabase template | File | Subject |
|---|---|---|
| Confirm signup | `confirm_signup.html` | Confirm your Daily Grind account |
| Reset password | `reset_password.html` | Reset your Daily Grind password |
| Change email address | `change_email.html` | Confirm your new email address |

Magic link, invite and reauthentication are not used by the app (sign-in is password or Google), so their defaults stay.

Notes
- Uses the template variables `{{ .ConfirmationURL }}`, `{{ .Email }}` and `{{ .NewEmail }}`. Keep them exactly as written.
- Tables and inline styles are deliberate: Gmail and Outlook ignore most modern CSS. The dark-mode block is a progressive
  enhancement (Apple Mail, Gmail app); other clients show the light version.
- The logo is `https://gym-galioni.vercel.app/icon-192.png`; change `SITE` in the files if the domain changes.
