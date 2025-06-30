const { ethers, upgrades } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    // Get network configuration
    const network = await ethers.provider.getNetwork();
    console.log("Network:", network.name);
    console.log("Chain ID:", network.chainId);

    // Price feed addresses based on network
    let priceFeedAddress;
    switch (network.chainId) {
        case 1: // Ethereum Mainnet
            priceFeedAddress = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"; // ETH/USD
            break;
        case 11155111: // Sepolia
            priceFeedAddress = "0x694AA1769357215DE4FAC081bf1f309aDC325306"; // ETH/USD
            break;
        case 5: // Goerli
            priceFeedAddress = "0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e"; // ETH/USD
            break;
        case 56: // BSC Mainnet
            priceFeedAddress = "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE"; // BNB/USD
            break;
        case 97: // BSC Testnet
            priceFeedAddress = "0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526"; // BNB/USD
            break;
        case 137: // Polygon Mainnet
            priceFeedAddress = "0xAB594600376Ec9fD91F8e885dADF0CE036862dE0"; // MATIC/USD
            break;
        case 80001: // Polygon Mumbai
            priceFeedAddress = "0xd0D5e3DB44DE05E9F294BB0a3bEEaF030DE24Ada"; // MATIC/USD
            break;
        default:
            // For local development, use a mock price feed
            console.log("Deploying mock price feed for local development...");
            const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
            const mockPriceFeed = await MockPriceFeed.deploy();
            await mockPriceFeed.deployed();
            priceFeedAddress = mockPriceFeed.address;
            console.log("MockPriceFeed deployed to:", mockPriceFeed.address);
    }

    console.log("Using price feed address:", priceFeedAddress);

    try {
        // Deploy LORA Token
        console.log("\nDeploying LORA Token...");
        const LoraToken = await ethers.getContractFactory("LoraToken");
        const loraToken = await LoraToken.deploy(
            deployer.address, // initialOwner
            deployer.address, // governance
            deployer.address, // emergencyMultisig
            deployer.address, // feeCollector
            priceFeedAddress // priceFeed
        );
        await loraToken.deployed();
        console.log("LoraToken deployed to:", loraToken.address);

        // Deploy RWA Contract
        console.log("\nDeploying LORA RWA Contract...");
        const LoraRWA = await ethers.getContractFactory("LoraRWA");
        const loraRWA = await upgrades.deployProxy(LoraRWA, [
            deployer.address, // admin
            loraToken.address, // loraToken
            priceFeedAddress // priceFeed
        ], {
            initializer: 'initialize',
            kind: 'uups'
        });
        await loraRWA.deployed();
        console.log("LoraRWA deployed to:", loraRWA.address);

        // Deploy NFT-OWN Contract
        console.log("\nDeploying LORA NFT-OWN Contract...");
        const LoraNFTOWN = await ethers.getContractFactory("LoraNFTOWN");
        const loraNFTOWN = await LoraNFTOWN.deploy(
            deployer.address, // admin
            loraRWA.address // loraRWA
        );
        await loraNFTOWN.deployed();
        console.log("LoraNFTOWN deployed to:", loraNFTOWN.address);

        // Setup roles and permissions
        console.log("\nSetting up roles and permissions...");

        // Grant roles in RWA contract
        const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));
        const APPRAISER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("APPRAISER_ROLE"));
        const COMPLIANCE_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("COMPLIANCE_ROLE"));
        const ADMIN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ADMIN_ROLE"));

        await loraRWA.grantRole(MINTER_ROLE, deployer.address);
        await loraRWA.grantRole(APPRAISER_ROLE, deployer.address);
        await loraRWA.grantRole(COMPLIANCE_ROLE, deployer.address);
        await loraRWA.grantRole(ADMIN_ROLE, deployer.address);

        // Grant roles in NFT-OWN contract
        await loraNFTOWN.grantRole(MINTER_ROLE, deployer.address);

        // Grant roles in LORA Token
        await loraToken.grantRole(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GOVERNANCE_ROLE")), deployer.address);
        await loraToken.grantRole(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EMERGENCY_ROLE")), deployer.address);
        await loraToken.grantRole(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FEE_COLLECTOR_ROLE")), deployer.address);
        await loraToken.grantRole(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE")), deployer.address);

        console.log("\nDeployment completed successfully!");
        console.log("===========================================");
        console.log("Deployed Contracts:");
        console.log("-------------------------------------------");
        console.log("LORA Token:", loraToken.address);
        console.log("LORA RWA:", loraRWA.address);
        console.log("LORA NFT-OWN:", loraNFTOWN.address);
        console.log("Price Feed:", priceFeedAddress);
        console.log("===========================================");

        // Save deployment info
        const deploymentInfo = {
            network: network.name,
            chainId: network.chainId,
            deployer: deployer.address,
            contracts: {
                loraToken: loraToken.address,
                loraRWA: loraRWA.address,
                loraNFTOWN: loraNFTOWN.address,
                priceFeed: priceFeedAddress
            },
            timestamp: new Date().toISOString()
        };

        // Write deployment info to file
        const fs = require('fs');
        const path = require('path');
        const deploymentsDir = path.join(__dirname, '../deployments');
        
        if (!fs.existsSync(deploymentsDir)) {
            fs.mkdirSync(deploymentsDir, { recursive: true });
        }
        
        fs.writeFileSync(
            path.join(deploymentsDir, `${network.name}.json`),
            JSON.stringify(deploymentInfo, null, 2)
        );

        console.log(`\nDeployment info saved to: deployments/${network.name}.json`);

        // Verify contracts on Etherscan (if not local network)
        if (network.chainId !== 1337 && network.chainId !== 31337) {
            console.log("\nVerifying contracts on Etherscan...");
            
            try {
                // Verify LORA Token
                await hre.run("verify:verify", {
                    address: loraToken.address,
                    constructorArguments: [
                        deployer.address,
                        deployer.address,
                        deployer.address,
                        deployer.address,
                        priceFeedAddress
                    ],
                });
                console.log("LORA Token verified on Etherscan");
            } catch (error) {
                console.log("LORA Token verification failed:", error.message);
            }

            // Note: Proxy contracts need different verification
            console.log("Please verify implementation contracts manually using hardhat-etherscan");
        }

    } catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 