import { chromium } from 'playwright';

const DEFAULT_CLEARANCE_URL = 'https://www.walmart.ca/fr/cp/clearance/6000204800999';
const DEFAULT_STORE_ID = '6000204800999';
const DEFAULT_CATEGORIES = ['électronique', 'electronics', 'jouets', 'toys'];

function parseArgs(argv) {
  const args = {
    store: process.env.WALMART_STORE_ID ?? DEFAULT_STORE_ID,
    url: process.env.WALMART_CLEARANCE_URL ?? DEFAULT_CLEARANCE_URL,
    categories: process.env.WALMART_CATEGORIES?.split(',').map((c) => c.trim()).filter(Boolean) ?? DEFAULT_CATEGORIES,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--store' && next) args.store = next;
    if (key === '--url' && next) args.url = next;
    if (key === '--category' && next) args.categories = next.split(',').map((c) => c.trim()).filter(Boolean);
  }
  return args;
}

function normalizePrice(raw) {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const match = raw.replace(/[^0-9,\.]/g, '').replace(',', '.');
    const parsed = Number.parseFloat(match);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function matchesCategory(product, keywords) {
  const searchable = [product.category, ...(product.categories ?? []), product.title, product.breadcrumb]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return keywords.some((keyword) => searchable.includes(keyword.toLowerCase()));
}

function uniqueByUrl(products) {
  const seen = new Set();
  return products.filter((product) => {
    if (!product.url) return true;
    if (seen.has(product.url)) return false;
    seen.add(product.url);
    return true;
  });
}

function pullFromState(state) {
  if (!state || typeof state !== 'object') return [];
  const candidates = [];
  const productBuckets = [state.entities?.products, state.entities?.product, state.products, state.items];
  productBuckets
    .filter(Boolean)
    .forEach((bucket) => {
      Object.values(bucket).forEach((product) => {
        if (!product) return;
        const urlPath = product?.productPageUrl || product?.productUrl || product?.canonicalUrl || product?.canonicalUrlV2 || product?.canonicalUrlV3;
        candidates.push({
          title: product?.name || product?.displayName || product?.title,
          price: normalizePrice(product?.price?.price || product?.price?.current || product?.price?.current?.price || product?.currentPrice || product?.priceInfo?.currentPrice?.price || product?.priceInfo?.currentPrice),
          currency: product?.price?.currency || product?.priceInfo?.currentPrice?.currencyUnit || 'CAD',
          url: urlPath ? `https://www.walmart.ca${urlPath}` : undefined,
          category: product?.category?.name || product?.categoryName || product?.department,
          categories: product?.categories || product?.categoryPath || product?.categoryHierarchy,
          breadcrumb: product?.breadcrumb?.join(' > '),
          availability: product?.availabilityStatus || product?.availability || product?.fulfillmentStatus,
        });
      });
    });
  return candidates;
}

function pullFromDom() {
  const cards = Array.from(document.querySelectorAll('[data-automation="product-grid"] article, article[data-automation="product"]'));
  return cards.map((card) => {
    const title = card.querySelector('[data-automation="name"]')?.textContent?.trim() || card.querySelector('a[title]')?.getAttribute('title');
    const priceText = card.querySelector('[data-automation="price"]')?.textContent || card.querySelector('.css-1p4va6y')?.textContent;
    const link = card.querySelector('a[href]')?.getAttribute('href');
    const breadcrumb = card.querySelector('[data-automation="department"]')?.textContent;
    const category = card.querySelector('[data-automation="category"]')?.textContent || breadcrumb;
    const availability = card.querySelector('[data-automation="availability"]')?.textContent;
    return {
      title,
      price: normalizePrice(priceText),
      currency: 'CAD',
      url: link?.startsWith('http') ? link : link ? `https://www.walmart.ca${link}` : undefined,
      category,
      breadcrumb,
      availability,
    };
  });
}

async function collectProducts(page) {
  const { products } = await page.evaluate(() => {
    const preloaded = window.__PRELOADED_STATE__;
    const redux = window.__WML_REDUX_INITIAL_STATE__;
    const raw = [];
    raw.push(...pullFromState(preloaded));
    raw.push(...pullFromState(redux));
    if (!raw.length) raw.push(...pullFromDom());
    return { products: raw };

    function normalizePrice(rawPrice) {
      if (typeof rawPrice === 'number') return rawPrice;
      if (typeof rawPrice === 'string') {
        const match = rawPrice.replace(/[^0-9,\.]/g, '').replace(',', '.');
        const parsed = Number.parseFloat(match);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    }

    function pullFromState(state) {
      if (!state || typeof state !== 'object') return [];
      const candidates = [];
      const productBuckets = [state.entities?.products, state.entities?.product, state.products, state.items];
      productBuckets
        .filter(Boolean)
        .forEach((bucket) => {
          Object.values(bucket).forEach((product) => {
            if (!product) return;
            const urlPath = product?.productPageUrl || product?.productUrl || product?.canonicalUrl || product?.canonicalUrlV2 || product?.canonicalUrlV3;
            candidates.push({
              title: product?.name || product?.displayName || product?.title,
              price: normalizePrice(product?.price?.price || product?.price?.current || product?.price?.current?.price || product?.currentPrice || product?.priceInfo?.currentPrice?.price || product?.priceInfo?.currentPrice),
              currency: product?.price?.currency || product?.priceInfo?.currentPrice?.currencyUnit || 'CAD',
              url: urlPath ? `https://www.walmart.ca${urlPath}` : undefined,
              category: product?.category?.name || product?.categoryName || product?.department,
              categories: product?.categories || product?.categoryPath || product?.categoryHierarchy,
              breadcrumb: product?.breadcrumb?.join(' > '),
              availability: product?.availabilityStatus || product?.availability || product?.fulfillmentStatus,
            });
          });
        });
      return candidates;
    }

    function pullFromDom() {
      const cards = Array.from(document.querySelectorAll('[data-automation="product-grid"] article, article[data-automation="product"]'));
      return cards.map((card) => {
        const title = card.querySelector('[data-automation="name"]')?.textContent?.trim() || card.querySelector('a[title]')?.getAttribute('title');
        const priceText = card.querySelector('[data-automation="price"]')?.textContent || card.querySelector('.css-1p4va6y')?.textContent;
        const link = card.querySelector('a[href]')?.getAttribute('href');
        const breadcrumb = card.querySelector('[data-automation="department"]')?.textContent;
        const category = card.querySelector('[data-automation="category"]')?.textContent || breadcrumb;
        const availability = card.querySelector('[data-automation="availability"]')?.textContent;
        return {
          title,
          price: normalizePrice(priceText),
          currency: 'CAD',
          url: link?.startsWith('http') ? link : link ? `https://www.walmart.ca${link}` : undefined,
          category,
          breadcrumb,
          availability,
        };
      });
    }
  });

  return products;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'fr-CA' });
  const page = await context.newPage();

  const clearanceUrl = args.url.includes(args.store) ? args.url : `${args.url.replace(/\/?$/, '')}/${args.store}`;
  await page.goto(clearanceUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const rawProducts = await collectProducts(page);
  const filtered = uniqueByUrl(
    rawProducts
      .filter((product) => product?.title)
      .filter((product) => matchesCategory(product, args.categories))
      .map((product) => ({
        ...product,
        price: product.price ?? null,
      })),
  );

  console.log(JSON.stringify({ store: args.store, url: clearanceUrl, categories: args.categories, count: filtered.length, products: filtered }, null, 2));

  await browser.close();
}

main().catch((error) => {
  console.error('Failed to scrape Walmart clearance page:', error);
  process.exitCode = 1;
});
