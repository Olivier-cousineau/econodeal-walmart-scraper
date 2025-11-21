import fs from 'fs';
import { chromium } from 'playwright';

const DEFAULT_CLEARANCE_URL = 'https://www.walmart.ca/fr/browse/electronics/10003?facet=special_offers%3ALiquidation&icid=cp_page_other_electronic_carousal_web_50803_4QMWQHY292';
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
    const url = product.productUrl || product.url;
    if (!url) return true;
    if (seen.has(url)) return false;
    seen.add(url);
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

async function collectProducts(cardsLocator) {
  const products = await cardsLocator.evaluateAll((cards) => {
    return cards.map((card) => {
      const title =
        card.querySelector('[data-automation="name"]')?.textContent?.trim() ||
        card.querySelector('a[title]')?.getAttribute('title') ||
        card.querySelector('a[href]')?.textContent?.trim();

      const currentPriceText =
        card.querySelector('[data-automation="price-section"] [data-automation="current-price"]')?.textContent ||
        card.querySelector('[data-automation="current-price"]')?.textContent ||
        card.querySelector('[data-automation="price"]')?.textContent ||
        card.querySelector('[itemprop="price"]')?.getAttribute('content') ||
        card.querySelector('span[class*="price"]')?.textContent;

      const originalPriceText =
        card.querySelector('[data-automation="price-section"] [data-automation="was-price"]')?.textContent ||
        card.querySelector('[data-automation="strike-price"]')?.textContent ||
        card.querySelector('s')?.textContent;

      const link = card.querySelector('a[href]')?.getAttribute('href');
      const image = card.querySelector('img[src], img[data-src], img[data-automation="product-image"]');
      const imageUrl =
        image?.getAttribute('src') ||
        image?.getAttribute('data-src') ||
        image?.getAttribute('data-image-src');

      return {
        title: title ?? null,
        currentPrice: normalizePrice(currentPriceText),
        originalPrice: normalizePrice(originalPriceText),
        productUrl: link?.startsWith('http') ? link : link ? `https://www.walmart.ca${link}` : null,
        imageUrl: imageUrl?.startsWith('http') ? imageUrl : imageUrl ? `https:${imageUrl}` : null,
      };
    });

    function normalizePrice(rawPrice) {
      if (typeof rawPrice === 'number') return rawPrice;
      if (typeof rawPrice === 'string') {
        const match = rawPrice.replace(/[^0-9,\.]/g, '').replace(',', '.');
        const parsed = Number.parseFloat(match);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    }
  });

  return products.filter((product) => product.title && product.productUrl && product.imageUrl);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'fr-CA' });
  const page = await context.newPage();

  const clearanceUrl = args.url.includes(args.store) ? args.url : `${args.url.replace(/\/?$/, '')}/${args.store}`;
  await page.goto(clearanceUrl, { waitUntil: 'networkidle' });
  for (let i = 0; i < 5; i += 1) {
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });
    await page.waitForTimeout(500);
  }
  await page.waitForLoadState('networkidle');

  let products = [];

  try {
    const productCardSelector = 'article[data-automation="product"], [data-automation="product-grid"] article';
    const cards = page.locator(productCardSelector);

    await cards.first().waitFor({ state: 'visible', timeout: 15000 });

    const rawProducts = await collectProducts(cards);
    products = uniqueByUrl(rawProducts.filter((product) => product?.title));
  } catch (error) {
    console.warn('No visible Walmart product cards found or timeout reached, returning empty products list.');
  }

  if (products.length === 0) {
    console.warn('No products found, saving debug artifacts...');
    const outputDir = 'outputs/walmart';

    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      await page.screenshot({ path: `${outputDir}/debug.png`, fullPage: true });
      const html = await page.content();
      fs.writeFileSync(`${outputDir}/debug.html`, html, 'utf-8');
    } catch (debugError) {
      console.error('Failed to save debug artifacts:', debugError);
    }
  }

  const result = { store: args.store, url: clearanceUrl, categories: args.categories, count: products.length, products };

  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}

async function run() {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error('Failed to scrape Walmart clearance page:', error);
    process.exit(1);
  }
}

run();
