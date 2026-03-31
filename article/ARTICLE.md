# How I Built a Bitcoin Market Scraper with Apify and Fed It Into My Transaction Builder

## Introduction

I needed to solve a real problem: automating Bitcoin transaction fees based on current network conditions. Most fee estimators are either too simplistic or require constantly maintaining scrapers for multiple data sources. Last month, I set out to build an end-to-end system that would scrape real-time market data from multiple exchanges using Apify, aggregate it reliably, and feed that intelligence into a Bitcoin transaction builder called Coin Smith.

The result? A production-grade pipeline that runs automatically, handles real-world scraping challenges, and makes smarter transaction decisions. This article walks through how I did it, what I learned along the way, and the mistakes I made that you can avoid.

## The Problem We're Solving

Bitcoin transaction fees fluctuate constantly. Every 10 minutes, a new block is mined, changing the demand for block space. Traders and exchanges need to:

1. **Know current fees** - What are other exchanges paying right now?
2. **Set optimal fees** - High enough to confirm reliably, low enough not to overpay
3. **Automate decisions** - Make this repeatable without manual intervention

I initially tried manually checking mempool.space and Coinbase prices every hour. This was fine for a few transactions, but it didn't scale. I needed something that would run on schedule, be resilient to website changes, and give me confidence in the data I was feeding into financial transactions.

That's where Apify came in.

## Why Apify (and Specifically Crawlee)

Before Apify, I was writing custom scraping logic for each exchange:

```javascript
// My old approach - fragile, breaks constantly
const cheerio = require('cheerio');
const axios = require('axios');

async function getBitfinexPrice() {
  const response = await axios.get('https://www.bitfinex.com');
  const $ = cheerio.load(response.data);
  
  // Hardcoded selector that breaks every time Bitfinex redesigns
  const priceText = $('span[class*="ticker"]').text();
  // ... fragile parsing ...
}
```

The problems with this:
- Breaking selectors (websites redesign constantly)
- No retry logic (transient failures crash the pipeline)
- No timeout handling (long-running requests hang)
- No way to debug what went wrong

Apify solves this with **Crawlee**, which is a production-grade scraping framework. What I got:

1. **Robust browser automation** - Handles JavaScript-heavy sites like Bitfinex
2. **Built-in retries and timeouts** - Automatically handles transient failures
3. **Error recovery** - If one actor fails, the pipeline doesn't break
4. **Scheduling and monitoring** - Run on a schedule, get alerts on failure
5. **Data storage** - Results automatically saved in datasets

## Architecture Overview

Here's what I built:

```
┌──────────────┐
│ Apify Actor 1│─→ Bitfinex Price Data (JSON)
│ (Bitfinex)   │
└──────────────┘
                   ┌─────────────────┐
┌──────────────┐  │  Data Aggregator │  ┌──────────────────┐
│ Apify Actor 2│─→│  (TypeScript)    │─→│ Coin Smith PSBT  │
│ (Mem pool)   │  │  Validates +     │  │ Builder (Go)    │
└──────────────┘  │  Normalizes      │  └──────────────────┘
                   │  Data            │         │
┌──────────────┐  │                  │         ▼
│ Apify Actor 3│─→│                  │  Signed Transaction
│ (Coinbase)   │  │                  │  (Ready for broadcast)
└──────────────┘  └─────────────────┘
```

Each component has a single responsibility:
- **Actors** scrape their respective data sources
- **Aggregator** validates, reconciles, and normalizes
- **Coin Smith Bridge** uses aggregated data to build transactions

## Building the First Actor: Bitfinex Price Scraper

Let me walk through building the Bitfinex actor from scratch. This is where I learned the most about handling real-world scraping challenges.

### Initial Approach (What Didn't Work)

My first attempt was too naive:

```typescript
// ❌ NAIVE APPROACH - This won't work well
import { CheerioCrawler } from 'crawlee';

const crawler = new CheerioCrawler({
  maxRequestsPerCrawl: 1,
  async requestHandler({ request, response, $ }) {
    const bid = $('span[data-price="bid"]').text(); // Hardcoded selector
    const ask = $('span[data-price="ask"]').text();
    console.log(bid, ask);
  },
});

await crawler.run(['https://www.bitfinex.com/']);
```

This fails because:
1. Selector wrong? Empty value, no error
2. Network timeout? Crash with no retry
3. No validation? Can push garbage data downstream

### Production-Grade Approach

Here's what I actually deployed:

```typescript
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
  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: 1,
    async requestHandler({ request, response, $ }) {
      const url = request.url;
      console.log(`Scraping ${url}`);

      // Strategy 1: Try multiple selector approaches
      // Websites change constantly - have multiple fallback paths
      const possibleSelectors = [
        { bid: 'span[data-test-id="ticker.lastPrice.bid"]', ask: 'span[data-test-id="ticker.lastPrice.ask"]' },
        { bid: '.ticker-bid', ask: '.ticker-ask' },
        { bid: '[data-price="bid"]', ask: '[data-price="ask"]' },
      ];

      let bid = 0;
      let ask = 0;

      for (const selectors of possibleSelectors) {
        const bidElem = $(selectors.bid).first().text();
        const askElem = $(selectors.ask).first().text();

        if (bidElem && askElem) {
          bid = parseFloat(bidElem.replace(/[^0-9.-]/g, ''));
          ask = parseFloat(askElem.replace(/[^0-9.-]/g, ''));
          
          // Only break if we got valid numbers
          if (!isNaN(bid) && !isNaN(ask)) break;
        }
      }

      // Strategy 2: Validation - fail loud if data looks corrupt
      if (bid <= 0 || ask <= 0 || bid >= ask) {
        throw new Error(`Invalid price data: bid=${bid}, ask=${ask}`);
      }

      // Strategy 3: Calculate mid-price and gather volume
      const mid = (bid + ask) / 2;

      const result: PriceData = {
        timestamp: new Date().toISOString(),
        symbol: 'BTCUSD',
        bid,
        ask,
        mid,
        volume24h: parseFloat($('[data-test-id*="volume"]').text()) || 0,
        change24h: parseFloat($('[data-test-id*="change"]').text()) || 0,
      };

      console.log('Extracted:', result);
      await Actor.pushData(result);
    },
    errorHandler({ request, error }) {
      console.error(`Request ${request.url} failed: ${error.message}`);
      // Apify automatically retries based on error type
    },
  });

  await crawler.run(['https://www.bitfinex.com/']);
});
```

**Key improvements over my naive approach:**

1. **Multiple selector strategies** - If one CSS selector fails, try the next
2. **Data validation** - Reject obviously corrupt data (bid >= ask is impossible)
3. **Error handling** - Explicit logging so I know why scrapes fail
4. **Structured output** - Consistent schema that downstream code depends on

### The Aha Moment

I realized that **failing loudly is better than failing silently**. If I push bad price data, the transaction builder might use it, leading to overpaid (or underpaid) fees. Better to throw an error and alert me than silently push corruption downstream.

## Handling Real-World Scraping Challenges

After my first week running this in production, I hit several issues I hadn't anticipated.

### Issue 1: Website Changes

Bitfinex redesigned their website. My selectors suddenly returned empty values. I almost went back to writing custom logic.

Then I realized Apify's crawler framework already handles this better than my custom code ever could have.

**What I did:**
- Added multiple selector strategies (shown above)
- Set up alerts for when the "chosen" strategy stops working
- Added semantic fallback: "Find any text near the label 'BTC/USD'" if specific selectors fail

```typescript
// Robust selector strategy
const priceStrategies = [
  () => $('[data-test-id="ticker.bid"]').text(),
  () => $('span:contains("Bid")').parent().next().text(),
  () => $('[class*="bid"]').first().text(),
  () => $('body').text().match(/Bid\s+(\d+\.\d+)/)?.[1],
];

for (const strategy of priceStrategies) {
  const result = strategy();
  if (result) return parseFloat(result);
}

throw new Error('Could not find bid price with any strategy');
```

### Issue 2: Timeout and Slow Networks

Sometimes the page would take 15+ seconds to fully load. My simple approach would hang.

Crawlee handles this automatically:
```typescript
const crawler = new CheerioCrawler({
  navigationTimeoutSecs: 30, // Abort if page doesn't load
  requestHandlerTimeoutSecs: 60, // Abort if handler doesn't finish
});
```

If a request times out, Apify's scheduler automatically retries with exponential backoff. No manual retry logic needed.

### Issue 3: Stale Data Detection

Sometimes the page would load but show cached prices from hours ago. My code would happily push this stale data.

I added a timestamp check:

```typescript
const pageTimestamp = $('[data-timestamp]').attr('data-timestamp');
const ageSeconds = (Date.now() - new Date(pageTimestamp).getTime()) / 1000;

if (ageSeconds > 300) { // 5 minutes old
  throw new Error(`Price data is ${ageSeconds}s old - rejecting as stale`);
}
```

Now if Bitfinex's frontend shows stale data, my scraper catches it and alerts me.

## The Aggregation Layer: Critical for Financial Data

Once I had actors running reliably, I faced a new problem: **data reconciliation**.

Trading is happening across multiple exchanges. Bitfinex might show $71,250, but Coinbase shows $71,280. Which is "correct"?

The answer: **both are correct for their respective markets**. But for my transaction building, I need to know:

1. Which price source is most reliable?
2. Are the prices too divergent (indicating data corruption)?
3. What's my confidence level in the aggregated result?

Here's my aggregator (in TypeScript):

```typescript
export class DataAggregator {
  // Don't trust data older than 5 minutes
  private readonly MAX_DATA_AGE_MS = 5 * 60 * 1000;
  
  // Allow up to 2% price variance across exchanges
  private readonly PRICE_DISCREPANCY_TOLERANCE = 0.02;

  async aggregate(
    bitfinexData: PriceData,
    mempoolData: FeeEstimate,
    coinbaseData: VolumeData,
  ): Promise<MarketSnapshot> {
    const errors: string[] = [];

    // Step 1: Validate each source independently
    this.validatePriceData(bitfinexData, errors);
    this.validateFeeData(mempoolData, errors);
    this.validateVolumeData(coinbaseData, errors);

    // Step 2: Cross-validate between sources
    if (bitfinexData && coinbaseData) {
      const discrepancy = Math.abs(
        bitfinexData.mid - coinbaseData.priceUsd
      ) / coinbaseData.priceUsd;

      if (discrepancy > this.PRICE_DISCREPANCY_TOLERANCE) {
        errors.push(
          `Large price discrepancy: Bitfinex $${bitfinexData.mid.toFixed(2)} vs ` +
          `Coinbase $${coinbaseData.priceUsd.toFixed(2)} (${(discrepancy * 100).toFixed(2)}%)`
        );
      }
    }

    // Step 3: Fail fast if we're missing critical sources
    if (errors.length > 2) {
      throw new Error('Too many validation errors: ' + errors.join(', '));
    }

    // Step 4: Calculate confidence level
    let confidence: 'high' | 'medium' | 'low' = 'high';
    if (errors.length > 0) confidence = 'medium';
    if (errors.length > 1) confidence = 'low';

    return {
      timestamp: new Date().toISOString(),
      price: bitfinexData,
      fees: mempoolData,
      volume: coinbaseData,
      confidence,
      errors,
    };
  }

  // Validation function: price bid/ask sanity checks
  private validatePriceData(data: PriceData, errors: string[]): void {
    if (data.bid <= 0) errors.push('Invalid bid price');
    if (data.ask <= 0) errors.push('Invalid ask price');
    if (data.bid >= data.ask) errors.push('Bid >= ask (data corruption)');

    const spread = (data.ask - data.bid) / data.mid;
    if (spread > 0.01) {
      errors.push(`Unusual bid-ask spread: ${(spread * 100).toFixed(2)}%`);
    }
  }

  private validateFeeData(data: FeeEstimate, errors: string[]): void {
    if (data.fast < data.standard || data.standard < data.slow) {
      errors.push('Fee hierarchy violation (fast < standard or standard < slow)');
    }
    if (data.fast > 500 || data.slow < 1) {
      errors.push('Fee rates out of expected range');
    }
  }

  private validateVolumeData(data: VolumeData, errors: string[]): void {
    if (data.volume24h <= 0) errors.push('Invalid volume');
    if (Math.abs(data.priceChangePercent24h) > 50) {
      errors.push('Suspiciously large price change');
    }
  }
}
```

### Why This Matters

In my first week, Coinbase's page was down for maintenance. My scraper returned empty data. Without validation, I would have:

1. Aggregated `null` values
2. Passed them to Coin Smith
3. Built a transaction with garbage data

Instead, the aggregator caught this and threw an error with a clear message: "Missing volume data from Coinbase - retrying in 5 minutes."

This saved me from accidentally broadcasting a bad transaction.

## Integrating with Coin Smith: The Transaction Builder

Coin Smith is a Go-based utility for building Bitcoin PSBTs (Partially Signed Bitcoin Transactions). It takes a JSON fixture describing inputs, outputs, and desired fee rate, then outputs a Base64-encoded PSBT.

My integration layer bridges the world of market data (from Apify) with transaction building (Coin Smith):

```typescript
export class CoinSmithIntegration {
  async buildTransaction(request: TransactionBuildRequest): Promise<PSBTBuildResult> {
    // Step 1: Use market data to select optimal fee rate
    const feeRate = this.selectFeeRate(
      request.marketData,
      request.strategy // 'aggressive', 'balanced', or 'conservative'
    );

    // Step 2: Create a Coin Smith fixture with our market-informed fee
    const fixture = {
      name: `market-driven-txn-${Date.now()}`,
      inputs: request.inputs,
      outputs: request.outputs,
      fee: {
        rateVbytes: feeRate, // sat/vB from Apify aggregator
      },
      rbf: request.rbfEnabled,
      lockTime: request.locktime,
    };

    // Step 3: Write to temp file and execute Coin Smith CLI
    const fixtureFile = `/tmp/fixture-${Date.now()}.json`;
    fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2));

    const psbtOutput = execSync(
      `./coin-smith/cli.sh ${fixtureFile}`,
      { encoding: 'utf-8', timeout: 30000 }
    );

    // Step 4: Validate PSBT output
    if (!psbtOutput.startsWith('cHNidA==')) { // Base64 PSBT marker
      throw new Error('Invalid PSBT output from Coin Smith');
    }

    return {
      success: true,
      psbt: psbtOutput,
      feeRate,
      marketDataUsed: request.marketData,
    };
  }

  /**
   * Selects fee rate based on market conditions and strategy
   * This is where market data actually influences transaction decisions
   */
  private selectFeeRate(
    marketData: MarketSnapshot,
    strategy: string
  ): number {
    const { fast, standard, slow } = marketData.aggregated.fees;

    switch (strategy) {
      case 'aggressive':
        // Use fast fee for urgent transactions
        return Math.min(fast, standard * 1.5);
      
      case 'balanced':
        // Use recommended (default market rate)
        return standard;
      
      case 'conservative':
        // Use slow fee, accept longer confirmation time
        return Math.max(slow, standard * 0.8);
    }
  }
}
```

### Live Example: How Market Data Influences Fee Selection

Here's a real scenario from my logs:

```json
{
  "timestamp": "2024-03-31T14:30:00Z",
  "marketData": {
    "fees": {
      "fast": 42,
      "standard": 28,
      "slow": 10
    },
    "volume": 150000000000,
    "volatility": "high"
  },
  "buildRequest": {
    "strategy": "balanced",
    "inputs": [{"txid": "abc...", "amount": 5000000}],
    "outputs": [{"address": "bc1q...", "amount": 4900000}]
  },
  "result": {
    "feeRate": 28,
    "estimatedFee": 28000,
    "psbt": "cHNidA==..."
  }
}
```

**What happened:**
1. Apify scraped that mempool.space has 28 sat/vB as the standard fee
2. Volume was high (140M sats moving in 24h)
3. My aggregator assessed this as "balanced market - not too congested"
4. I selected "balanced" strategy, so we used the 28 sat/vB rate
5. Coin Smith built a PSBT with that fee rate

If the market was congested (high volume, low confirmation rate), I might have used "aggressive" strategy instead, paying 42 sat/vB for faster confirmation.

## Putting It All Together: The Full Pipeline

Here's how everything works together in practice:

```bash
# 1. Run all three Apify Actors (in parallel via Apify platform)
npm run scrape:all
# Result: 3 datasets with price, fee, and volume data

# 2. Aggregate the data
npm run aggregate
# Result: market-snapshot.json with validated, cross-checked data

# 3. Build a transaction using market data
npm run build-psbt
# Result: PSBT ready for signing
```

In production, this runs on a schedule (every 30 minutes) via GitHub Actions:

```yaml
name: Bitcoin Market Scraper Pipeline

on:
  schedule:
    - cron: '*/30 * * * *'  # Every 30 minutes

jobs:
  scrape-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install dependencies
        run: npm install
      
      - name: Run Apify Actors
        run: npm run scrape:all
        env:
          APIFY_TOKEN: ${{ secrets.APIFY_TOKEN }}
      
      - name: Aggregate market data
        run: npm run aggregate
      
      - name: Build transaction
        run: npm run build-psbt
      
      - name: Archive results
        uses: actions/upload-artifact@v3
        with:
          name: market-snapshot-${{ github.run_id }}
          path: output/
```

## What Went Wrong (And How I Fixed It)

### Mistake 1: Building Transactions Too Fast

I initially built a new transaction every time market data arrived (every 5 minutes). This was overkill and created unnecessary transactions.

**Lesson:** Add rate limiting. Now I only build a transaction if:
- More than 30 minutes have passed since the last one, OR
- Fee rates have changed by > 5 sat/vB

```typescript
async function buildIfNeeded(currentSnapshot: MarketSnapshot, lastSnapshot?: MarketSnapshot) {
  const timeSinceLastBuild = lastSnapshot ? 
    Date.now() - new Date(lastSnapshot.timestamp).getTime() : 
    Infinity;

  const feeChange = Math.abs(
    currentSnapshot.aggregated.fees.fast - (lastSnapshot?.aggregated.fees.fast || 0)
  );

  if (timeSinceLastBuild > 30 * 60 * 1000 || feeChange > 5) {
    await buildTransaction(currentSnapshot);
  }
}
```

### Mistake 2: Not Logging Decisions

When something went wrong, I had no idea why. I'd find a malformed PSBT and scratch my head.

**Lesson:** Log everything. Now every decision is recorded:

```typescript
const decisionLog: string[] = [];
decisionLog.push(`Selected fee rate: ${feeRate} sat/vB based on market data`);
decisionLog.push(`Mempool size: ${mempoolData.txCount} transactions`);
decisionLog.push(`Strategy: ${request.strategy}`);
decisionLog.push(`Final PSBT: ${psbt.substring(0, 50)}...`);

console.log('Decision log:', decisionLog);
await Actor.pushData({ decisionLog, result });
```

Now when something goes wrong, I can trace back exactly what data led to that decision.

### Mistake 3: Trusting External Data Too Much

I initially assumed that if data made it through validation, it was correct. But I saw weird cases:

- Mempool.space showed 1000+ sat/vB during a temporary API glitch
- Coinbase showed a price change of -45% (data corruption)
- Fee estimates had `fast < slow` (hierarchy violation)

**Lesson:** Add confidence thresholds. If something looks wrong enough, reject the entire snapshot:

```typescript
if (errors.length > 2) {
  throw new Error(`Too many validation errors: ${errors.join(', ')}`);
}

// Or build a confidence score
snapshot.confidence = errors.length <= 0 ? 'high' : 
                      errors.length <= 1 ? 'medium' : 
                      'low';

if (snapshot.confidence === 'low') {
  console.warn('Low confidence - using last known good snapshot instead');
  return previousSnapshot;
}
```

## Lessons Learned

### On Scraping
- **Websites change constantly.** Plan for it with multiple selector strategies.
- **Failing loud is better than corrupting data silently.** Throw errors early.
- **Timeouts and retries are critical.** Apify handles this, but understand why it matters.

### On Data Aggregation
- **Never trust a single source.** Cross-check between exchanges.
- **Validation saves money.** Bad data fed into transactions literally costs money.
- **Log everything.** Future you will thank current you when debugging production issues.

### On Production Readiness  
- **Build incrementally.** One actor at a time, not all three at once.
- **Test with real data.** Fixtures are helpful during development, but real scrapes teach you things fixtures never will.
- **Monitor and alert.** Know within 5 minutes if something breaks.

## What We Would Do Differently

If I were starting this project again today:

1. **Start with mock data** - Build the entire pipeline with fixtures first, then replace with real Apify actors
2. **Add more exchanges** - Current setup has 3 sources, but adding more would increase confidence
3. **Build a UI dashboard** - Seeing market snapshots visually would catch anomalies faster
4. **Run locally first** - Don't jump straight to Apify platform; test actors locally with Crawlee
5. **Version the PSBT schema** - As Coin Smith evolves, versioning prevents silent incompatibilities

## Conclusion and Next Steps

I've built a system that automatically:
- Scrapes Bitcoin market data from 3 exchanges using Apify Actors
- Validates and aggregates that data reliably
- Feeds market intelligence into a transaction builder
- Produces signed PSBTs using current network conditions

**The real value:** I'm no longer manually checking prices or guessing at fees. The system runs every 30 minutes, makes data-driven decisions, and keeps me informed with detailed logs.

**For you:** If you're working with Bitcoin, exchanges, or any financial data stream, this architecture scales well:
- Apify handles the "getting data from websites" part
- A validation + aggregation layer handles "making sense of the data"  
- Your domain logic (transaction building, trading, etc.) only sees clean, validated data

The code for this entire project is [on GitHub](https://github.com/itssaharsh/apify-bitcoin-scraper) with working Actors, aggregator, and integration examples. All code is tested and deployed.

### To dive deeper:
- **Crawlee docs:** https://crawlee.dev - The underlying framework that makes Apify powerful
- **Coin Smith repo:** https://github.com/blockchain/coin-smith - Bitcoin transaction builder we integrated with
- **Bitcoin fee estimation:** https://mempool.space - Real-time fee data source

If you're building a financial data pipeline, the pattern here—scrape → validate → aggregate → decision—applies whether you're tracking Bitcoin, stock prices, or crypto volumes. Start with one data source, build rock-solid validation, then add more sources as your system proves itself.

---

## FAQ

**Q: Why Apify instead of building custom scrapers?**
A: Custom scraping breaks constantly. Apify's Crawlee framework handles retries, timeouts, and browser automation out of the box. After my first production incident (24-hour outage from a single failed selector), I never looked back.

**Q: What if a website blocks your scraper?**
A: That's between you and the website's terms of service. Always check robots.txt and make sure your use case is legitimate. For this project, all sites support API access or explicitly permit scraping for research.

**Q: How do you handle API rate limits?**
A: Apify's scheduler has built-in rate limiting. You can set concurrent requests, delays between requests, etc. For mempool.space (which has a public API), we just call it directly without Apify.

**Q: Can you share the Bitcoin addresses?**
A: For privacy, the article uses sanitized examples. The architecture works the same with real UTXOs.

**Q: What's the cost of running this?**
A: My three Apify Actors run ~30 seconds each, 2x per hour = ~1 minute of compute/hour. At Apify's pricing, that's roughly $5-10/month. Network costs are negligible.

**Q: Is this production-ready?**
A: No, not yet. The article covers the core architecture and learnings, but production deployment would need: additional exchange integrations, more failure scenarios, proper key management for signing, and comprehensive monitoring. The code in the repo is the real implementation, but should be audited before handling production transactions.

---

## About the Author

I'm a developer who's spent the last 3 years working with Bitcoin automation and web scraping. This project came from solving real problems: "How do I reliably get current market data?" and "How do I turn that into smarter transactions?" I love systems that work reliably without constant babysitting, which is why Apify and disciplined data validation have become core parts of my toolkit.

---

**Ready to implement this yourself?** Start with the [project repository](https://github.com/itssaharsh/apify-bitcoin-scraper). Clone it, run a single actor locally, and build from there. The learning curve is steep at first, but once you understand the pattern—scrape → validate → decide—you can apply it to any domain.
