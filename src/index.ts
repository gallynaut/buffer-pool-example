import {
  clusterApiUrl,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { loadSwitchboardProgram } from "@switchboard-xyz/switchboard-v2";

async function main() {
  const connection = new Connection(clusterApiUrl("devnet"), {
    commitment: "confirmed",
  });
  const payer = Keypair.generate();

  const blockheight = await connection.getBlockHeight();
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const airdropTxn = await connection.requestAirdrop(
    payer.publicKey,
    2 * LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction({
    signature: airdropTxn,
    blockhash,
    lastValidBlockHeight,
  });

  // load the switchboard program
  const program = await loadSwitchboardProgram("devnet", connection, payer);
}

main().then(
  () => process.exit(),
  (error) => {
    console.error("Buffer relayer example failed");
    console.error(error);
    process.exit(-1);
  }
);
