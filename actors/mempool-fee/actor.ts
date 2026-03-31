import { Actor } from 'apify';
import axios from 'axios';

interface FeeEstimate {
  timestamp: string;
  fast: number;
  standard: number;
  slow: number;
  mempoolSize: number;
  txCount: number;
  recommendedFee: number;
}

Actor.main(async () => {
  // Mempool.space provides a convenient API for fee data
  // This is more reliable than scraping since APIs are designed for access
  
  try {
    // Fetch fee estimates from mempool.space API
    const feeResponse = await axios.get('https://mempool.space/api/v1/fees/recommended');
    const mempoolResponse = await axios.get('https://mempool.space/api/mempool');

    const feeData = feeResponse.data;
    const mempoolData = mempoolResponse.data;

    // Validate API response
    if (!feeData.fastestFee || !feeData.halfHourFee || !feeData.hourFee) {
      throw new Error('Missing required fee data from API');
    }

    const result: FeeEstimate = {
      timestamp: new Date().toISOString(),
      // Mempool.space returns fees in sat/vB for different confirmation targets
      fast: feeData.fastestFee,        // Next block
      standard: feeData.halfHourFee,   // Within 30 minutes
      slow: feeData.hourFee,           // Within 1 hour
      mempoolSize: mempoolData.count,
      txCount: mempoolData.vsize,
      // Calculate recommended fee: fast for high urgency, else standard, else slow
      recommendedFee: feeData.halfHourFee, // Default to standard
    };

    // Sanity checks on fee data
    if (result.slow === 0 || result.fast === 0) {
      throw new Error('Invalid fee estimates fetched');
    }

    // Fees should follow: fast > standard > slow
    if (result.fast < result.standard || result.standard < result.slow) {
      console.warn('Fee hierarchy violation - normalizing');
      result.fast = Math.max(result.fast, result.standard);
      result.standard = Math.max(result.standard, result.slow);
    }

    console.log('Fee data:', result);
    await Actor.pushData(result);

  } catch (error) {
    console.error('Failed to fetch fee data:', error);
    throw error;
  }
});
