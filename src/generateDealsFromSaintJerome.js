import fs from 'fs';
import path from 'path';
import { getBureauEnGrosStores } from '../lib/bureauengrosStores.js';
import { scrapeSaintJeromeDeals } from './scrapeSaintJeromeDeals.js';

const ROOT_DIR = process.cwd();
const OUTPUT_ROOT = path.join(ROOT_DIR, 'outputs', 'bureauengros');

function writeStoreDeals(storeSlug, products) {
  const storeDir = path.join(OUTPUT_ROOT, storeSlug);
  fs.mkdirSync(storeDir, { recursive: true });

  const jsonPath = path.join(storeDir, 'data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(products, null, 2), 'utf8');
}

export async function generateDealsForAllStoresFromSaintJerome() {
  const stores = getBureauEnGrosStores();

  const saintJeromeDeals = await scrapeSaintJeromeDeals();

  for (const store of stores) {
    writeStoreDeals(store.slug, saintJeromeDeals);
  }
}
