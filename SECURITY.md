# Security

Accounts are handled in `auth.mjs` using only Node.js built-ins (`node:crypto`, `node:sqlite`). Data is stored in the app's SQLite file, `~/.signvoice/signvoice.db`.

## Access

| Page | Who |
|---|---|
| `/login.html` | Everyone |
| `/?view=speak` | Signed-in users |
| `/` (teach, vocabulary) | Admins; other users are redirected to the speak view |
| `/admin.html` | Admins: users, statistics, audit log, review queue |

## Measures

| Area | What we do | Protects against |
|---|---|---|
| Password storage | scrypt (N=16384, r=8, p=1), 16-byte random salt per user, compared with `timingSafeEqual` | Leaked database, rainbow tables, timing attacks |
| Password policy | 8–128 characters, letters and digits, must not contain the username | Easy guesses |
| Sessions | 32-byte random token, only its SHA-256 is stored; 12 h idle and 7 day maximum; deleted on logout | Token theft from the database, stale sessions |
| Cookie | `HttpOnly; SameSite=Strict`, plus `Secure` over HTTPS | Script access (XSS), cross-site requests (CSRF) |
| CSRF | State-changing requests must come from the same origin (`Origin` / `Sec-Fetch-Site`) | Forged requests from other sites |
| Brute force | 10 failed logins per 15 min per IP (successful logins are not counted), 5 registrations per hour per IP, account locked for 15 min after 5 failures in a row | Password guessing, sign-up spam |
| Enumeration | Wrong password and unknown user return the same message in similar time | Discovering which accounts exist |
| Authorization | Checked on the server for every request; vocabulary, samples and training require admin | Regular users changing the shared model |
| XSS | Admin page renders user data with `textContent` only; CSP forbids inline scripts | Malicious display names |
| Headers | CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, HSTS over HTTPS | Clickjacking, third-party scripts |
| Request size | JSON up to 16 KB, sign clips up to 400 frames | Oversized payloads |
| Path tricks | API paths with `..`, `%2e`, `%2f` or backslashes are rejected before any permission check | Bypassing admin checks through URL normalisation |
| Audit | Logins, failures, lockouts and admin actions are written to `auth_log` and shown on the admin page | After-the-fact review |
| Secrets | API keys only in `.env` (git-ignored); passwords are never logged | Leaked keys |

The microphone permission is used only to read audio output device names for the virtual-microphone option. Nothing is recorded.

## HTTPS

- **Local use** (`http://127.0.0.1`): the server listens on localhost only.
- **Cloudflare Tunnel**: Cloudflare terminates HTTPS. The server detects it from the tunnel headers (sent from 127.0.0.1) and turns on `Secure` cookies and HSTS.
- **Your own certificate**: set `SIGNVOICE_TLS_CERT` and `SIGNVOICE_TLS_KEY` (PEM files) and run `npm start`.

## Admins

- The first account to register becomes an admin. Create yours before sharing the link.
- `SIGNVOICE_ADMINS=name1,name2` in `.env` always grants admin to those usernames.
- Admins can promote, demote, suspend (ends sessions immediately), unlock and delete accounts. You cannot change your own account from the admin page, so the last admin cannot lock themselves out.

## Tests

```powershell
npm test               # auth unit tests: hashing, policy, sessions, lockout, roles, cookies, rate limits
npm run test:security  # 25 checks against a running server
```

Run the security test against a separate account database so test users never land in the real one:

```powershell
$env:SIGNVOICE_AUTH_DB = "$env:TEMP\signvoice-auth-test.db"; $env:PORT = 5174; $env:SIGNVOICE_ML_PORT = 8767; npm start
# in another window
npm run test:security   # defaults to port 5174 and refuses to run against 5173
```

## Known limits

- Rate limits are kept in memory and reset when the server restarts.
- No email verification, password reset or 2FA. An admin can delete the account so the user can register again.
- Camera video stays in the browser, but the sentence to be spoken is sent to ElevenLabs when an API key is configured.
