import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const liquidationUrl = "https://www.rona.ca/fr/promotions/liquidation";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(liquidationUrl, { waitUntil: "domcontentloaded" });

  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1000);
  }

  const cardsLocator = page.locator("div.product-tile");

  await cardsLocator
    .first()
    .waitFor({ state: "visible", timeout: 20000 })
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
