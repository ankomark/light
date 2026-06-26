# Adventist Life — mobile app (Expo / React Native)

The frontend for Adventist Life, a Seventh-day Adventist social, media, and
marketplace app. Built with Expo (SDK 53), React Native, and React Navigation.
The Django backend lives in `../advent-backend` (see its `DEPLOYMENT.md`).

## Prerequisites

- Node.js 18+
- A development build (this project uses native modules — Stripe, SecureStore,
  notifications — so a dev build is recommended over plain Expo Go).

## Setup

```bash
npm install
npx expo start --dev-client
```

Then open the app on a device/emulator from the Expo CLI output.

## Environment variables

Provide as `EXPO_PUBLIC_*` vars (EAS build config, or a local `.env`):

- `EXPO_PUBLIC_SENTRY_DSN` — crash reporting (production builds only).
- `EXPO_PUBLIC_STRIPE_KEY` — Stripe publishable key for marketplace checkout.

The API base URL is set in `services/api.js` (`API_BASE`).

## Building (EAS)

See `eas.json`:

```bash
eas build --platform android
eas build --platform ios
```

EAS project id is in `app.json` (`ce25330b-30db-4e8c-b99b-c03d70772178`).

## Project layout

- `App.js` — navigation stack (~55 screens), Sentry + ErrorBoundary wrappers.
- `components/` — screens & UI (feed, stories, marketplace, groups, chat, …).
- `pages/` — Groups sub-app and directory pages.
- `services/` — `api.js` (axios + token auth), `cloudinary.js` (signed uploads), `pushNotifications.js`.
- `context/useAuth.js` — auth lifecycle.
- `constants/theme.js` — design tokens (dark navy theme).

## Backend

API and deployment details: `../advent-backend/DEPLOYMENT.md`.


1. Audit-log viewer screen — I already write every action to AdminActionLog and have AdminActionLogSerializer, but there's no UI or list endpoint yet. Add GET /api/admin/logs/ + a screen so super-admins can see "who did what, when." Smallest lift, real accountability.
2. Notify users on moderation actions — directly relevant to the EMAIL_HOST_PASSWORD you just have configured: email/push a user when they're suspended/banned/warned (and why). Hooks into the existing notify_user/email setup.
3. Strikes + temporary suspensions — suspended_until (auto-expire) and a warnings/strikes count with escalation (warn → temp suspend → ban). Right now suspension is indefinite and manual.
4. Smarter reports queue — dedupe/group ("5 reports on this post"), assign-to-moderator, internal notes, and a count badge. Today each report is a separate row.

Medium

5. Analytics & charts — time-series for signups/posts/active users, top content, report trends (the dashboard currently shows point-in-time totals only).
6. Broaden moderation coverage — groups, stories, track-comments, and messages (Phase 1 covers posts/tracks/post-comments/users).
7. Search & filters in Content management — currently it's a flat newest-first list per type.

Later / larger

8. Granular per-permission roles — move from the 2-tier model to Django Groups/permissions so each capability is toggle-able (you chose 2-tier for Phase 1, deliberately).
9. Appeals flow — suspended/banned users can submit an appeal that lands in a moderator queue.
10. Bulk actions + rate limiting — multi-select resolve/remove with guardrails.
11. Separate web dashboard — the heavier "professional console" route, if in-app ever feels limiting.
