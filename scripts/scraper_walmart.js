import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const DEFAULT_CLEARANCE_URL = "https://www.walmart.ca/fr/browse/electronics/10003?facet=special_offers%3ALiquidation&icid=cp_page_other_electronic_carousal_web_50803_4QMWQHY292";
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

function mapProductFromApi(rawProduct) {
  if (!rawProduct || typeof rawProduct !== 'object') return null;

  const title = rawProduct?.name || rawProduct?.displayName || rawProduct?.title || rawProduct?.productName;
  const currentPrice =
    normalizePrice(rawProduct?.price?.price) ??
    normalizePrice(rawProduct?.price?.current) ??
    normalizePrice(rawProduct?.price) ??
    normalizePrice(rawProduct?.currentPrice) ??
    normalizePrice(rawProduct?.primaryOffer?.offerPrice) ??
    normalizePrice(rawProduct?.priceInfo?.currentPrice?.price) ??
    normalizePrice(rawProduct?.priceInfo?.currentPrice);

  const originalPrice =
    normalizePrice(rawProduct?.price?.listPrice) ??
    normalizePrice(rawProduct?.price?.wasPrice) ??
    normalizePrice(rawProduct?.wasPrice) ??
    normalizePrice(rawProduct?.originalPrice) ??
    normalizePrice(rawProduct?.priceInfo?.wasPrice?.price) ??
    normalizePrice(rawProduct?.priceInfo?.wasPrice);

  const urlPath =
    rawProduct?.productPageUrl ||
    rawProduct?.canonicalUrl ||
    rawProduct?.canonicalUrlV2 ||
    rawProduct?.canonicalUrlV3 ||
    rawProduct?.productUrl;
  const productUrl = urlPath ? (urlPath.startsWith('http') ? urlPath : `https://www.walmart.ca${urlPath}`) : null;

  const imageUrlCandidate =
    rawProduct?.image ||
    rawProduct?.imageUrl ||
    rawProduct?.imageInfo?.thumbnailUrl ||
    rawProduct?.images?.[0]?.url ||
    rawProduct?.imageUrls?.[0];
  const imageUrl = imageUrlCandidate
    ? imageUrlCandidate.startsWith('http')
      ? imageUrlCandidate
      : `https:${imageUrlCandidate}`
    : null;

  if (!title || !productUrl) return null;

  return {
    title,
    currentPrice,
    originalPrice,
    productUrl,
    imageUrl,
    category: rawProduct?.category?.name || rawProduct?.categoryName,
    breadcrumb: rawProduct?.breadcrumb?.join(' > '),
  };
}

function extractProductsFromApi(data) {
  const products = [];

  pullFromState(data).forEach((product) => {
    const mapped = mapProductFromApi({ ...product, productUrl: product.url ?? product.productUrl });
    if (mapped) products.push(mapped);
  });

  const candidateArrays = [];
  const addArray = (arr) => {
    if (Array.isArray(arr)) candidateArrays.push(arr);
  };

  addArray(data?.items);
  addArray(data?.products);
  addArray(data?.results);
  addArray(data?.searchResults);
  addArray(data?.data?.items);
  addArray(data?.data?.products);
  addArray(data?.data?.results);
  addArray(data?.payload?.items);
  addArray(data?.payload?.products);
  addArray(data?.payload?.searchResult?.products);
  addArray(data?.payload?.searchResult?.items);

  candidateArrays.forEach((arr) => {
    arr.forEach((rawProduct) => {
      const mapped = mapProductFromApi(rawProduct);
      if (mapped) products.push(mapped);
    });
  });

  return uniqueByUrl(products.filter((product) => product?.title && product?.productUrl));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'fr-CA' });
  const page = await context.newPage();

  const jsonResponses = [];

  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (!url.includes('walmart.ca')) return;

      const status = response.status();
      const bodyText = await response.text();

      jsonResponses.push({
        url,
        status,
        body: bodyText,
      });
    } catch (e) {
      // ignore errors in debug listener
    }
  });

  const clearanceUrl = "https://www.walmart.ca/fr/browse/electronics/10003?facet=special_offers%3ALiquidation&icid=cp_page_other_electronic_carousal_web_50803_4QMWQHY292";
  console.log("DEBUG Walmart URL:", clearanceUrl);
  await page.goto(clearanceUrl, { waitUntil: 'networkidle' });

  const outDir = path.join('outputs', 'walmart', 'json-responses');
  fs.mkdirSync(outDir, { recursive: true });

  jsonResponses.forEach((entry, index) => {
    const safeIndex = String(index + 1).padStart(3, '0');
    const filePath = path.join(outDir, `response-${safeIndex}.txt`);
    const content = [
      `URL: ${entry.url}`,
      `STATUS: ${entry.status}`,
      '',
      entry.body,
    ].join('\n');
    fs.writeFileSync(filePath, content, 'utf-8');
  });

  console.log(`Saved ${jsonResponses.length} Walmart responses to ${outDir}`);

  const products = [];

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
