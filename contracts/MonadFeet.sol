// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MonadFeet
 * @notice Core on-chain registry for the Monad Feet platform.
 *         Stores user registrations, posts, subscriptions, and streak check-ins
 *         directly on the Monad blockchain for full decentralization.
 *
 * Deployment:
 *   - Network: Monad Testnet (chainId 10143)
 *   - RPC: https://testnet.monad.xyz
 *   - After deploying, set CONTRACT_ADDRESS env var and update
 *     artifacts/monad-feet/src/lib/contract.ts with the deployed address + ABI.
 */
contract MonadFeet {

    // ─── Events ───────────────────────────────────────────────────────────────

    event UserRegistered(address indexed wallet, string username, string inviteCode, uint256 timestamp);
    event PostCreated(address indexed author, bytes32 indexed postHash, string ipfsCid, uint256 timestamp);
    event PostLiked(address indexed liker, bytes32 indexed postHash, uint256 timestamp);
    event Subscribed(address indexed subscriber, address indexed creator, uint256 priceWei, uint256 expiresAt);
    event StreakCheckin(address indexed user, uint256 currentStreak, uint256 totalPoints, uint256 timestamp);
    event InviteCodeGenerated(address indexed owner, string code, uint256 timestamp);
    event BadgeEarned(address indexed user, address indexed creator, string badgeType, uint256 timestamp);

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct UserRecord {
        bool registered;
        string username;
        uint256 registeredAt;
        uint256 postCount;
        uint256 streakPoints;
        uint256 currentStreak;
        uint256 lastCheckin;
    }

    struct PostRecord {
        address author;
        string ipfsCid;      // IPFS CID for image + content JSON
        uint256 likeCount;
        uint256 createdAt;
        bool exists;
    }

    struct SubscriptionRecord {
        bool active;
        uint256 expiresAt;
        uint256 consecutiveMonths;
        uint256 priceWei;
        bytes32 txHash;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    address public owner;
    uint256 public platformFeeBps = 1200; // 12% in basis points

    mapping(address => UserRecord) public users;
    mapping(bytes32 => PostRecord) public posts;  // postHash => PostRecord
    mapping(bytes32 => bool) public postLikes;    // keccak256(liker, postHash) => bool
    mapping(bytes32 => SubscriptionRecord) public subscriptions; // keccak256(subscriber, creator) => sub
    mapping(string => address) public inviteCodeOwner; // inviteCode => owner
    mapping(string => bool) public inviteCodeUsed;     // inviteCode => used
    mapping(address => string[]) public userInviteCodes;

    address[] public allUsers;
    bytes32[] public allPosts;

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyRegistered() {
        require(users[msg.sender].registered, "Not registered");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ─── User Registration ────────────────────────────────────────────────────

    function registerUser(
        string calldata username,
        string calldata inviteCode
    ) external {
        require(!users[msg.sender].registered, "Already registered");
        require(!inviteCodeUsed[inviteCode], "Invite code already used");
        require(inviteCodeOwner[inviteCode] != address(0), "Invalid invite code");
        require(bytes(username).length >= 2 && bytes(username).length <= 30, "Invalid username length");

        inviteCodeUsed[inviteCode] = true;
        users[msg.sender] = UserRecord({
            registered: true,
            username: username,
            registeredAt: block.timestamp,
            postCount: 0,
            streakPoints: 0,
            currentStreak: 0,
            lastCheckin: 0
        });
        allUsers.push(msg.sender);

        // Issue 2 invite codes to new user (codes generated off-chain, registered here)
        emit UserRegistered(msg.sender, username, inviteCode, block.timestamp);
    }

    function addInviteCode(
        address codeOwner,
        string calldata code
    ) external onlyOwner {
        require(inviteCodeOwner[code] == address(0), "Code already exists");
        inviteCodeOwner[code] = codeOwner;
        userInviteCodes[codeOwner].push(code);
        emit InviteCodeGenerated(codeOwner, code, block.timestamp);
    }

    // Allow registered users to register their own invite codes (issued by backend)
    function registerInviteCode(string calldata code) external onlyRegistered {
        require(inviteCodeOwner[code] == address(0), "Code already registered");
        inviteCodeOwner[code] = msg.sender;
        userInviteCodes[msg.sender].push(code);
        emit InviteCodeGenerated(msg.sender, code, block.timestamp);
    }

    // ─── Posts ────────────────────────────────────────────────────────────────

    /**
     * @notice Create a post. The image and content are stored on IPFS.
     *         The ipfsCid anchors the content hash on-chain.
     * @param ipfsCid IPFS CID of a JSON object: { content, imageUrl }
     */
    function createPost(string calldata ipfsCid) external onlyRegistered returns (bytes32 postHash) {
        postHash = keccak256(abi.encodePacked(msg.sender, ipfsCid, block.timestamp));
        posts[postHash] = PostRecord({
            author: msg.sender,
            ipfsCid: ipfsCid,
            likeCount: 0,
            createdAt: block.timestamp,
            exists: true
        });
        allPosts.push(postHash);
        users[msg.sender].postCount++;
        emit PostCreated(msg.sender, postHash, ipfsCid, block.timestamp);
    }

    function likePost(bytes32 postHash) external onlyRegistered {
        require(posts[postHash].exists, "Post does not exist");
        bytes32 likeKey = keccak256(abi.encodePacked(msg.sender, postHash));
        require(!postLikes[likeKey], "Already liked");
        postLikes[likeKey] = true;
        posts[postHash].likeCount++;
        emit PostLiked(msg.sender, postHash, block.timestamp);
    }

    // ─── Subscriptions ────────────────────────────────────────────────────────

    /**
     * @notice Subscribe to a creator. MON sent is split 88/12 between
     *         creator and platform automatically on-chain.
     */
    function subscribe(address creator) external payable onlyRegistered {
        require(users[creator].registered, "Creator not registered");
        require(creator != msg.sender, "Cannot subscribe to yourself");
        require(msg.value > 0, "Must send MON");

        uint256 platformFee = (msg.value * platformFeeBps) / 10000;
        uint256 creatorAmount = msg.value - platformFee;

        payable(creator).transfer(creatorAmount);
        payable(owner).transfer(platformFee);

        bytes32 subKey = keccak256(abi.encodePacked(msg.sender, creator));
        SubscriptionRecord storage sub = subscriptions[subKey];
        sub.active = true;
        sub.expiresAt = block.timestamp + 30 days;
        sub.priceWei = msg.value;
        sub.txHash = blockhash(block.number - 1);

        if (sub.consecutiveMonths > 0) {
            sub.consecutiveMonths++;
        } else {
            sub.consecutiveMonths = 1;
        }

        emit Subscribed(msg.sender, creator, msg.value, sub.expiresAt);

        if (sub.consecutiveMonths >= 2) {
            emit BadgeEarned(msg.sender, creator, "loyalty_2_months", block.timestamp);
        }
    }

    function isSubscribed(address subscriber, address creator) external view returns (bool) {
        bytes32 subKey = keccak256(abi.encodePacked(subscriber, creator));
        SubscriptionRecord storage sub = subscriptions[subKey];
        return sub.active && block.timestamp <= sub.expiresAt;
    }

    // ─── Streak & Points ──────────────────────────────────────────────────────

    function dailyCheckin() external onlyRegistered {
        UserRecord storage u = users[msg.sender];
        require(block.timestamp >= u.lastCheckin + 20 hours, "Already checked in today");

        bool isConsecutive = u.lastCheckin > 0 &&
            block.timestamp <= u.lastCheckin + 36 hours;

        if (isConsecutive) {
            u.currentStreak++;
        } else {
            u.currentStreak = 1;
        }

        uint256 pointsEarned = u.currentStreak >= 7 ? 20 :
                               u.currentStreak >= 3 ? 10 : 5;
        u.streakPoints += pointsEarned;
        u.lastCheckin = block.timestamp;

        emit StreakCheckin(msg.sender, u.currentStreak, u.streakPoints, block.timestamp);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getUserCount() external view returns (uint256) {
        return allUsers.length;
    }

    function getPostCount() external view returns (uint256) {
        return allPosts.length;
    }

    function getInviteCodes(address addr) external view returns (string[] memory) {
        return userInviteCodes[addr];
    }

    function setPlatformFeeBps(uint256 bps) external onlyOwner {
        require(bps <= 3000, "Max 30%");
        platformFeeBps = bps;
    }

    receive() external payable {}
}
