import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL =
  "https://www.bureauengros.com/collections/fr-centre-de-liquidation-7922" +
  "?configure%5Bfilters%5D=tags%3A%22fr_CA%22" +
  "&configure%5BruleContexts%5D%5B0%5D=logged-out" +
  "&refinementList%5Bnamed_tags.clearance_sku%5D%5B0%5D=1" +
  "&sortBy=shopify_products";

// Source store: Saint-Jérôme
const STORE_PAGE_URL =
  process.env.BUREAUENGROS_STORE_URL ||
  "https://www.bureauengros.com/stores/qc/saint-jerome/19/";
const STORE_NAME = process.env.BUREAUENGROS_STORE_NAME || "Saint-Jérôme";

const DEFAULT_MAX_PAGES = 100;

// Load Bureau en Gros branches
const BRANCHES_PATH = path.join("data", "bureauengros", "branches.json");
const branches = JSON.parse(fs.readFileSync(BRANCHES_PATH, "utf-8"));

function getMaxPages() {
  const arg = process.argv.find((a) => a.startsWith("--maxPages="));
  if (!arg) return DEFAULT_MAX_PAGES;

  const value = parseInt(arg.split("=")[1], 10);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_PAGES;
  }
  return value;
}

const maxPages = getMaxPages();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function humanDelay(min = 120, max = 450) {
  return randomInt(min, max);
}

async function humanMove(page) {
  const viewport = page.viewportSize() || { width: 1280, height: 720 };
  const moves = randomInt(3, 7);

  for (let i = 0; i < moves; i++) {
    const x = randomInt(Math.floor(viewport.width * 0.05), Math.floor(viewport.width * 0.95));
    const y = randomInt(Math.floor(viewport.height * 0.05), Math.floor(viewport.height * 0.95));

    await page.mouse.move(x, y, { steps: randomInt(10, 25) });
    await page.waitForTimeout(humanDelay());
  }
}

async function gradualScroll(page) {
  const segments = randomInt(6, 10);

  for (let i = 0; i < segments; i++) {
    await page.mouse.wheel(0, randomInt(300, 900));
    await page.waitForTimeout(humanDelay(350, 900));
    await humanMove(page);
  }
}

function chooseUserAgent() {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
  ];

  return userAgents[randomInt(0, userAgents.length - 1)];
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

function parsePrice(raw) {
  if (!raw) return null;
  const clean = raw
    .replace(/[^\d.,]/g, "")
    .replace(",", ".");
  const num = parseFloat(clean);
  return Number.isNaN(num) ? null : num;
}

function computeDiscountPercent(currentPrice, originalPrice) {
  if (
    typeof currentPrice !== "number" ||
    typeof originalPrice !== "number" ||
    !isFinite(currentPrice) ||
    !isFinite(originalPrice) ||
    originalPrice <= 0
  ) {
    return null;
  }

  const raw = ((originalPrice - currentPrice) / originalPrice) * 100;
  return Math.round(raw);
}

async function extractProduct(card) {
  const title = await card
    .$eval("a.product-thumbnail__title.product-link", (el) => el.textContent.trim())
    .catch(() => null);

  const productUrl = await card
    .$eval("a.product-thumbnail__title.product-link", (el) => el.href)
    .catch(() => null);

  const imageUrl = await card
    .$eval("img.product-thumbnail__image", (el) => el.src)
    .catch(() => null);

  const currentPriceRaw = await card
    .$eval(
      "span.money.pre-money, .price__current, .price--highlight",
      (el) => el.textContent,
    )
    .catch(() => null);
  const currentPrice = parsePrice(currentPriceRaw);

  const originalPriceRaw = await card
    .$eval(
      "div.product-thumbnail__price div.top-product.fr strike, .price__regular, .price--compare",
      (el) => el.textContent,
    )
    .catch(() => null);
  const originalPrice = parsePrice(originalPriceRaw);

  if (!title || !productUrl) {
    return null;
  }

  const discountPercent = computeDiscountPercent(currentPrice, originalPrice);

  return {
    title,
    productUrl,
    currentPrice,
    originalPrice,
    discountPercent,
    imageUrl,
  };
}

// Slugify identical to the frontend
function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function branchToStore(branch) {
  const slug = `${branch.id}-${slugify(branch.name)}`;
  return {
    id: branch.id,
    slug,
    name: branch.name,
    address: branch.address ?? "",
  };
}

const BUREAU_EN_GROS_STORES = branches.map(branchToStore);

function writeStoreDeals(store, products, sourceStoreName) {
  const outDir = path.join("outputs", "bureauengros", store.slug);
  fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, "data.json");
  const payload = {
    storeId: store.id,
    storeName: store.name,
    sourceStore: sourceStoreName,
    url: BASE_URL,
    scrapedAt: new Date().toISOString(),
    count: products.length,
    products,
  };

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf-8");
}

// Scrape Saint-Jérôme ONCE
async function scrapeSaintJeromeDeals() {
  const proxy = buildProxySettings();
  const isHeadful = process.env.HEADLESS === "false";
  console.log("Playwright mode:", isHeadful ? "headful" : "headless");
  console.log("Starting Bureau en Gros clearance scraping from Saint-Jérôme...");

  const browser = await chromium.launch({ headless: isHeadful ? false : true, proxy });

  const context = await browser.newContext({
    userAgent: chooseUserAgent(),
    viewport: { width: randomInt(1280, 1440), height: randomInt(720, 900) },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);

  if (STORE_PAGE_URL) {
    console.log(`Setting preferred store to ${STORE_NAME} via ${STORE_PAGE_URL}`);
    await page
      .goto(STORE_PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
      .catch(() => null);
    await page.waitForTimeout(humanDelay(500, 1200));
    await humanMove(page);
  }

  await page.waitForTimeout(humanDelay(400, 900));
  await humanMove(page);
  page.setDefaultTimeout(90000);

  const PRODUCT_CARD_SELECTOR = "div.product-thumbnail";
  const allProducts = [];
  let pagesScraped = 0;
  let lastFirstProductKey = null;

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const url = `${BASE_URL}&page=${pageNum}`;
    console.log(`Navigating to page ${pageNum}: ${url}`);

    await page.goto(url, {
      // "networkidle" is too strict for Bureau en Gros, it often never becomes idle
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });

    await page.waitForSelector("body", { state: "attached", timeout: 45000 });
    await gradualScroll(page);

    await page.waitForSelector("img", { state: "attached", timeout: 45000 }).catch(() => null);

    await page.waitForSelector(PRODUCT_CARD_SELECTOR, { timeout: 60000 }).catch(() => null);
    const cards = await page.$$(PRODUCT_CARD_SELECTOR);
    console.log(`Page ${pageNum}: found ${cards.length} product cards`);

    if (!cards.length) {
      console.log("No more products, stopping pagination.");
      break;
    }

    const firstKey = await cards[0].innerText();
    if (lastFirstProductKey && firstKey === lastFirstProductKey) {
      console.log(`Same content as previous page detected at page ${pageNum}, stopping.`);
      break;
    }
    lastFirstProductKey = firstKey;
    pagesScraped = pageNum;

    for (const card of cards) {
      const product = await extractProduct(card);
      if (!product) continue;

      // On garde tous les produits valides (la page est déjà filtrée sur les liquidations)
      allProducts.push(product);

      await page.waitForTimeout(humanDelay(100, 300));
    }
  }

  await browser.close();

  console.log(
    `✅ Bureau en Gros – scraped ${allProducts.length} clearance products across ${pagesScraped} page(s) from Saint-Jérôme.`,
  );

  return allProducts;
}

async function main() {
  try {
    const products = await scrapeSaintJeromeDeals();

    console.log(
      `Replicating ${products.length} clearance products to all ${BUREAU_EN_GROS_STORES.length} Bureau en Gros stores...`,
    );

    for (const store of BUREAU_EN_GROS_STORES) {
      writeStoreDeals(store, products, STORE_NAME);
    }

    console.log("✅ Finished generating Bureau en Gros deals for all stores from Saint-Jérôme source.");
    process.exit(0);
  } catch (err) {
    console.error("Failed to scrape Bureau en Gros clearance:", err);
    process.exit(1);
  }
}

main();
