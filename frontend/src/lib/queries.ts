// Queries used by more than one page.
import { useQuery } from "@tanstack/react-query";
import { getChains, getFunds } from "./registry";

/// Chains registered in MultiChainTxRegistry, with the schema keys of each one.
export const useChains = () => useQuery({ queryKey: ["chains"], queryFn: getChains });

export const useFunds = () => useQuery({ queryKey: ["funds"], queryFn: getFunds });
