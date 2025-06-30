# LORA Token - Deployment Guide

## Prerequisites

Before deploying the LORA Token contracts, ensure you have the following:

### Software Requirements
- Node.js (v16 or higher)
- npm or yarn
- Git

### Accounts and API Keys
- **Private Key**: Your deployment wallet private key
- **Infura API Key**: For Ethereum network access
- **Etherscan API Key**: For contract verification
- **BSCScan API Key**: For BSC deployment verification
- **PolygonScan API Key**: For Polygon deployment verification

### Network-Specific Requirements
- **Ethereum Mainnet**: Sufficient ETH for deployment gas
- **Polygon**: Sufficient MATIC for deployment gas
- **BSC**: Sufficient BNB for deployment gas
- **Testnets**: Test tokens from faucets

## Environment Setup

### 1. Clone the Repository
```bash
git clone https://github.com/RomuloLora/Lora-Token-Contract.git
cd Lora-Token-Contract
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
```bash
cp env.example .env
```

Edit the `.env` file with your configuration:
```env
# Network Configuration
PRIVATE_KEY=your_private_key_here
INFURA_API_KEY=your_infura_api_key_here

# API Keys for Contract Verification
ETHERSCAN_API_KEY=your_etherscan_api_key_here
BSCSCAN_API_KEY=your_bscscan_api_key_here
POLYGONSCAN_API_KEY=your_polygonscan_api_key_here

# Gas Reporter Configuration
COINMARKETCAP_API_KEY=your_coinmarketcap_api_key_here
```

## Deployment Process

### Step 1: Compile Contracts
```bash
npm run compile
```

### Step 2: Run Tests (Recommended)
```bash
npm test
```

### Step 3: Deploy to Target Network

#### Local Development
```bash
# Start local blockchain
npx hardhat node

# Deploy contracts locally
npm run deploy:local
```

#### Testnet Deployment (Sepolia)
```bash
npm run deploy:sepolia
```

#### Mainnet Deployment
```bash
npm run deploy:mainnet
```

### Step 4: Verify Contracts
```bash
# Verify on Sepolia
npm run verify:sepolia

# Verify on Mainnet
npm run verify:mainnet
```

## Deployment Scripts

### Main Deployment Script (`scripts/deploy.js`)

The main deployment script performs the following operations:

1. **Network Detection**: Automatically detects the target network
2. **Price Feed Selection**: Selects appropriate Chainlink price feed for the network
3. **Contract Deployment**: Deploys all three contracts in the correct order
4. **Role Assignment**: Sets up all necessary roles and permissions
5. **Configuration**: Applies initial configuration settings
6. **Verification**: Attempts to verify contracts on block explorers
7. **Documentation**: Saves deployment information to JSON files

### Verification Script (`scripts/verify.js`)

The verification script:
1. Loads deployment information from JSON files
2. Verifies contracts on the appropriate block explorer
3. Provides implementation addresses for manual verification

## Contract Deployment Order

The contracts must be deployed in the following order:

1. **LoraToken**: Main ERC20 token
2. **LoraRWA**: Real World Assets contract
3. **LoraNFTOWN**: NFT ownership contract

This order is necessary because:
- LoraRWA depends on LoraToken address
- LoraNFTOWN depends on LoraRWA address

## Network-Specific Configuration

### Ethereum Mainnet
- **Chain ID**: 1
- **Price Feed**: ETH/USD
- **Gas Price**: Auto (recommended)
- **Verification**: Etherscan

### Sepolia Testnet
- **Chain ID**: 11155111
- **Price Feed**: ETH/USD
- **Gas Price**: Auto
- **Verification**: Etherscan

### Polygon Mainnet
- **Chain ID**: 137
- **Price Feed**: MATIC/USD
- **Gas Price**: Auto
- **Verification**: PolygonScan

### BSC Mainnet
- **Chain ID**: 56
- **Price Feed**: BNB/USD
- **Gas Price**: Auto
- **Verification**: BSCScan

## Post-Deployment Setup

### 1. Verify Contract Addresses
After deployment, verify that all contracts are deployed correctly:
```bash
cat deployments/mainnet.json
```

### 2. Set Up Roles and Permissions
The deployment script automatically sets up basic roles, but you may need to:
- Grant additional roles to team members
- Set up multi-signature wallets for admin roles
- Configure governance parameters

### 3. Initialize Platform
- Register initial assets
- Set up compliance parameters
- Configure staking rewards
- Set up governance proposals

### 4. Test Platform Functions
- Test token transfers
- Test staking functionality
- Test asset registration and tokenization
- Test governance proposals

## Security Considerations

### Private Key Security
- Never commit private keys to version control
- Use hardware wallets for mainnet deployments
- Consider using multi-signature wallets for admin functions

### Contract Verification
- Always verify contracts on block explorers
- Verify implementation contracts for proxy contracts
- Document all contract addresses and ABIs

### Access Control
- Review and test all role assignments
- Implement proper access control procedures
- Consider time-locked admin functions

## Troubleshooting

### Common Issues

#### 1. Insufficient Gas
**Error**: `insufficient funds for gas`
**Solution**: Ensure your wallet has sufficient native tokens for gas fees

#### 2. Network Connection Issues
**Error**: `network connection failed`
**Solution**: Check your Infura API key and network configuration

#### 3. Contract Verification Failures
**Error**: `contract verification failed`
**Solution**: 
- Check constructor arguments
- Verify compiler settings match deployment
- Use manual verification for proxy contracts

#### 4. Role Assignment Failures
**Error**: `AccessControl: account not granted role`
**Solution**: Ensure the deployer has the necessary roles

### Debug Commands

```bash
# Check network configuration
npx hardhat console --network mainnet

# Verify contract bytecode
npx hardhat verify --help

# Check gas usage
REPORT_GAS=true npm test

# Clean and recompile
npm run clean
npm run compile
```

## Monitoring and Maintenance

### Contract Monitoring
- Monitor contract events for unusual activity
- Track gas usage and optimize if necessary
- Monitor oracle prices for accuracy

### Regular Maintenance
- Update compliance parameters as needed
- Review and update governance proposals
- Monitor staking rewards and adjust rates
- Update asset valuations regularly

### Emergency Procedures
- Know how to pause contracts if needed
- Have emergency contact procedures
- Document rollback procedures
- Test emergency functions regularly

## Support and Resources

### Documentation
- [Architecture Documentation](./ARCHITECTURE.md)
- [API Documentation](./API.md)
- [Security Documentation](./SECURITY.md)

### Community
- GitHub Issues: [Report bugs and request features](https://github.com/RomuloLora/Lora-Token-Contract/issues)
- GitHub Discussions: [Community discussions](https://github.com/RomuloLora/Lora-Token-Contract/discussions)

### Tools
- [Hardhat Documentation](https://hardhat.org/docs)
- [OpenZeppelin Documentation](https://docs.openzeppelin.com/)
- [Chainlink Documentation](https://docs.chain.link/) 