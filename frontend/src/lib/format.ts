/// "0x1234…abcd" for long hashes and addresses.
export const shorten = (value: string, head = 8, tail = 6): string =>
  value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;

/// Unix seconds as a local date and time. "—" for zero.
export const dateTime = (seconds: bigint | number): string =>
  Number(seconds) === 0 ? "—" : new Date(Number(seconds) * 1000).toLocaleString("pt-BR");

/// Integer amount with thousands separators. Amounts are in the smallest unit of the asset.
export const amount = (value: bigint): string => value.toLocaleString("pt-BR");
