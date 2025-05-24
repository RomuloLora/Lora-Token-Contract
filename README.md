// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./LoraToken.sol";

/**
 * @title LORA RWA (Real World Assets)
 * @dev Implements tokenization of real world assets with compliance and yield distribution
 * @author Lora Finance
 */
contract LoraRWA is 
    Initializable,
    ERC721URIStorageUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable 
{
    using StringsUpgradeable for uint256;

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
        string assetType;        // e.g., "Real Estate", "Vehicle", "Art"
        string location;
        uint256 value;          // Current valuation in USD (18 decimals)
        uint256 totalTokens;    // Total number of tokens for this asset
        uint256 tokenPrice;     // Price per token in USD (18 decimals)
        string documentHash;    // IPFS hash of legal documents
        string registryNumber;  // Official registry number
        bool isActive;
        bool isTokenized;
        uint256 lastValuation; // Timestamp of last valuation
        address custodian;     // Address responsible for the physical asset
    }

    // Yield distribution struct
    struct YieldInfo {
        uint256 amount;         // Amount in USD (18 decimals)
        uint256 timestamp;
        uint256 distributionId;
        bool claimed;
    }

    // Compliance struct for KYC/AML
    struct ComplianceInfo {
        bool isWhitelisted;
        uint256 kycExpiry;
        string kycHash;        // Hash of KYC documents
        string jurisdiction;   // Country/region code
        uint256 maxHolding;   // Maximum tokens this address can hold
    }

    // Mappings
    mapping(uint256 => Asset) public assets;                    // assetId => Asset
    mapping(uint256 => mapping(address => uint256)) public assetBalances;  // assetId => owner => balance
    mapping(uint256 => mapping(uint256 => YieldInfo)) public yields;      // assetId => distributionId => YieldInfo
    mapping(address => ComplianceInfo) public compliance;       // address => ComplianceInfo
    mapping(address => bool) public blacklisted;               // Blacklisted addresses
    mapping(uint256 => uint256) public totalYieldDistributed;  // assetId => total yield distributed
    mapping(address => uint256) public lastTransferTimestamp;  // For transfer restrictions

    // Configuration
    uint256 public minHoldPeriod;        // Minimum period to hold tokens
    uint256 public maxTokensPerAddress;   // Maximum tokens per address (anti-whale)
    uint256 public complianceUpdatePeriod; // How often KYC needs renewal
    uint256 public assetCount;            // Total number of registered assets

    // External contracts
    LoraToken public loraToken;           // Main LORA token
    AggregatorV3Interface public priceFeed; // Chainlink price feed

    // ================ EVENTS ================

    event AssetRegistered(uint256 indexed assetId, string name, string assetType, uint256 value);
    event AssetTokenized(uint256 indexed assetId, uint256 totalTokens, uint256 tokenPrice);
    event AssetValueUpdated(uint256 indexed assetId, uint256 oldValue, uint256 newValue);
    event YieldDistributed(uint256 indexed assetId, uint256 distributionId, uint256 amount);
    event YieldClaimed(address indexed user, uint256 indexed assetId, uint256 distributionId, uint256 amount);
    event ComplianceUpdated(address indexed user, bool isWhitelisted, uint256 kycExpiry);
    event BlacklistUpdated(address indexed user, bool blacklisted);
    event AssetCustodianUpdated(uint256 indexed assetId, address indexed oldCustodian, address indexed newCustodian);

    // ================ MODIFIERS ================

    modifier onlyWhitelisted(address account) {
        require(compliance[account].isWhitelisted, "LoraRWA: address not whitelisted");
        require(!blacklisted[account], "LoraRWA: address blacklisted");
        require(block.timestamp <= compliance[account].kycExpiry, "LoraRWA: KYC expired");
        _;
    }

    modifier validAsset(uint256 assetId) {
        require(assets[assetId].isActive, "LoraRWA: asset not active");
        _;
    }

    modifier withinLimits(uint256 assetId, uint256 amount) {
        require(
            assetBalances[assetId][msg.sender] + amount <= maxTokensPerAddress,
            "LoraRWA: exceeds max tokens per address"
        );
        _;
    }

    // ================ INITIALIZER ================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address loraTokenAddress,
        address priceFeedAddress
    ) public initializer {
        __ERC721_init("LORA Real World Assets", "LORA-RWA");
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);

        loraToken = LoraToken(loraTokenAddress);
        priceFeed = AggregatorV3Interface(priceFeedAddress);

        minHoldPeriod = 30 days;
        maxTokensPerAddress = 1000;
        complianceUpdatePeriod = 365 days;
    }

    // ================ ASSET MANAGEMENT FUNCTIONS ================

    /**
     * @dev Register a new real world asset
     * @param name Asset name
     * @param assetType Type of asset (e.g., "Real Estate")
     * @param location Physical location
     * @param value Initial valuation in USD
     * @param documentHash IPFS hash of legal documents
     * @param registryNumber Official registry number
     * @param custodian Address responsible for the physical asset
     */
    function registerAsset(
        string memory name,
        string memory assetType,
        string memory location,
        uint256 value,
        string memory documentHash,
        string memory registryNumber,
        address custodian
    ) 
        external 
        onlyRole(ADMIN_ROLE) 
        returns (uint256 assetId) 
    {
        require(bytes(name).length > 0, "LoraRWA: empty name");
        require(bytes(documentHash).length > 0, "LoraRWA: empty document hash");
        require(custodian != address(0), "LoraRWA: invalid custodian");
        
        assetId = assetCount++;
        
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
     * @dev Tokenize a registered asset
     * @param assetId ID of the asset to tokenize
     * @param totalTokens Number of tokens to create
     */
    function tokenizeAsset(uint256 assetId, uint256 totalTokens)
        external
        onlyRole(ADMIN_ROLE)
        validAsset(assetId)
    {
        Asset storage asset = assets[assetId];
        require(!asset.isTokenized, "LoraRWA: already tokenized");
        require(totalTokens > 0, "LoraRWA: invalid token amount");
        
        asset.totalTokens = totalTokens;
        asset.tokenPrice = asset.value / totalTokens;
        asset.isTokenized = true;
        
        emit AssetTokenized(assetId, totalTokens, asset.tokenPrice);
    }

    /**
     * @dev Update asset value (by appraiser or oracle)
     * @param assetId ID of the asset
     * @param newValue New valuation in USD
     */
    function updateAssetValue(uint256 assetId, uint256 newValue)
        external
        onlyRole(APPRAISER_ROLE)
        validAsset(assetId)
    {
        Asset storage asset = assets[assetId];
        uint256 oldValue = asset.value;
        
        require(newValue > 0, "LoraRWA: invalid value");
        // Prevent extreme value changes (e.g., more than 50% in a day)
        require(
            block.timestamp >= asset.lastValuation + 1 days ||
            (newValue >= oldValue * 50 / 100 && newValue <= oldValue * 150 / 100),
            "LoraRWA: suspicious value change"
        );
        
        asset.value = newValue;
        if (asset.isTokenized) {
            asset.tokenPrice = newValue / asset.totalTokens;
        }
        asset.lastValuation = block.timestamp;
        
        emit AssetValueUpdated(assetId, oldValue, newValue);
    }

    // ================ YIELD DISTRIBUTION FUNCTIONS ================

    /**
     * @dev Distribute yield for an asset (e.g., rental income)
     * @param assetId ID of the asset
     * @param amount Amount in USD to distribute
     */
    function distributeYield(uint256 assetId, uint256 amount)
        external
        onlyRole(ADMIN_ROLE)
        validAsset(assetId)
        nonReentrant
    {
        Asset storage asset = assets[assetId];
        require(asset.isTokenized, "LoraRWA: asset not tokenized");
        
        uint256 distributionId = totalYieldDistributed[assetId];
        yields[assetId][distributionId] = YieldInfo({
            amount: amount,
            timestamp: block.timestamp,
            distributionId: distributionId,
            claimed: false
        });
        
        totalYieldDistributed[assetId] = distributionId + 1;
        
        emit YieldDistributed(assetId, distributionId, amount);
    }

    /**
     * @dev Claim yield for a specific distribution
     * @param assetId ID of the asset
     * @param distributionId ID of the yield distribution
     */
    function claimYield(uint256 assetId, uint256 distributionId)
        external
        onlyWhitelisted(msg.sender)
        nonReentrant
        returns (uint256)
    {
        YieldInfo storage yieldInfo = yields[assetId][distributionId];
        require(!yieldInfo.claimed, "LoraRWA: yield already claimed");
        require(yieldInfo.timestamp > 0, "LoraRWA: invalid distribution");
        
        uint256 userBalance = assetBalances[assetId][msg.sender];
        require(userBalance > 0, "LoraRWA: no tokens owned");
        
        Asset storage asset = assets[assetId];
        uint256 userShare = (yieldInfo.amount * userBalance) / asset.totalTokens;
        
        yieldInfo.claimed = true;
        
        // Transfer yield in LORA tokens
        require(
            loraToken.transfer(msg.sender, userShare),
            "LoraRWA: yield transfer failed"
        );
        
        emit YieldClaimed(msg.sender, assetId, distributionId, userShare);
        return userShare;
    }

    // ================ COMPLIANCE FUNCTIONS ================

    /**
     * @dev Update compliance status for an address
     * @param account Address to update
     * @param isWhitelisted Whether the address is approved
     * @param kycHash Hash of KYC documents
     * @param jurisdiction User's jurisdiction code
     * @param maxHolding Maximum tokens allowed to hold
     */
    function updateCompliance(
        address account,
        bool isWhitelisted,
        string memory kycHash,
        string memory jurisdiction,
        uint256 maxHolding
    )
        external
        onlyRole(COMPLIANCE_ROLE)
    {
        require(account != address(0), "LoraRWA: invalid address");
        
        compliance[account] = ComplianceInfo({
            isWhitelisted: isWhitelisted,
            kycExpiry: block.timestamp + complianceUpdatePeriod,
            kycHash: kycHash,
            jurisdiction: jurisdiction,
            maxHolding: maxHolding
        });
        
        emit ComplianceUpdated(account, isWhitelisted, block.timestamp + complianceUpdatePeriod);
    }

    /**
     * @dev Add or remove address from blacklist
     * @param account Address to update
     * @param status Blacklist status
     */
    function updateBlacklist(address account, bool status)
        external
        onlyRole(COMPLIANCE_ROLE)
    {
        require(account != address(0), "LoraRWA: invalid address");
        blacklisted[account] = status;
        emit BlacklistUpdated(account, status);
    }

    // ================ CONFIGURATION FUNCTIONS ================

    /**
     * @dev Update minimum hold period
     * @param newPeriod New minimum period in seconds
     */
    function setMinHoldPeriod(uint256 newPeriod) external onlyRole(ADMIN_ROLE) {
        minHoldPeriod = newPeriod;
    }

    /**
     * @dev Update maximum tokens per address
     * @param newMax New maximum amount
     */
    function setMaxTokensPerAddress(uint256 newMax) external onlyRole(ADMIN_ROLE) {
        maxTokensPerAddress = newMax;
    }

    /**
     * @dev Update compliance renewal period
     * @param newPeriod New period in seconds
     */
    function setComplianceUpdatePeriod(uint256 newPeriod) external onlyRole(ADMIN_ROLE) {
        complianceUpdatePeriod = newPeriod;
    }

    // ================ OVERRIDE FUNCTIONS ================

    /**
     * @dev Override transfer function to enforce compliance
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        
        if (from != address(0) && to != address(0)) {
            require(
                !blacklisted[from] && !blacklisted[to],
                "LoraRWA: blacklisted address"
            );
            require(
                compliance[to].isWhitelisted,
                "LoraRWA: recipient not whitelisted"
            );
            require(
                block.timestamp >= lastTransferTimestamp[from] + minHoldPeriod,
                "LoraRWA: minimum hold period not met"
            );
        }
        
        lastTransferTimestamp[to] = block.timestamp;
    }

    /**
     * @dev Required override for UUPS proxy pattern
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(UPGRADER_ROLE)
    {}
}

































// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./LoraRWA.sol";

/**
 * @title LORA NFT Ownership Token
 * @dev Represents fractional ownership of real world assets using ERC1155
 */
contract LoraNFTOWN is 
    Initializable,
    ERC1155Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable 
{
    // ================ ROLES ================
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // ================ STATE VARIABLES ================
    LoraRWA public rwaContract;
    
    // Mapping from token ID to metadata URI
    mapping(uint256 => string) private _tokenURIs;
    
    // Mapping from token ID to total supply
    mapping(uint256 => uint256) public totalSupply;
    
    // Mapping from token ID to whether it's locked
    mapping(uint256 => bool) public tokenLocked;

    // ================ EVENTS ================
    event TokenURISet(uint256 indexed tokenId, string uri);
    event TokenLockStatusUpdated(uint256 indexed tokenId, bool locked);
    event BatchMinted(address indexed to, uint256 indexed tokenId, uint256 amount);

    // ================ MODIFIERS ================
    modifier whenNotLocked(uint256 tokenId) {
        require(!tokenLocked[tokenId], "LoraNFTOWN: token is locked");
        _;
    }

    // ================ INITIALIZER ================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address rwaContractAddress
    ) public initializer {
        __ERC1155_init("");
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);

        rwaContract = LoraRWA(rwaContractAddress);
    }

    // ================ MINTING FUNCTIONS ================

    /**
     * @dev Mint new tokens for an asset
     * @param to Recipient address
     * @param tokenId Token ID (matches RWA asset ID)
     * @param amount Amount of tokens to mint
     * @param data Additional data for mint
     */
    function mint(
        address to,
        uint256 tokenId,
        uint256 amount,
        bytes memory data
    )
        external
        onlyRole(MINTER_ROLE)
        whenNotPaused
        whenNotLocked(tokenId)
    {
        require(to != address(0), "LoraNFTOWN: mint to zero address");
        require(amount > 0, "LoraNFTOWN: zero amount");
        
        _mint(to, tokenId, amount, data);
        totalSupply[tokenId] += amount;
        
        emit BatchMinted(to, tokenId, amount);
    }

    /**
     * @dev Mint tokens in batch
     * @param to Recipient address
     * @param tokenIds Array of token IDs
     * @param amounts Array of amounts
     * @param data Additional data for mint
     */
    function mintBatch(
        address to,
        uint256[] memory tokenIds,
        uint256[] memory amounts,
        bytes memory data
    )
        external
        onlyRole(MINTER_ROLE)
        whenNotPaused
    {
        require(to != address(0), "LoraNFTOWN: mint to zero address");
        require(
            tokenIds.length == amounts.length,
            "LoraNFTOWN: ids and amounts length mismatch"
        );
        
        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(!tokenLocked[tokenIds[i]], "LoraNFTOWN: token is locked");
            totalSupply[tokenIds[i]] += amounts[i];
            emit BatchMinted(to, tokenIds[i], amounts[i]);
        }
        
        _mintBatch(to, tokenIds, amounts, data);
    }

    // ================ URI MANAGEMENT ================

    /**
     * @dev Set the URI for a token's metadata
     * @param tokenId Token ID to update
     * @param newuri New URI to set
     */
    function setURI(uint256 tokenId, string memory newuri) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _tokenURIs[tokenId] = newuri;
        emit TokenURISet(tokenId, newuri);
    }

    /**
     * @dev Get the URI for a token's metadata
     * @param tokenId Token ID to query
     */
    function uri(uint256 tokenId) 
        public 
        view 
        virtual 
        override 
        returns (string memory) 
    {
        return _tokenURIs[tokenId];
    }

    // ================ LOCKING FUNCTIONS ================

    /**
     * @dev Lock or unlock a token
     * @param tokenId Token ID to update
     * @param locked New lock status
     */
    function setTokenLockStatus(uint256 tokenId, bool locked)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        tokenLocked[tokenId] = locked;
        emit TokenLockStatusUpdated(tokenId, locked);
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
            require(!tokenLocked[ids[i]], "LoraNFTOWN: token is locked");
        }
    }

    /**
     * @dev Required override for UUPS proxy pattern
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(UPGRADER_ROLE)
    {}

    // ================ VIEW FUNCTIONS ================

    /**
     * @dev Get the total supply of a token
     * @param tokenId Token ID to query
     */
    function getTokenTotalSupply(uint256 tokenId) 
        external 
        view 
        returns (uint256) 
    {
        return totalSupply[tokenId];
    }

    /**
     * @dev Check if a token is locked
     * @param tokenId Token ID to query
     */
    function isTokenLocked(uint256 tokenId) 
        external 
        view 
        returns (bool) 
    {
        return tokenLocked[tokenId];
    }
}














































 // ================ VScode/node.js/...Deploy.js ================
const { ethers, upgrades } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // Deploy LORA Token
    console.log("\nDeploying LORA Token...");
    const LoraToken = await ethers.getContractFactory("LoraToken");
    const loraToken = await LoraToken.deploy(
        deployer.address, // initialOwner
        deployer.address, // governance
        deployer.address, // emergencyMultisig
        deployer.address, // feeCollector
        "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" // ETH/USD Chainlink Price Feed for Mainnet
    );
    await loraToken.deployed();
    console.log("LoraToken deployed to:", loraToken.address);

    // Deploy RWA Contract
    console.log("\nDeploying LORA RWA Contract...");
    const LoraRWA = await ethers.getContractFactory("LoraRWA");
    const loraRWA = await upgrades.deployProxy(LoraRWA, [
        deployer.address,
        loraToken.address,
        "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" // ETH/USD Chainlink Price Feed
    ], {
        initializer: 'initialize',
        kind: 'uups'
    });
    await loraRWA.deployed();
    console.log("LoraRWA deployed to:", loraRWA.address);

    // Deploy NFT-OWN Contract
    console.log("\nDeploying LORA NFT-OWN Contract...");
    const LoraNFTOWN = await ethers.getContractFactory("LoraNFTOWN");
    const loraNFTOWN = await upgrades.deployProxy(LoraNFTOWN, [
        deployer.address,
        loraRWA.address
    ], {
        initializer: 'initialize',
        kind: 'uups'
    });
    await loraNFTOWN.deployed();
    console.log("LoraNFTOWN deployed to:", loraNFTOWN.address);

    // Setup roles and permissions
    console.log("\nSetting up roles and permissions...");

    // Grant roles in RWA contract
    const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));
    const APPRAISER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("APPRAISER_ROLE"));
    const COMPLIANCE_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("COMPLIANCE_ROLE"));
    
    await loraRWA.grantRole(MINTER_ROLE, deployer.address);
    await loraRWA.grantRole(APPRAISER_ROLE, deployer.address);
    await loraRWA.grantRole(COMPLIANCE_ROLE, deployer.address);

    // Grant roles in NFT-OWN contract
    await loraNFTOWN.grantRole(MINTER_ROLE, deployer.address);

    console.log("\nDeployment completed!");
    console.log("===========================================");
    console.log("Deployed Contracts:");
    console.log("-------------------------------------------");
    console.log("LORA Token:", loraToken.address);
    console.log("LORA RWA:", loraRWA.address);
    console.log("LORA NFT-OWN:", loraNFTOWN.address);
    console.log("===========================================");

    // Verify contracts on Etherscan
    if (network.name !== "hardhat" && network.name !== "localhost") {
        console.log("\nVerifying contracts on Etherscan...");
        
        await hre.run("verify:verify", {
            address: loraToken.address,
            constructorArguments: [
                deployer.address,
                deployer.address,
                deployer.address,
                deployer.address,
                "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"
            ],
        });

        // Note: Proxy contracts need different verification
        console.log("Please verify implementation contracts manually using hardhat-etherscan");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


Hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0000000000000000000000000000000000000000000000000000000000000000";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const INFURA_API_KEY = process.env.INFURA_API_KEY || "";
const COINMARKETCAP_API_KEY = process.env.COINMARKETCAP_API_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.30",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            },
            viaIR: true
        }
    },
    networks: {
        hardhat: {
            chainId: 1337,
            allowUnlimitedContractSize: false,
            gas: "auto",
            gasPrice: "auto",
            mining: {
                auto: true,
                interval: 0
            }
        },
        mainnet: {
            url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
            accounts: [PRIVATE_KEY],
            chainId: 1,
            gasPrice: "auto",
            verify: {
                etherscan: {
                    apiKey: ETHERSCAN_API_KEY
                }
            }
        },
        sepolia: {
            url: `https://sepolia.infura.io/v3/${INFURA_API_KEY}`,
            accounts: [PRIVATE_KEY],
            chainId: 11155111,
            verify: {
                etherscan: {
                    apiKey: ETHERSCAN_API_KEY
                }
            }
        },
        bsc: {
            url: "https://bsc-dataseed.binance.org",
            accounts: [PRIVATE_KEY],
            chainId: 56,
            verify: {
                etherscan: {
                    apiUrl: "https://api.bscscan.com/",
                    apiKey: process.env.BSCSCAN_API_KEY || ""
                }
            }
        },
        polygon: {
            url: `https://polygon-mainnet.infura.io/v3/${INFURA_API_KEY}`,
            accounts: [PRIVATE_KEY],
            chainId: 137,
            verify: {
                etherscan: {
                    apiUrl: "https://api.polygonscan.com/",
                    apiKey: process.env.POLYGONSCAN_API_KEY || ""
                }
            }
        }
    },
    etherscan: {
        apiKey: {
            mainnet: ETHERSCAN_API_KEY,
            sepolia: ETHERSCAN_API_KEY,
            bsc: process.env.BSCSCAN_API_KEY || "",
            polygon: process.env.POLYGONSCAN_API_KEY || ""
        }
    },
    gasReporter: {
        enabled: true,
        currency: "USD",
        coinmarketcap: COINMARKETCAP_API_KEY,
        token: "ETH",
        gasPriceApi: "https://api.etherscan.io/api?module=proxy&action=eth_gasPrice",
        showTimeSpent: true,
        excludeContracts: ["mock/", "test/"]
    },
    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts"
    },
    mocha: {
        timeout: 40000
    }
};
