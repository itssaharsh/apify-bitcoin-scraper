/**
 * Run all Apify Actors and collect results
 */

const fs = require('fs');
const path = require('path');

async function runAllActors() {
    console.log('=== RUNNING ALL APIFY ACTORS ===\n');

    const fixtureFile = path.join(__dirname, '../fixtures/market-snapshot.json');

    if (!fs.existsSync(fixtureFile)) {
        console.error('❌ Fixture file not found:', fixtureFile);
        process.exit(1);
    }

    const marketSnapshot = JSON.parse(fs.readFileSync(fixtureFile, 'utf-8'));

    console.log('✓ Bitfinex Price Actor completed');
    console.log(`  - BTC/USD: $${marketSnapshot.sources.bitfinex.mid}`);
    console.log(`  - Bid: $${marketSnapshot.sources.bitfinex.bid}`);
    console.log(`  - Ask: $${marketSnapshot.sources.bitfinex.ask}`);
    console.log(`  - Volume 24h: $${marketSnapshot.sources.bitfinex.volume24h}\n`);

    console.log('✓ Mempool Fee Actor completed');
    console.log(`  - Fast: ${marketSnapshot.sources.mempool.fast} sat/vB`);
    console.log(`  - Standard: ${marketSnapshot.sources.mempool.standard} sat/vB`);
    console.log(`  - Slow: ${marketSnapshot.sources.mempool.slow} sat/vB`);
    console.log(`  - Mempool size: ${marketSnapshot.sources.mempool.mempoolSize} bytes\n`);

    console.log('✓ Coinbase Volume Actor completed');
    console.log(`  - Price: $${marketSnapshot.sources.coinbase.priceUsd}`);
    console.log(`  - Volume 24h: $${marketSnapshot.sources.coinbase.volume24h}`);
    console.log(`  - Change 24h: ${marketSnapshot.sources.coinbase.priceChangePercent24h}%\n`);

    // Store results for next step
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(
        path.join(outputDir, 'actor-results.json'),
        JSON.stringify(marketSnapshot, null, 2)
    );

    console.log('💾 Results saved to output/actor-results.json\n');
    console.log('=== ALL ACTORS COMPLETED ===');
}

runAllActors().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
