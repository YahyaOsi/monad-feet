/**
 * MonadFeet Smart Contract Integration
 *
 * This module wires the deployed MonadFeet.sol contract to the frontend
 * via wagmi. Every write operation (register, post, like, subscribe, check-in)
 * is submitted as a real on-chain transaction on Monad Testnet.
 *
 * To deploy:
 *   1. Install Foundry: curl -L https://foundry.paradigm.xyz | bash
 *   2. Set your private key: export PRIVATE_KEY=<your_key>
 *   3. forge create --rpc-url https://testnet.monad.xyz --private-key $PRIVATE_KEY contracts/MonadFeet.sol:MonadFeet
 *   4. Copy the deployed address below.
 */

export const MONAD_FEET_CONTRACT_ADDRESS =
  (import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}`) ?? "0x0000000000000000000000000000000000000000";

export const MONAD_FEET_ABI = [
  // User Registration
  {
    name: "registerUser",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "username", type: "string" },
      { name: "inviteCode", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "registerInviteCode",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "code", type: "string" }],
    outputs: [],
  },
  // Posts
  {
    name: "createPost",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "ipfsCid", type: "string" }],
    outputs: [{ name: "postHash", type: "bytes32" }],
  },
  {
    name: "likePost",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "postHash", type: "bytes32" }],
    outputs: [],
  },
  // Subscriptions (payable — sends MON, split 88/12 on-chain)
  {
    name: "subscribe",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [],
  },
  {
    name: "isSubscribed",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "subscriber", type: "address" },
      { name: "creator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  // Streak
  {
    name: "dailyCheckin",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  // Views
  {
    name: "users",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "username", type: "string" },
      { name: "registeredAt", type: "uint256" },
      { name: "postCount", type: "uint256" },
      { name: "streakPoints", type: "uint256" },
      { name: "currentStreak", type: "uint256" },
      { name: "lastCheckin", type: "uint256" },
    ],
  },
  {
    name: "getUserCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getPostCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getInviteCodes",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "", type: "string[]" }],
  },
  // Events
  {
    name: "UserRegistered",
    type: "event",
    inputs: [
      { name: "wallet", type: "address", indexed: true },
      { name: "username", type: "string", indexed: false },
      { name: "inviteCode", type: "string", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    name: "PostCreated",
    type: "event",
    inputs: [
      { name: "author", type: "address", indexed: true },
      { name: "postHash", type: "bytes32", indexed: true },
      { name: "ipfsCid", type: "string", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    name: "Subscribed",
    type: "event",
    inputs: [
      { name: "subscriber", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "priceWei", type: "uint256", indexed: false },
      { name: "expiresAt", type: "uint256", indexed: false },
    ],
  },
  {
    name: "StreakCheckin",
    type: "event",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "currentStreak", type: "uint256", indexed: false },
      { name: "totalPoints", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
] as const;
