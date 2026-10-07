/// Minimal shape of a sent transaction: what ethers returns from a contract call.
type SentTx = { hash: string; wait: () => Promise<unknown> };

// Error of the RPC node when the account already has a transaction that the node
// still sees as pending. Accounts delegated with EIP-7702 are limited to one pending
// transaction; behind a load-balanced RPC, the node that receives the next transaction
// may not have seen the previous one mined yet.
const IN_FLIGHT_LIMIT = /in-flight transaction limit/i;

const RETRIES = 10;
const RETRY_DELAY_MS = 6_000;

/// Sends a transaction and waits for it to be mined. Sending is tried again, after a
/// pause, when the node refuses it because of the pending transaction limit above.
export async function sendTx<T extends SentTx>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const tx = await send();
      await tx.wait();
      return tx;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!IN_FLIGHT_LIMIT.test(message) || attempt > RETRIES) throw err;
      console.log(`  (the node still sees a pending transaction of this account, trying again in ${RETRY_DELAY_MS / 1000}s)`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}
