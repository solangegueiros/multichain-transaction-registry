import type { NetworkConfig } from "hardhat/types/config";

/// Exits the script with a clear message when the private key in .env is empty or
/// malformed. Without this, Hardhat fails with "Field.fromBytes: expected 32 bytes".
export function assertPrivateKey(networkConfig: NetworkConfig): void {
  // The local simulated network uses its own test accounts
  if (networkConfig.type === "edr-simulated") return;

  const key = (process.env.SEPOLIA_PRIVATE_KEY ?? "").trim();

  if (key === "") {
    fail("SEPOLIA_PRIVATE_KEY is empty. Set it in the .env at the repository root (see .env.example).");
  }

  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) {
    fail("SEPOLIA_PRIVATE_KEY is invalid: expected 64 hexadecimal characters (with or without 0x).");
  }
}

// Exits without throwing, so Hardhat prints neither a stack trace nor "unexpected error"
function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}
