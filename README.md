# Buffer Pool Example

## Setup

```bash
yarn install
yarn link
```

## Steps

Create a new solana keypair for this example and give it funds

```bash
solana-keygen new -s --no-bip39-passphrase --outfile buffer-pool-keypair.json
solana airdrop 1 buffer-pool-keypair.json
solana airdrop 1 buffer-pool-keypair.json
```

To get the pubkey and balance

```bash
solana-keygen pubkey buffer-pool-keypair.json
solana balance buffer-pool-keypair.json
```

Create your own personal devnet queue, crank, and oracle

```bash
buffer-pool setup
```

Add a buffer relayer

```bash
# buffer-pool add [JOBDEFINITION] [UPDATEINTERVAL]
buffer-pool add jobs/todo.1.json 30
```

Start your oracle

```bash
docker-compose -f docker-compose.oracle.yml up
```

Request a buffer relayer update

```bash
# buffer-pool update [BUFFERRELAYERPUBKEY]
buffer-pool update ABr5bmaSTs958bWfaz7eFi16syx2YyTJG4J8tWYKyYo
```

Watch the pool of buffer relayers and call openRound when ready

```bash
# buffer-pool crank [UPDATEDELAY]
buffer-pool crank 60
```
