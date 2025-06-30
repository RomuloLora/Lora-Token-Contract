// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title MockPriceFeed
 * @dev Mock price feed for local testing
 * @author Lora Finance
 */
contract MockPriceFeed is AggregatorV3Interface {
    int256 private _price;
    uint8 private _decimals;
    string private _description;
    uint256 private _version;
    
    constructor() {
        _price = 2000 * 10**8; // $2000 USD (8 decimals)
        _decimals = 8;
        _description = "ETH / USD";
        _version = 1;
    }
    
    function decimals() external view override returns (uint8) {
        return _decimals;
    }
    
    function description() external view override returns (string memory) {
        return _description;
    }
    
    function version() external view override returns (uint256) {
        return _version;
    }
    
    function getRoundData(uint80 _roundId) external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (_roundId, _price, block.timestamp, block.timestamp, _roundId);
    }
    
    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (1, _price, block.timestamp, block.timestamp, 1);
    }
    
    /**
     * @dev Set mock price (for testing)
     * @param newPrice New price in USD (8 decimals)
     */
    function setPrice(int256 newPrice) external {
        _price = newPrice;
    }
    
    /**
     * @dev Get current mock price
     */
    function getPrice() external view returns (int256) {
        return _price;
    }
} 