import { MarketSnapshot, TransactionBuildRequest, PSBTBuildResult } from '../types/index';
import { execSync } from 'child_process';
import * as fs from 'fs';

/**
 * CoinSmithIntegration
 * 
 * Bridge between market data and Coin Smith PSBT builder.
 * 
 * Coin Smith is a Go-based Bitcoin transaction builder that creates BIP-174 PSBTs.
 * We integrate it by:
 * 1. Formatting market data into a Coin Smith fixture
 * 2. Running Coin Smith's CLI with our market-informed fee rates
 * 3. Capturing and validating the PSBT output
 */

export class CoinSmithIntegration {
  private readonly coinSmithBinaryPath: string;

  constructor(coinSmithPath?: string) {
    this.coinSmithBinaryPath = coinSmithPath || '/path/to/coin-smith/cli.sh';
  }

  /**
   * Builds a PSBT using market data to inform fee rates
   */
  async buildTransaction(request: TransactionBuildRequest): Promise<PSBTBuildResult> {
    const decisionLog: string[] = [];

    try {
      // Step 1: Determine fee rate from market data
      const selectedFeeRate = this.selectFeeRate(
        request.marketData,
        request.strategy,
        decisionLog
      );

      decisionLog.push(`Selected fee rate: ${selectedFeeRate} sat/vB based on market data`);

      // Step 2: Create a Coin Smith fixture with our market-informed parameters
      const fixture = this.createCoinSmithFixture(
        request,
        selectedFeeRate,
        decisionLog
      );

      // Step 3: Write fixture to temp file
      const fixtureFile = `/tmp/market-fixture-${Date.now()}.json`;
      fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2));
      decisionLog.push(`Created fixture: ${fixtureFile}`);

      // Step 4: Execute Coin Smith with our fixture
      decisionLog.push(`Executing Coin Smith: ${this.coinSmithBinaryPath} ${fixtureFile}`);

      let psbtOutput = '';
      try {
        psbtOutput = execSync(`${this.coinSmithBinaryPath} ${fixtureFile}`, {
          encoding: 'utf-8',
          timeout: 30000,
        }).trim();
      } catch (execError: any) {
        decisionLog.push(`Coin Smith execution error: ${execError.message}`);
        throw execError;
      }

      // Step 5: Parse and validate PSBT output
      const psbtResult = this.validatePSBTOutput(psbtOutput, decisionLog);

      if (!psbtResult.success) {
        throw new Error(`PSBT validation failed: ${psbtResult.error}`);
      }

      // Step 6: Calculate actual fee
      const estimatedFee = this.estimateFee(fixture, selectedFeeRate);

      // Cleanup
      try {
        fs.unlinkSync(fixtureFile);
      } catch (e) {
        console.warn(`Failed to cleanup fixture: ${fixtureFile}`);
      }

      decisionLog.push(`Successfully built PSBT with estimated fee: ${estimatedFee} sats`);

      return {
        success: true,
        psbt: psbtOutput,
        feeRate: selectedFeeRate,
        estimatedFee,
        marketDataUsed: request.marketData,
        decisionLog,
      };
    } catch (error: any) {
      return {
        success: false,
        feeRate: 0,
        estimatedFee: 0,
        marketDataUsed: request.marketData,
        decisionLog,
        error: error.message,
      };
    }
  }

  /**
   * Selects fee rate based on strategy and market conditions
   */
  private selectFeeRate(
    marketData: MarketSnapshot,
    strategy: 'aggressive' | 'balanced' | 'conservative',
    log: string[]
  ): number {
    const recommended = marketData.aggregated.fees.recommendedForTransaction;
    const fast = marketData.aggregated.fees.fast;
    const standard = marketData.aggregated.fees.standard;
    const slow = marketData.aggregated.fees.slow;

    let selected = recommended;

    switch (strategy) {
      case 'aggressive':
        // Use fast fee, but not more than 50% above recommended
        selected = Math.min(fast, recommended * 1.5);
        log.push(`Aggressive strategy: using ${selected} sat/vB (fast: ${fast})`);
        break;

      case 'balanced':
        // Use recommended (default)
        selected = recommended;
        log.push(`Balanced strategy: using recommended ${selected} sat/vB`);
        break;

      case 'conservative':
        // Use slow fee, but ensure minimum of slow rate
        selected = Math.max(slow, recommended * 0.8);
        log.push(`Conservative strategy: using ${selected} sat/vB (slow: ${slow})`);
        break;
    }

    // Sanity check: fee should be at least slow rate
    if (selected < slow) {
      log.push(`Fee rate ${selected} is below slow rate ${slow}, adjusting`);
      selected = slow;
    }

    return Math.round(selected);
  }

  /**
   * Creates a Coin Smith fixture from transaction request + market data
   */
  private createCoinSmithFixture(
    request: TransactionBuildRequest,
    feeRate: number,
    log: string[]
  ): any {
    const fixture = {
      name: `market-driven-txn-${Date.now()}`,
      inputs: request.inputs.map(input => ({
        txid: input.txid,
        vout: input.vout,
        amount: input.amount,
        scriptpubkey: input.scriptPubKey,
      })),
      outputs: request.outputs.map(output => ({
        address: output.address,
        amount: output.amount,
      })),
      fee: {
        rateVbytes: feeRate,
      },
      ...(request.rbfEnabled && { rbf: true }),
      ...(request.locktime !== undefined && { lockTime: request.locktime }),
    };

    log.push(`Created fixture with ${request.inputs.length} inputs, ${request.outputs.length} outputs`);
    return fixture;
  }

  /**
   * Validates PSBT output from Coin Smith
   */
  private validatePSBTOutput(
    output: string,
    log: string[]
  ): { success: boolean; error?: string } {
    // Check if output looks like a valid PSBT (starts with "cHNidA==" when base64)
    if (!output) {
      return { success: false, error: 'Empty PSBT output' };
    }

    if (!output.startsWith('cHNidA==') && !output.startsWith('psbt')) {
      return { success: false, error: 'Output does not appear to be a valid PSBT' };
    }

    log.push(`PSBT output validation passed`);
    return { success: true };
  }

  /**
   * Estimates total fee based on fixture size and fee rate
   * (Approximation - actual fee depends on signature sizes)
   */
  private estimateFee(fixture: any, feeRate: number): number {
    // Very rough estimate: base transaction + input/output overhead
    const baseSize = 10; // Transaction header
    const inputSize = fixture.inputs.length * 148; // Approximate per input
    const outputSize = fixture.outputs.length * 34; // Approximate per output
    const estimatedSize = baseSize + inputSize + outputSize;

    const estimatedFee = Math.ceil((estimatedSize * feeRate) / 4); // vbytes estimate
    return estimatedFee;
  }
}

// Export singleton
export const coinSmith = new CoinSmithIntegration();
