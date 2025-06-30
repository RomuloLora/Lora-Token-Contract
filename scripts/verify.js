const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Verifying contracts with account:", deployer.address);

    // Get network configuration
    const network = await ethers.provider.getNetwork();
    console.log("Network:", network.name);
    console.log("Chain ID:", network.chainId);

    // Load deployment info
    const deploymentsDir = path.join(__dirname, '../deployments');
    const deploymentFile = path.join(deploymentsDir, `${network.name}.json`);
    
    if (!fs.existsSync(deploymentFile)) {
        console.error(`Deployment file not found: ${deploymentFile}`);
        console.log("Please run deployment first: npx hardhat run scripts/deploy.js --network <network>");
        process.exit(1);
    }

    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
    console.log("Loaded deployment info:", deploymentInfo);

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
            console.error("Unsupported network for verification");
            process.exit(1);
    }

    try {
        // Verify LORA Token
        console.log("\nVerifying LORA Token...");
        try {
            await hre.run("verify:verify", {
                address: deploymentInfo.contracts.loraToken,
                constructorArguments: [
                    deploymentInfo.deployer, // initialOwner
                    deploymentInfo.deployer, // governance
                    deploymentInfo.deployer, // emergencyMultisig
                    deploymentInfo.deployer, // feeCollector
                    priceFeedAddress // priceFeed
                ],
            });
            console.log("✅ LORA Token verified successfully");
        } catch (error) {
            if (error.message.includes("Already Verified")) {
                console.log("✅ LORA Token already verified");
            } else {
                console.log("❌ LORA Token verification failed:", error.message);
            }
        }

        // Verify LORA RWA (Proxy)
        console.log("\nVerifying LORA RWA (Proxy)...");
        try {
            await hre.run("verify:verify", {
                address: deploymentInfo.contracts.loraRWA,
                constructorArguments: [],
            });
            console.log("✅ LORA RWA proxy verified successfully");
        } catch (error) {
            if (error.message.includes("Already Verified")) {
                console.log("✅ LORA RWA proxy already verified");
            } else {
                console.log("❌ LORA RWA proxy verification failed:", error.message);
            }
        }

        // Verify LORA NFT-OWN (Proxy)
        console.log("\nVerifying LORA NFT-OWN (Proxy)...");
        try {
            await hre.run("verify:verify", {
                address: deploymentInfo.contracts.loraNFTOWN,
                constructorArguments: [],
            });
            console.log("✅ LORA NFT-OWN proxy verified successfully");
        } catch (error) {
            if (error.message.includes("Already Verified")) {
                console.log("✅ LORA NFT-OWN proxy already verified");
            } else {
                console.log("❌ LORA NFT-OWN proxy verification failed:", error.message);
            }
        }

        // Get implementation addresses for manual verification
        console.log("\nGetting implementation addresses for manual verification...");
        
        try {
            const loraRWA = await ethers.getContractAt("LoraRWA", deploymentInfo.contracts.loraRWA);
            const loraNFTOWN = await ethers.getContractAt("LoraNFTOWN", deploymentInfo.contracts.loraNFTOWN);
            
            // Get implementation addresses (this might not work for all proxy patterns)
            console.log("Implementation addresses for manual verification:");
            console.log("LORA RWA Implementation:", await upgrades.erc1967.getImplementationAddress(deploymentInfo.contracts.loraRWA));
            console.log("LORA NFT-OWN Implementation:", await upgrades.erc1967.getImplementationAddress(deploymentInfo.contracts.loraNFTOWN));
        } catch (error) {
            console.log("Could not get implementation addresses:", error.message);
        }

        console.log("\n===========================================");
        console.log("Verification Summary:");
        console.log("-------------------------------------------");
        console.log("Network:", network.name);
        console.log("LORA Token:", deploymentInfo.contracts.loraToken);
        console.log("LORA RWA:", deploymentInfo.contracts.loraRWA);
        console.log("LORA NFT-OWN:", deploymentInfo.contracts.loraNFTOWN);
        console.log("Price Feed:", priceFeedAddress);
        console.log("===========================================");
        
        console.log("\nNote: For proxy contracts, you may need to verify the implementation contracts manually.");
        console.log("Check the block explorer for the implementation addresses and verify them separately.");

    } catch (error) {
        console.error("Verification process failed:", error);
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 