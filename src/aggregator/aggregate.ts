import { MarketSnapshot, PriceDataPoint, FeeEstimate, VolumeData } from '../types/index';

/**
 * DataAggregator
 * 
 * Combines outputs from multiple Apify Actors:
 * 1. Validates each data source independently
 * 2. Cross-checks for inconsistencies
 * 3. Calculates final aggregated values
 * 4. Returns unified market snapshot
 * 
 * This is CRITICAL because:
 * - Scraped data can be stale or corrupted
 * - Different exchanges have price discrepancies
 * - Fee estimates can be outdated
 * - We feed this into financial transactions (errors are expensive!)
 */

export class DataAggregator {
  private readonly MAX_DATA_AGE_MS = 5 * 60 * 1000; // 5 minutes
  private readonly PRICE_DISCREPANCY_TOLERANCE = 0.02; // 2% variance allowed

  /**
   * Aggregates data from all sources into a single market snapshot
   */
  async aggregate(
    priceData: PriceDataPoint | null,
    feeData: FeeEstimate | null,
    volumeData: VolumeData | null,
  ): Promise<MarketSnapshot> {
    const errors: string[] = [];

    // Step 1: Validate individual data sources
    if (priceData) {
      this.validatePriceData(priceData, errors);
    } else {
      errors.push('Missing price data from Bitfinex');
    }

    if (feeData) {
      this.validateFeeData(feeData, errors);
    } else {
      errors.push('Missing fee data from Mempool');
    }

    if (volumeData) {
      this.validateVolumeData(volumeData, errors);
    } else {
      errors.push('Missing volume data from Coinbase');
    }

    // Step 2: Check data freshness
    this.validateDataFreshness(priceData, feeData, volumeData, errors);

    // Step 3: Cross-validate relationships
    if (priceData && volumeData) {
      this.checkPriceCrossExchange(priceData, volumeData, errors);
    }

    // Step 4: Build aggregated snapshot
    const snapshot: MarketSnapshot = {
      timestamp: new Date().toISOString(),
      sources: {
        bitfinex: priceData || undefined,
        mempool: feeData || undefined,
        coinbase: volumeData || undefined,
      },
      aggregated: {
        price: {
          bid: priceData?.bid || 0,
          ask: priceData?.ask || 0,
          mid: priceData?.mid || 0,
          confidence: this.calculatePriceConfidence(priceData, errors),
        },
        fees: {
          fast: feeData?.fast || 0,
          standard: feeData?.standard || 0,
          slow: feeData?.slow || 0,
          recommendedForTransaction: this.selectOptimalFee(feeData),
        },
        market: {
          volume24h: volumeData?.volume24h || 0,
          priceChangePercent24h: volumeData?.priceChangePercent24h || 0,
          volatility: this.assessVolatility(volumeData),
        },
      },
      validationErrors: errors,
    };

    // Step 5: Fail fast if critical data missing
    if (errors.length > 0) {
      console.warn('Aggregation warnings:', errors);
    }

    if (!priceData || !feeData) {
      throw new Error('Critical data missing - cannot proceed: ' + errors.join(', '));
    }

    return snapshot;
  }

  /**
   * Validates price data from Bitfinex
   */
  private validatePriceData(data: PriceDataPoint, errors: string[]): void {
    if (data.bid <= 0) errors.push('Bitfinex: Invalid bid price');
    if (data.ask <= 0) errors.push('Bitfinex: Invalid ask price');
    if (data.bid >= data.ask) errors.push('Bitfinex: Bid >= ask (corrupt data)');
    if (data.volume24h <= 0) errors.push('Bitfinex: Invalid volume');

    // Sanity checks
    const spread = (data.ask - data.bid) / data.mid;
    if (spread > 0.01) {
      // > 1% spread is unusual
      errors.push(`Bitfinex: Large bid-ask spread (${(spread * 100).toFixed(2)}%)`);
    }
  }

  /**
   * Validates fee data from Mempool.space
   */
  private validateFeeData(data: FeeEstimate, errors: string[]): void {
    if (data.fast <= 0 || data.standard <= 0 || data.slow <= 0) {
      errors.push('Mempool: Invalid fee rates');
    }

    if (data.fast < data.standard || data.standard < data.slow) {
      errors.push('Mempool: Fee hierarchy violated (fast < standard or standard < slow)');
    }

    // Fees should be in reasonable range for Bitcoin
    // 1 sat/vB (very low) to 500 sat/vB (extremely high)
    if (data.fast > 500 || data.slow < 1) {
      errors.push('Mempool: Fee rates out of expected range');
    }
  }

  /**
   * Validates volume data from Coinbase
   */
  private validateVolumeData(data: VolumeData, errors: string[]): void {
    if (data.volume24h <= 0) errors.push('Coinbase: Invalid volume');
    if (data.priceUsd <= 0) errors.push('Coinbase: Invalid price');
    if (Math.abs(data.priceChangePercent24h) > 50) {
      // > 50% change in 24h is suspiciously high
      errors.push('Coinbase: Suspicious price change percentage');
    }
  }

  /**
   * Ensures all data is recent (not stale cache)
   */
  private validateDataFreshness(
    priceData: PriceDataPoint | null,
    feeData: FeeEstimate | null,
    volumeData: VolumeData | null,
    errors: string[],
  ): void {
    const now = Date.now();

    if (priceData) {
      const age = now - new Date(priceData.timestamp).getTime();
      if (age > this.MAX_DATA_AGE_MS) {
        errors.push(`Price data is ${(age / 1000).toFixed(0)}s old (max: 300s)`);
      }
    }

    if (feeData) {
      const age = now - new Date(feeData.timestamp).getTime();
      if (age > this.MAX_DATA_AGE_MS) {
        errors.push(`Fee data is ${(age / 1000).toFixed(0)}s old (max: 300s)`);
      }
    }

    if (volumeData) {
      const age = now - new Date(volumeData.timestamp).getTime();
      if (age > this.MAX_DATA_AGE_MS) {
        errors.push(`Volume data is ${(age / 1000).toFixed(0)}s old (max: 300s)`);
      }
    }
  }

  /**
   * Compares price across exchanges to detect anomalies
   */
  private checkPriceCrossExchange(
    bitfinexPrice: PriceDataPoint,
    coinbasePrice: VolumeData,
    errors: string[],
  ): void {
    const priceDiscrepancy = Math.abs(bitfinexPrice.mid - coinbasePrice.priceUsd) / 
                            coinbasePrice.priceUsd;

    if (priceDiscrepancy > this.PRICE_DISCREPANCY_TOLERANCE) {
      errors.push(
        `Large price discrepancy: ` +
        `Bitfinex $${bitfinexPrice.mid.toFixed(2)} vs ` +
        `Coinbase $${coinbasePrice.priceUsd.toFixed(2)} ` +
        `(${(priceDiscrepancy * 100).toFixed(2)}%)`
      );
    }
  }

  /**
   * Assesses price confidence based on data consistency
   */
  private calculatePriceConfidence(
    data: PriceDataPoint | null,
    errors: string[]
  ): 'high' | 'medium' | 'low' {
    if (!data) return 'low';
    
    const relevantErrors = errors.filter(e => e.includes('price') || e.includes('discrepancy'));
    if (relevantErrors.length > 1) return 'low';
    if (relevantErrors.length === 1) return 'medium';
    return 'high';
  }

  /**
   * Selects optimal fee based on current market conditions
   * This is where we make the transaction fee decision.
   */
  private selectOptimalFee(feeData: FeeEstimate | null): number {
    if (!feeData) return 10; // Default fallback

    // Strategy: 
    // - If mempool is small (< 50 MB of transactions), use standard fee
    // - If mempool is large (> 100 MB), use fast fee to ensure inclusion
    // - Otherwise split the difference

    const mempoolSizeEstimate = feeData.txCount;

    if (mempoolSizeEstimate < 2000) {
      // Small mempool - safe to use standard fee
      return feeData.standard;
    } else if (mempoolSizeEstimate > 5000) {
      // Large mempool - use fast fee for reliability
      return feeData.fast;
    } else {
      // Medium congestion - use midpoint
      return Math.round((feeData.standard + feeData.fast) / 2);
    }
  }

  /**
   * Assesses market volatility based on price movement
   */
  private assessVolatility(data: VolumeData | null): 'low' | 'medium' | 'high' {
    if (!data) return 'medium';

    const absPriceChange = Math.abs(data.priceChangePercent24h);

    if (absPriceChange < 2) return 'low';
    if (absPriceChange > 8) return 'high';
    return 'medium';
  }
}

// Export singleton instance
export const aggregator = new DataAggregator();
