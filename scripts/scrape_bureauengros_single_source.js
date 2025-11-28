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
    .catch
