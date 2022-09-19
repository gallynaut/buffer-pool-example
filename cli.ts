#!/usr/bin/env ts-node-esm

/* eslint-disable @typescript-eslint/no-loop-func */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-var-requires */
const yargs = require("yargs");
const { hideBin } = require("yargs/helpers");
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { findOrCreateKeypair, jsonReplacers } from "./src/utils";
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import {
  BufferRelayerAccount,
  CrankAccount,
  JobAccount,
  loadSwitchboardProgram,
  OracleAccount,
  OracleQueueAccount,
  PermissionAccount,
  programWallet,
  SwitchboardPermission,
  SwitchboardProgram,
} from "@switchboard-xyz/switchboard-v2";
import { BN } from "bn.js";
import { OracleJob } from "@switchboard-xyz/common";
import * as anchor from "@project-serum/anchor";
import * as borsh from "@project-serum/borsh";

export const CHECK_ICON = chalk.green("\u2714");
export const FAILED_ICON = chalk.red("\u2717");

yargs(hideBin(process.argv))
  .scriptName("buffer-pool")
  .command(
    "setup",
    "setup a buffer pool",
    (y: any) => {
      return y;
    },
    async function (argv: any) {
      const { rpcUrl, keypairPath } = argv;
      let { program, config } = await loadCli(rpcUrl);
      const payerKeypair = programWallet(program);

      // Create a new OracleQueue
      const queueAccount = await OracleQueueAccount.create(program, {
        name: Buffer.from("buffer pool queue"),
        metadata: Buffer.from("buffer pool queue"),
        reward: new BN(0),
        minStake: new BN(0),
        authority: payerKeypair.publicKey,
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
        name: Buffer.from("buffer pool crank"),
        metadata: Buffer.from("buffer pool crank"),
        queueAccount,
        maxRows: 100,
      });
      const crankData = await crankAccount.loadData();
      console.log(
        chalk.green(
          "\u2714 ",
          "Created Crank",
          crankAccount.publicKey.toBase58()
        )
      );

      // Create an oracle
      const oracleAccount = await OracleAccount.create(program, {
        name: Buffer.from("buffer pool oracle"),
        metadata: Buffer.from("buffer pool oracle"),
        oracleAuthority: payerKeypair,
        queueAccount,
      });
      const oracleData = await oracleAccount.loadData();
      console.log(
        chalk.green(
          "\u2714 ",
          "Created Oracle",
          oracleAccount.publicKey.toBase58()
        )
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
        authority: payerKeypair,
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
        path.join(__dirname, "docker-compose.oracle.yml"),
        `version: "3.3"
services:
  oracle:
    image: "switchboardlabs/node:dev-v2-09-19-22"
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
    file: buffer-pool-keypair.json
`
      );

      config = {
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
      };

      saveCli(config);

      process.exit(0);
    }
  )
  .command(
    "add [jobDefinition] [updateInterval]",
    "add a buffer relayer account to the pool",
    (y: any) => {
      return y
        .positional("jobDefinition", {
          type: "string",
          describe: "filesystem path to job definition file",
          required: true,
        })
        .positional("updateInterval", {
          type: "string",
          describe: "minimum time between open round calls",
          default: 30,
        });
    },
    async function (argv: any) {
      const { rpcUrl, jobDefinition, updateInterval } = argv;
      let { program, config } = await loadCli(rpcUrl);
      const payerKeypair = programWallet(program);

      if (!("publicKey" in config)) {
        throw new Error(`Queue missing from config`);
      }
      const queueAccount = new OracleQueueAccount({
        program,
        publicKey: new PublicKey(config.publicKey),
      });

      const jobDefPath = path.join(process.cwd(), jobDefinition);
      if (!fs.existsSync(jobDefPath)) {
        throw new Error(`Failed to find job definition file at ${jobDefPath}`);
      }

      const jobDef = JSON.parse(fs.readFileSync(jobDefPath, "utf-8"));
      if (
        !("tasks" in jobDef) ||
        !Array.isArray(jobDef.tasks) ||
        jobDef.tasks.length === 0
      ) {
        throw new Error(
          `Failed to find 'tasks' in job definition file at ${jobDefPath}`
        );
      }
      const oracleJob = OracleJob.fromObject(jobDef);

      //   const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
      //   const jobKeypair = Keypair.generate();
      //   const data = Buffer.from(OracleJob.encodeDelimited(oracleJob).finish());
      //   await program.methods
      //     .jobInit({
      //       name: Buffer.from(""),
      //       expiration: new BN(0),
      //       stateBump,
      //       data,
      //       size: data.byteLength,
      //     })
      //     .accounts({
      //       job: jobKeypair.publicKey,
      //       authority: payerKeypair.publicKey,
      //       programState: stateAccount.publicKey,
      //       payer: payerKeypair.publicKey,
      //       systemProgram: SystemProgram.programId,
      //     })
      //     .signers([jobKeypair])
      //     .rpc();
      //   const jobAccount = new JobAccount({
      //     program,
      //     publicKey: jobKeypair.publicKey,
      //   });
      const jobAccount = await JobAccount.create(program, {
        authority: payerKeypair.publicKey,
        data: Buffer.from(OracleJob.encodeDelimited(oracleJob).finish()),
      });

      const bufferAccount = await BufferRelayerAccount.create(program, {
        queueAccount,
        authority: payerKeypair.publicKey,
        jobAccount,
        minUpdateDelaySeconds: updateInterval,
        name: Buffer.from(""),
      });
      console.log(
        chalk.green(
          "\u2714 ",
          "Created Buffer",
          bufferAccount.publicKey.toBase58()
        )
      );
      const permissionAccount = await PermissionAccount.create(program, {
        granter: queueAccount.publicKey,
        grantee: bufferAccount.publicKey,
        authority: payerKeypair.publicKey, // divvyKeypair.publicKey
      });

      // set oracle permissions
      await permissionAccount.set({
        permission: SwitchboardPermission.PERMIT_ORACLE_QUEUE_USAGE,
        authority: payerKeypair,
        enable: true,
      });
      const permissionData = await permissionAccount.loadData();
      console.log(
        chalk.green(
          "\u2714 ",
          "Created Permission",
          permissionAccount.publicKey.toBase58()
        )
      );

      let buffers = "buffers" in config ? config.buffers : [];
      buffers.push(bufferAccount.publicKey.toBase58());

      saveCli({
        ...config,
        buffers,
      });

      process.exit(0);
    }
  )
  .command(
    "update [bufferKey]",
    "update a buffer relayer account",
    (y: any) => {
      return y.positional("bufferKey", {
        type: "string",
        describe: "public key of the BufferRelayerAccount",
        required: true,
      });
    },
    async function (argv: any) {
      const { rpcUrl, bufferKey } = argv;
      let { program, config } = await loadCli(rpcUrl);
      const payerKeypair = programWallet(program);

      const bufferAccount = new BufferRelayerAccount({
        program,
        publicKey: new PublicKey(bufferKey),
      });
      const bufferData = await bufferAccount.loadData();

      const solanaClock = await SolanaClock.fetch(program.provider.connection);
      const solanaTime = solanaClock.unixTimestamp;
      const timeDelta =
        bufferData.currentRound.roundOpenTimestamp.sub(solanaTime);

      console.log(`Current Solana Time: ${solanaTime}`);
      console.log(
        `Next Available Update Time: ${bufferData.currentRound.roundOpenTimestamp}`
      );
      console.log(`Time Delta: ${timeDelta}`);

      const signature = await bufferAccount.openRound();
      console.log(chalk.green("\u2714 ", "Open Round Signature", signature));

      process.exit(0);
    }
  )
  .command(
    "watch [bufferKey]",
    "watch a buffer relayer account for a new value",
    (y: any) => {
      return y.positional("bufferKey", {
        type: "string",
        describe: "public key of the BufferRelayerAccount",
        required: true,
      });
    },
    async function (argv: any) {
      const { rpcUrl, keypairPath } = argv;
      let { program, config } = await loadCli(rpcUrl);
    }
  )
  .options({
    // keypairPath: {
    //   type: "string",
    //   alias: "k",
    //   describe: "filesystem path to a keypair file",
    //   default: "buffer-pool-keypair.json",
    //   required: true,
    // },
    rpcUrl: {
      type: "string",
      alias: "u",
      describe: "Alternative RPC URL",
      default: "https://api.devnet.solana.com",
    },
  })
  .help().argv;

const configPath = path.join(__dirname, "Buffer_Pool_Config.json");

async function loadCli(
  rpcUrl: string
): Promise<{ program: SwitchboardProgram; config: Record<string, any> }> {
  const connection = new Connection(rpcUrl, { commitment: "confirmed" });

  const keypair = await findOrCreateKeypair(connection);
  const program = await loadSwitchboardProgram("devnet", connection, keypair);

  let config: Record<string, any> = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }

  return { program, config };
}

function saveCli(config: Record<string, any>) {
  fs.writeFileSync(configPath, JSON.stringify(config, jsonReplacers, 2));
}

export interface SolanaClockDataFields {
  slot: anchor.BN;
  epochStartTimestamp: anchor.BN;
  epoch: anchor.BN;
  leaderScheduleEpoch: anchor.BN;
  unixTimestamp: anchor.BN;
}

export class SolanaClock {
  slot: anchor.BN;
  epochStartTimestamp: anchor.BN;
  epoch: anchor.BN;
  leaderScheduleEpoch: anchor.BN;
  unixTimestamp: anchor.BN;

  static readonly layout = borsh.struct([
    borsh.u64("slot"),
    borsh.i64("epochStartTimestamp"),
    borsh.u64("epoch"),
    borsh.u64("leaderScheduleEpoch"),
    borsh.i64("unixTimestamp"),
  ]);

  constructor(fields: SolanaClockDataFields) {
    this.slot = fields.slot;
    this.epochStartTimestamp = fields.epochStartTimestamp;
    this.epoch = fields.epoch;
    this.leaderScheduleEpoch = fields.epochStartTimestamp;
    this.unixTimestamp = fields.unixTimestamp;
  }

  static decode(data: Buffer): SolanaClock {
    const dec = SolanaClock.layout.decode(data) as SolanaClockDataFields;

    return new SolanaClock({
      slot: dec.slot,
      epochStartTimestamp: dec.epochStartTimestamp,
      epoch: dec.epoch,
      leaderScheduleEpoch: dec.leaderScheduleEpoch,
      unixTimestamp: dec.unixTimestamp,
    });
  }

  static async fetch(connection: Connection): Promise<SolanaClock> {
    const sysclockInfo = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    if (!sysclockInfo) {
      throw new Error(`Failed to fetch SYSVAR_CLOCK AccountInfo`);
    }
    const clock = SolanaClock.decode(sysclockInfo.data);
    return clock;
  }
}
