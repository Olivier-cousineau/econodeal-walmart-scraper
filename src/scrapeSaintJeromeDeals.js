import { chromium } from 'playwright';

const CLEARANCE_BASE_URL =
  'https://www.bureauengros.com/collections/fr-centre-de-liquidation-7922' +
  '?configure%5Bfilters%5D=tags%3A%22fr_CA%22' +
  '&configure%5BruleContexts%5D%5B0%5D=logged-out' +
  '&refinementList%5Bnamed_tags.clearance_sku%5D%5B0%5D=1' +
  '&sortBy=shopify_products';

const SAINT_JEROME_STORE_URL =
  process.env.BUREAUENGROS_STORE_URL || 'https://www.bureauengros.com/stores/qc/saint-jerome/19/';

const PRODUCT_CARD_SELECTOR = 'div.product-thumbnail';

function parsePrice(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(',', '.');
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function extractSkuFromUrl(url) {
  if (!url) return null;
  const match = url.match(/products\/([^/?#]+)/i);
  return match ? match[1] : null;
}

async function extractProduct(card) {
  const name = await card
    .$eval('a.product-thumbnail__title.product-link', (el) => el.textContent.trim())
    .catch(() => null);

  const productUrl = await card
    .$eval('a.product-thumbnail__title.product-link', (el) => el.href)
    .catch(() => null);

  const imageUrl = await card
    .$eval('img.product-thumbnail__image', (el) => el.src)
    .catch(() => null);

  const salePriceText = await card
    .$eval('span.money.pre-money, .price__current, .price--highlight', (el) => el.textContent)
    .catch(() => null);
  const regularPriceText = await card
    .$eval('div.product-thumbnail__price div.top-product.fr strike, .price__regular, .price--compare', (el) => el.textContent)
    .catch(() => null);

  if (!name || !productUrl) {
    return null;
  }

  const salePrice = parsePrice(salePriceText);
  const regularPrice = parsePrice(regularPriceText);

  return {
    name,
    sku: extractSkuFromUrl(productUrl),
    regularPrice,
    salePrice,
    imageUrl: imageUrl || '',
    productUrl,
    availability: 'In stock',
  };
}

function buildProxySettings() {
  const proxyServer =
    process.env.PROXY_URL || process.env.RESIDENTIAL_PROXY || process.env.MOBILE_PROXY || null;

  if (!proxyServer) return undefined;

  return {
    server: proxyServer,
    username: process.env.PROXY_USERNAME,
    password: process.env.PROXY_PASSWORD,
  };
}

export async function scrapeSaintJeromeDeals() {
  const proxy = buildProxySettings();
  const headless = process.env.HEADLESS !== 'false';
  const browser = await chromium.launch({ headless, proxy });
  const context = await browser.newContext();
  const page = await context.newPage();

  if (SAINT_JEROME_STORE_URL) {
    await page.goto(SAINT_JEROME_STORE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(1000);
  }

  const products = [];
  const DEFAULT_MAX_PAGES = 40;

  for (let pageNum = 1; pageNum <= DEFAULT_MAX_PAGES; pageNum++) {
    const pageUrl = `${CLEARANCE_BASE_URL}&page=${pageNum}`;
    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector(PRODUCT_CARD_SELECTOR, { timeout: 30000 }).catch(() => null);

    const cards = await page.$$(PRODUCT_CARD_SELECTOR);
    if (!cards.length) {
      break;
    }

    for (const card of cards) {
      const product = await extractProduct(card);
      if (product) {
        products.push(product);
      }
    }
  }

  await browser.close();
  return products;
}
