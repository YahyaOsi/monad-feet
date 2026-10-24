export interface DocItem { t: string; d: string }
export interface DocSection { id: string; title: string; paras: string[]; items?: DocItem[] }

export const TREATMENTS = [
  { name: "Wash", price: "1.43 MON", doubles: "2, 4, 7, 10", count: "4 rewarded doubles", total: "285", invite: "Points only, no invite" },
  { name: "Massage", price: "14.3 MON", doubles: "2, 3, 4, 6, 7, 9, 10", count: "7 rewarded doubles", total: "2,065", invite: "Invite every 7 verified lifetime purchases" },
  { name: "Pedicure", price: "143 MON", doubles: "1 through 10", count: "10 rewarded doubles", total: "30,690", invite: "Invite every 3 verified lifetime purchases" },
];

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "overview",
    title: "Overview",
    paras: [
      "Monad Feet is a social and creator platform on Monad Mainnet. Members use a wallet to build a profile, share photos, discover creators, subscribe in MON and earn points through daily participation.",
      "The platform brings familiar social features together with verified wallet activity. Key transactions have a public record, while photos, messages and everyday app data use the platform services.",
    ],
  },
  {
    id: "access",
    title: "Getting in",
    paras: [
      "Join with an unused invite code or a CHOG Genesis NFT in your connected wallet. CHOG ownership is verified on Monad Mainnet against 0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763. Registration still requires a successful wallet transaction and network gas.",
      "CHOG and Monad Feet are separate collections. Accounts admitted through CHOG must keep a CHOG NFT in their admission wallet. Ownership and the ChogNFT holder badge are rechecked, including for existing members. Invited accounts do not lose membership when they transfer an NFT. Monad Feet NFT access is not available; the mint is coming soon.",
    ],
  },
  {
    id: "invites",
    title: "Invite codes",
    paras: [
      "Each invite code admits one new member. You can find your earned codes in your wallet page and share an unused code with a friend. A code is consumed when the new member completes registration, not when it is copied.",
      "Invites can come from the Monad Feet team and eligible rewards inside the app. Social tasks on X award points, not invite codes.",
    ],
  },
  {
    id: "profile",
    title: "Wallet profile",
    paras: [
      "Your profile is tied to the wallet you connect. Choose a unique username, display name, picture and short bio. Public profiles can be opened from share links, even by visitors who are not signed in.",
      "Returning members sign a wallet message to confirm their identity. Signing in does not require a payment. Actions that record a transaction on Monad may require a separate approval and a network fee.",
    ],
  },
  {
    id: "posts",
    title: "Photo posts",
    paras: [
      "Share a photo with an optional caption. Creators can publish public posts or reserve content for paid subscribers. Public posts and profiles have links that can be shared outside the app.",
      "Every new public or exclusive post requires an image and a successful transaction on Monad Mainnet. The wallet approval authorises the registry to record your authorship, post ID and content commitment; it does not authorise unrelated spending. Network gas is paid separately. Captions and images remain in app storage, not fully on chain.",
      "A draft becomes visible only after the app verifies its successful matching receipt. Rejecting or reverting the transaction leaves it unpublished. If the transaction succeeds but app sync fails, resume the pending publication with its original hash instead of signing again.",
      "No app user, including the author or an administrator, can delete a published post through the application. There is no removal from public app views through deletion. On chain authorship, post IDs, commitments, transaction hashes and likes are permanent. Older unsigned records are preserved privately for their authors until they confirm publication.",
      "Latest sorts by the app creation date with the newest posts first. Top ranks the loaded posts by verified recorded likes, with newer posts first when counts tie. App totals count verified publications stored here; the registry lifetime count may also include anchors still awaiting app recovery. Unconfirmed historical app post records are counted separately and are excluded from the published total.",
    ],
    items: [
      { t: "Public posts", d: "Visible to everyone who opens the link or browses the feed." },
      { t: "Paid posts", d: "Reserved for active verified subscribers of the creator, with the same signed publication requirement." },
      { t: "Likes", d: "A new like requires its own successful Monad transaction. Already recorded likes can be synced again without another transaction. The deployed registry has no unlike function, so confirmed likes cannot be reversed." },
      { t: "Share links", d: "Visitors can read public posts and profiles without joining. Sharing a link does not grant access to paid content." },
    ],
  },
  {
    id: "feed",
    title: "Feed and alerts",
    paras: [
      "The feed and alerts help you stay up to date with community activity. Open a like or comment notification to visit the related post. Select the member name or picture to open their profile.",
      "Comments support nested replies, so a conversation can branch under the post it belongs to.",
      "You can mark notifications as read and choose alert preferences. Deleting one of your comments preserves replies from other people.",
    ],
  },
  {
    id: "discover",
    title: "Discover",
    paras: [
      "Discover helps you find people and posts. You can search, browse trending posts and see which members are online right now.",
    ],
  },
  {
    id: "subscriptions",
    title: "Subscriptions",
    paras: [
      "Paid subscriptions are live. Creators choose a monthly price in MON, and fans subscribe to enjoy exclusive content for 30 days.",
      "An active subscription shows its remaining access time instead of another subscribe button. Once it expires, the option becomes available again for renewal. Each subscription payment is a wallet transaction.",
      "Creators may also allow subscriber only direct messages. This is optional and set by each creator.",
      "The Private Feed collects the paid posts from the creators you subscribe to in one place.",
    ],
  },
  {
    id: "messages",
    title: "Direct messages",
    paras: [
      "Direct messages let members stay in touch. Some creators keep messaging open, while others require an active subscription.",
      "Inbox controls help you manage conversations. Removing a conversation from your inbox only changes your own view. It does not erase the other member copy of the message history.",
    ],
  },
  {
    id: "checkins",
    title: "Daily check ins",
    paras: [
      "Check in once per UTC day to build a streak and earn points. Streak milestones can award extra points and invites. Check ins are recorded on chain, so each one is a wallet transaction.",
      "A foot spa purchase does not count as a daily check in. If a successful check in is missing from the app, use the transaction recovery option before sending another transaction.",
    ],
  },
  {
    id: "daily-bonus",
    title: "Daily bonus",
    paras: [
      "A new bonus task appears each UTC day above milestone progress. The app rotates through 12 tasks, including posting, replying, supporting creators, inviting a friend and visiting the foot spa.",
      "The task card shows what to do, your progress and the points available. Complete the activity for that day and claim the reward once. The server checks eligible activity before crediting points.",
    ],
    items: [
      { t: "Check in", d: "Complete the daily check in task for 30 bonus points." },
      { t: "Publish a post", d: "Complete the publishing task for 70 bonus points." },
      { t: "Subscribe", d: "Complete the creator subscription task for 500 bonus points." },
      { t: "Exclusive content", d: "Complete the exclusive publishing task for 200 bonus points." },
    ],
  },
  {
    id: "points",
    title: "Points and leaderboards",
    paras: [
      "Points come from check ins, rotating daily bonuses, foot spa rewards and social tasks. Leaderboards and badges show who is active, and a weekly stats card can be shared to X.",
      "Social tasks on X give points only. They are self reported and are not verified through X. Points have no fixed cash value and no token exchange rate. Points earned under earlier versions of the app remain valid.",
      "App points are separate from the balance held in the originally deployed contract, so the two numbers can differ.",
      "Points record current app activities; leaderboard positions are rankings, not confirmed rewards. Points are not tokens. Potential future token plans and unannounced rewards do not guarantee eligibility, a reward, a date or a conversion rate.",
    ],
  },
  {
    id: "foot-spa",
    title: "Foot spa",
    paras: [
      "Choose Wash, Massage or Pedicure in the daily foot spa. Each costs a fixed amount of MON and awards points. You can make up to 10 purchases of each treatment per UTC day. Each purchase is its own transaction, so a quantity of five means five transactions.",
      "Select a quantity to preview the total price and points before starting. Every purchase awards points. The doubling purchases shown below increase the reward for that purchase and later purchases in the same day.",
      "Wash gives points only. Massage earns an invite for every 7 verified lifetime purchases, and pedicure earns one for every 3.",
    ],
  },
  {
    id: "badges",
    title: "Badges and weekly stats",
    paras: [
      "Beta ended on October 10 2026. The Early Beta User badge recognises accounts registered before October 10 2026 at 00:00 UTC. Eligible members keep it; later accounts cannot earn it. Current CHOG Genesis holders receive the ChogNFT holder badge after an ownership check.",
      "Your weekly summary highlights recent activity. Share it to X with the project account @MonadFeet to celebrate your progress and help others discover the community.",
    ],
  },
  {
    id: "nft",
    title: "Monad Feet NFT",
    paras: [
      "The Monad Feet NFT collection is planned as a membership key with future ecosystem benefits. An OpenSea mainnet launch is planned for October 2026. A verified contract and official mint link will be announced through the project channels.",
      "Following issues with the previous Scatter mint, earlier holders are planned to receive their matching NFTs through a free airdrop. Use the original collection details and NFT ID on MonadVision to inspect previous reveal metadata.",
      "NFT point boosts are planned, not active rewards. The tiers below describe the announced design. Exact amounts for Rare and Legendary have not been published.",
    ],
    items: [
      { t: "Common", d: "Planned app access." },
      { t: "Uncommon", d: "Planned app access and a 2 percent point boost." },
      { t: "Rare", d: "Planned app access and a medium point boost." },
      { t: "Epic", d: "Planned app access and a 3 percent point boost." },
      { t: "Legendary", d: "Planned app access and the maximum point boost." },
      { t: "CHOG access", d: "CHOG is a separate collection with verified admission without an invite on Monad Mainnet. Hold it in the admission wallet to retain NFT based access. Monad Feet rarity boosts do not apply to CHOG." },
    ],
  },
  {
    id: "token",
    title: "The $MFEET ecosystem",
    paras: [
      "$MFEET is the planned ecosystem token on Monad Mainnet, with a launch and prebuy event targeted for Q4 2026. Payments currently use MON. Support for $MFEET transactions and earnings is a future plan.",
      "The roadmap includes mainnet NFT holder benefits, access to the prebuy event and a token airdrop. Final terms, allocations and eligibility will be announced through official channels.",
      "App points are intended for future community rewards. There is no fixed cash value, token exchange rate or guaranteed allocation. Participation does not promise a financial return.",
    ],
  },
  {
    id: "architecture",
    title: "How it is built",
    paras: [
      "On chain: selected registrations, post proofs, payments and check ins. Off chain: photos, messages, profiles and other app data.",
      "This split keeps everyday use fast and affordable while giving key actions a public record. It also means some data depends on the Monad Feet servers.",
    ],
  },
  {
    id: "safety",
    title: "Wallet safety",
    paras: ["Monad Feet uses wallet connections, sign in messages and transaction approvals. Read each request in your wallet before accepting it."],
    items: [
      { t: "Never share keys", d: "No one from Monad Feet will ask for your seed phrase or private key. Do not enter them anywhere." },
      { t: "Check each prompt", d: "Read the network, the amount and the address before approving. Reject anything unexpected." },
      { t: "Use official links", d: "Only trust links published on the official X and Telegram accounts." },
      { t: "Invite codes", d: "Share an invite code only with people you know. Each code gives access to the community." },
      { t: "Shared access", d: "Use one wallet per person. Do not share a wallet, and do not give others control of yours." },
    ],
  },
  {
    id: "privacy",
    title: "Privacy and settings",
    paras: [
      "Public posts and profiles can be viewed outside the member community. Private content still requires an active subscription. Decide what you want to share before publishing.",
      "Settings include alert preferences and blocked users. Optional usage analytics can be enabled or disabled. Declining analytics does not prevent you from using the app.",
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    paras: ["Most problems can be solved with a few checks."],
    items: [
      { t: "Wallet will not connect", d: "Unlock your wallet, refresh the page and try again. Make sure the wallet is set to Monad Mainnet." },
      { t: "Transaction pending", d: "Wait a moment and check your wallet activity before trying again, to avoid paying twice." },
      { t: "Invite code rejected", d: "Check for typing errors and make sure the code has not already been used." },
      { t: "Points look different", d: "App points include history from earlier versions and differ from the original contract balance." },
      { t: "Still stuck", d: "Ask in the Telegram community or message the project on X." },
    ],
  },
  {
    id: "faq",
    title: "FAQ",
    paras: [],
    items: [
      { t: "Do I need an NFT to join?", d: "No. An unused invite is an independent admission route. Current CHOG Genesis holders can also join without an invite after verified ownership checks." },
      { t: "Is the CHOG NFT the same as the Monad Feet NFT?", d: "No. CHOG Genesis access is available. Monad Feet NFT access is not available yet and its mint is coming soon." },
      { t: "Are points worth money?", d: "No. Points have no fixed cash value and no token exchange rate." },
      { t: "Are X tasks verified?", d: "No. They are self reported and give points only." },
      { t: "Can I buy a token?", d: "No token sale is open. MFEET is a plan, and details will be announced later." },
    ],
  },
];

export interface RoadmapStage { id: string; status: "Completed" | "Current" | "Planned"; when: string; title: string; points: string[] }

export const ROADMAP: RoadmapStage[] = [
  {
    id: "testnet",
    status: "Completed",
    when: "May 2025 to November 2025",
    title: "Testnet mints and reveals",
    points: [
      "Testnet mints and reveals were run for the community.",
      "Community edition cards were shared on X.",
      "The first ideas for an app and a token were drafted.",
    ],
  },
  {
    id: "mainnet-app",
    status: "Current",
    when: "October 2026",
    title: "Mainnet app is live",
    points: [
      "Wallet profiles and invite code admission bring the community onto Monad Mainnet.",
      "Beta ended on October 10 2026. Eligible existing members keep their Early Beta User badge; new registrations do not receive it.",
      "Public and exclusive publishing require verified successful Monad transactions. App post deletion is disabled for everyone.",
      "Photo posts, public share links and nested replies support community conversations.",
      "Creators offer 30 day MON subscriptions, exclusive posts and optional subscriber messaging.",
      "Daily check ins, rotating bonus tasks and the foot spa reward participation.",
      "Discover, search, trending posts and clickable notifications help members stay connected.",
      "Leaderboards, profile badges and weekly stats highlight community progress.",
    ],
  },
  {
    id: "opensea",
    status: "Planned",
    when: "October 2026",
    title: "OpenSea collection launch",
    points: [
      "A Monad Feet collection is planned for OpenSea. No contract or mint link has been published yet.",
      "Previous reveal metadata can be checked on MonadVision using the original collection details and NFT ID.",
      "Holders of a previous Scatter mint are planned to receive a matching NFT as a free airdrop.",
      "Planned rarity tiers: common gives access, uncommon gives a 2 percent points boost, rare gives a medium boost, epic gives 3 percent and legendary gives the maximum boost. Rare and legendary amounts are not set yet.",
      "All boosts are planned. None are active in the app.",
    ],
  },
  {
    id: "nft-access",
    status: "Current",
    when: "October 2026",
    title: "NFT admission",
    points: [
      "CHOG Genesis holders can join without an invite after live Monad ownership verification and signed registration.",
      "New and existing current holders receive the ChogNFT holder badge. Accounts admitted through an NFT retain access while the NFT is in their admission wallet.",
      "Monad Feet NFT admission is not available yet. The mint is coming soon; a date alone will not enable access.",
    ],
  },
  {
    id: "mfeet",
    status: "Planned",
    when: "Q4 2026",
    title: "$MFEET prebuy and launch",
    points: [
      "The $MFEET token prebuy event and launch on Monad Mainnet are targeted for Q4 2026.",
      "Future plans include token payments and earnings alongside MON, plus mainnet NFT holder benefits and an airdrop.",
      "Terms and eligibility will be announced. No supply allocation, rate or financial value is promised.",
    ],
  },
];
