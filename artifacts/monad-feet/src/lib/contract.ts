/** Platform registry on Monad Mainnet. This is NOT an NFT collection. */

export const MONAD_MAINNET_CHAIN_ID = 143;

export const MONAD_FEET_CONTRACT_ADDRESS =
  "0x616929D84ED483a26a568fC97A364e5c5eCBe39D" as const;
export const MONAD_TREASURY_ADDRESS =
  "0x23B4C6DdcA73ba99045E1c0Def939BD41932E773" as const;

/** Feet game writes. Source verification confirmed; set false to pause prompts. */
export const GAME_ENABLED = true;

/**
 * keccak256 of the full live runtime bytecode (eth_getCode) of the verified
 * deployment. Source runtime equivalence confirmed; only metadata differs.
 * Every write refuses to proceed unless the live code hashes to this value.
 */
export const EXPECTED_RUNTIME_CODE_HASH =
  "0x0e57820b5da0dce2e9154720eb1fcfccaf7cf80e0578ec190b8d53c0fd331678" as const;

/** Onchain playFeetGame action ids (match backend actions[].id). */
export const GAME_ACTION_IDS = [1, 2, 3] as const;

// eth_getCode and the selectors/read calls were checked on chain 143.
// Source provenance is NOT explorer-verified. Writes additionally check code at
// call time, and only confirmed successful receipts count as completed actions.
export const CONTRACT_DEPLOYED = true;

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
    name: "playFeetGame",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "actionType", type: "uint8" }],
    outputs: [],
  },
  {
    name: "dailyCheckin",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "updateProfile",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "bio", type: "string" },
      { name: "avatarUri", type: "string" },
    ],
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
       { name: "name", type: "string" },
       { name: "bio", type: "string" },
       { name: "avatarUri", type: "string" },
    ],
  },
  {
    name: "gameStates",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "lastPlayDay", type: "uint256" },
      { name: "washCount", type: "uint8" },
      { name: "massageCount", type: "uint8" },
      { name: "pedicureCount", type: "uint8" },
      { name: "totalPurchases", type: "uint256" },
    ],
  },
  {
    name: "feeRecipient",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
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
  {
    name: "ProfileUpdated",
    type: "event",
    inputs: [
      { name: "wallet", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "bio", type: "string", indexed: false },
      { name: "avatarUri", type: "string", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    name: "GamePlayed",
    type: "event",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "actionType", type: "uint8", indexed: false },
      { name: "pointsEarned", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    name: "InviteEarned",
    type: "event",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
] as const;
