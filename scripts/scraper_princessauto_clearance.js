import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = "https://www.princessauto.com/en/clearance";
const DEFAULT_MAX_PAGES = 12;

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
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
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

function buildAbsoluteUrl(href) {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("//")) return `https:${href}`;
  return `https://www.princessauto.com${href.startsWith("/") ? href : `/${href}`}`;
}

function parsePrice(raw) {
  if (!raw) return null;
  const clean = raw
    .replace(/[^0-9.,-]/g, "")
    .replace(",", ".")
    .trim();
  const num = parseFloat(clean);
  return Number.isNaN(num) ? null : num;
}

function computeDiscountPercent(currentPrice, originalPrice) {
  if (
    typeof currentPrice !== "number" ||
    typeof originalPrice !== "number" ||
    currentPrice <= 0 ||
    originalPrice <= 0 ||
    currentPrice >= originalPrice
  ) {
    return null;
  }

  return Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
}

function getMaxPages() {
  const arg = process.argv.find((value) => value.startsWith("--maxPages="));
  if (!arg) return DEFAULT_MAX_PAGES;

  const parsed = parseInt(arg.split("=")[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_PAGES;

  return parsed;
}

async function extractProduct(card) {
  const title =
    (await card
      .locator(
        "[data-testid=product-name], .product-tile__name, .product-title, h3, h2, .product-name"
      )
      .first()
      .innerText()
      .catch(() => ""))
      ?.trim() || "";

  const href = await card.locator("a").first().getAttribute("href").catch(() => null);
  const productUrl = buildAbsoluteUrl(href || "");

  const salePriceText =
    (await card
      .locator(
        "[data-testid=sale-price], .price--sale, .price__sales, .price__current, .price--highlight"
      )
      .first()
      .innerText()
      .catch(() => "")) || "";

  const originalPriceText =
    (await card
      .locator(
        "[data-testid=original-price], .price--original, .price__regular, .price--compare, .price__was"
      )
      .first()
      .innerText()
      .catch(() => "")) || "";

  const imageUrlRaw = await card.locator("img").first().getAttribute("src").catch(() => "");
  const imageUrl = buildAbsoluteUrl(imageUrlRaw || "");

  const currentPrice = parsePrice(salePriceText);
  const originalPrice = parsePrice(originalPriceText);
  const discountPercent = computeDiscountPercent(currentPrice, originalPrice);

  const badgeText = (await card.innerText().catch(() => "")).toLowerCase();
  const isClearance = /clearance|liquidation/.test(badgeText);

  if (!title || !productUrl) return null;

  return {
    title,
    productUrl,
    currentPrice,
    originalPrice,
    discountPercent,
    imageUrl,
    badge: isClearance,
  };
}

async function scrapePage(page, pageIndex) {
  const targetUrl = `${BASE_URL}${pageIndex > 1 ? `?page=${pageIndex}` : ""}`;
  console.log(`Navigating to page ${pageIndex}: ${targetUrl}`);

  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("body", { state: "attached", timeout: 45000 });
  await gradualScroll(page);

  const cardSelector = [
    "[data-testid=product-tile]",
    ".product-grid__item",
    "li.product-grid__item",
    ".product-tile",
    "li.product-item",
  ].join(", ");

  await page.waitForSelector(cardSelector, { timeout: 60000 }).catch(() => null);
  const cards = await page.$$(cardSelector);
  console.log(`Page ${pageIndex}: found ${cards.length} product cards`);

  const products = [];

  for (const card of cards) {
    const product = await extractProduct(card);
    if (!product) continue;
    if (typeof product.discountPercent === "number" && product.discountPercent > 50) {
      products.push(product);
    }
    await page.waitForTimeout(humanDelay(100, 300));
  }

  return products;
}

async function goToNextPage(page) {
  const nextSelector = "a[aria-label=Next], a[rel=next], button[aria-label=Next]";
  const nextButton = await page.$(nextSelector);
  if (!nextButton) return false;

  const disabled = await nextButton.getAttribute("disabled");
  if (disabled !== null) return false;

  await nextButton.scrollIntoViewIfNeeded().catch(() => null);
  await nextButton.click({ delay: humanDelay(80, 180) }).catch(() => null);
  await page.waitForTimeout(humanDelay(500, 900));
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => null);
  return true;
}

async function main() {
  const maxPages = getMaxPages();
  const proxy = buildProxySettings();
  const isHeadful = process.env.HEADLESS === "false";
  console.log("Playwright mode:", isHeadful ? "headful" : "headless");
  console.log(`Princess Auto clearance scraping (max ${maxPages} page(s))...`);

  const browser = await chromium.launch({ headless: !isHeadful, proxy });
  const context = await browser.newContext({
    userAgent: chooseUserAgent(),
    viewport: { width: randomInt(1280, 1440), height: randomInt(720, 900) },
  });
  const page = await context.newPage();

  await page.waitForTimeout(humanDelay(400, 900));
  await humanMove(page);

  const collected = [];
  let pagesScraped = 0;

  for (let currentPage = 1; currentPage <= maxPages; currentPage++) {
    const products = await scrapePage(page, currentPage);
    if (!products.length && currentPage > 1) {
      console.log("No products collected, stopping pagination.");
      break;
    }

    collected.push(...products);
    pagesScraped = currentPage;

    const hasNext = await goToNextPage(page);
    if (!hasNext) {
      break;
    }
  }

  const result = {
    store: "Princess Auto Canada",
    url: BASE_URL,
    scrapedAt: new Date().toISOString(),
    count: collected.length,
    products: collected,
  };

  const outDir = path.join("outputs", "princessauto", "clearance");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "data.json");
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf-8");

  console.log(`✅ Princess Auto – kept ${collected.length} liquidation items over 50% off across ${pagesScraped} page(s).`);

  await browser.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to scrape Princess Auto clearance:", err);
    process.exit(1);
  });
