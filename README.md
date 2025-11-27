# EconoDeal Walmart Scraper (archived)

This repository has been cleaned to remove Walmart scraping logic, workflows, and generated outputs while keeping the basic project structure for future reuse. New scrapers can be added incrementally.

## Contents
- `package.json`: Minimal package manifest retained for potential future development.
- `scripts/`: Playwright scrapers for retailer liquidation sections and orchestrators.
- `data/`: Static datasets used by the scrapers.
- `src/`: Shared scraping helpers.

## Usage

- **Bureau en Gros (Staples Canada) – single-source clearance replicated to all stores**
  - Manual run: `npm run scrape:bureauengros`
  - Output: `outputs/bureauengros/<storeSlug>/data.json` for every store listed in `data/bureauengros/branches.json`
  - Optional: set `BUREAUENGROS_STORE_URL` to override the Saint-Jérôme store page when selecting inventory context.

## Automation

- `.github/workflows/bureauengros-clearance.yml`: Nightly (09:00 UTC) and manual workflow to run the Bureau en Gros clearance scraper and upload results as an artifact.

## Notes
- Walmart-specific automation and workflows have been removed.
- Add new tooling or scripts as needed before publishing or deployment.
