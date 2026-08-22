# K Street Snack

Official trilingual promotional site for K Street Snack, a Korean-owned bunsik and street-food shop in Wrocław, Poland.

## Languages

- Polish (default)
- English
- Korean

## Development

```bash
npm install
npm run dev
```

The site is built with Next.js and exported as static HTML for GitHub Pages.

## Deployment

GitHub Actions deploys the `master` branch to GitHub Pages after every push. It can also be run manually from the Actions tab and is scheduled to rebuild every Monday.

Menu releases can also be deployed from the authenticated admin tool through a Supabase Edge Function. The browser never receives a GitHub credential, and each admin-triggered build is pinned to an immutable Supabase release UUID. Setup and rollback notes are in [docs/menu-admin-deployment.md](docs/menu-admin-deployment.md).

Live site: [songnoin.github.io/kstreetsnack](https://songnoin.github.io/kstreetsnack/)

## Brand

Design and brand assets © K Street Snack. All rights reserved.
