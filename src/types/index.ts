/**
 * Core types for the Bitcoin market scraper + Coin Smith integration
 */

export interface MarketSnapshot {
  id?: string;
  timestamp: string;
  sources: {
    bitfinex?: PriceDataPoint;
    mempool?: FeeEstimate;
    coinbase?: VolumeData;
  };
  aggregated: {
    price: {
      bid: number;
      ask: number;
      mid: number;
      confidence: 'high' | 'medium' | 'low';
    };
    fees: {
      fast: number;
      standard: number;
      slow: number;
      recommendedForTransaction: number;
    };
    market: {
      volume24h: number;
      priceChangePercent24h: number;
      volatility: 'low' | 'medium' | 'high';
    };
  };
  validationErrors: string[];
}

export interface PriceDataPoint {
  timestamp: string;
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  volume24h: number;
  change24h: number;
}

export interface FeeEstimate {
  timestamp: string;
  fast: number;
  standard: number;
  slow: number;
  mempoolSize: number;
  txCount: number;
  recommendedFee: number;
}

export interface VolumeData {
  timestamp: string;
  exchange: string;
  volume24h: number;
  priceUsd: number;
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
}

export interface TransactionBuildRequest {
  inputs: UTXOInput[];
  outputs: TransactionOutput[];
  marketData: MarketSnapshot;
  strategy: 'aggressive' | 'balanced' | 'conservative';
  rbfEnabled?: boolean;
  locktime?: number;
}

export interface UTXOInput {
  txid: string;
  vout: number;
  amount: number;
  scriptPubKey: string;
}

export interface TransactionOutput {
  address: string;
  amount: number;
}

export interface PSBTBuildResult {
  success: boolean;
  psbt?: string; // Base64-encoded PSBT
  feeRate: number; // sat/vB used
  estimatedFee: number;
  marketDataUsed: MarketSnapshot;
  decisionLog: string[];
  error?: string;
}
