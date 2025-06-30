// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./LoraToken.sol";

/**
 * @title LoraRWA
 * @dev Real World Assets tokenization contract with compliance and yield distribution
 * @author Lora Finance
 */
contract LoraRWA is Initializable, ERC1155Upgradeable, AccessControlUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {
    using SafeMathUpgradeable for uint256;

    // ================ ROLES ================
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant APPRAISER_ROLE = keccak256("APPRAISER_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // ================ STATE VARIABLES ================
    
    // Asset struct to store RWA details
    struct Asset {
        string name;
        string assetType; // e.g., "Real Estate", "Vehicle", "Art"
        string location;
        uint256 value; // Current valuation in USD (18 decimals)
        uint256 totalTokens; // Total number of tokens for this asset
        uint256 tokenPrice; // Price per token in USD (18 decimals)
        string documentHash; // IPFS hash of legal documents
        string registryNumber; // Official registry number
        bool isActive;
        bool isTokenized;
        uint256 lastValuation; // Timestamp of last valuation
        address custodian; // Address responsible for the physical asset
    }
    
    // Yield distribution struct
    struct YieldInfo {
        uint256 amount; // Amount in USD (18 decimals)
        uint256 timestamp;
        uint256 distributionId;
        bool claimed;
    }
    
    // Compliance struct for KYC/AML
    struct ComplianceInfo {
        bool isWhitelisted;
        uint256 kycExpiry;
        string kycHash; // Hash of KYC documents
        string jurisdiction; // Country/region code
        uint256 maxHolding; // Maximum tokens this address can hold
    }
    
    // Mappings
    mapping(uint256 => Asset) public assets; // assetId => Asset
    mapping(uint256 => mapping(address => uint256)) public assetBalances; // assetId => owner => balance
    mapping(uint256 => mapping(uint256 => YieldInfo)) public yields; // assetId => distributionId => YieldInfo
    mapping(address => ComplianceInfo) public compliance; // address => ComplianceInfo
    mapping(address => bool) public blacklisted; // Blacklisted addresses
    mapping(uint256 => uint256) public totalYieldDistributed; // assetId => total yield distributed
    mapping(address => uint256) public lastTransferTimestamp; // For transfer restrictions
    
    // Configuration
    uint256 public minHoldPeriod; // Minimum period to hold tokens
    uint256 public maxTokensPerAddress; // Maximum tokens per address (anti-whale)
    uint256 public complianceUpdatePeriod; // How often KYC needs renewal
    uint256 public assetCount; // Total number of registered assets
    
    // External contracts
    LoraToken public loraToken; // Main LORA token
    AggregatorV3Interface public priceFeed; // Chainlink price feed
    
    // ================ EVENTS ================
    
    event AssetRegistered(uint256 indexed assetId, string name, string assetType, uint256 value);
    event AssetTokenized(uint256 indexed assetId, uint256 totalTokens, uint256 tokenPrice);
    event AssetValuationUpdated(uint256 indexed assetId, uint256 newValue, uint256 timestamp);
    event TokensPurchased(uint256 indexed assetId, address indexed buyer, uint256 amount, uint256 cost);
    event TokensSold(uint256 indexed assetId, address indexed seller, uint256 amount, uint256 proceeds);
    event YieldDistributed(uint256 indexed assetId, uint256 distributionId, uint256 amount);
    event YieldClaimed(uint256 indexed assetId, address indexed claimant, uint256 amount);
    event ComplianceUpdated(address indexed user, bool isWhitelisted, uint256 kycExpiry);
    event BlacklistUpdated(address indexed account, bool status);
    event CustodianUpdated(uint256 indexed assetId, address indexed newCustodian);
    
    // ================ INITIALIZER ================
    
    /**
     * @dev Initialize the contract
     * @param admin Admin address
     * @param _loraToken LORA token address
     * @param _priceFeed Chainlink price feed address
     */
    function initialize(
        address admin,
        address _loraToken,
        address _priceFeed
    ) public initializer {
        require(admin != address(0), "Invalid admin address");
        require(_loraToken != address(0), "Invalid LORA token address");
        require(_priceFeed != address(0), "Invalid price feed address");
        
        __ERC1155_init("");
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(APPRAISER_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);
        _grantRole(ORACLE_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        
        loraToken = LoraToken(_loraToken);
        priceFeed = AggregatorV3Interface(_priceFeed);
        
        // Set default configuration
        minHoldPeriod = 1 days;
        maxTokensPerAddress = 1000000 * 10**18; // 1M tokens
        complianceUpdatePeriod = 365 days;
    }
    
    // ================ ASSET MANAGEMENT ================
    
    /**
     * @dev Register a new real-world asset
     * @param name Asset name
     * @param assetType Type of asset
     * @param location Asset location
     * @param value Initial valuation in USD
     * @param documentHash IPFS hash of legal documents
     * @param registryNumber Official registry number
     * @param custodian Custodian address
     */
    function registerAsset(
        string memory name,
        string memory assetType,
        string memory location,
        uint256 value,
        string memory documentHash,
        string memory registryNumber,
        address custodian
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        require(bytes(name).length > 0, "Empty name");
        require(bytes(assetType).length > 0, "Empty asset type");
        require(value > 0, "Invalid value");
        require(custodian != address(0), "Invalid custodian");
        
        uint256 assetId = assetCount;
        assetCount = assetCount.add(1);
        
        assets[assetId] = Asset({
            name: name,
            assetType: assetType,
            location: location,
            value: value,
            totalTokens: 0,
            tokenPrice: 0,
            documentHash: documentHash,
            registryNumber: registryNumber,
            isActive: true,
            isTokenized: false,
            lastValuation: block.timestamp,
            custodian: custodian
        });
        
        emit AssetRegistered(assetId, name, assetType, value);
        return assetId;
    }
    
    /**
     * @dev Tokenize an asset
     * @param assetId Asset ID to tokenize
     * @param totalTokens Total number of tokens to create
     */
    function tokenizeAsset(uint256 assetId, uint256 totalTokens) external onlyRole(ADMIN_ROLE) {
        Asset storage asset = assets[assetId];
        require(asset.isActive, "Asset not active");
        require(!asset.isTokenized, "Asset already tokenized");
        require(totalTokens > 0, "Invalid token amount");
        
        asset.totalTokens = totalTokens;
        asset.tokenPrice = asset.value.mul(10**18).div(totalTokens);
        asset.isTokenized = true;
        
        // Mint initial tokens to custodian
        _mint(asset.custodian, assetId, totalTokens, "");
        
        emit AssetTokenized(assetId, totalTokens, asset.tokenPrice);
    }
    
    /**
     * @dev Update asset valuation
     * @param assetId Asset ID
     * @param newValue New valuation in USD
     */
    function updateAssetValuation(uint256 assetId, uint256 newValue) external onlyRole(APPRAISER_ROLE) {
        Asset storage asset = assets[assetId];
        require(asset.isActive, "Asset not active");
        require(newValue > 0, "Invalid value");
        
        asset.value = newValue;
        asset.lastValuation = block.timestamp;
        
        if (asset.isTokenized) {
            asset.tokenPrice = newValue.mul(10**18).div(asset.totalTokens);
        }
        
        emit AssetValuationUpdated(assetId, newValue, block.timestamp);
    }
    
    /**
     * @dev Update asset custodian
     * @param assetId Asset ID
     * @param newCustodian New custodian address
     */
    function updateCustodian(uint256 assetId, address newCustodian) external onlyRole(ADMIN_ROLE) {
        require(newCustodian != address(0), "Invalid custodian");
        require(assets[assetId].isActive, "Asset not active");
        
        assets[assetId].custodian = newCustodian;
        emit CustodianUpdated(assetId, newCustodian);
    }
    
    // ================ TRADING FUNCTIONS ================
    
    /**
     * @dev Purchase tokens for an asset
     * @param assetId Asset ID
     * @param amount Amount of tokens to purchase
     */
    function purchaseTokens(uint256 assetId, uint256 amount) external nonReentrant whenNotPaused {
        Asset storage asset = assets[assetId];
        require(asset.isActive && asset.isTokenized, "Asset not available");
        require(amount > 0, "Invalid amount");
        require(compliance[msg.sender].isWhitelisted, "Not whitelisted");
        require(!blacklisted[msg.sender], "Address blacklisted");
        
        uint256 cost = amount.mul(asset.tokenPrice).div(10**18);
        require(loraToken.balanceOf(msg.sender) >= cost, "Insufficient LORA balance");
        
        // Check anti-whale limits
        uint256 newBalance = assetBalances[assetId][msg.sender].add(amount);
        require(newBalance <= maxTokensPerAddress, "Exceeds max holding");
        
        // Transfer LORA tokens
        require(loraToken.transferFrom(msg.sender, address(this), cost), "LORA transfer failed");
        
        // Mint RWA tokens
        _mint(msg.sender, assetId, amount, "");
        assetBalances[assetId][msg.sender] = newBalance;
        
        emit TokensPurchased(assetId, msg.sender, amount, cost);
    }
    
    /**
     * @dev Sell tokens for an asset
     * @param assetId Asset ID
     * @param amount Amount of tokens to sell
     */
    function sellTokens(uint256 assetId, uint256 amount) external nonReentrant whenNotPaused {
        Asset storage asset = assets[assetId];
        require(asset.isActive && asset.isTokenized, "Asset not available");
        require(amount > 0, "Invalid amount");
        require(balanceOf(msg.sender, assetId) >= amount, "Insufficient balance");
        require(!blacklisted[msg.sender], "Address blacklisted");
        
        // Check hold period
        require(block.timestamp >= lastTransferTimestamp[msg.sender].add(minHoldPeriod), "Hold period not met");
        
        uint256 proceeds = amount.mul(asset.tokenPrice).div(10**18);
        
        // Burn RWA tokens
        _burn(msg.sender, assetId, amount);
        assetBalances[assetId][msg.sender] = assetBalances[assetId][msg.sender].sub(amount);
        
        // Transfer LORA tokens
        require(loraToken.transfer(msg.sender, proceeds), "LORA transfer failed");
        
        emit TokensSold(assetId, msg.sender, amount, proceeds);
    }
    
    // ================ YIELD DISTRIBUTION ================
    
    /**
     * @dev Distribute yield for an asset
     * @param assetId Asset ID
     * @param amount Yield amount in USD
     */
    function distributeYield(uint256 assetId, uint256 amount) external onlyRole(ADMIN_ROLE) {
        Asset storage asset = assets[assetId];
        require(asset.isActive && asset.isTokenized, "Asset not available");
        require(amount > 0, "Invalid amount");
        
        uint256 distributionId = totalYieldDistributed[assetId];
        totalYieldDistributed[assetId] = distributionId.add(1);
        
        yields[assetId][distributionId] = YieldInfo({
            amount: amount,
            timestamp: block.timestamp,
            distributionId: distributionId,
            claimed: false
        });
        
        emit YieldDistributed(assetId, distributionId, amount);
    }
    
    /**
     * @dev Claim yield for an asset
     * @param assetId Asset ID
     * @param distributionId Distribution ID
     */
    function claimYield(uint256 assetId, uint256 distributionId) external nonReentrant {
        require(balanceOf(msg.sender, assetId) > 0, "No tokens held");
        require(!blacklisted[msg.sender], "Address blacklisted");
        
        YieldInfo storage yield = yields[assetId][distributionId];
        require(!yield.claimed, "Already claimed");
        
        Asset storage asset = assets[assetId];
        uint256 userShare = balanceOf(msg.sender, assetId).mul(yield.amount).div(asset.totalTokens);
        
        require(userShare > 0, "No yield to claim");
        
        yield.claimed = true;
        
        // Transfer yield in LORA tokens (converted from USD)
        uint256 loraAmount = userShare.mul(10**18).div(getEthPrice());
        require(loraToken.transfer(msg.sender, loraAmount), "Yield transfer failed");
        
        emit YieldClaimed(assetId, msg.sender, userShare);
    }
    
    // ================ COMPLIANCE FUNCTIONS ================
    
    /**
     * @dev Update compliance information for a user
     * @param user User address
     * @param isWhitelisted Whitelist status
     * @param kycExpiry KYC expiry timestamp
     * @param kycHash KYC document hash
     * @param jurisdiction Jurisdiction code
     * @param maxHolding Maximum tokens this user can hold
     */
    function updateCompliance(
        address user,
        bool isWhitelisted,
        uint256 kycExpiry,
        string memory kycHash,
        string memory jurisdiction,
        uint256 maxHolding
    ) external onlyRole(COMPLIANCE_ROLE) {
        require(user != address(0), "Invalid user address");
        
        compliance[user] = ComplianceInfo({
            isWhitelisted: isWhitelisted,
            kycExpiry: kycExpiry,
            kycHash: kycHash,
            jurisdiction: jurisdiction,
            maxHolding: maxHolding
        });
        
        emit ComplianceUpdated(user, isWhitelisted, kycExpiry);
    }
    
    /**
     * @dev Blacklist or unblacklist an address
     * @param account Address to blacklist/unblacklist
     * @param status True to blacklist, false to unblacklist
     */
    function setBlacklisted(address account, bool status) external onlyRole(COMPLIANCE_ROLE) {
        blacklisted[account] = status;
        emit BlacklistUpdated(account, status);
    }
    
    // ================ ADMIN FUNCTIONS ================
    
    /**
     * @dev Update minimum hold period
     * @param newPeriod New hold period in seconds
     */
    function updateMinHoldPeriod(uint256 newPeriod) external onlyRole(ADMIN_ROLE) {
        minHoldPeriod = newPeriod;
    }
    
    /**
     * @dev Update maximum tokens per address
     * @param newMax New maximum tokens per address
     */
    function updateMaxTokensPerAddress(uint256 newMax) external onlyRole(ADMIN_ROLE) {
        maxTokensPerAddress = newMax;
    }
    
    /**
     * @dev Update compliance update period
     * @param newPeriod New compliance update period in seconds
     */
    function updateComplianceUpdatePeriod(uint256 newPeriod) external onlyRole(ADMIN_ROLE) {
        complianceUpdatePeriod = newPeriod;
    }
    
    /**
     * @dev Pause the contract
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause the contract
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    // ================ OVERRIDE FUNCTIONS ================
    
    /**
     * @dev Hook that is called before any token transfer
     */
    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal virtual override {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
        
        for (uint256 i = 0; i < ids.length; i++) {
            if (from != address(0) && to != address(0)) {
                require(!blacklisted[from], "Sender blacklisted");
                require(!blacklisted[to], "Recipient blacklisted");
                require(compliance[from].isWhitelisted, "Sender not whitelisted");
                require(compliance[to].isWhitelisted, "Recipient not whitelisted");
                
                lastTransferTimestamp[from] = block.timestamp;
                lastTransferTimestamp[to] = block.timestamp;
            }
        }
    }
    
    /**
     * @dev Required override for UUPS proxy pattern
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}
    
    // ================ VIEW FUNCTIONS ================
    
    /**
     * @dev Get current ETH price in USD
     */
    function getEthPrice() public view returns (uint256) {
        (, int256 price,,,) = priceFeed.latestRoundData();
        return uint256(price);
    }
    
    /**
     * @dev Get asset information
     * @param assetId Asset ID
     */
    function getAsset(uint256 assetId) external view returns (
        string memory name,
        string memory assetType,
        string memory location,
        uint256 value,
        uint256 totalTokens,
        uint256 tokenPrice,
        string memory documentHash,
        string memory registryNumber,
        bool isActive,
        bool isTokenized,
        uint256 lastValuation,
        address custodian
    ) {
        Asset storage asset = assets[assetId];
        return (
            asset.name,
            asset.assetType,
            asset.location,
            asset.value,
            asset.totalTokens,
            asset.tokenPrice,
            asset.documentHash,
            asset.registryNumber,
            asset.isActive,
            asset.isTokenized,
            asset.lastValuation,
            asset.custodian
        );
    }
    
    /**
     * @dev Get compliance information for a user
     * @param user User address
     */
    function getCompliance(address user) external view returns (
        bool isWhitelisted,
        uint256 kycExpiry,
        string memory kycHash,
        string memory jurisdiction,
        uint256 maxHolding
    ) {
        ComplianceInfo storage info = compliance[user];
        return (
            info.isWhitelisted,
            info.kycExpiry,
            info.kycHash,
            info.jurisdiction,
            info.maxHolding
        );
    }
    
    /**
     * @dev Get yield information
     * @param assetId Asset ID
     * @param distributionId Distribution ID
     */
    function getYield(uint256 assetId, uint256 distributionId) external view returns (
        uint256 amount,
        uint256 timestamp,
        bool claimed
    ) {
        YieldInfo storage yield = yields[assetId][distributionId];
        return (yield.amount, yield.timestamp, yield.claimed);
    }
} 