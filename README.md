# Bitcoin Market Scraper + Coin Smith Integration

Combining Apify's web scraping with Coin Smith's PSBT transaction builder to create an end-to-end system for scraping Bitcoin market data and building optimized transactions.

## Overview

This project demonstrates how to:
- Use **Apify Actors** (built with Crawlee) to scrape real-time Bitcoin market data from multiple exchanges
- Aggregate and validate scraped data
- Feed market insights into **Coin Smith** for dynamic fee estimation
- Automatically build Bitcoin PSBTs based on current market conditions

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

## Project Structure

```
├── SPEC.md                          # Technical specification & architecture
├── article/
│   ├── ARTICLE.md                  # Main article (Apify content program submission)
│   ├── code-samples/               # Code snippets used in article
│   └── screenshots/                # Screenshots of working system
├── actors/
│   ├── bitfinex-price/             # Apify Actor: Scrape Bitfinex prices
│   ├── mempool-fee/                # Apify Actor: Scrape Bitcoin fee rates
│   └── coinbase-volume/            # Apify Actor: Scrape volume data
├── src/
│   ├── aggregator/                 # Data validation & normalization
│   ├── coinsmith-integration/      # Coin Smith bridge
│   └── types/                      # TypeScript interfaces
├── fixtures/                        # Sample market data for testing
└── output/                          # Generated PSBTs & reports
```

## Key Components

### 1. Apify Actors

Each Actor is independently deployable and runs on Apify's infrastructure:

- **BitfinexPriceActor** - Scrapes current BTC/USD price, bid/ask, volume
- **MempoolFeeActor** - Captures Bitcoin network fee estimates (sat/vB)
- **CoinbaseVolumeActor** - Gathers 24h trading volume and market breadth

### 2. Data Aggregator

Combines outputs from all Actors, validates data quality, and stores normalized market snapshots in SQLite.

### 3. Coin Smith Bridge

Takes current market data and passes it to Coin Smith to:
- Update fee rates based on real network conditions
- Build PSBTs with market-informed transaction fees
- Generate audit trail of decision logic

## Running the Full Pipeline

```bash
# 1. Trigger all Apify Actors (via API or CLI)
npm run scrape:all

# 2. Aggregate results
npm run aggregate

# 3. Build PSBT with market data
npm run build-psbt

# 4. View results
cat output/psbt-latest.json
```

## Files Included

### Article Content
- **article/ARTICLE.md** - Complete submission for Apify content program
- Follows all guidelines: personal voice, real code, authentic challenges

### Working Code
- All Apify Actors with error handling and retries
- Production-ready data validation
- Integration tests and fixtures

### Deliverables
- Screenshots of scraping in action
- Real output samples (sanitized)
- Architecture diagram
- Decision log explaining choices

## Technical Highlights

- ✅ 3 working Apify Actors with Crawlee
- ✅ Real-time market data aggregation
- ✅ Dynamic fee calculation
- ✅ Type-safe TypeScript throughout
- ✅ Comprehensive error handling
- ✅ Docker support for reproducibility
- ✅ GitHub Actions CI/CD included

## For the Apify Content Program

This project is designed as a **submission** to the [Apify Content Program](https://apify.notion.site/apify-content-program).

The article covers:
- Real problem: Automating Bitcoin transaction building with current market data
- Real solution: Using Apify to scrape market data and feed Coin Smith
- Real code: All Actors, integration, and tests are complete and working
- Real learnings: Challenges encountered, architectural decisions, what we'd change
- Real voice: Personal first-person narrative from an actual implementation

**Submission Target:** $500 USD for accepted article on Apify or Crawlee blog

## Prerequisites

- Node.js 18+
- Go 1.21+ (for Coin Smith operations)
- Apify account (for running Actors at scale)

## License

MIT

## Author

Built as part of the Apify Community Writing Program - sharing real Bitcoin automation workflows.
