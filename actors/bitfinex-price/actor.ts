import { Actor } from 'apify';
import { CheerioCrawler } from 'crawlee';

interface PriceData {
  timestamp: string;
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  volume24h: number;
  change24h: number;
}

Actor.main(async () => {
  // Initialize Crawlee crawler for HTML parsing
  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: 1,
    async requestHandler({ request, response, $ }) {
      const url = request.url;
      
      // Log the scrape attempt
      console.log(`Scraping ${url}`);

      // Parse Bitfinex ticker page structure
      // NOTE: In real implementation, this would be resilient to page changes
      // This examples uses specific selectors but with fallback logic
      
      let bid = 0;
      let ask = 0;
      let mid = 0;
      let volume24h = 0;
      let change24h = 0;

      // Try multiple selector strategies since Bitfinex uses dynamic rendering
      const possibleSelectors = [
        // Strategy 1: Direct price spans
        { bid: 'span[data-test-id="ticker.lastPrice.bid"]', ask: 'span[data-test-id="ticker.lastPrice.ask"]' },
        // Strategy 2: Fallback to class-based selectors
        { bid: '.ticker-bid', ask: '.ticker-ask' },
        // Strategy 3: Data attributes
        { bid: '[data-price="bid"]', ask: '[data-price="ask"]' },
      ];

      for (const selectors of possibleSelectors) {
        const bidElem = $(selectors.bid).first().text();
        const askElem = $(selectors.ask).first().text();

        if (bidElem && askElem) {
          bid = parseFloat(bidElem.replace(/[^0-9.-]/g, ''));
          ask = parseFloat(askElem.replace(/[^0-9.-]/g, ''));
          if (!isNaN(bid) && !isNaN(ask)) break;
        }
      }

      // If we got bid/ask, calculate mid price
      if (bid > 0 && ask > 0) {
        mid = (bid + ask) / 2;
      }

      // Try to find 24h volume
      const volumeText = $('span:contains("24h Volume")').parent().text() || 
                         $('[data-test-id*="volume"]').text() ||
                         $('.volume-24h').text();
      
      const volumeMatch = volumeText.match(/[\d,]+\.?\d*/);
      if (volumeMatch) {
        volume24h = parseFloat(volumeMatch[0].replace(/,/g, ''));
      }

      // Try to find 24h change
      const changeText = $('span:contains("24h Change")').parent().text() ||
                        $('[data-test-id*="change"]').text();
      
      const changeMatch = changeText.match(/[-+]?\d+\.?\d*%?/);
      if (changeMatch) {
        change24h = parseFloat(changeMatch[0].replace('%', ''));
      }

      // Validate data quality
      if (bid <= 0 || ask <= 0 || bid >= ask) {
        throw new Error(`Invalid price data: bid=${bid}, ask=${ask}`);
      }

      const result: PriceData = {
        timestamp: new Date().toISOString(),
        symbol: 'BTCUSD',
        bid,
        ask,
        mid,
        volume24h,
        change24h,
      };

      console.log('Extracted data:', result);

      // Store result in Apify dataset (automatically handled)
      await Actor.pushData(result);
    },
    errorHandler({ request, error }) {
      console.error(`Request ${request.url} failed: ${error.message}`);
    },
  });

  // Start crawling Bitfinex ticker
  await crawler.run(['https://www.bitfinex.com/']);
});
