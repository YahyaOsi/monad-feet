/**
 * MonadFeet Smart Contract — Monad Mainnet (chainId 143 / 0x8f)
 *
 * Deploy:
 *   forge create --rpc-url https://rpc.monad.xyz \
 *     --private-key $PRIVATE_KEY contracts/MonadFeet.sol:MonadFeet
 *
 * Then set VITE_CONTRACT_ADDRESS to the deployed address.
 * Explorer: https://monvision.io
 */

export const MONAD_MAINNET_CHAIN_ID = 143;

export const MONAD_FEET_CONTRACT_ADDRESS =
  (import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}`) ??
  "0x0000000000000000000000000000000000000000";

export const CONTRACT_DEPLOYED =
  MONAD_FEET_CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000";

export const MONAD_FEET_ABI = [
  // ── Write ──────────────────────────────────────────────────────────────────
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
    name: "createPost",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "postId", type: "uint256" },
      { name: "contentUri", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "likePost",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "postId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "subscribe",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [],
  },
  {
    name: "dailyCheckin",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  // ── Read ───────────────────────────────────────────────────────────────────
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
      { name: "likesSent", type: "uint256" },
      { name: "streakPoints", type: "uint256" },
      { name: "currentStreak", type: "uint256" },
      { name: "longestStreak", type: "uint256" },
      { name: "lastCheckin", type: "uint256" },
    ],
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
  {
    name: "isPostLikedBy",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "postId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "postLikeCount",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
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
    name: "getSubscriptionExpiry",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "subscriber", type: "address" },
      { name: "creator", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "postAuthor",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  // ── Events ─────────────────────────────────────────────────────────────────
  {
    name: "UserRegistered",
    type: "event",
    inputs: [
      { name: "wallet", type: "address", indexed: true },
      { name: "username", type: "string", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    name: "PostCreated",
    type: "event",
    inputs: [
      { name: "author", type: "address", indexed: true },
      { name: "postId", type: "uint256", indexed: true },
      { name: "contentUri", type: "string", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    name: "PostLiked",
    type: "event",
    inputs: [
      { name: "liker", type: "address", indexed: true },
      { name: "postId", type: "uint256", indexed: true },
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
