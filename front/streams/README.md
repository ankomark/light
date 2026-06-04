# Advent Light — mobile app (Expo / React Native)

The frontend for Advent Light, a Seventh-day Adventist social, media, and
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
$env:EXPO_TOKEN ="yhrwClME7aMjBB-tcsC8IUcUKznHBxJqUGne2gw7"