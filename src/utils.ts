import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import Big from "big.js";
import { BN } from "bn.js";
import fs from "fs";
import path from "path";

/** Returns a promise that resolves successfully if returned before the given timeout has elapsed.
 * @param ms the number of milliseconds before the promise expires
 * @param promise the promise to wait for
 * @param timeoutError the error to throw if the promise expires
 * @return the promise result
 */
export async function promiseWithTimeout<T>(
  ms: number,
  promise: Promise<T>,
  timeoutError = new Error("timeoutError")
): Promise<T> {
  // create a promise that rejects in milliseconds
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(timeoutError);
    }, ms);
  });

  return Promise.race<T>([promise, timeout]);
}

export async function findOrCreateKeypair(
  connection: Connection,
  keypairName = "buffer-pool-keypair.json"
): Promise<Keypair> {
  const srcDir = __dirname;
  const divvyKeypairPath = path.join(srcDir, "..", keypairName);
  if (fs.existsSync(divvyKeypairPath)) {
    return Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(fs.readFileSync(divvyKeypairPath, "utf-8")))
    );
  }

  const divvyKeypair = Keypair.generate();
  fs.writeFileSync(divvyKeypairPath, `[${divvyKeypair.secretKey.toString()}]`);
  // airdrop some funds
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const airdropTxn = await connection.requestAirdrop(
    divvyKeypair.publicKey,
    2 * LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction({
    signature: airdropTxn,
    blockhash,
    lastValidBlockHeight,
  });

  return divvyKeypair;
}

export const toUtf8 = (buf: any): string => {
  buf = buf ?? "";
  return Buffer.from(buf)
    .toString("utf8")
    .replace(/\u0000/g, "");
};

export function jsonReplacers(key: any, value: any): string {
  if (key === "name" || (key === "metadata" && Array.isArray(value))) {
    return toUtf8(Buffer.from(value));
  }
  // big.js
  if (value instanceof Big) {
    return value.toString();
  }
  // pubkey
  if (value instanceof PublicKey) {
    return value.toBase58();
  }
  // BN
  if (BN.isBN(value)) {
    return value.toString(10);
  }
  // bigint
  if (typeof value === "bigint") {
    return value.toString(10);
  }

  // Fall through for nested objects
  return value;
}
