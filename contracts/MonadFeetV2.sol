// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MonadFeet {

    event UserRegistered(address indexed wallet, string username, uint256 timestamp);
    event PostCreated(address indexed author, uint256 indexed postId, string contentUri, uint256 timestamp);
    event PostLiked(address indexed liker, uint256 indexed postId, uint256 timestamp);
    event Subscribed(address indexed subscriber, address indexed creator, uint256 priceWei, uint256 expiresAt);
    event StreakCheckin(address indexed user, uint256 currentStreak, uint256 totalPoints, uint256 timestamp);
    event ProfileUpdated(address indexed wallet, string name, string bio, string avatarUri, uint256 timestamp);
    event GamePlayed(address indexed user, uint8 actionType, uint256 pointsEarned, uint256 timestamp);
    event InviteEarned(address indexed user, uint256 timestamp);

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
        string name;
        string bio;
        string avatarUri;
    }

    struct GameState {
        uint256 lastPlayDay;
        uint8 washCount;
        uint8 massageCount;
        uint8 pedicureCount;
        uint256 totalPurchases;
    }

    mapping(address => UserInfo) public users;
    mapping(uint256 => address) public postAuthor;
    mapping(uint256 => mapping(address => bool)) public postLikes;
    mapping(uint256 => uint256) public postLikeCount;
    mapping(address => mapping(address => uint256)) public subscriptionExpiry;
    mapping(address => GameState) public gameStates;

    address public immutable feeRecipient = address(uint160(0x0023b4c6ddca73ba99045e1c0def939bd41932e773));
    
    uint256 public userCount;
    uint256 public totalPostCount;

    uint256 constant SUBSCRIPTION_DURATION = 30 days;
    uint256 constant CREATOR_SHARE_BPS = 8800; 

    modifier onlyRegistered() {
        require(users[msg.sender].registered, "MonadFeet: not registered");
        _;
    }

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
            lastCheckin: 0,
            name: "",
            bio: "",
            avatarUri: ""
        });
        userCount++;

        emit UserRegistered(msg.sender, username, block.timestamp);
        inviteCode;
    }

    function createPost(uint256 postId, string calldata contentUri) external onlyRegistered {
        require(postAuthor[postId] == address(0), "MonadFeet: postId already anchored");

        postAuthor[postId] = msg.sender;
        users[msg.sender].postCount++;
        totalPostCount++;

        emit PostCreated(msg.sender, postId, contentUri, block.timestamp);
    }

    function likePost(uint256 postId) external onlyRegistered {
        require(postAuthor[postId] != address(0), "MonadFeet: post not anchored");
        require(!postLikes[postId][msg.sender], "MonadFeet: already liked");

        postLikes[postId][msg.sender] = true;
        postLikeCount[postId]++;
        users[msg.sender].likesSent++;

        emit PostLiked(msg.sender, postId, block.timestamp);
    }

    function subscribe(address creator) external payable {
        require(msg.value > 0, "MonadFeet: payment required");
        require(users[creator].registered, "MonadFeet: creator not registered");
        require(creator != msg.sender, "MonadFeet: cannot self-subscribe");

        uint256 creatorAmount = (msg.value * CREATOR_SHARE_BPS) / 10000;
        uint256 feeAmount = msg.value - creatorAmount;

        (bool creatorSuccess, ) = creator.call{value: creatorAmount}("");
        require(creatorSuccess, "MonadFeet: creator transfer failed");

        (bool feeSuccess, ) = feeRecipient.call{value: feeAmount}("");
        require(feeSuccess, "MonadFeet: fee transfer failed");

        uint256 expiry = block.timestamp + SUBSCRIPTION_DURATION;
        subscriptionExpiry[msg.sender][creator] = expiry;

        emit Subscribed(msg.sender, creator, msg.value, expiry);
    }

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

    function playFeetGame(uint8 actionType) external payable onlyRegistered {
        GameState storage state = gameStates[msg.sender];
        uint256 today = block.timestamp / 1 days;

        if (state.lastPlayDay < today) {
            state.washCount = 0;
            state.massageCount = 0;
            state.pedicureCount = 0;
            state.lastPlayDay = today;
        }

        uint256 requiredFee;
        uint256 pointsEarned;

        if (actionType == 1) {
            require(state.washCount < 10, "MonadFeet: max wash limit reached today");
            requiredFee = 1.43 ether;
            pointsEarned = 5 * (2 ** state.washCount);
            state.washCount++;
        } else if (actionType == 2) {
            require(state.massageCount < 10, "MonadFeet: max massage limit reached today");
            requiredFee = 14.3 ether;
            pointsEarned = 7 * (2 ** state.massageCount);
            state.massageCount++;
        } else if (actionType == 3) {
            require(state.pedicureCount < 10, "MonadFeet: max pedicure limit reached today");
            requiredFee = 143 ether;
            pointsEarned = 15 * (2 ** state.pedicureCount);
            state.pedicureCount++;
        } else {
            revert("MonadFeet: invalid game action");
        }

        require(msg.value == requiredFee, "MonadFeet: exact fee required");

        (bool feeSuccess, ) = feeRecipient.call{value: msg.value}("");
        require(feeSuccess, "MonadFeet: fee transfer failed");

        users[msg.sender].streakPoints += pointsEarned;
        state.totalPurchases++;

        emit GamePlayed(msg.sender, actionType, pointsEarned, block.timestamp);

        if (state.totalPurchases % 5 == 0) {
            emit InviteEarned(msg.sender, block.timestamp);
        }
    }

    function updateProfile(string calldata name, string calldata bio, string calldata avatarUri) external onlyRegistered {
        require(bytes(name).length <= 64,      "MonadFeet: name too long");
        require(bytes(bio).length <= 256,      "MonadFeet: bio too long");
        require(bytes(avatarUri).length <= 512, "MonadFeet: avatarUri too long");

        UserInfo storage u = users[msg.sender];
        u.name      = name;
        u.bio       = bio;
        u.avatarUri = avatarUri;

        emit ProfileUpdated(msg.sender, name, bio, avatarUri, block.timestamp);
    }

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
}