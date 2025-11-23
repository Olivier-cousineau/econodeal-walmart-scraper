import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const clearanceUrl =
  "https://www.bureauengros.com/collections/fr-centre-de-liquidation-7922?configure%5Bfilters%5D=tags%3A%22fr_CA%22&configure%5BruleContexts%5D%5B0%5D=logged-out&page=1&refinementList%5Bnamed_tags.clearance_sku%5D%5B0%5D=1&sortBy=shopify_products";

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

  return `https://www.bureauengros.com${href.startsWith("/") ? href : `/${href}`}`;
}

async function extractText(root, selectorList) {
  try {
    if (!root) return null;
    const selectors = Array.isArray(selectorList) ? selectorList : [selectorList];

    for (const selector of selectors) {
      const el = await root.$(selector);
      if (!el) continue;
      const text = await el.innerText();
      if (text && text.trim()) return text.trim();
    }

    return null;
  } catch (err) {
    console.error(`Failed to extract text for selector "${selectorList}":`, err);
    return null;
  }
}

function parsePrice(raw) {
  if (!raw) return null;
  const clean = raw
    .replace(/\s/g, "")
    .replace("$", "")
    .replace(",", ".");
  const num = parseFloat(clean);
  return Number.isNaN(num) ? null : num;
}

async function extractAttribute(locator, selectorList, attribute) {
  for (const selector of selectorList) {
    const value = await locator.locator(selector).first().getAttribute(attribute).catch(() => null);
    if (value) return value;
  }
  return null;
}

async function main() {
  const proxy = buildProxySettings();
  const isHeadful = process.env.HEADLESS === "false";
  console.log("Playwright mode:", isHeadful ? "headful" : "headless");

  const browser = await chromium.launch({ headless: isHeadful ? false : true, proxy });

  const context = await browser.newContext({
    userAgent: chooseUserAgent(),
    viewport: { width: randomInt(1280, 1440), height: randomInt(720, 900) },
  });
  const page = await context.newPage();

  await page.waitForTimeout(humanDelay(400, 900));
  await humanMove(page);
  console.log(`Navigating to ${clearanceUrl}...`);
  await page.goto(clearanceUrl, {
    waitUntil: "domcontentloaded", // or "load"
    timeout: 60000,
  });
  page.setDefaultTimeout(60000);

  await page.waitForSelector("body", { state: "attached", timeout: 45000 });
  await gradualScroll(page);

  await page.waitForSelector("img", { state: "attached", timeout: 45000 }).catch(() => null);

  const PRODUCT_CARD_SELECTOR = "div.product-thumbnail__header";
  await page.waitForSelector(PRODUCT_CARD_SELECTOR, { timeout: 60000 });
  const cards = await page.$$(PRODUCT_CARD_SELECTOR);
  console.log(`DEBUG: found ${cards.length} product cards`);

  if (cards.length === 0) {
    const html = await page.content();
    fs.writeFileSync("bureauengros_debug.html", html);
    console.error("No product cards found, wrote bureauengros_debug.html");
  }

  const products = [];

  for (const card of cards) {
    const title = await extractText(
      card,
      "a.product-thumbnail__title.product-link",
    );

    let productUrl = "";
    try {
      const href = await card.$eval(
        "a.product-thumbnail__title.product-link",
        (el) => el.getAttribute("href"),
      );
      if (href) {
        productUrl = new URL(href, "https://www.bureauengros.com").toString();
      }
    } catch {}

    const currentPriceText = await extractText(
      card,
      "span.money.pre-money",
    );

    const originalPriceText = await extractText(
      card,
      "div.product-thumbnail__price div.top-product.fr strike",
    );

    const currentPrice = parsePrice(currentPriceText);
    const originalPrice = parsePrice(originalPriceText);

    const imgSrc = await card
      .$eval("img.product-thumbnail__image", (el) => el.src)
      .catch(() => null);
    const imageUrl = imgSrc ? buildAbsoluteUrl(imgSrc) : "";

    const cardText = (await card.innerText().catch(() => "")) || "";
    const badge = /liquidation|clearance/i.test(cardText);

    products.push({
      title,
      productUrl,
      currentPrice,
      originalPrice,
      imageUrl,
      badge,
    });

    await page.waitForTimeout(humanDelay(100, 300));
  }

  const result = {
    store: "Bureau en Gros - Centre de liquidation",
    url: clearanceUrl,
    scrapedAt: new Date().toISOString(),
    count: products.length,
    products,
  };

  const outDir = path.join("outputs", "bureauengros", "clearance");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "data.json");
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf-8");

  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to scrape Bureau en Gros clearance:", err);
    process.exit(1);
  });
