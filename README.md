# Divvy Example

## Steps

Create a new solana keypair for this example and give it funds

```bash
solana-keygen new -s --no-bip39-passphrase --outfile divvy-keypair.json
solana airdrop 1 divvy-keypair.json
solana airdrop 1 divvy-keypair.json
```

To get the pubkey and balance

```bash
solana-keygen pubkey divvy-keypair.json
solana balance divvy-keypair.json
```

Create your own personal devnet queue, crank, and oracle

```bash
ts-node src/setup.ts
```
