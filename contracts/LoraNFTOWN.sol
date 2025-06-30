// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./LoraRWA.sol";

/**
 * @title LoraNFTOWN
 * @dev NFT ownership representation for RWA tokens
 * @author Lora Finance
 */
contract LoraNFTOWN is ERC1155, ERC1155URIStorage, AccessControl, Pausable, ReentrancyGuard {
    using Strings for uint256;

    // ================ ROLES ================
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ================ STATE VARIABLES ================
    struct NFTMetadata {
        uint256 assetId;
        string name;
        string symbol;
        string description;
        string imageURI;
        string externalURI;
        uint256 totalSupply;
        uint256 circulatingSupply;
        bool isLocked;
        uint256 lockExpiry;
        address lockOwner;
    }

    mapping(uint256 => NFTMetadata) public nftMetadata;
    mapping(uint256 => bool) public tokenLocked;
    mapping(uint256 => mapping(address => uint256)) public lockExpiry;
    mapping(address => uint256[]) public userTokens;

    LoraRWA public loraRWA;
    uint256 public nextTokenId;
    string public baseURI;

    // ================ EVENTS ================
    event NFTMinted(uint256 indexed tokenId, uint256 indexed assetId, address indexed owner, uint256 amount);
    event NFTBurned(uint256 indexed tokenId, address indexed owner, uint256 amount);
    event NFTLocked(uint256 indexed tokenId, address indexed owner, uint256 lockDuration);
    event NFTUnlocked(uint256 indexed tokenId, address indexed owner);
    event MetadataUpdated(uint256 indexed tokenId, string name, string symbol);
    event BaseURIUpdated(string newBaseURI);

    // ================ CONSTRUCTOR ================
    constructor(address admin, address _loraRWA) ERC1155("") {
        require(admin != address(0), "Invalid admin address");
        require(_loraRWA != address(0), "Invalid RWA contract address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        loraRWA = LoraRWA(_loraRWA);
        nextTokenId = 1;
        baseURI = "https://api.lora.finance/nft/";
    }

    // ================ NFT MINTING & BURNING ================
    function mintNFT(
        uint256 assetId,
        address owner,
        uint256 amount,
        string memory name,
        string memory symbol,
        string memory description,
        string memory imageURI,
        string memory externalURI
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        require(owner != address(0), "Invalid owner");
        require(amount > 0, "Invalid amount");
        require(bytes(name).length > 0, "Empty name");
        require(bytes(symbol).length > 0, "Empty symbol");
        uint256 tokenId = nextTokenId;
        nextTokenId++;
        nftMetadata[tokenId] = NFTMetadata({
            assetId: assetId,
            name: name,
            symbol: symbol,
            description: description,
            imageURI: imageURI,
            externalURI: externalURI,
            totalSupply: amount,
            circulatingSupply: amount,
            isLocked: false,
            lockExpiry: 0,
            lockOwner: address(0)
        });
        _mint(owner, tokenId, amount, "");
        userTokens[owner].push(tokenId);
        _setURI(tokenId, string(abi.encodePacked(baseURI, tokenId.toString())));
        emit NFTMinted(tokenId, assetId, owner, amount);
        return tokenId;
    }

    function burnNFT(uint256 tokenId, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(amount > 0, "Invalid amount");
        require(nftMetadata[tokenId].assetId != 0, "NFT does not exist");
        address owner = msg.sender;
        require(balanceOf(owner, tokenId) >= amount, "Insufficient balance");
        require(!tokenLocked[tokenId], "Token is locked");
        _burn(owner, tokenId, amount);
        nftMetadata[tokenId].circulatingSupply -= amount;
        emit NFTBurned(tokenId, owner, amount);
    }

    // ================ LOCKING FUNCTIONS ================
    function lockNFT(uint256 tokenId, uint256 lockDuration) external {
        require(balanceOf(msg.sender, tokenId) > 0, "No tokens to lock");
        require(lockDuration > 0, "Invalid lock duration");
        require(!tokenLocked[tokenId], "Token already locked");
        require(nftMetadata[tokenId].assetId != 0, "NFT does not exist");
        tokenLocked[tokenId] = true;
        lockExpiry[tokenId][msg.sender] = block.timestamp + lockDuration;
        nftMetadata[tokenId].isLocked = true;
        nftMetadata[tokenId].lockExpiry = block.timestamp + lockDuration;
        nftMetadata[tokenId].lockOwner = msg.sender;
        emit NFTLocked(tokenId, msg.sender, lockDuration);
    }
    function unlockNFT(uint256 tokenId) external {
        require(tokenLocked[tokenId], "Token not locked");
        require(lockExpiry[tokenId][msg.sender] <= block.timestamp, "Lock not expired");
        require(nftMetadata[tokenId].lockOwner == msg.sender, "Not lock owner");
        tokenLocked[tokenId] = false;
        lockExpiry[tokenId][msg.sender] = 0;
        nftMetadata[tokenId].isLocked = false;
        nftMetadata[tokenId].lockExpiry = 0;
        nftMetadata[tokenId].lockOwner = address(0);
        emit NFTUnlocked(tokenId, msg.sender);
    }
    function forceUnlockNFT(uint256 tokenId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(tokenLocked[tokenId], "Token not locked");
        address lockOwner = nftMetadata[tokenId].lockOwner;
        tokenLocked[tokenId] = false;
        lockExpiry[tokenId][lockOwner] = 0;
        nftMetadata[tokenId].isLocked = false;
        nftMetadata[tokenId].lockExpiry = 0;
        nftMetadata[tokenId].lockOwner = address(0);
        emit NFTUnlocked(tokenId, lockOwner);
    }

    // ================ METADATA FUNCTIONS ================
    function updateMetadata(
        uint256 tokenId,
        string memory name,
        string memory symbol,
        string memory description,
        string memory imageURI,
        string memory externalURI
    ) external onlyRole(MINTER_ROLE) {
        require(nftMetadata[tokenId].assetId != 0, "NFT does not exist");
        nftMetadata[tokenId].name = name;
        nftMetadata[tokenId].symbol = symbol;
        nftMetadata[tokenId].description = description;
        nftMetadata[tokenId].imageURI = imageURI;
        nftMetadata[tokenId].externalURI = externalURI;
        emit MetadataUpdated(tokenId, name, symbol);
    }
    function updateBaseURI(string memory newBaseURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }
    function setTokenURI(uint256 tokenId, string memory newuri) external onlyRole(MINTER_ROLE) {
        _setURI(tokenId, newuri);
    }
    function uri(uint256 tokenId) public view override(ERC1155, ERC1155URIStorage) returns (string memory) {
        return ERC1155URIStorage.uri(tokenId);
    }

    // ================ LOCKING FUNCTIONS ================
    function setTokenLockStatus(uint256 tokenId, bool locked) external onlyRole(DEFAULT_ADMIN_ROLE) {
        tokenLocked[tokenId] = locked;
        emit NFTLocked(tokenId, address(0), 0);
    }

    // ================ OVERRIDE FUNCTIONS ================
    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal override(ERC1155) {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
        for (uint256 i = 0; i < ids.length; i++) {
            require(!tokenLocked[ids[i]], "LoraNFTOWN: token is locked");
        }
    }
    function _setURI(uint256 tokenId, string memory newuri) internal override(ERC1155URIStorage) {
        ERC1155URIStorage._setURI(tokenId, newuri);
    }
    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, ERC1155URIStorage, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
    // ================ VIEW FUNCTIONS ================
    function getTokenTotalSupply(uint256 tokenId) external view returns (uint256) {
        return nftMetadata[tokenId].totalSupply;
    }
    function isTokenLocked(uint256 tokenId) external view returns (bool) {
        return tokenLocked[tokenId];
    }
    function getNFTMetadata(uint256 tokenId) external view returns (
        uint256 assetId,
        string memory name,
        string memory symbol,
        string memory description,
        string memory imageURI,
        string memory externalURI,
        uint256 totalSupply,
        uint256 circulatingSupply,
        bool isLocked,
        uint256 lockExpiry,
        address lockOwner
    ) {
        NFTMetadata storage metadata = nftMetadata[tokenId];
        return (
            metadata.assetId,
            metadata.name,
            metadata.symbol,
            metadata.description,
            metadata.imageURI,
            metadata.externalURI,
            metadata.totalSupply,
            metadata.circulatingSupply,
            metadata.isLocked,
            metadata.lockExpiry,
            metadata.lockOwner
        );
    }
    function getUserTokens(address user) external view returns (uint256[] memory) {
        return userTokens[user];
    }
    function getLockExpiry(uint256 tokenId, address owner) external view returns (uint256) {
        return lockExpiry[tokenId][owner];
    }
    function isLockExpired(uint256 tokenId, address owner) external view returns (bool) {
        return lockExpiry[tokenId][owner] <= block.timestamp;
    }
} 