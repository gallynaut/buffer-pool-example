import { clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import {
  CrankAccount,
  loadSwitchboardProgram,
  OracleAccount,
  OracleQueueAccount,
  PermissionAccount,
  SwitchboardPermission,
} from "@switchboard-xyz/switchboard-v2";
import { BN } from "bn.js";
import fs from "fs";
import path from "path";
import chalk from "chalk";

import { findOrCreateDivvyKeypair } from "./utils";

async function setup() {
  const connection = new Connection(clusterApiUrl("devnet"), {
    commitment: "confirmed",
  });

  const divvyKeypair = await findOrCreateDivvyKeypair(connection);

  // load the switchboard program
  const program = await loadSwitchboardProgram(
    "devnet",
    connection,
    divvyKeypair
  );

  // Create a new OracleQueue
  const queueAccount = await OracleQueueAccount.create(program, {
    name: Buffer.from("divvy queue"),
    metadata: Buffer.from("divvy queue"),
    reward: new BN(0),
    minStake: new BN(0),
    authority: divvyKeypair.publicKey,
    unpermissionedFeeds: true,
    enableBufferRelayers: true,
    mint: new PublicKey("So11111111111111111111111111111111111111112"), // wrapped SOL
  });
  const queueData = await queueAccount.loadData();
  console.log(
    chalk.green(
      "\u2714 ",
      "Created Oracle Queue",
      queueAccount.publicKey.toBase58()
    )
  );

  // Create a crank
  const crankAccount = await CrankAccount.create(program, {
    name: Buffer.from("divvy crank"),
    metadata: Buffer.from("divvy crank"),
    queueAccount,
    maxRows: 100,
  });
  const crankData = await crankAccount.loadData();
  console.log(
    chalk.green("\u2714 ", "Created Crank", crankAccount.publicKey.toBase58())
  );

  // Create an oracle
  const oracleAccount = await OracleAccount.create(program, {
    name: Buffer.from("divvy oracle"),
    metadata: Buffer.from("divvy oracle"),
    oracleAuthority: divvyKeypair,
    queueAccount,
  });
  const oracleData = await oracleAccount.loadData();
  console.log(
    chalk.green("\u2714 ", "Created Crank", oracleAccount.publicKey.toBase58())
  );

  // Create oracle permissions
  const permissionAccount = await PermissionAccount.create(program, {
    granter: queueAccount.publicKey,
    grantee: oracleAccount.publicKey,
    authority: queueData.authority, // divvyKeypair.publicKey
  });

  // set oracle permissions
  await permissionAccount.set({
    permission: SwitchboardPermission.PERMIT_ORACLE_HEARTBEAT,
    authority: divvyKeypair,
    enable: true,
  });
  const permissionData = await permissionAccount.loadData();

  console.log(
    chalk.green(
      "\u2714 ",
      "Created Oracle Permissions",
      permissionAccount.publicKey.toBase58()
    )
  );

  // write the docker files
  fs.writeFileSync(
    path.join(__dirname, "..", "docker-compose.oracle.yml"),
    `version: "3.3"
services:
  oracle:
    image: "switchboardlabs/node:dev-v2-09-13-22"
    network_mode: host
    # restart: always
    secrets:
      - PAYER_SECRETS
    environment:
      # Logging
      - VERBOSE=1
      - DEBUG=1
      # Oracle
      - CHAIN=solana
      # Solana
      - CLUSTER=devnet
      - RPC_URL=\${RPC_URL:-https://api.devnet.solana.com}
      - ORACLE_KEY=${oracleAccount.publicKey}
      # Task Runner, need a mainnet RPC
      - TASK_RUNNER_SOLANA_RPC=\${TASK_RUNNER_SOLANA_RPC:-https://api.mainnet-beta.solana.com}
secrets:
  PAYER_SECRETS:
    file: divvy-keypair.json
`
  );

  fs.writeFileSync(
    path.join(__dirname, "..", "docker-compose.crank.yml"),
    `version: "3.3"
services:
  crank:
    image: "switchboardlabs/crank-turn:dev-v2-09-13-22"
    network_mode: host
    # restart: always
    secrets:
      - PAYER_SECRETS
    environment:
      # Logging
      - VERBOSE=1
      - DEBUG=1
      # Crank
      - CHAIN=solana
      # Solana
      - CLUSTER=devnet
      - RPC_URL=\${RPC_URL:-https://api.devnet.solana.com}
      - SOLANA_CRANK_KEY=${crankAccount.publicKey}
secrets:
  PAYER_SECRETS:
    file: divvy-keypair.json
`
  );

  // write queue json
  fs.writeFileSync(
    path.join(__dirname, "..", "docker-compose.crank.yml"),
    JSON.stringify({
      publicKey: queueAccount.publicKey.toBase58(),
      ...queueData,
      crank: { publicKey: crankAccount.publicKey, ...crankData },
      oracle: {
        publicKey: oracleAccount.publicKey,
        ...oracleData,
        permission: {
          publicKey: permissionAccount.publicKey,
          ...permissionData,
        },
      },
    })
  );

  // write queue env file
  fs.writeFileSync(
    path.join(__dirname, "..", "docker-compose.crank.yml"),
    `
QUEUE_KEY="${queueAccount.publicKey.toBase58()}"
QUEUE_AUTHORITY_KEY="${(queueData.authority as PublicKey).toBase58()}"
CRANK_KEY="${crankAccount.publicKey.toBase58()}"
ORACLE_KEY="${oracleAccount.publicKey.toBase58()}"
ORACLE_PERMISSION_KEY="${permissionAccount.publicKey.toBase58()}"
`
  );
}

setup().then(
  () => process.exit(),
  (error) => {
    console.error("Buffer relayer example failed");
    console.error(error);
    process.exit(-1);
  }
);
