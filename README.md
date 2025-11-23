# EconoDeal Walmart Scraper (archived)

This repository has been cleaned to remove Walmart scraping logic, workflows, and generated outputs while keeping the basic project structure for future reuse. New scrapers can be added incrementally.

## Contents
- `package.json`: Minimal package manifest retained for potential future development.
- `scripts/`: Playwright scrapers for retailer liquidation sections.

## Usage

- **Bureau en Gros (Staples Canada) – liquidation**
  - Manual run: `npm run scrape:bureauengros:clearance`
  - Output: `outputs/bureauengros/clearance/data.json`

## Automation

- `.github/workflows/bureauengros-clearance.yml`: Nightly (09:00 UTC) and manual workflow to run the Bureau en Gros clearance scraper and upload results as an artifact.

## Notes
- Walmart-specific automation and workflows have been removed.
- Add new tooling or scripts as needed before publishing or deployment.
