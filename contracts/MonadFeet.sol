// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MonadFeet
 * @notice Core on-chain registry for the Monad Feet social platform.
 *         All user actions — registration, posts, likes, subscriptions,
 *         and daily streaks — are recorded on Monad Mainnet.
 *
 * Deployment:
 *   - Network: Monad Mainnet (chainId 41454)
 *   - RPC: https://rpc.monad.xyz
 *   - Explorer: https://explorer.monad.xyz
 *   - forge create --rpc-url https://rpc.monad.xyz --private-key $PRIVATE_KEY \
 *       contracts/MonadFeet.sol:MonadFeet
 *   - Set VITE_CONTRACT_ADDRESS to the deployed address.
 */
contract MonadFeet {

    // ─── Events ───────────────────────────────────────────────────────────────

    event UserRegistered(address indexed wallet, string username, uint256 timestamp);
    event PostCreated(address indexed author, uint256 indexed postId, string contentUri, uint256 timestamp);
    event PostLiked(address indexed liker, uint256 indexed postId, uint256 timestamp);
    event Subscribed(
        address indexed subscriber,
        address indexed creator,
        uint256 priceWei,
        uint256 expiresAt
    );
    event StreakCheckin(
        address indexed user,
        uint256 currentStreak,
        uint256 totalPoints,
        uint256 timestamp
    );

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct UserInfo {
        bool registered;
        string username;
        uint256 registeredAt;
        uint256 postCount;
        uint256 likesSent;
        uint256 streakPoints;
        uint256 currentStreak;
        uint256 longestStreak;
        uint256 lastCheckin;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    mapping(address => UserInfo) public users;
    mapping(uint256 => address) public postAuthor;                      // DB postId => author
    mapping(uint256 => mapping(address => bool)) public postLikes;      // postId => liker => liked
    mapping(uint256 => uint256) public postLikeCount;                   // postId => count
    mapping(address => mapping(address => uint256)) public subscriptionExpiry; // subscriber => creator => expiry

    address public feeRecipient;
    uint256 public userCount;
    uint256 public totalPostCount;

    uint256 constant SUBSCRIPTION_DURATION = 30 days;
    uint256 constant CREATOR_SHARE_BPS = 8800; // 88.00%

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        feeRecipient = msg.sender;
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyRegistered() {
        require(users[msg.sender].registered, "MonadFeet: not registered");
        _;
    }

    // ─── Registration ─────────────────────────────────────────────────────────

    /**
     * @notice Register a new user. The invite code is validated off-chain;
     *         it is passed here only for event-log transparency.
     */
    function registerUser(string calldata username, string calldata inviteCode) external {
        require(!users[msg.sender].registered, "MonadFeet: already registered");
        require(bytes(username).length >= 1 && bytes(username).length <= 32, "MonadFeet: invalid username");

        users[msg.sender] = UserInfo({
            registered: true,
            username: username,
            registeredAt: block.timestamp,
            postCount: 0,
            likesSent: 0,
            streakPoints: 0,
            currentStreak: 0,
            longestStreak: 0,
            lastCheckin: 0
        });
        userCount++;

        emit UserRegistered(msg.sender, username, block.timestamp);
        // silence unused var warning — inviteCode is intentionally logged off-chain
        (inviteCode);
    }

    // ─── Posts ────────────────────────────────────────────────────────────────

    /**
     * @notice Anchor a post on-chain.
     *         postId is the database primary key; contentUri points to GCS / IPFS.
     */
    function createPost(uint256 postId, string calldata contentUri) external onlyRegistered {
        require(postAuthor[postId] == address(0), "MonadFeet: postId already anchored");

        postAuthor[postId] = msg.sender;
        users[msg.sender].postCount++;
        totalPostCount++;

        emit PostCreated(msg.sender, postId, contentUri, block.timestamp);
    }

    /**
     * @notice Like a post on-chain. Likes are permanent and cannot be reversed.
     */
    function likePost(uint256 postId) external onlyRegistered {
        require(postAuthor[postId] != address(0), "MonadFeet: post not anchored");
        require(!postLikes[postId][msg.sender], "MonadFeet: already liked");

        postLikes[postId][msg.sender] = true;
        postLikeCount[postId]++;
        users[msg.sender].likesSent++;

        emit PostLiked(msg.sender, postId, block.timestamp);
    }

    // ─── Subscriptions ────────────────────────────────────────────────────────

    /**
     * @notice Subscribe to a creator for 30 days.
     *         Sends 88% of msg.value to the creator and 12% to the platform.
     */
    function subscribe(address creator) external payable {
        require(msg.value > 0, "MonadFeet: payment required");
        require(users[creator].registered, "MonadFeet: creator not registered");
        require(creator != msg.sender, "MonadFeet: cannot self-subscribe");

        uint256 creatorAmount = (msg.value * CREATOR_SHARE_BPS) / 10000;
        uint256 feeAmount = msg.value - creatorAmount;

        payable(creator).transfer(creatorAmount);
        payable(feeRecipient).transfer(feeAmount);

        uint256 expiry = block.timestamp + SUBSCRIPTION_DURATION;
        subscriptionExpiry[msg.sender][creator] = expiry;

        emit Subscribed(msg.sender, creator, msg.value, expiry);
    }

    // ─── Streak ───────────────────────────────────────────────────────────────

    /**
     * @notice Record a daily check-in and earn streak points.
     *         Points: 5/day for days 1–6, 10/day for days 7–29, 20/day for 30+.
     */
    function dailyCheckin() external onlyRegistered {
        UserInfo storage u = users[msg.sender];

        uint256 today = block.timestamp / 1 days;
        uint256 lastDay = u.lastCheckin > 0 ? (u.lastCheckin / 1 days) : 0;

        require(today > lastDay, "MonadFeet: already checked in today");

        uint256 newStreak;
        if (u.lastCheckin > 0 && today == lastDay + 1) {
            newStreak = u.currentStreak + 1;
        } else {
            newStreak = 1;
        }

        uint256 pts = newStreak >= 30 ? 20 : newStreak >= 7 ? 10 : 5;

        u.currentStreak = newStreak;
        u.lastCheckin = block.timestamp;
        u.streakPoints += pts;
        if (newStreak > u.longestStreak) u.longestStreak = newStreak;

        emit StreakCheckin(msg.sender, newStreak, u.streakPoints, block.timestamp);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function isSubscribed(address subscriber, address creator) external view returns (bool) {
        return subscriptionExpiry[subscriber][creator] > block.timestamp;
    }

    function getSubscriptionExpiry(address subscriber, address creator) external view returns (uint256) {
        return subscriptionExpiry[subscriber][creator];
    }

    function isPostLikedBy(uint256 postId, address user) external view returns (bool) {
        return postLikes[postId][user];
    }

    function getUserCount() external view returns (uint256) { return userCount; }
    function getPostCount() external view returns (uint256) { return totalPostCount; }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setFeeRecipient(address newRecipient) external {
        require(msg.sender == feeRecipient, "MonadFeet: not authorized");
        require(newRecipient != address(0), "MonadFeet: zero address");
        feeRecipient = newRecipient;
    }
}
