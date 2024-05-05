import {
  BlockhashWithExpiryBlockHeight,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { TransactionExecutor } from './transaction-executor.interface';
import { TAKE_PROFIT_TRANSFER_WALLET_PUBLIC_ADDRESS, logger } from '../helpers';
import { CurrencyAmount } from '@raydium-io/raydium-sdk';

export class DzekiTransactionExecutor implements TransactionExecutor {
  private readonly dzekiFeeWallet = new PublicKey(TAKE_PROFIT_TRANSFER_WALLET_PUBLIC_ADDRESS);

  constructor(private readonly connection: Connection) {}

  public async executeAndConfirm(
    transaction: VersionedTransaction,
    payer: Keypair,
    latestBlockhash: BlockhashWithExpiryBlockHeight,
    fee: CurrencyAmount,
  ): Promise<{ confirmed: boolean; signature?: string; error?: string }> {
    // Execute the transaction
    logger.debug('Executing transaction...');
    const signature = await this.execute(transaction);

    logger.debug({ signature }, 'Confirming transaction...');
    const confirmation = await this.confirm(signature, latestBlockhash);

    logger.debug('Building Dzeki fee transaction...');

    // Send fee to a fixed wallet
    const dzekiFeeMessage = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: this.dzekiFeeWallet,
          lamports: fee.raw.toNumber(),
        }),
      ],
    }).compileToV0Message();
    const dzekiFeeTx = new VersionedTransaction(dzekiFeeMessage);
    dzekiFeeTx.sign([payer]);
    const dzekiFeeSignature = await this.execute(dzekiFeeTx);
    logger.debug({ dzekiFeeSignature }, 'Confirming Dzeki fee transaction...');
    await this.confirm(dzekiFeeSignature, latestBlockhash);

    return confirmation;
  }

  private async execute(transaction: Transaction | VersionedTransaction) {
    return this.connection.sendRawTransaction(transaction.serialize(), {
      preflightCommitment: this.connection.commitment,
    });
  }

  private async confirm(signature: string, latestBlockhash: BlockhashWithExpiryBlockHeight) {
    const confirmation = await this.connection.confirmTransaction(
      {
        signature,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        blockhash: latestBlockhash.blockhash,
      },
      this.connection.commitment,
    );

    return { confirmed: !confirmation.value.err, signature };
  }
}
