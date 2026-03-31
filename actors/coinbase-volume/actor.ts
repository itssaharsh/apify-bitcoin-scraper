import { Actor } from 'apify';
import { CheerioCrawler } from 'crawlee';

interface VolumeData {
    timestamp: string;
    exchange: string;
    volume24h: number;
    priceUsd: number;
    priceChangePercent24h: number;
    high24h: number;
    low24h: number;
}

/**
 * CoinbaseVolumeActor
 * 
 * Scrapes Coinbase's public statistics page for 24h trading volume
 * and price movement. This gives us market breadth - how active the market is.
 * 
 * Why this matters: High volume + price stability = safer fee environment
 * Low volume + volatile prices = use conservative fees
 */
Actor.main(async () => {
    const crawler = new CheerioCrawler({
        maxRequestsPerCrawl: 1,
        async requestHandler({ request, response, $ }) {
            const url = request.url;
            console.log(`Scraping ${url}`);

            // Coinbase uses a data-laden page structure
            // We look for Bitcoin statistics in their tables/cards

            let volume24h = 0;
            let priceUsd = 0;
            let priceChangePercent24h = 0;
            let high24h = 0;
            let low24h = 0;

            // Strategy: Look for common container patterns
            // Coinbase shows stats in various CSS structures depending on layout

            // Try to find price section
            const priceEl = $('[data-testid="price"]').text() ||
                $('[data-test="price-display"]').text() ||
                $('h1').text();

            if (priceEl) {
                const priceMatch = priceEl.match(/\$?([\d,]+\.?\d*)/);
                if (priceMatch) {
                    priceUsd = parseFloat(priceMatch[1].replace(/,/g, ''));
                }
            }

            // Find 24h volume
            const volumeLabels = $('*').toArray().filter(el =>
                $(el).text().includes('24h Volume') ||
                $(el).text().includes('Volume (24h)')
            );

            for (const label of volumeLabels) {
                const parent = $(label).parent().parent();
                const volumeText = parent.text();
                const volumeMatch = volumeText.match(/\$?([\d,]+\.?\d*)/);
                if (volumeMatch) {
                    volume24h = parseFloat(volumeMatch[1].replace(/,/g, ''));
                    if (volume24h > 1000) break; // Reasonable volume threshold
                }
            }

            // Find price change
            const changeEl = $('[data-testid="change-percent"]').text() ||
                $('[data-test="price-change"]').text();

            if (changeEl) {
                const changeMatch = changeEl.match(/([-+]?\d+\.?\d*)/);
                if (changeMatch) {
                    priceChangePercent24h = parseFloat(changeMatch[1]);
                }
            }

            // Find high/low
            const statsText = $('body').text();
            const highMatch = statsText.match(/(?:High|High 24h).*?\$?([\d,]+\.?\d*)/i);
            const lowMatch = statsText.match(/(?:Low|Low 24h).*?\$?([\d,]+\.?\d*)/i);

            if (highMatch) high24h = parseFloat(highMatch[1].replace(/,/g, ''));
            if (lowMatch) low24h = parseFloat(lowMatch[1].replace(/,/g, ''));

            // Validation
            if (priceUsd <= 0 || volume24h <= 0) {
                throw new Error(`Invalid data: price=${priceUsd}, volume=${volume24h}`);
            }

            const result: VolumeData = {
                timestamp: new Date().toISOString(),
                exchange: 'Coinbase',
                volume24h,
                priceUsd,
                priceChangePercent24h,
                high24h: high24h || priceUsd,
                low24h: low24h || priceUsd,
            };

            console.log('Volume data extracted:', result);
            await Actor.pushData(result);
        },
        errorHandler({ request, error }) {
            console.error(`Request ${request.url} failed:`, error.message);
        },
    });

    // Scrape Coinbase bitcoin stats
    await crawler.run(['https://www.coinbase.com/price/bitcoin']);
});
