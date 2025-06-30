// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title LoraToken
 * @dev Main ERC20 token for the LORA platform with governance and staking capabilities
 * @author Lora Finance
 */
contract LoraToken is ERC20, ERC20Burnable, ERC20Pausable, AccessControl, ReentrancyGuard {
    using SafeMath for uint256;

    // ================ ROLES ================
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant FEE_COLLECTOR_ROLE = keccak256("FEE_COLLECTOR_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ================ STATE VARIABLES ================
    uint256 public constant TOTAL_SUPPLY = 21_000_000 * 10**18; // 21 million tokens (Bitcoin model)
    uint256 public constant INITIAL_SUPPLY = 10_500_000 * 10**18; // 10.5 million tokens initially (50%)
    uint256 public constant SECOND_DISTRIBUTION = 5_000_000 * 10**18; // 5 million tokens for second distribution
    uint256 public constant REMAINING_THRESHOLD = 2_000_000 * 10**18; // 2 million tokens threshold
    bool public secondDistributionExecuted = false;
    
    // Staking variables
    uint256 public totalStaked;
    uint256 public stakingRewardRate = 5; // 5% APY
    uint256 public lastRewardTime;
    uint256 public rewardPerTokenStored;
    uint256 public rewardRate; // Reward rate per second per token
    
    // Fee variables
    uint256 public transferFee = 25; // 0.25% (25 basis points)
    uint256 public stakingFee = 10; // 0.1% (10 basis points)
    uint256 public constant FEE_DENOMINATOR = 10000;
    
    // Oracle
    AggregatorV3Interface public priceFeed;
    
    // Fee collector address
    address public feeCollector;
    
    // Staking structs
    struct StakerInfo {
        uint256 stakedAmount;
        uint256 rewardDebt;
        uint256 lastClaimTime;
        bool isStaking;
    }
    
    // Governance structs
    struct Proposal {
        uint256 id;
        address proposer;
        string description;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 startTime;
        uint256 endTime;
        bool executed;
        bool canceled;
        mapping(address => Receipt) receipts;
    }
    
    struct Receipt {
        bool hasVoted;
        bool support;
        uint256 votes;
    }
    
    // Mappings
    mapping(address => StakerInfo) public stakers;
    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public lastTransferTime;
    mapping(address => bool) public blacklisted;
    
    // Events
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event StakingRewardRateUpdated(uint256 newRate);
    event TransferFeeUpdated(uint256 newFee);
    event StakingFeeUpdated(uint256 newFee);
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, string description);
    event Voted(uint256 indexed proposalId, address indexed voter, bool support, uint256 votes);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCanceled(uint256 indexed proposalId);
    event Blacklisted(address indexed account, bool status);
    event SecondDistributionExecuted(address[] recipients, uint256[] amounts);
    event FeeCollectorUpdated(address newFeeCollector);
    
    // ================ CONSTRUCTOR ================
    constructor(
        address initialOwner,
        address governance,
        address emergencyMultisig,
        address _feeCollector,
        address _priceFeed
    ) ERC20("LORA Token", "LORA") {
        require(initialOwner != address(0), "Invalid initial owner");
        require(governance != address(0), "Invalid governance address");
        require(emergencyMultisig != address(0), "Invalid emergency address");
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_priceFeed != address(0), "Invalid price feed");
        
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(GOVERNANCE_ROLE, governance);
        _grantRole(EMERGENCY_ROLE, emergencyMultisig);
        _grantRole(FEE_COLLECTOR_ROLE, _feeCollector);
        _grantRole(MINTER_ROLE, initialOwner);
        
        priceFeed = AggregatorV3Interface(_priceFeed);
        feeCollector = _feeCollector; // Store fee collector address
        lastRewardTime = block.timestamp;
        
        // Calculate reward rate per second (5% APY = 5/100/365/24/3600 per second)
        rewardRate = stakingRewardRate * 1e18 / (365 days * 100);
        
        // Mint initial supply to initial owner
        _mint(initialOwner, INITIAL_SUPPLY);
    }
    
    // ================ STAKING FUNCTIONS ================
    
    /**
     * @dev Stake tokens to earn rewards
     * @param amount Amount of tokens to stake
     */
    function stake(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Cannot stake 0 tokens");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        require(!blacklisted[msg.sender], "Address is blacklisted");
        
        _updateReward(msg.sender);
        
        _transfer(msg.sender, address(this), amount);
        
        StakerInfo storage staker = stakers[msg.sender];
        staker.stakedAmount = staker.stakedAmount.add(amount);
        staker.isStaking = true;
        staker.lastClaimTime = block.timestamp;
        
        totalStaked = totalStaked.add(amount);
        
        emit Staked(msg.sender, amount);
    }
    
    /**
     * @dev Unstake tokens
     * @param amount Amount of tokens to unstake
     */
    function unstake(uint256 amount) external nonReentrant {
        StakerInfo storage staker = stakers[msg.sender];
        require(staker.stakedAmount >= amount, "Insufficient staked amount");
        require(!blacklisted[msg.sender], "Address is blacklisted");
        
        _updateReward(msg.sender);
        
        uint256 fee = amount.mul(stakingFee).div(FEE_DENOMINATOR);
        uint256 unstakeAmount = amount.sub(fee);
        
        staker.stakedAmount = staker.stakedAmount.sub(amount);
        if (staker.stakedAmount == 0) {
            staker.isStaking = false;
        }
        
        totalStaked = totalStaked.sub(amount);
        
        _transfer(address(this), msg.sender, unstakeAmount);
        if (fee > 0) {
            _transfer(address(this), feeCollector, fee);
        }
        
        emit Unstaked(msg.sender, amount);
    }
    
    /**
     * @dev Claim staking rewards
     */
    function claimRewards() external nonReentrant {
        _updateReward(msg.sender);
        
        StakerInfo storage staker = stakers[msg.sender];
        uint256 earned = staker.stakedAmount.mul(rewardPerTokenStored.sub(staker.rewardDebt)).div(1e18);
        
        require(earned > 0, "No rewards to claim");
        
        staker.rewardDebt = staker.rewardDebt.add(earned);
        staker.lastClaimTime = block.timestamp;
        
        _mint(msg.sender, earned);
        
        emit RewardClaimed(msg.sender, earned);
    }
    
    /**
     * @dev Get pending rewards for a staker
     * @param staker Address of the staker
     */
    function pendingRewards(address staker) external view returns (uint256) {
        StakerInfo storage stakerInfo = stakers[staker];
        if (stakerInfo.stakedAmount == 0) return 0;
        
        uint256 currentRewardPerToken = rewardPerTokenStored;
        if (totalStaked > 0) {
            uint256 timeElapsed = block.timestamp.sub(lastRewardTime);
            uint256 newRewards = timeElapsed.mul(rewardRate).mul(totalStaked).div(1e18);
            currentRewardPerToken = rewardPerTokenStored.add(newRewards.mul(1e18).div(totalStaked));
        }
        
        uint256 pending = stakerInfo.stakedAmount.mul(currentRewardPerToken.sub(stakerInfo.rewardDebt)).div(1e18);
        return pending;
    }
    
    // ================ GOVERNANCE FUNCTIONS ================
    
    /**
     * @dev Create a new governance proposal
     * @param description Description of the proposal
     * @param duration Duration of the voting period in seconds
     */
    function createProposal(string memory description, uint256 duration) external onlyRole(GOVERNANCE_ROLE) returns (uint256) {
        require(bytes(description).length > 0, "Empty description");
        require(duration > 0, "Invalid duration");
        
        uint256 proposalId = proposals.length;
        Proposal storage proposal = proposals[proposalId];
        
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.description = description;
        proposal.startTime = block.timestamp;
        proposal.endTime = block.timestamp.add(duration);
        
        emit ProposalCreated(proposalId, msg.sender, description);
        return proposalId;
    }
    
    /**
     * @dev Vote on a proposal
     * @param proposalId ID of the proposal
     * @param support True for support, false for against
     */
    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp >= proposal.startTime, "Voting not started");
        require(block.timestamp <= proposal.endTime, "Voting ended");
        require(!proposal.receipts[msg.sender].hasVoted, "Already voted");
        require(!blacklisted[msg.sender], "Address is blacklisted");
        
        uint256 votes = balanceOf(msg.sender).add(stakers[msg.sender].stakedAmount);
        require(votes > 0, "No voting power");
        
        proposal.receipts[msg.sender] = Receipt({
            hasVoted: true,
            support: support,
            votes: votes
        });
        
        if (support) {
            proposal.forVotes = proposal.forVotes.add(votes);
        } else {
            proposal.againstVotes = proposal.againstVotes.add(votes);
        }
        
        emit Voted(proposalId, msg.sender, support, votes);
    }
    
    /**
     * @dev Execute a proposal
     * @param proposalId ID of the proposal to execute
     */
    function executeProposal(uint256 proposalId) external onlyRole(GOVERNANCE_ROLE) {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp > proposal.endTime, "Voting not ended");
        require(!proposal.executed, "Already executed");
        require(!proposal.canceled, "Proposal canceled");
        require(proposal.forVotes > proposal.againstVotes, "Proposal not passed");
        
        proposal.executed = true;
        
        emit ProposalExecuted(proposalId);
    }
    
    /**
     * @dev Cancel a proposal
     * @param proposalId ID of the proposal to cancel
     */
    function cancelProposal(uint256 proposalId) external onlyRole(GOVERNANCE_ROLE) {
        Proposal storage proposal = proposals[proposalId];
        require(!proposal.executed, "Already executed");
        require(!proposal.canceled, "Already canceled");
        
        proposal.canceled = true;
        
        emit ProposalCanceled(proposalId);
    }
    
    // ================ ADMIN FUNCTIONS ================
    
    /**
     * @dev Update staking reward rate
     * @param newRate New reward rate (APY percentage)
     */
    function updateStakingRewardRate(uint256 newRate) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRate <= 50, "Rate too high"); // Max 50% APY
        stakingRewardRate = newRate;
        // Recalculate reward rate per second
        rewardRate = newRate * 1e18 / (365 days * 100);
        emit StakingRewardRateUpdated(newRate);
    }
    
    /**
     * @dev Update transfer fee
     * @param newFee New transfer fee in basis points
     */
    function updateTransferFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFee <= 100, "Fee too high"); // Max 1%
        transferFee = newFee;
        emit TransferFeeUpdated(newFee);
    }
    
    /**
     * @dev Update staking fee
     * @param newFee New staking fee in basis points
     */
    function updateStakingFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFee <= 50, "Fee too high"); // Max 0.5%
        stakingFee = newFee;
        emit StakingFeeUpdated(newFee);
    }
    
    /**
     * @dev Blacklist or unblacklist an address
     * @param account Address to blacklist/unblacklist
     * @param status True to blacklist, false to unblacklist
     */
    function setBlacklisted(address account, bool status) external onlyRole(EMERGENCY_ROLE) {
        blacklisted[account] = status;
        emit Blacklisted(account, status);
    }
    
    /**
     * @dev Mint tokens (only for authorized minters)
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        require(totalSupply().add(amount) <= TOTAL_SUPPLY, "Exceeds total supply");
        
        _mint(to, amount);
    }
    
    /**
     * @dev Execute second distribution when remaining supply reaches threshold
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to distribute
     */
    function executeSecondDistribution(address[] memory recipients, uint256[] memory amounts) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!secondDistributionExecuted, "Second distribution already executed");
        require(recipients.length == amounts.length, "Arrays length mismatch");
        require(recipients.length > 0, "Empty recipients array");
        
        uint256 totalToDistribute = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalToDistribute = totalToDistribute.add(amounts[i]);
        }
        
        require(totalToDistribute == SECOND_DISTRIBUTION, "Total amount must equal second distribution");
        require(totalSupply().add(totalToDistribute) <= TOTAL_SUPPLY, "Exceeds total supply");
        
        // Check if remaining supply after this distribution will be <= threshold
        uint256 remainingAfterDistribution = TOTAL_SUPPLY.sub(totalSupply().add(totalToDistribute));
        require(remainingAfterDistribution <= REMAINING_THRESHOLD, "Remaining supply still above threshold");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient address");
            require(amounts[i] > 0, "Invalid amount");
            _mint(recipients[i], amounts[i]);
        }
        
        secondDistributionExecuted = true;
        emit SecondDistributionExecuted(recipients, amounts);
    }
    
    /**
     * @dev Check if second distribution can be executed
     */
    function canExecuteSecondDistribution() external view returns (bool) {
        if (secondDistributionExecuted) return false;
        
        uint256 remainingSupply = TOTAL_SUPPLY.sub(totalSupply());
        return remainingSupply <= REMAINING_THRESHOLD;
    }
    
    /**
     * @dev Update fee collector address
     * @param newFeeCollector New fee collector address
     */
    function updateFeeCollector(address newFeeCollector) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFeeCollector != address(0), "Invalid fee collector address");
        feeCollector = newFeeCollector;
        emit FeeCollectorUpdated(newFeeCollector);
    }
    
    // ================ OVERRIDE FUNCTIONS ================
    
    /**
     * @dev Override transfer function to include fees
     */
    function _transfer(address from, address to, uint256 amount) internal virtual override {
        require(from != address(0), "Transfer from zero");
        require(to != address(0), "Transfer to zero");
        require(!blacklisted[from], "Sender is blacklisted");
        require(!blacklisted[to], "Recipient is blacklisted");
        
        if (from != address(this) && to != address(this)) {
            uint256 fee = amount.mul(transferFee).div(FEE_DENOMINATOR);
            uint256 transferAmount = amount.sub(fee);
            
            super._transfer(from, to, transferAmount);
            if (fee > 0) {
                super._transfer(from, feeCollector, fee);
            }
        } else {
            super._transfer(from, to, amount);
        }
        
        lastTransferTime[from] = block.timestamp;
        lastTransferTime[to] = block.timestamp;
    }
    
    /**
     * @dev Override _beforeTokenTransfer for pausable functionality
     */
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override(ERC20, ERC20Pausable) {
        super._beforeTokenTransfer(from, to, amount);
    }
    
    /**
     * @dev Pause token transfers
     */
    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause token transfers
     */
    function unpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
    }
    
    // ================ INTERNAL FUNCTIONS ================
    
    /**
     * @dev Update reward for a staker
     * @param staker Address of the staker
     */
    function _updateReward(address staker) internal {
        if (totalStaked > 0) {
            uint256 timeElapsed = block.timestamp.sub(lastRewardTime);
            uint256 newRewards = timeElapsed.mul(rewardRate).mul(totalStaked).div(1e18);
            rewardPerTokenStored = rewardPerTokenStored.add(newRewards.mul(1e18).div(totalStaked));
        }
        
        lastRewardTime = block.timestamp;
        
        StakerInfo storage stakerInfo = stakers[staker];
        if (stakerInfo.stakedAmount > 0) {
            stakerInfo.rewardDebt = stakerInfo.stakedAmount.mul(rewardPerTokenStored).div(1e18);
        }
    }
    
    // ================ VIEW FUNCTIONS ================
    
    /**
     * @dev Get current ETH price in USD
     */
    function getEthPrice() external view returns (uint256) {
        (, int256 price,,,) = priceFeed.latestRoundData();
        return uint256(price);
    }
    
    /**
     * @dev Get staker information
     * @param staker Address of the staker
     */
    function getStakerInfo(address staker) external view returns (
        uint256 stakedAmount,
        uint256 rewardDebt,
        uint256 lastClaimTime,
        bool isStaking
    ) {
        StakerInfo storage stakerInfo = stakers[staker];
        return (
            stakerInfo.stakedAmount,
            stakerInfo.rewardDebt,
            stakerInfo.lastClaimTime,
            stakerInfo.isStaking
        );
    }
    
    /**
     * @dev Get proposal information
     * @param proposalId ID of the proposal
     */
    function getProposal(uint256 proposalId) external view returns (
        uint256 id,
        address proposer,
        string memory description,
        uint256 forVotes,
        uint256 againstVotes,
        uint256 startTime,
        uint256 endTime,
        bool executed,
        bool canceled
    ) {
        Proposal storage proposal = proposals[proposalId];
        return (
            proposal.id,
            proposal.proposer,
            proposal.description,
            proposal.forVotes,
            proposal.againstVotes,
            proposal.startTime,
            proposal.endTime,
            proposal.executed,
            proposal.canceled
        );
    }
    
    /**
     * @dev Check if an address has voted on a proposal
     * @param proposalId ID of the proposal
     * @param voter Address of the voter
     */
    function hasVoted(uint256 proposalId, address voter) external view returns (bool) {
        return proposals[proposalId].receipts[voter].hasVoted;
    }
    
    /**
     * @dev Get remaining supply information
     */
    function getRemainingSupplyInfo() external view returns (
        uint256 remainingSupply,
        uint256 totalSupplyValue,
        uint256 currentSupply,
        bool canExecuteSecondDist
    ) {
        totalSupplyValue = TOTAL_SUPPLY;
        currentSupply = totalSupply();
        remainingSupply = TOTAL_SUPPLY.sub(currentSupply);
        canExecuteSecondDist = canExecuteSecondDistribution();
        
        return (remainingSupply, totalSupplyValue, currentSupply, canExecuteSecondDist);
    }
} 