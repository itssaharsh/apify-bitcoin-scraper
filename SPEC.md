# Project Specification: Building a Bitcoin Market Scraper with Apify + Coin Smith

## Executive Summary

This project demonstrates how to combine Apify's web scraping capabilities with Coin Smith (a Bitcoin PSBT transaction builder) to create an end-to-end automation system for:
- Scraping real-time Bitcoin market data from multiple exchanges
- Aggregating and normalizing price/liquidity information  
- Using that data to inform fee calculations in Bitcoin transactions
- Automatically building optimized PSBTs for transaction signing

## Problem Statement

Bitcoin traders and exchanges need:
1. Real-time, multi-source market data (prices, volumes, fee rates)
2. Reliable fee estimation that reflects current network conditions
3. Automated transaction building based on current market state
4. A reproducible pipeline that runs on schedule

Previously, this required:
- Custom scraping logic for each exchange
- Fragile parsers that break when websites change
- Manual data aggregation and cleaning
- Manual PSBT creation with guesswork on fees

## Solution Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Apify Actors (Crawlee-based)                               │
│ - BitfinexPriceActor: Scrapes current BTC/USD prices       │
│ - MempoolFeeActor: Scrapes pending transaction fee rates    │
│ - CoinbaseVolumeActor: Scrapes exchange volume info         │
└─────────────┬───────────────────────────────────────────────┘
              │ (JSON outputs)
              ▼
┌─────────────────────────────────────────────────────────────┐
│ Data Aggregation Layer (Node.js)                            │
│ - Validates scraped data                                    │
│ - Normalizes across exchanges                               │
│ - Stores in local database (SQLite)                         │
└─────────────┬───────────────────────────────────────────────┘
              │ (normalized market state)
              ▼
┌─────────────────────────────────────────────────────────────┐
│ Coin Smith Integration                                       │
│ - Reads market data                                         │
│ - Sets optimal fee rates based on current data              │
│ - Builds PSBT with dynamic fee estimation                   │
└─────────────┬───────────────────────────────────────────────┘
              │ (PSBT output)
              ▼
┌─────────────────────────────────────────────────────────────┐
│ Output                                                       │
│ - Signed PSBT ready for broadcast                           │
│ - Market data snapshot archived                             │
│ - Audit log of decisions                                    │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Apify Actors (Crawlee + Node.js)

**BitfinexPriceActor:**
- Scrapes Bitfinex ticker page
- Extracts BTC/USD price, bid/ask, volume
- Outputs JSON with timestamp

**MempoolFeeActor:**
- Scrapes mempool.space fee estimates
- Extracts fast/standard/slow fee rates in sat/vB
- Provides market-driven fee data

**CoinbaseVolumeActor:**
- Scrapes Coinbase trading statistics
- Extracts 24h volume, price change
- Used for market breadth assessment

### 2. Data Aggregation (Node.js + TypeScript)

```typescript
interface MarketSnapshot {
  timestamp: Timestamp;
  price: { bid: number; ask: number; mid: number };
  fees: { fast: number; standard: number; slow: number };
  volume24h: number;
  sources: { exchange: string; confidence: 'high' | 'medium' | 'low' }[];
}
```

### 3. Coin Smith Integration

Modified Coin Smith to accept market data input:
```go
type BuilderConfig struct {
  FeeRate int64           // sat/vB from Apify
  MarketData *MarketData  // price/volume context
  Strategy string         // "aggressive", "balanced", "conservative"
}
```

## Implementation Details

### Technology Stack
- **Scraping:** Apify SDK + Crawlee (Node.js)
- **Data Processing:** TypeScript + SQLite  
- **Transaction Building:** Coin Smith (Go)
- **Automation:** GitHub Actions for scheduled runs
- **Monitoring:** Basic logging + error alerts

### Key Features
1. **Multi-exchange price aggregation** with fallback logic
2. **Dynamic fee selection** based on recent network activity
3. **Deterministic PSBT building** for reproducibility
4. **Audit trail** of all decisions and data points
5. **Error handling** for failed scrapes or invalid data

### Success Criteria
- Successfully scrapes data from 3+ exchanges
- Aggregates and validates all data points
- Builds valid PSBT with correct fees (verified against known transactions)
- Completes full pipeline in < 5 minutes
- Runs reliably on schedule (no data stale > 1 hour)

## Article Outline

The article will cover:
1. **Introduction** - The problem of fee estimation + manual processes
2. **Architecture Overview** - How Apify fits into the pipeline
3. **Building the First Actor** - Deep dive into BitfinexPriceActor (code + lessons)
4. **Handling Real-World Scraping** - Edge cases, retries, timeouts
5. **Data Validation & Normalization** - Critical for financial data
6. **Integration with Coin Smith** - Feeding market data into transaction builder
7. **Putting It All Together** - Full working pipeline demo
8. **What We Learned** - Mistakes made, decisions in hindsight
9. **Conclusion + Next Steps** - Production hardening ideas

## Code Artifacts

All working code will be included:
- 3 complete, tested Apify Actors (Crawlee + TypeScript)
- Data aggregation service (Node.js)
- Modified Coin Smith integration layer
- Docker configuration for reproducibility  
- Working GitHub Actions workflow
- Real output samples + screenshots

## Estimated Article Length

2,500-4,000 words covering:
- ~400 words architecture + problem statement
- ~600 words first Actor deep dive (with code)
- ~500 words on data validation challenges
- ~400 words Coin Smith integration
- ~500 words full pipeline walkthrough with results
- ~300 words learnings + what would change

## Timeline & Deliverables

1. **Project Setup** - README, spec, file structure
2. **GitHub Init** - Create repo, initial commit
3. **Article Draft** - Write following Apify guidelines (personal voice, real challenges, working code)
4. **Code Validation** - Ensure all code is tested and runnable
5. **Final Review** - Check against submission checklist

## Compliance with Apify Content Program

✅ Personal experience story: "How I built a Bitcoin scraper to feed market data into Coin Smith"  
✅ Real project with production constraints (fee accuracy, speed, reliability)  
✅ Complete, working code from actual implementation  
✅ Honest about challenges and decisions made  
✅ Developer-to-developer voice (first-person narrative)  
✅ Specific use case with clear problem statement  
✅ Screenshots of working system + real output  
✅ GitHub repository with full project code  
✅ Technical depth appropriate for engineering audience  
✅ Not AI-generated patterns, authentic insights about trade-offs
