const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const http = require("http");

const app = express();
app.use(cors());

app.get("/scrape", async (req, res) => {
  const searchKeyword = req.query.keyword || "AI";
  const maxAdsToScrape = parseInt(req.query.limit) || 15;
  const adsScroll = parseInt(req.query.adsScroll) || 10;
  try {
    const results = await scrapeLinkedInAds(
      searchKeyword,
      maxAdsToScrape,
      adsScroll
    );
    res.json({ success: true, count: results.length, results });
  } catch (error) {
    console.error("❌ Scrape failed:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function scrapeLinkedInAds(searchKeyword, maxAdsToScrape, adsScroll) {
  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: null,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();

  await page.goto("https://www.linkedin.com/ad-library", {
    waitUntil: "networkidle2",
  });

  await page.waitForSelector('input[placeholder="Search by keyword"]');
  await page.type('input[placeholder="Search by keyword"]', searchKeyword);
  await Promise.all([
    page.keyboard.press("Enter"),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
  ]);
  await page.waitForSelector(".base-ad-preview-card", { timeout: 30000 });

  for (let i = 0; i < adsScroll; i++) {
    const previousHeight = await page.evaluate("document.body.scrollHeight");
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const newHeight = await page.evaluate("document.body.scrollHeight");
    if (newHeight === previousHeight) break;
  }

  const adLinks = await page.$$eval(
    '.base-ad-preview-card a[href*="/ad-library/detail/"]',
    (links) => [
      ...new Set(
        links.map(
          (link) =>
            "https://www.linkedin.com" + link.getAttribute("href").split("?")[0]
        )
      ),
    ]
  );

  const adDetails = [];
  for (const link of adLinks.slice(0, maxAdsToScrape)) {
    const detail = await scrapeAdDetailPage(browser, link);
    adDetails.push({ ...detail, sourceLink: link });
    console.log(`✅ Scraped: ${detail.headline || detail.adCopy}`);
  }

  await browser.close();

  return adDetails;
}

async function scrapeAdDetailPage(browser, adUrl) {
  const page = await browser.newPage();
  await page.goto(adUrl, { waitUntil: "domcontentloaded" });

  try {
    try {
      await page.waitForSelector(".base-ad-preview-card", { timeout: 10000 });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const ad = await page.evaluate(() => {
      const getText = (sel) =>
        document.querySelector(sel)?.innerText?.trim() || "";
      const getAttr = (sel, attr) =>
        document.querySelector(sel)?.getAttribute(attr) || "";

      const imageUrl =
        getAttr("img.ad-preview__dynamic-dimensions-image", "src") ||
        getAttr("img.object-cover", "src") ||
        "";

      let videoUrl = "";
      const videoEl = document.querySelector("video[data-sources]");
      if (videoEl) {
        try {
          const sources = JSON.parse(videoEl.getAttribute("data-sources"));
          sources.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          videoUrl = sources[0]?.src || "";
        } catch (e) {
          console.warn("Failed to parse video sources");
        }
      }

      const carouselItems = Array.from(
        document.querySelectorAll(
          ".slide-list__list img.ad-preview__dynamic-dimensions-image"
        )
      ).map((img) => img.src);

      let ctaLink =
        getAttr(
          'a[data-tracking-control-name="ad_library_ad_preview_headline_content"]',
          "href"
        ) ||
        getAttr(
          'a[data-tracking-control-name="ad_library_ad_preview_content_image"]',
          "href"
        ) ||
        "";

      return {
        advertiserName: getText('a[aria-label^="View organization page"]'),
        advertiserLogo: getAttr(
          'a[aria-label^="View organization page"] img',
          "src"
        ),
        promotedTag: getText(".text-xs.text-color-text-secondary"),
        adCopy: getText(".commentary__content"),
        imageUrl,
        videoUrl,
        headline: getText(".sponsored-content-headline h2"),
        ctaText: getText(
          'button[data-tracking-control-name="ad_library_ad_detail_cta"]'
        ),
        ctaLink,
        mediaAsset: videoUrl || imageUrl || carouselItems[0] || "",
        mediaAssetCarousel: carouselItems,
      };
    });

    await page.close();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return ad;
  } catch (e) {
    const body = await page.content();
    console.error(`❌ Failed to scrape ${adUrl}`);
    console.error(`⛔ Error: ${e.message}`);
    console.error("📄 Partial HTML snapshot:", body.slice(0, 1000));
    return {};
  }
}

const PORT = process.env.PORT || 3000;
// 👇 Manually create and configure server timeout
const server = http.createServer(app);
server.setTimeout(5 * 60 * 1000); // 5 minutes

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
