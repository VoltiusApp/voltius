# Subscription Tiers — Implementation Plan

## Overview

- **Payment processor**: LemonSqueezy (EU VAT handling, no-card trials, customer portal, webhooks)
- **Enforcement**: server-side on cloud APIs (open-source client = soft gates only, accepted trade-off)
- **Subscription management**: dedicated `/account` route on the Next.js web app — NOT on the landing page
- **Tiers**: `free` | `pro` (€7/mo, billed annually) | `teams` (€15/user/mo, billed annually, 3-user min) | `business` (custom)
- **Trial**: 14-day free Pro trial, no credit card, auto-starts on cloud account creation

### Billing model
Prices shown are monthly equivalents of an annual charge. One LemonSqueezy product per tier, billed annually:
- Pro: €84/yr (displayed as €7/mo)
- Teams: €180/user/yr (displayed as €15/user/mo)
- Business: custom contract, no LS product

---

## Phase 1 — Backend: JWT tier claims + LemonSqueezy webhooks

### DB additions (users table)
```sql
subscription_tier  TEXT DEFAULT 'free'   -- free | pro | teams | business
trial_ends_at      TIMESTAMPTZ NULL       -- set to now()+14d on cloud account creation
trial_used         BOOLEAN DEFAULT FALSE  -- flipped true when trial expires or user subscribes
ls_customer_id     TEXT NULL
ls_subscription_id TEXT NULL
seat_count         INTEGER NULL           -- teams/business only: number of licensed seats
```

### JWT payload additions
```json
{
  "sub": "account_id",
  "tier": "free",
  "trial_ends_at": "2026-05-04T00:00:00Z",
  "trial_used": false,
  "exp": 1234567890
}
```

### Trial auto-start on registration
On `POST /v1/auth/register`:
- Set `trial_ends_at = now() + 14 days`
- `trial_used = false`
- `subscription_tier = 'free'` (trial gives Pro-level access via `isTrialActive` check, not by changing tier)
- JWT issued immediately includes `trial_ends_at`

Trial expiry: a scheduled job (cron or LS webhook `subscription_trial_expired`) flips `trial_used = true` and clears `trial_ends_at`. Next token refresh propagates this to the client.

### LemonSqueezy webhook handler — `POST /v1/webhooks/lemonsqueezy`
- `subscription_created` → set tier from product metadata, `ls_customer_id`, `ls_subscription_id`; flip `trial_used = true`
- `subscription_updated` → update tier on plan changes (pro → teams)
- `subscription_cancelled` → schedule downgrade to `free` at `ends_at`
- `subscription_expired` → immediate downgrade to `free`, `trial_used = true`
- `subscription_trial_expired` → flip `trial_used = true`, clear `trial_ends_at`

### JWT refresh
- `/v1/auth/refresh` re-reads tier + trial fields from DB before issuing new token
- Short-lived tokens (~1h) so downgrades propagate within 1 hour
- Client calls refresh on app focus if token age > 50min
- On 403 from any guarded endpoint → trigger immediate refresh, then notify user (see Phase 6)

### API enforcement middleware — route guards
| Route | Required |
|---|---|
| `POST /v1/sync/*` | `isPro` (tier=pro/teams/business OR trial active) |
| `GET /v1/sse` | `isPro` |
| `POST /v1/share/start` | `isPro` |
| `POST /v1/share/invite` | `pro`: reject if guest_count >= 1; `teams/business`: check seat_count |
| `POST /v1/teams/*` | `tier = teams or business` |
| `GET /v1/teams/*` | `tier = teams or business` |

---

## Phase 2 — Client: `subscriptionStore` + `useSubscription`

### New file: `src/stores/subscriptionStore.ts`
```ts
type Tier = 'free' | 'pro' | 'teams' | 'business'

interface SubscriptionState {
  tier: Tier
  trialEndsAt: Date | null
  trialUsed: boolean
  isTrialActive: boolean  // computed: trialEndsAt != null && trialEndsAt > now && !trialUsed
  isPro: boolean          // computed: tier != free OR isTrialActive
  isTeams: boolean        // computed: tier = teams | business
}
```

- Parses JWT claims from keychain via `keychainGet("jwt")` on load
- `load()` called in `account.ts` after any JWT update (login, refresh, register)
- `useSubscription()` hook returns `SubscriptionState`
- Falls back to `{ tier: 'free', ...nulls }` for local accounts (no JWT)

---

## Phase 3 — TitleBar: `SubscriptionBadge` component

**Location in `TitleBar.tsx`**: right of `SyncIndicator`, left of `NotificationBell`

**Only shown when**: `accountMode === "server"` (cloud accounts only)

### Free tier (including trial active)
- Default: `lucide:circle-fading-arrow-up` icon (compact, icon-only, `--t-text-secondary`)
- Hover: smooth `max-width` expand → shows text:
  - `"Upgrade · 14d Free Trial"` when `!trialUsed && !isTrialActive` (trial not yet consumed)
  - `"X days left"` when `isTrialActive` (trial running — remind them it ends)
  - `"Upgrade"` when `trialUsed && !isPro`
- Hover color: cyan accent (`--t-accent`)

### Premium tier (pro / teams / business)
- Default: `lucide:crown` icon (compact, amber/gold color)
- Hover: expand → plan name (`"Pro"` / `"Teams"` / `"Business"`)

### Animation
```css
max-width: 2rem → max-width: 10rem on hover
overflow: hidden; white-space: nowrap
transition: max-width 250ms ease
```

### Click
Both states call `openSettings("account")`.

---

## Phase 4 — Account Settings: Plans section

Add a **Plans section** to the existing account settings tab (below account info).

### Free / trial view
- Current plan badge: `Free` or `Pro Trial — X days left`
- If `!trialUsed && !isTrialActive`: "Start your 14-day Pro trial — no credit card"  
  → CTA hits `POST /v1/billing/checkout { plan: 'pro' }`, backend returns LS checkout URL, `shell_open` it
- Feature comparison table (compact: Free / Pro / Teams)
- "View all plans" → `shell_open("https://voltius.app/account/plans")`

### Pro view
- Badge: `Pro`
- Next billing date (from JWT or backend)
- "Manage billing" → `shell_open("https://voltius.app/account")`
- "Upgrade to Teams" CTA

### Teams view
- Badge: `Teams`
- Seat count: `X / Y seats used`
- "Manage billing & seats" → `shell_open("https://voltius.app/account")`

### Implementation note
Use `open()` from `@tauri-apps/plugin-opener` for external URLs.

---

## Phase 5 — Web: `/account` portal route

**Repo**: `../web` (Next.js app)

### Auth — two separate flows, same backend
The app uses Bearer JWT in keychain. The web portal needs its own cookie session:
- `POST /v1/auth/web-login` → same credentials as app login, but returns `Set-Cookie: session=<jwt>; HttpOnly; SameSite=Strict` instead of JSON body
- Web portal reads session from cookie; app reads JWT from keychain
- Same token contents, same backend issuer — just different delivery mechanism

### Routes
```
app/account/
  layout.tsx          — auth guard (redirect to /account/login if no cookie session)
  page.tsx            — dashboard: current plan, trial status, next billing date
  plans/page.tsx      — plan cards with annual checkout links
  billing/page.tsx    — redirect to LemonSqueezy customer portal URL
  login/page.tsx      — email + password → POST /v1/auth/web-login → cookie
```

### Teams invite flow (web)
- Team vaults exist in the app; inviting a member to a team vault triggers a seat check
- `POST /v1/teams/:id/invite { email }` — backend checks `seat_count` vs current member count
  - If seats available: sends invite email, returns success
  - If seats exhausted: returns 402 with `{ error: 'seat_limit', upgrade_url: '...' }`
- Web portal `/account` page shows seat usage and "Add seats" button → new LS checkout for additional seats

### Checkout flow
1. User clicks upgrade CTA (in-app or web)
2. Backend `POST /v1/billing/checkout { plan, seats? }` → creates LS checkout URL with trial if eligible
3. Client `shell_open(url)` (app) or `router.push(url)` (web)
4. LS fires `subscription_created` webhook → backend updates tier + seat_count
5. Success redirect lands on `voltius.app/account`

### No auth on marketing landing page
- `app/page.tsx` stays pure marketing
- Pricing CTA buttons → `/account/plans`

---

## Phase 5b — Teams invite UX (in-app)

Team membership is scoped to **team vaults** — you invite someone to a vault, not to the account globally.

### Invite flow
1. In a team vault's settings panel, user clicks "Invite member"
2. App calls `POST /v1/teams/:vault_id/invite { email }`
3. Backend checks seat_count:
   - OK → invited user receives email with a magic link to join
   - Seat limit hit → app shows inline error: "You've used all X seats. [Add seats →]" which `shell_open`s the billing portal
4. Invitee clicks email link → lands on `voltius.app/account/join?token=...` → logs in or creates account → vault is added to their app on next sync

### Seat model
- Teams subscription purchased with a seat count (minimum 3)
- Adding a member beyond seat_count requires upgrading the subscription (via LS quantity change)
- Backend enforces this; client shows the seat usage count in team vault settings

---

## Phase 6 — Feature gating + expiry notifications

### Hook usage
```ts
const { tier, isTrialActive, isPro, isTeams } = useSubscription();
```

### Gated features
| Feature | Gate | Locked UI |
|---|---|---|
| Real-time cloud sync | `isPro` | Toggle disabled + "Pro feature" nudge |
| Share terminal (1 guest) | `isPro` | Button disabled + tooltip |
| Share terminal (unlimited) | `isTeams` | Upgrade nudge in share menu for Pro users |
| Team vault creation | `isTeams` | Button disabled + upgrade nudge |
| Gist sync | always free | No gate |

### Subscription expiry notification (mid-session)
When a token refresh returns a downgraded tier (e.g. trial expired, sub cancelled):
- Toast notification: `"Your Pro subscription has ended — sync has been paused. [Manage plan →]"`
- Sync stops automatically (server will 403 anyway)
- Clicking the toast CTA opens account settings

Trigger: compare old tier vs new tier after every token refresh. If `newTier < oldTier`, fire the toast.

### Upgrade nudge pattern
```tsx
{!isPro && (
  <div className="upgrade-nudge">
    <Icon icon="lucide:lock" /> Pro feature —{" "}
    <button onClick={() => openSettings("account")}>Upgrade</button>
  </div>
)}
```

---

## Implementation order

1. **Phase 1** — Backend: DB cols, trial on register, LS webhooks, route guards, JWT refresh
2. **Phase 2** — `subscriptionStore.ts` + `useSubscription` (mock tier for local dev)
3. **Phase 3** — `SubscriptionBadge` in TitleBar
4. **Phase 4** — Account settings Plans section
5. **Phase 5** — Web `/account` portal + web-login cookie endpoint
6. **Phase 5b** — Teams invite UX (in-app + email join flow)
7. **Phase 6** — Feature gates + expiry toast

---

## Open questions / decisions

- [ ] LemonSqueezy product IDs (set once products are created in LS dashboard)
- [ ] Invite email sender — transactional email service (Resend? Postmark?)
- [ ] Magic link TTL for team invite join links
- [ ] `voltius.app` domain — is this the live domain for the web portal?
