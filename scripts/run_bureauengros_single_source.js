import { generateDealsForAllStoresFromSaintJerome } from '../src/generateDealsFromSaintJerome.js';

async function main() {
  try {
    await generateDealsForAllStoresFromSaintJerome();
    console.log('✅ Generated Bureau en Gros deals for all stores from Saint-Jérôme');
  } catch (err) {
    console.error('❌ Failed to generate Bureau en Gros deals', err);
    process.exit(1);
  }
}

main();
