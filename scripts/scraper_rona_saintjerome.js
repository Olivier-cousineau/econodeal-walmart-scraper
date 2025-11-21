import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const liquidationUrl = "https://www.rona.ca/fr/promotions/liquidation";

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
  await page.goto(liquidationUrl, { waitUntil: "domcontentloaded" });

  await page.waitForSelector("div.product-tile", { state: "attached", timeout: 30000 });
  await gradualScroll(page);

  await page.waitForSelector("div.product-tile a", { state: "visible", timeout: 30000 });

  const cardsLocator = page.locator("div.product-tile");

  await cardsLocator
    .first()
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(() => null);

  const products = [];
  const count = await cardsLocator.count();

  for (let i = 0; i < count; i++) {
    const card = cardsLocator.nth(i);

    const title = (await card.locator("a").first().innerText().catch(() => ""))?.trim() || "";

    const href = await card.locator("a").first().getAttribute("href").catch(() => null);
    const productUrl = href ? (href.startsWith("http") ? href : "https://www.rona.ca" + href) : "";

    const currentPrice =
      (await card
        .locator(
          ".product-price__price, .product-price__value, .product-tile__price, .product-tile__price-current"
        )
        .first()
        .innerText()
        .catch(() => ""))
        ?.trim() || "";

    const originalPriceRaw =
      (await card
        .locator(
          ".product-price__was, .product-price__compare, .product-tile__price-original, .product-price__price--old"
        )
        .first()
        .innerText()
        .catch(() => null)) || null;
    const originalPrice = originalPriceRaw ? originalPriceRaw.trim() : null;

    const imgSrc = await card.locator("img").first().getAttribute("src").catch(() => null);
    const imageUrl = imgSrc ? (imgSrc.startsWith("http") ? imgSrc : "https://www.rona.ca" + imgSrc) : "";

    const cardText = (await card.innerText().catch(() => "")) || "";
    const badge = /\bLIQUIDATION\b/i.test(cardText);

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
    store: "RONA Saint-Jérôme",
    url: liquidationUrl,
    count: products.length,
    products,
  };

  const outDir = path.join("outputs", "rona", "saint-jerome");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "data.json");
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf-8");

  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to scrape RONA Saint-Jérôme liquidation:", err);
    process.exit(1);
  });
