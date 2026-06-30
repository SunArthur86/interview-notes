const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const browserPath = '/opt/data/pw-browsers/chromium-1217/chrome-linux/chrome';
const outputDir = '/tmp/xhs-images';

async function downloadImages() {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const posts = [
    { note_id: '6a4312310000000008002661', label: 'tt-agent', expected: 8 },
    { note_id: '6a424250000000001101eb0d', label: 'java-1mian', expected: 3 },
    { note_id: '6a28ff15000000002003b5f4', label: 'agent-3skill', expected: 1 },
  ];

  for (const post of posts) {
    const html = fs.readFileSync(`/tmp/xhs-post-${post.note_id}.html`, 'utf-8');
    const tokenMatch = html.match(/xsec_token=([^&"']+)/);
    const token = tokenMatch ? tokenMatch[1] : '';
    
    // Get unique image URLs
    const allUrls = html.match(/https?:\/\/sns-webpic-qc\.xhscdn\.com[^"'\s\\]+/g) || [];
    const dedupMap = new Map();
    for (const u of allUrls) {
      const fileMatch = u.match(/1040g[a-z0-9]+/i);
      const fileId = fileMatch ? fileMatch[0] : u;
      if (!dedupMap.has(fileId)) {
        dedupMap.set(fileId, u);
      }
    }
    const uniqueUrls = [...dedupMap.values()];
    
    console.log(`\n${post.label}: ${uniqueUrls.length} unique URLs`);

    const fetchUrl = `https://www.xiaohongshu.com/explore/${post.note_id}?xsec_token=${token}&xsec_source=app_share`;

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Capture all image responses via response event
    const imageResponses = [];
    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('xhscdn.com') && url.includes('1040g')) {
        const ct = resp.headers()['content-type'] || '';
        if (ct.includes('image') || url.includes('png') || url.includes('webp')) {
          try {
            const body = await resp.body();
            if (body.length > 5000) {
              imageResponses.push({ url, body, size: body.length });
            }
          } catch(e) {}
        }
      }
    });

    // Navigate to the note page and scroll to trigger image loading
    await page.goto(fetchUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Scroll down to load all images (lazy loading)
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(1000);
    }

    // Also try clicking through images in the carousel if present
    const nextBtn = await page.$('.swiper-button-next, .close-circle + div, [class*="next"]');
    for (let i = 0; i < 8 && nextBtn; i++) {
      try {
        await nextBtn.click({ timeout: 2000 });
        await page.waitForTimeout(1500);
      } catch(e) { break; }
    }

    await page.waitForTimeout(2000);

    // Dedup captured images by fileId
    const seenIds = new Set();
    let saved = 0;
    imageResponses.sort((a, b) => b.size - a.size);
    for (const img of imageResponses) {
      const fileMatch = img.url.match(/1040g[a-z0-9]+/i);
      const fileId = fileMatch ? fileMatch[0] : img.url;
      if (seenIds.has(fileId)) continue;
      seenIds.add(fileId);

      const ext = 'webp';
      const fname = `${post.label}-${saved}.${ext}`;
      fs.writeFileSync(path.join(outputDir, fname), img.body);
      console.log(`  Saved: ${fname} (${img.size} bytes)`);
      saved++;
    }

    if (saved < post.expected) {
      // Fallback: try navigating directly to each image URL
      console.log(`  Only got ${saved}/${post.expected}, trying direct navigation...`);
      for (let i = 0; i < uniqueUrls.length; i++) {
        const imgUrl = uniqueUrls[i].replace(/\\u002F/g, '/');
        const fileMatch = imgUrl.match(/1040g[a-z0-9]+/i);
        const fileId = fileMatch ? fileMatch[0] : imgUrl;
        if (seenIds.has(fileId)) continue;

        try {
          const resp = await page.goto(imgUrl, { timeout: 10000, waitUntil: 'load' });
          if (resp && resp.ok()) {
            const body = await resp.body();
            if (body.length > 5000) {
              const fname = `${post.label}-${saved}.webp`;
              fs.writeFileSync(path.join(outputDir, fname), body);
              console.log(`  Saved (direct): ${fname} (${body.length} bytes)`);
              seenIds.add(fileId);
              saved++;
            }
          }
        } catch(e) {
          console.log(`  Direct nav failed [${i}]: ${e.message.substring(0, 50)}`);
        }
      }
    }

    await context.close();
    console.log(`  Total: ${saved} images for ${post.label}`);
  }

  await browser.close();
  console.log('\nDone!');
}

downloadImages().catch(console.error);
